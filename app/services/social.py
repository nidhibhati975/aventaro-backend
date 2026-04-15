from __future__ import annotations

import base64
import ipaddress
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import PurePosixPath
from urllib.parse import urlparse

from sqlalchemy import Float, and_, case, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.social import (
    Block,
    Collection,
    CollectionPost,
    Follow,
    Hashtag,
    MediaType,
    Post,
    PostComment,
    PostHashtag,
    PostLike,
    PostWatch,
    Report,
    ReportTargetType,
    SavedPost,
    Story,
    StoryView,
)
from app.models.user import User
from app.services.notifications import create_notification
from app.services.redis_runtime import invalidate_discover_cache, invalidate_social_cache
from app.utils.config import get_settings


HASHTAG_RE = re.compile(r"(?<!\w)#([a-z0-9_]{1,64})", re.IGNORECASE)
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def extract_hashtags(caption: str | None) -> list[str]:
    if not caption:
        return []
    tags = [match.group(1).strip().lower() for match in HASHTAG_RE.finditer(caption)]
    return list(dict.fromkeys(tag for tag in tags if tag))


def encode_cursor(*, score: float, created_at: datetime, entity_id: int) -> str:
    payload = {
        "score": round(float(score), 6),
        "created_at": created_at.isoformat(),
        "id": int(entity_id),
    }
    return base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("ascii")


def decode_cursor(cursor: str | None) -> tuple[float, datetime, int] | None:
    if not cursor:
        return None
    try:
        decoded = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        payload = json.loads(decoded)
        created_at = datetime.fromisoformat(payload["created_at"])
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        return float(payload["score"]), created_at, int(payload["id"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise ValueError("Invalid cursor")


def _is_public_media_host(hostname: str) -> bool:
    normalized = hostname.strip().lower()
    if not normalized or normalized == "localhost":
        return False
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        ip = None
    if ip is not None:
        return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved)
    return True


def validate_media_payload(
    *,
    media_url: str,
    media_type: MediaType,
    media_size_bytes: int | None = None,
    media_duration_seconds: float | None = None,
) -> None:
    settings = get_settings()
    parsed = urlparse(media_url)
    hostname = (parsed.hostname or "").lower()
    if not _is_public_media_host(hostname):
        raise ValueError("media_url must use a public host")
    if settings.media_allowed_domains and not any(
        hostname == domain or hostname.endswith(f".{domain}") for domain in settings.media_allowed_domains
    ):
        raise ValueError("media_url domain is not allowed")

    extension = PurePosixPath(parsed.path or "").suffix.lower()
    allowed_extensions = IMAGE_EXTENSIONS if media_type == MediaType.image else VIDEO_EXTENSIONS
    if extension and extension not in allowed_extensions:
        raise ValueError(f"media_url extension is not valid for {media_type.value}")

    if media_size_bytes is not None:
        if media_size_bytes <= 0:
            raise ValueError("media_size_bytes must be greater than 0")
        max_size = settings.media_max_image_bytes if media_type == MediaType.image else settings.media_max_video_bytes
        if media_size_bytes > max_size:
            raise ValueError(f"{media_type.value} media exceeds allowed size")

    if media_duration_seconds is not None:
        if media_duration_seconds <= 0:
            raise ValueError("media_duration_seconds must be greater than 0")
        if media_type == MediaType.image:
            raise ValueError("media_duration_seconds is only valid for video content")
        if media_duration_seconds > settings.media_max_video_duration_seconds:
            raise ValueError("video duration exceeds allowed limit")


def build_blocked_user_ids_subquery(current_user_id: int):
    return (
        select(Block.blocked_id.label("user_id"))
        .where(Block.blocker_id == current_user_id)
        .union(select(Block.blocker_id.label("user_id")).where(Block.blocked_id == current_user_id))
        .subquery()
    )


def has_block_relationship(db: Session, user_id: int, other_user_id: int) -> bool:
    return bool(
        db.scalar(
            select(Block.id).where(
                or_(
                    and_(Block.blocker_id == user_id, Block.blocked_id == other_user_id),
                    and_(Block.blocker_id == other_user_id, Block.blocked_id == user_id),
                )
            )
        )
    )


def _blocked_user_ids(db: Session, current_user_id: int) -> set[int]:
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    return {int(user_id) for user_id in db.scalars(select(blocked_users.c.user_id)).all()}


def _serialize_profile(user: User) -> dict[str, object] | None:
    profile = user.profile
    if profile is None:
        return None
    return {
        "name": profile.name,
        "age": profile.age,
        "bio": profile.bio,
        "location": profile.location,
        "gender": profile.gender,
        "travel_style": profile.travel_style,
        "interests": profile.interests,
        "budget_min": profile.budget_min,
        "budget_max": profile.budget_max,
    }


def _serialize_user(user: User) -> dict[str, object]:
    return {
        "id": user.id,
        "email": user.email,
        "created_at": user.created_at,
        "profile": _serialize_profile(user),
    }


def _serialize_post_row(row, current_user_id: int) -> dict[str, object]:
    post = row[0]
    data = row._mapping
    return {
        "id": post.id,
        "caption": post.caption,
        "media_url": post.media_url,
        "media_type": post.media_type,
        "location": post.location,
        "watch_time": float(post.watch_time or 0.0),
        "hashtags": [entry.hashtag.tag for entry in post.hashtag_entries],
        "created_at": post.created_at,
        "user": _serialize_user(post.user),
        "likes_count": int(data["likes_count"] or 0),
        "comments_count": int(data["comments_count"] or 0),
        "liked_by_current_user": bool(data["liked_by_current_user"]),
        "saved_by_current_user": bool(data["saved_by_current_user"]),
        "is_following_author": bool(data["is_following_author"]),
        "is_owner": post.user_id == current_user_id,
    }


def _build_post_query(current_user_id: int):
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    likes_subquery = (
        select(PostLike.post_id.label("post_id"), func.count(PostLike.id).label("likes_count"))
        .group_by(PostLike.post_id)
        .subquery()
    )
    comments_subquery = (
        select(PostComment.post_id.label("post_id"), func.count(PostComment.id).label("comments_count"))
        .group_by(PostComment.post_id)
        .subquery()
    )
    watch_metrics_subquery = (
        select(
            PostWatch.post_id.label("post_id"),
            func.count(PostWatch.id).label("watch_count"),
            func.sum(case((PostWatch.completed.is_(True), 1), else_=0)).label("completed_count"),
            func.sum(case((PostWatch.skipped.is_(True), 1), else_=0)).label("skipped_count"),
        )
        .group_by(PostWatch.post_id)
        .subquery()
    )
    liked_posts_subquery = (
        select(PostLike.post_id.label("post_id"))
        .where(PostLike.user_id == current_user_id)
        .subquery()
    )
    saved_posts_subquery = (
        select(SavedPost.post_id.label("post_id"))
        .where(SavedPost.user_id == current_user_id)
        .subquery()
    )
    followed_users_subquery = (
        select(Follow.following_id.label("following_id"))
        .where(Follow.follower_id == current_user_id)
        .subquery()
    )
    author_like_interactions = (
        select(
            Post.user_id.label("author_id"),
            func.count(PostLike.id).label("like_interactions"),
        )
        .join(PostLike, PostLike.post_id == Post.id)
        .where(PostLike.user_id == current_user_id)
        .group_by(Post.user_id)
        .subquery()
    )
    author_comment_interactions = (
        select(
            Post.user_id.label("author_id"),
            func.count(PostComment.id).label("comment_interactions"),
        )
        .join(PostComment, PostComment.post_id == Post.id)
        .where(PostComment.user_id == current_user_id)
        .group_by(Post.user_id)
        .subquery()
    )
    author_completion_interactions = (
        select(
            Post.user_id.label("author_id"),
            func.count(PostWatch.id).label("completion_interactions"),
        )
        .join(PostWatch, PostWatch.post_id == Post.id)
        .where(PostWatch.user_id == current_user_id, PostWatch.completed.is_(True))
        .group_by(Post.user_id)
        .subquery()
    )

    likes_count = func.coalesce(likes_subquery.c.likes_count, 0)
    comments_count = func.coalesce(comments_subquery.c.comments_count, 0)
    watch_count = func.coalesce(watch_metrics_subquery.c.watch_count, 0)
    completed_count = func.coalesce(watch_metrics_subquery.c.completed_count, 0)
    skipped_count = func.coalesce(watch_metrics_subquery.c.skipped_count, 0)
    author_like_score = func.coalesce(author_like_interactions.c.like_interactions, 0)
    author_comment_score = func.coalesce(author_comment_interactions.c.comment_interactions, 0)
    author_completion_score = func.coalesce(author_completion_interactions.c.completion_interactions, 0)
    recentness_factor = func.greatest(0.0, 72.0 - (func.extract("epoch", func.now() - Post.created_at) / 3600.0))
    base_score = likes_count * 2 + comments_count * 3 + recentness_factor
    interaction_with_author = author_like_score * 2 + author_comment_score * 3 + author_completion_score * 2
    followed_user_boost = case((followed_users_subquery.c.following_id.is_not(None), 12.0), else_=0.0)
    feed_score = (base_score + interaction_with_author + followed_user_boost).label("feed_score")
    completion_rate = case(
        (watch_count > 0, completed_count.cast(Float) / func.nullif(watch_count, 0)),
        else_=0.0,
    )
    skip_rate = case(
        (watch_count > 0, skipped_count.cast(Float) / func.nullif(watch_count, 0)),
        else_=0.0,
    )
    completion_rate_weight = completion_rate * 12.0 - skip_rate * 4.0
    user_affinity_score = (author_like_score * 1.5 + author_comment_score * 2.5 + author_completion_score * 3.0 + case((followed_users_subquery.c.following_id.is_not(None), 6.0), else_=0.0))
    reel_score = (likes_count * 2 + comments_count * 3 + recentness_factor + completion_rate_weight + user_affinity_score).label("reel_score")

    statement = (
        select(
            Post,
            likes_count.label("likes_count"),
            comments_count.label("comments_count"),
            watch_count.label("watch_count"),
            completed_count.label("completed_count"),
            case((liked_posts_subquery.c.post_id.is_not(None), True), else_=False).label("liked_by_current_user"),
            case((saved_posts_subquery.c.post_id.is_not(None), True), else_=False).label("saved_by_current_user"),
            case((followed_users_subquery.c.following_id.is_not(None), True), else_=False).label("is_following_author"),
            feed_score,
            reel_score,
        )
        .options(
            joinedload(Post.user).joinedload(User.profile),
            selectinload(Post.hashtag_entries).joinedload(PostHashtag.hashtag),
        )
        .outerjoin(likes_subquery, likes_subquery.c.post_id == Post.id)
        .outerjoin(comments_subquery, comments_subquery.c.post_id == Post.id)
        .outerjoin(watch_metrics_subquery, watch_metrics_subquery.c.post_id == Post.id)
        .outerjoin(liked_posts_subquery, liked_posts_subquery.c.post_id == Post.id)
        .outerjoin(saved_posts_subquery, saved_posts_subquery.c.post_id == Post.id)
        .outerjoin(followed_users_subquery, followed_users_subquery.c.following_id == Post.user_id)
        .outerjoin(author_like_interactions, author_like_interactions.c.author_id == Post.user_id)
        .outerjoin(author_comment_interactions, author_comment_interactions.c.author_id == Post.user_id)
        .outerjoin(author_completion_interactions, author_completion_interactions.c.author_id == Post.user_id)
        .where(Post.user_id.not_in(select(blocked_users.c.user_id)))
    )
    return statement, feed_score, reel_score


def _count_visible_posts(db: Session, current_user_id: int, *, media_type: MediaType | None = None) -> int:
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    count_query = select(func.count(Post.id)).where(Post.user_id.not_in(select(blocked_users.c.user_id)))
    if media_type is not None:
        count_query = count_query.where(Post.media_type == media_type)
    return int(db.scalar(count_query) or 0)


def _ensure_accessible_post(
    db: Session,
    *,
    post_id: int,
    current_user_id: int,
    media_type: MediaType | None = None,
) -> Post:
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    query = (
        select(Post)
        .options(
            selectinload(Post.user).selectinload(User.profile),
            selectinload(Post.hashtag_entries).selectinload(PostHashtag.hashtag),
        )
        .where(
            Post.id == post_id,
            Post.user_id.not_in(select(blocked_users.c.user_id)),
        )
    )
    if media_type is not None:
        query = query.where(Post.media_type == media_type)
    post = db.scalar(query)
    if post is None:
        raise LookupError("Post not found")
    return post


def _sync_post_hashtags(db: Session, post: Post) -> None:
    tags = extract_hashtags(post.caption)
    db.execute(delete(PostHashtag).where(PostHashtag.post_id == post.id))
    if not tags:
        return

    existing = db.scalars(select(Hashtag).where(Hashtag.tag.in_(tags))).all()
    by_tag = {hashtag.tag: hashtag for hashtag in existing}
    for tag in tags:
        if tag in by_tag:
            continue
        hashtag = Hashtag(tag=tag)
        db.add(hashtag)
        db.flush()
        by_tag[tag] = hashtag

    for tag in tags:
        db.add(PostHashtag(post_id=post.id, hashtag_id=by_tag[tag].id))


def get_post_detail(db: Session, post_id: int, current_user_id: int) -> dict[str, object] | None:
    statement, _, _ = _build_post_query(current_user_id)
    row = db.execute(statement.where(Post.id == post_id)).first()
    if row is None:
        return None
    return _serialize_post_row(row, current_user_id)


def _apply_rank_cursor(statement, rank_expression, cursor: str | None):
    decoded = decode_cursor(cursor)
    if decoded is None:
        return statement
    score, created_at, entity_id = decoded
    return statement.where(
        or_(
            rank_expression < score,
            and_(rank_expression == score, Post.created_at < created_at),
            and_(rank_expression == score, Post.created_at == created_at, Post.id < entity_id),
        )
    )


def _build_next_cursor(rows, score_key: str) -> str | None:
    if not rows:
        return None
    last_row = rows[-1]
    return encode_cursor(
        score=float(last_row._mapping[score_key] or 0.0),
        created_at=last_row[0].created_at,
        entity_id=last_row[0].id,
    )


def list_feed_posts(
    db: Session,
    current_user_id: int,
    limit: int,
    offset: int,
    cursor: str | None = None,
) -> tuple[list[dict[str, object]], int, str | None]:
    statement, feed_score, _ = _build_post_query(current_user_id)
    statement = _apply_rank_cursor(statement, feed_score, cursor)
    statement = statement.order_by(feed_score.desc(), Post.created_at.desc(), Post.id.desc())
    if cursor:
        statement = statement.limit(limit)
    else:
        statement = statement.offset(offset).limit(limit)
    rows = db.execute(statement).all()
    total = _count_visible_posts(db, current_user_id)
    return [_serialize_post_row(row, current_user_id) for row in rows], total, _build_next_cursor(rows, "feed_score")


def list_reel_posts(
    db: Session,
    current_user_id: int,
    limit: int,
    offset: int,
    cursor: str | None = None,
) -> tuple[list[dict[str, object]], int, str | None]:
    statement, _, reel_score = _build_post_query(current_user_id)
    statement = _apply_rank_cursor(statement.where(Post.media_type == MediaType.video), reel_score, cursor)
    statement = statement.order_by(reel_score.desc(), Post.created_at.desc(), Post.id.desc())
    if cursor:
        statement = statement.limit(limit)
    else:
        statement = statement.offset(offset).limit(limit)
    rows = db.execute(statement).all()
    total = _count_visible_posts(db, current_user_id, media_type=MediaType.video)
    return [_serialize_post_row(row, current_user_id) for row in rows], total, _build_next_cursor(rows, "reel_score")


def list_saved_posts(db: Session, current_user_id: int, limit: int, offset: int) -> tuple[list[dict[str, object]], int]:
    statement, _, _ = _build_post_query(current_user_id)
    rows = db.execute(
        statement.join(SavedPost, and_(SavedPost.post_id == Post.id, SavedPost.user_id == current_user_id))
        .order_by(Post.created_at.desc(), Post.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    total = int(
        db.scalar(
            select(func.count(SavedPost.post_id))
            .join(Post, Post.id == SavedPost.post_id)
            .where(
                SavedPost.user_id == current_user_id,
                Post.user_id.not_in(select(blocked_users.c.user_id)),
            )
        )
        or 0
    )
    return [_serialize_post_row(row, current_user_id) for row in rows], total


def list_hashtag_posts(
    db: Session,
    *,
    current_user_id: int,
    tag: str,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, object]], int]:
    normalized = tag.strip().lower().lstrip("#")
    statement, feed_score, _ = _build_post_query(current_user_id)
    rows = db.execute(
        statement.join(PostHashtag, PostHashtag.post_id == Post.id)
        .join(Hashtag, Hashtag.id == PostHashtag.hashtag_id)
        .where(Hashtag.tag == normalized)
        .order_by(feed_score.desc(), Post.created_at.desc(), Post.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    total = int(
        db.scalar(
            select(func.count(Post.id))
            .join(PostHashtag, PostHashtag.post_id == Post.id)
            .join(Hashtag, Hashtag.id == PostHashtag.hashtag_id)
            .where(
                Hashtag.tag == normalized,
                Post.user_id.not_in(select(blocked_users.c.user_id)),
            )
        )
        or 0
    )
    return [_serialize_post_row(row, current_user_id) for row in rows], total


def list_trending_hashtags(db: Session, *, current_user_id: int, limit: int) -> list[dict[str, object]]:
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    recent_usage_weight = func.greatest(
        0.0,
        72.0 - (func.extract("epoch", func.now() - func.max(Post.created_at)) / 3600.0),
    )
    trend_score = (func.count(Post.id) + recent_usage_weight).label("trend_score")
    rows = db.execute(
        select(
            Hashtag.tag.label("tag"),
            func.count(Post.id).label("posts_count"),
            func.max(Post.created_at).label("latest_post_at"),
            trend_score,
        )
        .join(PostHashtag, PostHashtag.hashtag_id == Hashtag.id)
        .join(Post, Post.id == PostHashtag.post_id)
        .where(Post.user_id.not_in(select(blocked_users.c.user_id)))
        .group_by(Hashtag.id, Hashtag.tag)
        .order_by(trend_score.desc(), func.max(Post.created_at).desc(), Hashtag.tag.asc())
        .limit(limit)
    ).all()
    return [
        {
            "tag": row.tag,
            "posts_count": int(row.posts_count or 0),
            "latest_post_at": row.latest_post_at,
            "score": float(row.trend_score or 0.0),
        }
        for row in rows
    ]


def search_hashtags(db: Session, *, current_user_id: int, query: str, limit: int) -> list[dict[str, object]]:
    normalized = query.strip().lower().lstrip("#")
    if not normalized:
        return []
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    recent_usage_weight = func.greatest(
        0.0,
        72.0 - (func.extract("epoch", func.now() - func.max(Post.created_at)) / 3600.0),
    )
    trend_score = (func.count(Post.id) + recent_usage_weight).label("trend_score")
    rows = db.execute(
        select(
            Hashtag.tag.label("tag"),
            func.count(Post.id).label("posts_count"),
            func.max(Post.created_at).label("latest_post_at"),
            trend_score,
        )
        .join(PostHashtag, PostHashtag.hashtag_id == Hashtag.id)
        .join(Post, Post.id == PostHashtag.post_id)
        .where(
            Hashtag.tag.ilike(f"%{normalized}%"),
            Post.user_id.not_in(select(blocked_users.c.user_id)),
        )
        .group_by(Hashtag.id, Hashtag.tag)
        .order_by(
            case((Hashtag.tag == normalized, 2), (Hashtag.tag.ilike(f"{normalized}%"), 1), else_=0).desc(),
            trend_score.desc(),
            Hashtag.tag.asc(),
        )
        .limit(limit)
    ).all()
    return [
        {
            "tag": row.tag,
            "posts_count": int(row.posts_count or 0),
            "latest_post_at": row.latest_post_at,
            "score": float(row.trend_score or 0.0),
        }
        for row in rows
    ]


def create_post(
    db: Session,
    *,
    user_id: int,
    caption: str | None,
    media_url: str,
    media_type: MediaType,
    location: str | None,
    media_size_bytes: int | None = None,
    media_duration_seconds: float | None = None,
) -> dict[str, object]:
    validate_media_payload(
        media_url=media_url,
        media_type=media_type,
        media_size_bytes=media_size_bytes,
        media_duration_seconds=media_duration_seconds,
    )
    post = Post(
        user_id=user_id,
        caption=caption,
        media_url=media_url,
        media_type=media_type,
        location=location,
    )
    db.add(post)
    db.flush()
    _sync_post_hashtags(db, post)
    db.commit()
    invalidate_social_cache()
    return get_post_detail(db, post.id, user_id)


def delete_post(db: Session, *, post_id: int, current_user_id: int) -> None:
    post = db.scalar(select(Post).where(Post.id == post_id))
    if post is None:
        raise LookupError("Post not found")
    if post.user_id != current_user_id:
        raise PermissionError("Only the post owner can delete this post")
    db.delete(post)
    db.commit()
    invalidate_social_cache()


def like_post(db: Session, *, post_id: int, current_user_id: int) -> dict[str, object]:
    post = _ensure_accessible_post(db, post_id=post_id, current_user_id=current_user_id)
    existing = db.scalar(select(PostLike).where(PostLike.post_id == post_id, PostLike.user_id == current_user_id))
    if existing is None:
        db.add(PostLike(user_id=current_user_id, post_id=post_id))
        if post.user_id != current_user_id:
            actor = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == current_user_id))
            actor_name = actor.profile.name if actor and actor.profile and actor.profile.name else actor.email if actor else "Someone"
            create_notification(
                db=db,
                user_id=post.user_id,
                notification_type="post_liked",
                message=f"{actor_name} liked your post",
                commit=False,
            )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    invalidate_social_cache()
    return get_post_detail(db, post_id, current_user_id)


def unlike_post(db: Session, *, post_id: int, current_user_id: int) -> dict[str, object]:
    _ensure_accessible_post(db, post_id=post_id, current_user_id=current_user_id)
    existing = db.scalar(select(PostLike).where(PostLike.post_id == post_id, PostLike.user_id == current_user_id))
    if existing is not None:
        db.delete(existing)
        db.commit()
    invalidate_social_cache()
    return get_post_detail(db, post_id, current_user_id)


def save_post(db: Session, *, post_id: int, current_user_id: int) -> dict[str, object]:
    _ensure_accessible_post(db, post_id=post_id, current_user_id=current_user_id)
    existing = db.scalar(select(SavedPost).where(SavedPost.post_id == post_id, SavedPost.user_id == current_user_id))
    if existing is None:
        db.add(SavedPost(user_id=current_user_id, post_id=post_id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    invalidate_social_cache()
    return get_post_detail(db, post_id, current_user_id)


def create_post_comment(
    db: Session,
    *,
    post_id: int,
    current_user_id: int,
    comment_text: str,
) -> tuple[PostComment, int]:
    post = _ensure_accessible_post(db, post_id=post_id, current_user_id=current_user_id)
    comment = PostComment(user_id=current_user_id, post_id=post_id, comment=comment_text.strip())
    db.add(comment)
    if post.user_id != current_user_id:
        actor = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == current_user_id))
        actor_name = actor.profile.name if actor and actor.profile and actor.profile.name else actor.email if actor else "Someone"
        create_notification(
            db=db,
            user_id=post.user_id,
            notification_type="post_commented",
            message=f"{actor_name} commented on your post",
            commit=False,
        )
    db.commit()
    invalidate_social_cache()
    comment = db.scalar(
        select(PostComment)
        .options(selectinload(PostComment.user).selectinload(User.profile))
        .where(PostComment.id == comment.id)
    )
    comments_count = int(db.scalar(select(func.count(PostComment.id)).where(PostComment.post_id == post_id)) or 0)
    return comment, comments_count


def list_post_comments(
    db: Session,
    *,
    post_id: int,
    current_user_id: int,
    limit: int,
    offset: int,
) -> tuple[list[PostComment], int]:
    _ensure_accessible_post(db, post_id=post_id, current_user_id=current_user_id)
    comments = db.scalars(
        select(PostComment)
        .options(selectinload(PostComment.user).selectinload(User.profile))
        .where(PostComment.post_id == post_id)
        .order_by(PostComment.created_at.desc(), PostComment.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    total = int(db.scalar(select(func.count(PostComment.id)).where(PostComment.post_id == post_id)) or 0)
    return comments, total


def record_reel_watch(
    db: Session,
    *,
    post_id: int,
    current_user_id: int,
    watch_time: float,
    duration_seconds: float | None = None,
) -> dict[str, object]:
    post = _ensure_accessible_post(db, post_id=post_id, current_user_id=current_user_id, media_type=MediaType.video)
    existing = db.scalar(select(PostWatch).where(PostWatch.post_id == post_id, PostWatch.user_id == current_user_id))
    effective_watch_time = max(watch_time, 0.0)
    if existing is None:
        existing = PostWatch(user_id=current_user_id, post_id=post_id, watch_time=effective_watch_time, viewed_at=_utcnow())
        db.add(existing)
        post.watch_time = float(post.watch_time or 0.0) + effective_watch_time
        user_watch_time = effective_watch_time
    else:
        previous = float(existing.watch_time or 0.0)
        user_watch_time = max(previous, effective_watch_time)
        delta = max(user_watch_time - previous, 0.0)
        existing.watch_time = user_watch_time
        existing.viewed_at = _utcnow()
        post.watch_time = float(post.watch_time or 0.0) + delta
    if duration_seconds is not None and duration_seconds > 0:
        existing.completed = user_watch_time >= duration_seconds * 0.9
    existing.skipped = user_watch_time < 3.0
    db.commit()
    invalidate_social_cache()
    return {
        "post_id": post.id,
        "watch_time": float(post.watch_time or 0.0),
        "user_watch_time": float(user_watch_time),
        "completed": bool(existing.completed),
        "skipped": bool(existing.skipped),
    }


def _serialize_story_row(row, current_user_id: int) -> dict[str, object]:
    story = row[0]
    data = row._mapping
    is_seen = bool(data["viewed_by_current_user"])
    return {
        "id": story.id,
        "media_url": story.media_url,
        "media_type": story.media_type,
        "created_at": story.created_at,
        "expires_at": story.expires_at,
        "user": _serialize_user(story.user),
        "viewed_by_current_user": is_seen,
        "is_seen": is_seen,
        "views_count": int(data["views_count"] or 0),
        "is_following_author": bool(data["is_following_author"]),
        "is_owner": story.user_id == current_user_id,
    }


def _build_story_query(current_user_id: int):
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    views_subquery = (
        select(StoryView.story_id.label("story_id"), func.count(StoryView.id).label("views_count"))
        .group_by(StoryView.story_id)
        .subquery()
    )
    viewed_subquery = (
        select(StoryView.story_id.label("story_id"))
        .where(StoryView.viewer_id == current_user_id)
        .subquery()
    )
    followed_users_subquery = (
        select(Follow.following_id.label("following_id"))
        .where(Follow.follower_id == current_user_id)
        .subquery()
    )

    statement = (
        select(
            Story,
            func.coalesce(views_subquery.c.views_count, 0).label("views_count"),
            case((viewed_subquery.c.story_id.is_not(None), True), else_=False).label("viewed_by_current_user"),
            case((followed_users_subquery.c.following_id.is_not(None), True), else_=False).label("is_following_author"),
        )
        .options(selectinload(Story.user).selectinload(User.profile))
        .outerjoin(views_subquery, views_subquery.c.story_id == Story.id)
        .outerjoin(viewed_subquery, viewed_subquery.c.story_id == Story.id)
        .outerjoin(followed_users_subquery, followed_users_subquery.c.following_id == Story.user_id)
        .where(
            Story.expires_at > _utcnow(),
            Story.user_id.not_in(select(blocked_users.c.user_id)),
        )
    )
    return statement


def _serialize_story_groups(rows, current_user_id: int) -> list[dict[str, object]]:
    groups_by_user: dict[int, dict[str, object]] = {}
    ordered_user_ids: list[int] = []
    for row in rows:
        story_data = _serialize_story_row(row, current_user_id)
        story = row[0]
        group = groups_by_user.get(story.user_id)
        if group is None:
            group = {
                "user_id": story.user_id,
                "user": story_data["user"],
                "stories": [],
                "has_unseen": False,
            }
            groups_by_user[story.user_id] = group
            ordered_user_ids.append(story.user_id)
        group["stories"].append(story_data)
        group["has_unseen"] = bool(group["has_unseen"] or not story_data["is_seen"])
    return [groups_by_user[user_id] for user_id in ordered_user_ids]


def create_story(
    db: Session,
    *,
    user_id: int,
    media_url: str,
    media_type: MediaType,
    media_size_bytes: int | None = None,
    media_duration_seconds: float | None = None,
) -> dict[str, object]:
    validate_media_payload(
        media_url=media_url,
        media_type=media_type,
        media_size_bytes=media_size_bytes,
        media_duration_seconds=media_duration_seconds,
    )
    story = Story(
        user_id=user_id,
        media_url=media_url,
        media_type=media_type,
        expires_at=_utcnow() + timedelta(hours=24),
    )
    db.add(story)
    db.commit()
    invalidate_social_cache()

    statement = _build_story_query(user_id)
    row = db.execute(statement.where(Story.id == story.id)).first()
    if row is None:
        raise LookupError("Story not found")
    return _serialize_story_row(row, user_id)


def list_active_stories(db: Session, *, current_user_id: int, limit: int, offset: int) -> tuple[list[dict[str, object]], int]:
    statement = _build_story_query(current_user_id)
    rows = db.execute(
        statement.order_by(
            case((Story.id.in_(select(StoryView.story_id).where(StoryView.viewer_id == current_user_id)), 0), else_=1).desc(),
            case((Story.user_id == current_user_id, 2), (Story.user_id.in_(select(Follow.following_id).where(Follow.follower_id == current_user_id)), 1), else_=0).desc(),
            Story.created_at.desc(),
            Story.id.desc(),
        )
    ).all()
    grouped = _serialize_story_groups(rows, current_user_id)
    total = len(grouped)
    return grouped[offset : offset + limit], total


def view_story(db: Session, *, story_id: int, current_user_id: int) -> dict[str, object]:
    statement = _build_story_query(current_user_id)
    row = db.execute(statement.where(Story.id == story_id)).first()
    if row is None:
        raise LookupError("Story not found")

    story = row[0]
    if story.user_id != current_user_id:
        existing = db.scalar(select(StoryView).where(StoryView.story_id == story_id, StoryView.viewer_id == current_user_id))
        if existing is None:
            db.add(StoryView(story_id=story_id, viewer_id=current_user_id))
            try:
                db.commit()
            except IntegrityError:
                db.rollback()

    refreshed = db.execute(statement.where(Story.id == story_id)).first()
    if refreshed is None:
        raise LookupError("Story not found")
    return _serialize_story_row(refreshed, current_user_id)


def _serialize_collection_preview(post: Post) -> dict[str, object]:
    return {
        "id": post.id,
        "caption": post.caption,
        "media_url": post.media_url,
        "media_type": post.media_type,
        "created_at": post.created_at,
    }


def _load_collection(db: Session, *, collection_id: int, user_id: int) -> Collection:
    collection = db.scalar(
        select(Collection)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Collection.post_entries)
            .selectinload(CollectionPost.post)
            .selectinload(Post.user)
            .selectinload(User.profile)
        )
        .where(Collection.id == collection_id, Collection.user_id == user_id)
    )
    if collection is None:
        raise LookupError("Collection not found")
    return collection


def _serialize_collection(db: Session, collection: Collection, current_user_id: int) -> dict[str, object]:
    blocked_users = _blocked_user_ids(db, current_user_id)
    previews: list[dict[str, object]] = []
    for entry in sorted(
        collection.post_entries,
        key=lambda item: (item.post.created_at if item.post else _utcnow(), item.post_id),
        reverse=True,
    ):
        if entry.post is None or entry.post.user_id in blocked_users:
            continue
        previews.append(_serialize_collection_preview(entry.post))
    return {
        "id": collection.id,
        "name": collection.name,
        "created_at": collection.created_at,
        "posts_count": len(previews),
        "posts": previews,
    }


def create_collection(db: Session, *, user_id: int, name: str) -> dict[str, object]:
    normalized = name.strip()
    if not normalized:
        raise ValueError("Collection name cannot be blank")
    collection = Collection(user_id=user_id, name=normalized)
    db.add(collection)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Collection name already exists") from exc
    collection = _load_collection(db, collection_id=collection.id, user_id=user_id)
    return _serialize_collection(db, collection, user_id)


def add_post_to_collection(
    db: Session,
    *,
    collection_id: int,
    post_id: int,
    current_user_id: int,
) -> dict[str, object]:
    collection = _load_collection(db, collection_id=collection_id, user_id=current_user_id)
    _ensure_accessible_post(db, post_id=post_id, current_user_id=current_user_id)
    existing = db.scalar(
        select(CollectionPost).where(CollectionPost.collection_id == collection_id, CollectionPost.post_id == post_id)
    )
    if existing is None:
        db.add(CollectionPost(collection_id=collection_id, post_id=post_id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    db.expire_all()
    collection = _load_collection(db, collection_id=collection_id, user_id=current_user_id)
    return _serialize_collection(db, collection, current_user_id)


def list_collections(
    db: Session,
    *,
    user_id: int,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, object]], int]:
    collections = db.scalars(
        select(Collection)
        .options(
            selectinload(Collection.post_entries)
            .selectinload(CollectionPost.post)
            .selectinload(Post.user)
            .selectinload(User.profile)
        )
        .where(Collection.user_id == user_id)
        .order_by(Collection.created_at.desc(), Collection.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    total = int(db.scalar(select(func.count(Collection.id)).where(Collection.user_id == user_id)) or 0)
    return [_serialize_collection(db, collection, user_id) for collection in collections], total


def follow_user(db: Session, *, follower_id: int, following_id: int) -> tuple[Follow | None, int, int]:
    if follower_id == following_id:
        raise ValueError("You cannot follow yourself")

    target_user = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == following_id))
    if target_user is None:
        raise LookupError("User not found")
    if has_block_relationship(db, follower_id, following_id):
        raise RuntimeError("Follow unavailable for this user")

    follow = db.scalar(select(Follow).where(Follow.follower_id == follower_id, Follow.following_id == following_id))
    if follow is None:
        follow = Follow(follower_id=follower_id, following_id=following_id)
        db.add(follow)
        actor = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == follower_id))
        actor_name = actor.profile.name if actor and actor.profile and actor.profile.name else actor.email if actor else "Someone"
        create_notification(
            db=db,
            user_id=following_id,
            notification_type="new_follower",
            message=f"{actor_name} started following you",
            commit=False,
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            follow = db.scalar(select(Follow).where(Follow.follower_id == follower_id, Follow.following_id == following_id))
    invalidate_discover_cache()
    invalidate_social_cache()
    followers_count = int(db.scalar(select(func.count(Follow.follower_id)).where(Follow.following_id == following_id)) or 0)
    following_count = int(db.scalar(select(func.count(Follow.following_id)).where(Follow.follower_id == follower_id)) or 0)
    return follow, followers_count, following_count


def unfollow_user(db: Session, *, follower_id: int, following_id: int) -> tuple[bool, int, int]:
    if follower_id == following_id:
        raise ValueError("You cannot unfollow yourself")
    target_user = db.scalar(select(User.id).where(User.id == following_id))
    if target_user is None:
        raise LookupError("User not found")

    follow = db.scalar(select(Follow).where(Follow.follower_id == follower_id, Follow.following_id == following_id))
    deleted = False
    if follow is not None:
        db.delete(follow)
        db.commit()
        deleted = True
    invalidate_discover_cache()
    invalidate_social_cache()
    followers_count = int(db.scalar(select(func.count(Follow.follower_id)).where(Follow.following_id == following_id)) or 0)
    following_count = int(db.scalar(select(func.count(Follow.following_id)).where(Follow.follower_id == follower_id)) or 0)
    return deleted, followers_count, following_count


def _user_visibility_query(current_user_id: int):
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    return select(User).options(selectinload(User.profile)).where(User.id.not_in(select(blocked_users.c.user_id)))


def list_followers(
    db: Session,
    *,
    user_id: int,
    current_user_id: int,
    limit: int,
    offset: int,
) -> tuple[list[User], int]:
    target_user = db.scalar(_user_visibility_query(current_user_id).where(User.id == user_id))
    if target_user is None:
        raise LookupError("User not found")
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    users = db.scalars(
        _user_visibility_query(current_user_id)
        .join(Follow, Follow.follower_id == User.id)
        .where(Follow.following_id == user_id, User.id.not_in(select(blocked_users.c.user_id)))
        .order_by(User.created_at.desc(), User.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    total = int(
        db.scalar(
            select(func.count(User.id))
            .join(Follow, Follow.follower_id == User.id)
            .where(Follow.following_id == user_id, User.id.not_in(select(blocked_users.c.user_id)))
        )
        or 0
    )
    return users, total


def list_following(
    db: Session,
    *,
    user_id: int,
    current_user_id: int,
    limit: int,
    offset: int,
) -> tuple[list[User], int]:
    target_user = db.scalar(_user_visibility_query(current_user_id).where(User.id == user_id))
    if target_user is None:
        raise LookupError("User not found")
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    users = db.scalars(
        _user_visibility_query(current_user_id)
        .join(Follow, Follow.following_id == User.id)
        .where(Follow.follower_id == user_id, User.id.not_in(select(blocked_users.c.user_id)))
        .order_by(User.created_at.desc(), User.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    total = int(
        db.scalar(
            select(func.count(User.id))
            .join(Follow, Follow.following_id == User.id)
            .where(Follow.follower_id == user_id, User.id.not_in(select(blocked_users.c.user_id)))
        )
        or 0
    )
    return users, total


def get_user_with_social_stats(db: Session, *, user_id: int, current_user_id: int) -> dict[str, object] | None:
    user = db.scalar(_user_visibility_query(current_user_id).where(User.id == user_id))
    if user is None:
        return None

    posts_count = int(db.scalar(select(func.count(Post.id)).where(Post.user_id == user_id)) or 0)
    followers_count = int(db.scalar(select(func.count(Follow.follower_id)).where(Follow.following_id == user_id)) or 0)
    following_count = int(db.scalar(select(func.count(Follow.following_id)).where(Follow.follower_id == user_id)) or 0)
    saved_count = int(db.scalar(select(func.count(SavedPost.post_id)).where(SavedPost.user_id == user_id)) or 0)
    return {
        **_serialize_user(user),
        "posts_count": posts_count,
        "followers_count": followers_count,
        "following_count": following_count,
        "saved_count": saved_count,
    }


def create_report(
    db: Session,
    *,
    reporter_id: int,
    target_type: ReportTargetType,
    target_id: int,
    reason: str,
) -> dict[str, object]:
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ValueError("Reason cannot be blank")

    if target_type == ReportTargetType.post:
        exists = bool(db.scalar(select(Post.id).where(Post.id == target_id)))
    else:
        exists = bool(db.scalar(select(User.id).where(User.id == target_id)))
    if not exists:
        raise LookupError("Report target not found")

    report = Report(
        reporter_id=reporter_id,
        target_type=target_type,
        target_id=target_id,
        reason=normalized_reason,
    )
    db.add(report)
    db.commit()
    return {
        "id": report.id,
        "target_type": report.target_type,
        "target_id": report.target_id,
        "reason": report.reason,
        "created_at": report.created_at,
    }


def block_user(db: Session, *, blocker_id: int, blocked_id: int) -> dict[str, object]:
    if blocker_id == blocked_id:
        raise ValueError("You cannot block yourself")

    user = db.scalar(select(User.id).where(User.id == blocked_id))
    if user is None:
        raise LookupError("User not found")

    existing = db.scalar(select(Block).where(Block.blocker_id == blocker_id, Block.blocked_id == blocked_id))
    if existing is None:
        db.add(Block(blocker_id=blocker_id, blocked_id=blocked_id))
    db.execute(
        delete(Follow).where(
            or_(
                and_(Follow.follower_id == blocker_id, Follow.following_id == blocked_id),
                and_(Follow.follower_id == blocked_id, Follow.following_id == blocker_id),
            )
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    invalidate_discover_cache()
    invalidate_social_cache()
    return {"blocked": True, "user_id": blocked_id}
