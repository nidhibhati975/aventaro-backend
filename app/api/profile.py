from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.profile import Profile
from app.models.user import User
from app.services.auth import get_current_user
from app.services.redis_runtime import invalidate_discover_cache, invalidate_match_suggestions_cache


router = APIRouter(prefix="/profile")


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


class ProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    age: int | None = Field(default=None, ge=18, le=120)
    bio: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=120)
    gender: str | None = Field(default=None, max_length=32)
    travel_style: str | None = Field(default=None, max_length=64)
    interests: list[str] | None = None
    budget_min: int | None = Field(default=None, ge=0)
    budget_max: int | None = Field(default=None, ge=0)


@router.get("/me", response_model=ProfileRead)
def get_profile(current_user: User = Depends(get_current_user)) -> ProfileRead:
    profile = current_user.profile or Profile()
    return ProfileRead.model_validate(profile)


@router.put("/me", response_model=ProfileRead)
def update_profile(
    payload: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProfileRead:
    if payload.budget_min is not None and payload.budget_max is not None:
        if payload.budget_min > payload.budget_max:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="budget_min cannot exceed budget_max")

    profile = current_user.profile
    if profile is None:
        profile = Profile(user_id=current_user.id)
        db.add(profile)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)

    db.commit()
    db.refresh(profile)
    invalidate_discover_cache()
    invalidate_match_suggestions_cache()
    return ProfileRead.model_validate(profile)
