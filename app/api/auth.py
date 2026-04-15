from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.payments import Subscription
from app.models.profile import Profile
from app.models.user import User
from app.services.auth import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    get_password_hash,
    verify_password,
)
from app.services.growth import apply_referral_code, generate_referral_code, get_request_ip, resolve_referrer_by_code
from app.services.rate_limit import rate_limit
from app.services.redis_runtime import invalidate_discover_cache, invalidate_match_suggestions_cache
from app.services.subscriptions import FREE_PLAN, STATUS_ACTIVE


router = APIRouter(prefix="/auth")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str | None = None
    age: int | None = None
    bio: str | None = None
    location: str | None = None
    gender: str | None = None
    travel_style: str | None = None
    interests: list[str] | None = None
    budget_min: int | None = None
    budget_max: int | None = None


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    created_at: object
    profile: ProfileRead | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserRead


class SignupRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    name: str | None = Field(default=None, max_length=120)
    age: int | None = Field(default=None, ge=18, le=120)
    bio: str | None = Field(default=None, max_length=500)
    travel_style: str | None = Field(default=None, max_length=64)
    referral_code: str | None = Field(default=None, max_length=32)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not EMAIL_RE.match(normalized):
            raise ValueError("Invalid email address")
        return normalized


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not EMAIL_RE.match(normalized):
            raise ValueError("Invalid email address")
        return normalized


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(min_length=32, max_length=4096)


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(
    payload: SignupRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit("auth_signup", 10, 300)),
) -> TokenResponse:
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    if payload.referral_code:
        resolve_referrer_by_code(db, payload.referral_code)

    user = User(email=payload.email, password_hash=get_password_hash(payload.password))
    profile = Profile(name=payload.name, age=payload.age, bio=payload.bio, travel_style=payload.travel_style, user=user)
    subscription = Subscription(
        user=user,
        plan_type=FREE_PLAN,
        status=STATUS_ACTIVE,
        current_period_end=None,
        stripe_customer_id=None,
        stripe_subscription_id=None,
    )
    db.add_all([user, profile, subscription])

    try:
        db.flush()
        user.referral_code = generate_referral_code(user.id)
        if payload.referral_code:
            apply_referral_code(
                db=db,
                referred_user=user,
                referral_code=payload.referral_code,
                referral_ip=get_request_ip(request),
                commit=False,
            )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        if "uq_app_referrals_referrer_referral_ip" in str(exc.orig):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Suspicious referral activity detected") from exc
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to create user") from exc

    db.refresh(user)
    invalidate_discover_cache()
    invalidate_match_suggestions_cache()
    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserRead.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit("auth_login", 20, 300)),
) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserRead.model_validate(user),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_access_token(
    payload: RefreshTokenRequest,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit("auth_refresh", 30, 300)),
) -> TokenResponse:
    token_payload = decode_refresh_token(payload.refresh_token)
    user_id = token_payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = db.scalar(select(User).where(User.id == int(user_id)))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserRead.model_validate(user),
    )
