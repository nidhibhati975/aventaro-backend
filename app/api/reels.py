from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.posts import FeedResponse, PostRead
from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.rate_limit import rate_limit
from app.services.redis_runtime import build_cache_key, get_cache
from app.services.social import list_reel_posts, record_reel_watch
from app.utils.config import get_settings


router = APIRouter(prefix="/reels")


class ReelWatchRequest(BaseModel):
    watch_time: float = Field(ge=0, le=21600)
    duration_seconds: float | None = Field(default=None, gt=0, le=14400)


class ReelWatchResponse(BaseModel):
    post_id: int
    watch_time: float
    user_watch_time: float
    completed: bool
    skipped: bool


@router.get("/feed", response_model=FeedResponse)
def get_reels_feed(
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    cursor: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FeedResponse:
    cache_key = build_cache_key(
        "social:reels",
        user_id=current_user.id,
        limit=limit,
        offset=offset,
        cursor=cursor,
    )
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        return FeedResponse.model_validate(cached)
    try:
        items, total, next_cursor = list_reel_posts(
            db=db,
            current_user_id=current_user.id,
            limit=limit,
            offset=offset,
            cursor=cursor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    response = FeedResponse(
        items=[PostRead.model_validate(item) for item in items],
        limit=limit,
        offset=offset,
        total=total,
        next_cursor=next_cursor,
    )
    get_cache().set_json(cache_key, response.model_dump(mode="json"), ttl_seconds=get_settings().social_cache_ttl_seconds)
    return response


@router.post("/{post_id}/watch", response_model=ReelWatchResponse, status_code=status.HTTP_201_CREATED)
def watch_reel(
    post_id: int,
    payload: ReelWatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("reels_watch", 240, 3600)),
) -> ReelWatchResponse:
    try:
        result = record_reel_watch(
            db=db,
            post_id=post_id,
            current_user_id=current_user.id,
            watch_time=payload.watch_time,
            duration_seconds=payload.duration_seconds,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ReelWatchResponse.model_validate(result)
