from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import AnyHttpUrl, BaseModel, Field
from sqlalchemy.orm import Session

from app.api.posts import UserRead
from app.db.session import get_db
from app.models.social import MediaType
from app.models.user import User
from app.services.auth import get_current_user
from app.services.rate_limit import rate_limit
from app.services.social import create_story, list_active_stories, view_story


router = APIRouter(prefix="/stories")


class StoryCreateRequest(BaseModel):
    media_url: AnyHttpUrl
    media_type: MediaType
    media_size_bytes: int | None = Field(default=None, gt=0)
    media_duration_seconds: float | None = Field(default=None, gt=0, le=14400)


class StoryRead(BaseModel):
    id: int
    media_url: str
    media_type: MediaType
    created_at: object
    expires_at: object
    user: UserRead
    viewed_by_current_user: bool
    is_seen: bool
    views_count: int
    is_following_author: bool
    is_owner: bool


class StoryGroupRead(BaseModel):
    user_id: int
    user: UserRead
    stories: list[StoryRead]
    has_unseen: bool


class StoryFeedResponse(BaseModel):
    items: list[StoryGroupRead]
    limit: int
    offset: int
    total: int


@router.post("/create", response_model=StoryRead, status_code=status.HTTP_201_CREATED)
def create_story_endpoint(
    payload: StoryCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("stories_create", 30, 3600)),
) -> StoryRead:
    try:
        story = create_story(
            db=db,
            user_id=current_user.id,
            media_url=str(payload.media_url),
            media_type=payload.media_type,
            media_size_bytes=payload.media_size_bytes,
            media_duration_seconds=payload.media_duration_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return StoryRead.model_validate(story)


@router.get("/feed", response_model=StoryFeedResponse)
def get_stories_feed(
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StoryFeedResponse:
    items, total = list_active_stories(db=db, current_user_id=current_user.id, limit=limit, offset=offset)
    return StoryFeedResponse(
        items=[StoryGroupRead.model_validate(item) for item in items],
        limit=limit,
        offset=offset,
        total=total,
    )


@router.post("/{story_id}/view", response_model=StoryRead)
def view_story_endpoint(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("stories_view", 600, 3600)),
) -> StoryRead:
    try:
        story = view_story(db=db, story_id=story_id, current_user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return StoryRead.model_validate(story)
