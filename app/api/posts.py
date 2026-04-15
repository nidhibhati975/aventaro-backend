from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.social import MediaType
from app.models.user import User
from app.services.auth import get_current_user
from app.services.rate_limit import rate_limit
from app.services.redis_runtime import build_cache_key, get_cache
from app.services.social import (
    create_post as create_post_service,
    create_post_comment,
    delete_post as delete_post_service,
    get_post_detail,
    like_post,
    list_feed_posts,
    list_post_comments,
    list_saved_posts,
    save_post,
    unlike_post,
)
from app.utils.config import get_settings


router = APIRouter(prefix="/posts")


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
    id: int
    email: str
    created_at: object
    profile: ProfileRead | None = None


class PostRead(BaseModel):
    id: int
    caption: str | None = None
    media_url: str
    media_type: MediaType
    location: str | None = None
    watch_time: float
    hashtags: list[str]
    created_at: object
    user: UserRead
    likes_count: int
    comments_count: int
    liked_by_current_user: bool
    saved_by_current_user: bool
    is_following_author: bool
    is_owner: bool


class FeedResponse(BaseModel):
    items: list[PostRead]
    limit: int
    offset: int
    total: int
    next_cursor: str | None = None


class PostCreateRequest(BaseModel):
    caption: str | None = Field(default=None, max_length=1000)
    media_url: AnyHttpUrl
    media_type: MediaType
    location: str | None = Field(default=None, max_length=150)
    media_size_bytes: int | None = Field(default=None, gt=0)
    media_duration_seconds: float | None = Field(default=None, gt=0, le=14400)

    @field_validator("caption", "location")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class CommentCreateRequest(BaseModel):
    comment: str = Field(min_length=1, max_length=500)

    @field_validator("comment")
    @classmethod
    def normalize_comment(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("comment cannot be blank")
        return normalized


class CommentRead(BaseModel):
    id: int
    comment: str
    created_at: object
    user: UserRead


class CommentListResponse(BaseModel):
    items: list[CommentRead]
    limit: int
    offset: int
    total: int


class CommentCreateResponse(BaseModel):
    comment: CommentRead
    comments_count: int


class DeletePostResponse(BaseModel):
    deleted: bool
    post_id: int


def _serialize_comment(comment) -> CommentRead:
    return CommentRead(
        id=comment.id,
        comment=comment.comment,
        created_at=comment.created_at,
        user=UserRead(
            id=comment.user.id,
            email=comment.user.email,
            created_at=comment.user.created_at,
            profile=ProfileRead.model_validate(comment.user.profile) if comment.user.profile else None,
        ),
    )


@router.post("/create", response_model=PostRead, status_code=status.HTTP_201_CREATED)
def create_post(
    payload: PostCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("posts_create", 20, 3600)),
) -> PostRead:
    try:
        post = create_post_service(
            db=db,
            user_id=current_user.id,
            caption=payload.caption,
            media_url=str(payload.media_url),
            media_type=payload.media_type,
            location=payload.location,
            media_size_bytes=payload.media_size_bytes,
            media_duration_seconds=payload.media_duration_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return PostRead.model_validate(post)


@router.get("/feed", response_model=FeedResponse)
def get_feed(
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    cursor: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FeedResponse:
    cache_key = build_cache_key(
        "social:feed",
        user_id=current_user.id,
        limit=limit,
        offset=offset,
        cursor=cursor,
    )
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        return FeedResponse.model_validate(cached)
    try:
        items, total, next_cursor = list_feed_posts(
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


@router.get("/saved", response_model=FeedResponse)
def get_saved_posts(
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FeedResponse:
    items, total = list_saved_posts(db=db, current_user_id=current_user.id, limit=limit, offset=offset)
    return FeedResponse(items=[PostRead.model_validate(item) for item in items], limit=limit, offset=offset, total=total)


@router.post("/{post_id}/like", response_model=PostRead)
def like_post_endpoint(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("posts_like", 120, 3600)),
) -> PostRead:
    try:
        post = like_post(db=db, post_id=post_id, current_user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return PostRead.model_validate(post)


@router.post("/{post_id}/unlike", response_model=PostRead)
def unlike_post_endpoint(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("posts_like", 120, 3600)),
) -> PostRead:
    try:
        post = unlike_post(db=db, post_id=post_id, current_user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return PostRead.model_validate(post)


@router.post("/{post_id}/comment", response_model=CommentCreateResponse, status_code=status.HTTP_201_CREATED)
def comment_on_post(
    post_id: int,
    payload: CommentCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("posts_comment", 60, 3600)),
) -> CommentCreateResponse:
    try:
        comment, comments_count = create_post_comment(
            db=db,
            post_id=post_id,
            current_user_id=current_user.id,
            comment_text=payload.comment,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return CommentCreateResponse(comment=_serialize_comment(comment), comments_count=comments_count)


@router.get("/{post_id}/comments", response_model=CommentListResponse)
def get_post_comments(
    post_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentListResponse:
    try:
        comments, total = list_post_comments(
            db=db,
            post_id=post_id,
            current_user_id=current_user.id,
            limit=limit,
            offset=offset,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return CommentListResponse(items=[_serialize_comment(comment) for comment in comments], limit=limit, offset=offset, total=total)


@router.post("/{post_id}/save", response_model=PostRead)
def save_post_endpoint(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("posts_save", 60, 3600)),
) -> PostRead:
    try:
        post = save_post(db=db, post_id=post_id, current_user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return PostRead.model_validate(post)


@router.get("/{post_id}", response_model=PostRead)
def get_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PostRead:
    post = get_post_detail(db=db, post_id=post_id, current_user_id=current_user.id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return PostRead.model_validate(post)


@router.delete("/{post_id}", response_model=DeletePostResponse)
def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DeletePostResponse:
    try:
        delete_post_service(db=db, post_id=post_id, current_user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return DeletePostResponse(deleted=True, post_id=post_id)
