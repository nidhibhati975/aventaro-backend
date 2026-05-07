from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.payments import Subscription
from app.models.profile import Profile
from app.models.security import AuthSession
from app.models.user import User
from app.services.auth import (
    create_token_pair,
    assert_access_session_valid,
    decode_access_token,
    ensure_aware_utc,
    extract_bearer_token,
    get_current_user,
    get_password_hash,
    revoke_user_sessions,
    rotate_refresh_session,
    verify_password,
)
from app.services.growth import apply_referral_code, generate_referral_code, get_request_ip, resolve_referrer_by_code
from app.services.mfa import create_mfa_challenge, verify_mfa_challenge
from app.services.rate_limit import rate_limit
from app.services.redis_runtime import invalidate_discover_cache, invalidate_match_suggestions_cache
from app.services.security import detect_login_anomaly, record_security_event
from app.services.subscriptions import FREE_PLAN, STATUS_ACTIVE
from app.utils.config import get_settings


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
    role: str = "user"
    created_at: object
    profile: ProfileRead | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    device_id: str | None = None
    user: UserRead


class MfaRequiredResponse(BaseModel):
    mfa_required: bool = True
    challenge_id: str
    channel: str
    destination_hint: str
    user_id: int


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


class MfaVerifyRequest(BaseModel):
    challenge_id: str = Field(min_length=8, max_length=128)
    code: str = Field(min_length=6, max_length=12)
    device_id: str | None = Field(default=None, max_length=128)


class MfaStartRequest(BaseModel):
    channel: str = Field(default="email", pattern="^(email|sms)$")
    destination: str | None = Field(default=None, max_length=255)


class PasswordResetRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not EMAIL_RE.match(normalized):
            raise ValueError("Invalid email address")
        return normalized


class PasswordResetConfirmRequest(BaseModel):
    challenge_id: str = Field(min_length=8, max_length=128)
    code: str = Field(min_length=6, max_length=12)
    new_password: str = Field(min_length=8, max_length=128)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class MfaStatusResponse(BaseModel):
    enabled: bool
    channel: str | None = None
    phone_number: str | None = None


class SessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: str
    user_agent: str | None
    ip_address: str | None
    created_at: object
    last_used_at: object | None
    expires_at: object
    revoked_at: object | None


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(
    payload: SignupRequest,
    request: Request,
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
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
    access_token, refresh_token, auth_session = create_token_pair(db, user=user, request=request, device_id=x_device_id)
    record_security_event(db, event_type="auth_signup_success", user_id=user.id, request=request)
    db.commit()
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        device_id=auth_session.device_id,
        user=UserRead.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse | MfaRequiredResponse)
def login(
    payload: LoginRequest,
    request: Request,
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit("auth_login", 20, 300)),
) -> TokenResponse | MfaRequiredResponse:
    user = db.scalar(select(User).where(User.email == payload.email))
    now = datetime.now(timezone.utc)
    if user is not None and user.locked_until is not None and ensure_aware_utc(user.locked_until) > now:
        record_security_event(
            db,
            event_type="auth_login_locked",
            user_id=user.id,
            request=request,
            risk_level="high",
            details={"locked_until": user.locked_until.isoformat()},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account temporarily locked")
    if user is None or not verify_password(payload.password, user.password_hash):
        if user is not None:
            user.failed_login_count += 1
            settings = get_settings()
            if user.failed_login_count >= settings.auth_lockout_threshold:
                user.locked_until = now + timedelta(minutes=settings.auth_lockout_minutes)
                revoke_user_sessions(db, user_id=user.id, reason="account_locked")
            record_security_event(
                db,
                event_type="auth_login_failed",
                user_id=user.id,
                request=request,
                risk_level="high" if user.locked_until is not None else "medium" if user.failed_login_count >= 3 else "low",
                details={
                    "failed_login_count": user.failed_login_count,
                    "locked_until": user.locked_until.isoformat() if user.locked_until is not None else None,
                },
            )
            db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is disabled")

    if user.mfa_enabled:
        challenge = create_mfa_challenge(
            db,
            user=user,
            purpose="login",
            channel=user.mfa_channel or "email",
            request=request,
        )
        destination_hint = challenge.destination
        if "@" in destination_hint:
            local, _, domain = destination_hint.partition("@")
            destination_hint = f"{local[:2]}***@{domain}"
        else:
            destination_hint = f"***{destination_hint[-4:]}"
        return MfaRequiredResponse(
            challenge_id=challenge.challenge_id,
            channel=challenge.channel,
            destination_hint=destination_hint,
            user_id=user.id,
        )

    user.last_login = datetime.now(timezone.utc)
    user.failed_login_count = 0
    user.locked_until = None
    risk_level, anomaly_details = detect_login_anomaly(db, user_id=user.id, request=request)
    access_token, refresh_token, auth_session = create_token_pair(db, user=user, request=request, device_id=x_device_id)
    record_security_event(
        db,
        event_type="auth_login_success",
        user_id=user.id,
        request=request,
        risk_level=risk_level,
        details=anomaly_details,
    )
    db.commit()
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        device_id=auth_session.device_id,
        user=UserRead.model_validate(user),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_access_token(
    payload: RefreshTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit("auth_refresh", 30, 300)),
) -> TokenResponse:
    user, access_token, refresh_token, auth_session = rotate_refresh_session(
        db,
        refresh_token=payload.refresh_token,
        request=request,
    )
    user.last_login = datetime.now(timezone.utc)
    record_security_event(
        db,
        event_type="auth_refresh_rotated",
        user_id=user.id,
        request=request,
        details={"device_id": auth_session.device_id},
    )
    db.commit()
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        device_id=auth_session.device_id,
        user=UserRead.model_validate(user),
    )


@router.post("/logout")
def logout(
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    token = extract_bearer_token(authorization)
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    payload = decode_access_token(token)
    auth_session = assert_access_session_valid(db, payload)
    if auth_session.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication session mismatch")
    if auth_session.revoked_at is None:
        auth_session.revoked_at = datetime.now(timezone.utc)
        auth_session.revoked_reason = "logout"
        record_security_event(
            db,
            event_type="auth_logout",
            user_id=current_user.id,
            request=request,
            details={"session_id": auth_session.id, "device_id": auth_session.device_id},
        )
        db.commit()
    return {"status": "logged_out"}


@router.post("/mfa/login/verify", response_model=TokenResponse)
def verify_login_mfa(
    payload: MfaVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit("auth_mfa_verify", 20, 300)),
) -> TokenResponse:
    challenge = verify_mfa_challenge(
        db,
        challenge_id=payload.challenge_id,
        code=payload.code,
        purpose="login",
        request=request,
        commit=False,
    )
    user = db.scalar(select(User).where(User.id == challenge.user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    user.last_login = datetime.now(timezone.utc)
    user.failed_login_count = 0
    user.locked_until = None
    access_token, refresh_token, auth_session = create_token_pair(db, user=user, request=request, device_id=payload.device_id)
    record_security_event(db, event_type="auth_login_mfa_success", user_id=user.id, request=request)
    db.commit()
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        device_id=auth_session.device_id,
        user=UserRead.model_validate(user),
    )


@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(get_current_user)) -> UserRead:
    return UserRead.model_validate(current_user)


@router.post("/password/reset/request")
def request_password_reset(
    payload: PasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit("auth_password_reset", 5, 300)),
) -> dict[str, str | bool]:
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not user.is_active:
        record_security_event(db, event_type="auth_password_reset_requested_unknown", user_id=None, request=request)
        db.commit()
        return {"status": "accepted", "challenge_created": False}
    challenge = create_mfa_challenge(
        db,
        user=user,
        purpose="password_reset",
        channel=user.mfa_channel or "email",
        request=request,
    )
    record_security_event(db, event_type="auth_password_reset_requested", user_id=user.id, request=request)
    return {"status": "accepted", "challenge_created": True, "challenge_id": challenge.challenge_id}


@router.post("/password/reset/confirm")
def confirm_password_reset(
    payload: PasswordResetConfirmRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit("auth_password_reset_confirm", 10, 300)),
) -> dict[str, str]:
    challenge = verify_mfa_challenge(
        db,
        challenge_id=payload.challenge_id,
        code=payload.code,
        purpose="password_reset",
        request=request,
        commit=False,
    )
    user = db.scalar(select(User).where(User.id == challenge.user_id).with_for_update())
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    user.password_hash = get_password_hash(payload.new_password)
    user.failed_login_count = 0
    user.locked_until = None
    user.last_password_changed_at = datetime.now(timezone.utc)
    revoke_user_sessions(db, user_id=user.id, reason="password_reset")
    record_security_event(db, event_type="auth_password_reset_completed", user_id=user.id, request=request)
    db.commit()
    return {"status": "password_reset"}


@router.post("/password/change")
def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("auth_password_change", 10, 300)),
) -> dict[str, str]:
    user = db.scalar(select(User).where(User.id == current_user.id).with_for_update())
    if user is None or not verify_password(payload.current_password, user.password_hash):
        record_security_event(
            db,
            event_type="auth_password_change_failed",
            user_id=current_user.id,
            request=request,
            risk_level="medium",
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be different")
    user.password_hash = get_password_hash(payload.new_password)
    user.failed_login_count = 0
    user.locked_until = None
    user.last_password_changed_at = datetime.now(timezone.utc)
    revoke_user_sessions(db, user_id=user.id, reason="password_changed")
    record_security_event(db, event_type="auth_password_changed", user_id=user.id, request=request)
    db.commit()
    return {"status": "password_changed"}


@router.get("/mfa/status", response_model=MfaStatusResponse)
def get_mfa_status(current_user: User = Depends(get_current_user)) -> MfaStatusResponse:
    return MfaStatusResponse(
        enabled=current_user.mfa_enabled,
        channel=current_user.mfa_channel,
        phone_number=current_user.phone_number,
    )


@router.post("/mfa/start")
def start_mfa_setup(
    payload: MfaStartRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    challenge = create_mfa_challenge(
        db,
        user=current_user,
        purpose="enroll",
        channel=payload.channel,
        destination=payload.destination,
        request=request,
    )
    return {"challenge_id": challenge.challenge_id, "channel": challenge.channel}


@router.post("/mfa/verify", response_model=MfaStatusResponse)
def verify_mfa_setup(
    payload: MfaVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MfaStatusResponse:
    challenge = verify_mfa_challenge(
        db,
        challenge_id=payload.challenge_id,
        code=payload.code,
        purpose="enroll",
        request=request,
        commit=False,
    )
    if challenge.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="MFA challenge does not belong to this user")
    current_user.mfa_enabled = True
    current_user.mfa_channel = challenge.channel
    if challenge.channel == "sms":
        current_user.phone_number = challenge.destination
    record_security_event(db, event_type="mfa_enabled", user_id=current_user.id, request=request)
    db.commit()
    return MfaStatusResponse(
        enabled=True,
        channel=current_user.mfa_channel,
        phone_number=current_user.phone_number,
    )


@router.post("/mfa/disable", response_model=MfaStatusResponse)
def disable_mfa(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MfaStatusResponse:
    current_user.mfa_enabled = False
    current_user.mfa_channel = None
    record_security_event(db, event_type="mfa_disabled", user_id=current_user.id, request=request)
    db.commit()
    return MfaStatusResponse(enabled=False)


@router.get("/sessions", response_model=list[SessionRead])
def list_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SessionRead]:
    sessions = db.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == current_user.id)
        .order_by(AuthSession.created_at.desc())
    ).all()
    return [SessionRead.model_validate(session, from_attributes=True) for session in sessions]


@router.post("/sessions/{session_id}/revoke")
def revoke_session(
    session_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    auth_session = db.scalar(
        select(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.user_id == current_user.id)
        .with_for_update()
    )
    if auth_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if auth_session.revoked_at is None:
        auth_session.revoked_at = datetime.now(timezone.utc)
        auth_session.revoked_reason = "user_revoked"
        record_security_event(
            db,
            event_type="auth_session_revoked",
            user_id=current_user.id,
            request=request,
            details={"session_id": session_id, "device_id": auth_session.device_id},
        )
        db.commit()
    return {"status": "revoked"}
