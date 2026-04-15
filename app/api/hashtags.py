from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.posts import FeedResponse, PostRead
from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.social import list_hashtag_posts, list_trending_hashtags, search_hashtags


router = APIRouter(prefix="/hashtags")


class TrendingHashtagRead(BaseModel):
    tag: str
    posts_count: int
    latest_post_at: object
    score: float


@router.get("/trending", response_model=list[TrendingHashtagRead])
def get_trending_hashtags(
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TrendingHashtagRead]:
    items = list_trending_hashtags(db=db, current_user_id=current_user.id, limit=limit)
    return [TrendingHashtagRead.model_validate(item) for item in items]


@router.get("/search", response_model=list[TrendingHashtagRead])
def find_hashtags(
    q: str = Query(min_length=1, max_length=64),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TrendingHashtagRead]:
    items = search_hashtags(db=db, current_user_id=current_user.id, query=q, limit=limit)
    return [TrendingHashtagRead.model_validate(item) for item in items]


@router.get("/{tag}/posts", response_model=FeedResponse)
def get_posts_by_hashtag(
    tag: str,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FeedResponse:
    items, total = list_hashtag_posts(
        db=db,
        current_user_id=current_user.id,
        tag=tag,
        limit=limit,
        offset=offset,
    )
    return FeedResponse(items=[PostRead.model_validate(item) for item in items], limit=limit, offset=offset, total=total)
