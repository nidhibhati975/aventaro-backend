from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.rate_limit import rate_limit
from app.services.social import follow_user, get_user_with_social_stats, list_followers, list_following, unfollow_user


router = APIRouter(prefix="/users")


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


class UserListResponse(BaseModel):
    items: list[UserRead]
    limit: int
    offset: int
    total: int


class FollowStateResponse(BaseModel):
    following: bool
    target_user_id: int
    followers_count: int
    following_count: int


class UserSocialRead(UserRead):
    posts_count: int
    followers_count: int
    following_count: int
    saved_count: int


@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(get_current_user)) -> UserRead:
    return UserRead.model_validate(current_user)


@router.post("/{user_id}/follow", response_model=FollowStateResponse)
def follow_user_endpoint(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("users_follow", 60, 3600)),
) -> FollowStateResponse:
    try:
        _, followers_count, following_count = follow_user(db=db, follower_id=current_user.id, following_id=user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return FollowStateResponse(
        following=True,
        target_user_id=user_id,
        followers_count=followers_count,
        following_count=following_count,
    )


@router.post("/{user_id}/unfollow", response_model=FollowStateResponse)
def unfollow_user_endpoint(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("users_follow", 60, 3600)),
) -> FollowStateResponse:
    try:
        _, followers_count, following_count = unfollow_user(db=db, follower_id=current_user.id, following_id=user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return FollowStateResponse(
        following=False,
        target_user_id=user_id,
        followers_count=followers_count,
        following_count=following_count,
    )


@router.get("/{user_id}/followers", response_model=UserListResponse)
def get_followers(
    user_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserListResponse:
    try:
        users, total = list_followers(
            db=db,
            user_id=user_id,
            current_user_id=current_user.id,
            limit=limit,
            offset=offset,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return UserListResponse(items=[UserRead.model_validate(user) for user in users], limit=limit, offset=offset, total=total)


@router.get("/{user_id}/following", response_model=UserListResponse)
def get_following(
    user_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserListResponse:
    try:
        users, total = list_following(
            db=db,
            user_id=user_id,
            current_user_id=current_user.id,
            limit=limit,
            offset=offset,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return UserListResponse(items=[UserRead.model_validate(user) for user in users], limit=limit, offset=offset, total=total)


@router.get("/{user_id}", response_model=UserSocialRead)
def get_user_profile(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserSocialRead:
    user = get_user_with_social_stats(db=db, user_id=user_id, current_user_id=current_user.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserSocialRead.model_validate(user)
