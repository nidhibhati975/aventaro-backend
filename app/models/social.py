from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum as SqlEnum, Float, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class MediaType(str, Enum):
    image = "image"
    video = "video"


class ReportTargetType(str, Enum):
    post = "post"
    user = "user"


class Post(Base):
    __tablename__ = "app_posts"
    __table_args__ = (
        Index("ix_app_posts_user_created_at", "user_id", "created_at"),
        Index("ix_app_posts_media_type_created_at", "media_type", "created_at"),
        Index("ix_app_posts_location_created_at", "location", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    media_type: Mapped[MediaType] = mapped_column(SqlEnum(MediaType, native_enum=False), nullable=False)
    location: Mapped[str | None] = mapped_column(String(150), nullable=True)
    watch_time: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="posts")
    likes: Mapped[list["PostLike"]] = relationship(back_populates="post", cascade="all, delete-orphan")
    comments: Mapped[list["PostComment"]] = relationship(back_populates="post", cascade="all, delete-orphan")
    saves: Mapped[list["SavedPost"]] = relationship(back_populates="post", cascade="all, delete-orphan")
    watches: Mapped[list["PostWatch"]] = relationship(back_populates="post", cascade="all, delete-orphan")
    hashtag_entries: Mapped[list["PostHashtag"]] = relationship(back_populates="post", cascade="all, delete-orphan")
    collection_entries: Mapped[list["CollectionPost"]] = relationship(back_populates="post", cascade="all, delete-orphan")


class PostLike(Base):
    __tablename__ = "app_likes"
    __table_args__ = (
        UniqueConstraint("user_id", "post_id", name="uq_app_likes_user_post"),
        Index("ix_app_likes_post_id", "post_id"),
        Index("ix_app_likes_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False)
    post_id: Mapped[int] = mapped_column(ForeignKey("app_posts.id", ondelete="CASCADE"), nullable=False)

    user: Mapped["User"] = relationship(back_populates="post_likes")
    post: Mapped["Post"] = relationship(back_populates="likes")


class PostWatch(Base):
    __tablename__ = "app_post_watches"
    __table_args__ = (
        UniqueConstraint("user_id", "post_id", name="uq_app_post_watches_user_post"),
        Index("ix_app_post_watches_post_id", "post_id"),
        Index("ix_app_post_watches_user_id", "user_id"),
        Index("ix_app_post_watches_post_completed", "post_id", "completed"),
        CheckConstraint("watch_time >= 0", name="ck_app_post_watches_watch_time_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False)
    post_id: Mapped[int] = mapped_column(ForeignKey("app_posts.id", ondelete="CASCADE"), nullable=False)
    watch_time: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    skipped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    viewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="post_watches")
    post: Mapped["Post"] = relationship(back_populates="watches")


class PostComment(Base):
    __tablename__ = "app_comments"
    __table_args__ = (
        CheckConstraint("char_length(trim(comment)) > 0", name="ck_app_comments_not_blank"),
        Index("ix_app_comments_post_created_at", "post_id", "created_at"),
        Index("ix_app_comments_user_created_at", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("app_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="post_comments")
    post: Mapped["Post"] = relationship(back_populates="comments")


class Story(Base):
    __tablename__ = "app_stories"
    __table_args__ = (
        Index("ix_app_stories_user_created_at", "user_id", "created_at"),
        Index("ix_app_stories_expires_at", "expires_at"),
        Index("ix_app_stories_user_expires_at", "user_id", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    media_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    media_type: Mapped[MediaType] = mapped_column(SqlEnum(MediaType, native_enum=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped["User"] = relationship(back_populates="stories")
    views: Mapped[list["StoryView"]] = relationship(back_populates="story", cascade="all, delete-orphan")


class StoryView(Base):
    __tablename__ = "app_story_views"
    __table_args__ = (
        UniqueConstraint("story_id", "viewer_id", name="uq_app_story_views_story_viewer"),
        Index("ix_app_story_views_story_id", "story_id"),
        Index("ix_app_story_views_viewer_id", "viewer_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    story_id: Mapped[int] = mapped_column(ForeignKey("app_stories.id", ondelete="CASCADE"), nullable=False)
    viewer_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False)
    viewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    story: Mapped["Story"] = relationship(back_populates="views")
    viewer: Mapped["User"] = relationship(back_populates="story_views")


class Hashtag(Base):
    __tablename__ = "app_hashtags"
    __table_args__ = (UniqueConstraint("tag", name="uq_app_hashtags_tag"), Index("ix_app_hashtags_tag", "tag"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tag: Mapped[str] = mapped_column(String(64), nullable=False)

    post_entries: Mapped[list["PostHashtag"]] = relationship(back_populates="hashtag", cascade="all, delete-orphan")


class PostHashtag(Base):
    __tablename__ = "app_post_hashtags"
    __table_args__ = (
        UniqueConstraint("post_id", "hashtag_id", name="uq_app_post_hashtags_post_hashtag"),
        Index("ix_app_post_hashtags_hashtag_id", "hashtag_id"),
    )

    post_id: Mapped[int] = mapped_column(ForeignKey("app_posts.id", ondelete="CASCADE"), primary_key=True)
    hashtag_id: Mapped[int] = mapped_column(ForeignKey("app_hashtags.id", ondelete="CASCADE"), primary_key=True)

    post: Mapped["Post"] = relationship(back_populates="hashtag_entries")
    hashtag: Mapped["Hashtag"] = relationship(back_populates="post_entries")


class Follow(Base):
    __tablename__ = "app_follows"
    __table_args__ = (
        CheckConstraint("follower_id <> following_id", name="ck_app_follows_distinct_users"),
        UniqueConstraint("follower_id", "following_id", name="uq_app_follows_pair"),
        Index("ix_app_follows_follower_id", "follower_id"),
        Index("ix_app_follows_following_id", "following_id"),
    )

    follower_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), primary_key=True)
    following_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), primary_key=True)

    follower: Mapped["User"] = relationship(
        back_populates="following_relationships",
        foreign_keys=[follower_id],
    )
    following: Mapped["User"] = relationship(
        back_populates="follower_relationships",
        foreign_keys=[following_id],
    )


class Collection(Base):
    __tablename__ = "app_collections"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_app_collections_user_name"),
        Index("ix_app_collections_user_created_at", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="collections")
    post_entries: Mapped[list["CollectionPost"]] = relationship(back_populates="collection", cascade="all, delete-orphan")


class CollectionPost(Base):
    __tablename__ = "app_collection_posts"
    __table_args__ = (
        UniqueConstraint("collection_id", "post_id", name="uq_app_collection_posts_collection_post"),
        Index("ix_app_collection_posts_post_id", "post_id"),
    )

    collection_id: Mapped[int] = mapped_column(ForeignKey("app_collections.id", ondelete="CASCADE"), primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("app_posts.id", ondelete="CASCADE"), primary_key=True)

    collection: Mapped["Collection"] = relationship(back_populates="post_entries")
    post: Mapped["Post"] = relationship(back_populates="collection_entries")


class SavedPost(Base):
    __tablename__ = "app_saved_posts"
    __table_args__ = (
        UniqueConstraint("user_id", "post_id", name="uq_app_saved_posts_user_post"),
        Index("ix_app_saved_posts_user_id", "user_id"),
        Index("ix_app_saved_posts_post_id", "post_id"),
    )

    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("app_posts.id", ondelete="CASCADE"), primary_key=True)

    user: Mapped["User"] = relationship(back_populates="saved_post_entries")
    post: Mapped["Post"] = relationship(back_populates="saves")


class Report(Base):
    __tablename__ = "app_reports"
    __table_args__ = (
        Index("ix_app_reports_target_created_at", "target_type", "target_id", "created_at"),
        Index("ix_app_reports_reporter_created_at", "reporter_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    target_type: Mapped[ReportTargetType] = mapped_column(SqlEnum(ReportTargetType, native_enum=False), nullable=False)
    target_id: Mapped[int] = mapped_column(nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    reporter: Mapped["User"] = relationship(back_populates="reports")


class Block(Base):
    __tablename__ = "app_blocks"
    __table_args__ = (
        CheckConstraint("blocker_id <> blocked_id", name="ck_app_blocks_distinct_users"),
        UniqueConstraint("blocker_id", "blocked_id", name="uq_app_blocks_pair"),
        Index("ix_app_blocks_blocker_id", "blocker_id"),
        Index("ix_app_blocks_blocked_id", "blocked_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    blocker_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False)
    blocked_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False)

    blocker: Mapped["User"] = relationship(back_populates="blocking_relationships", foreign_keys=[blocker_id])
    blocked: Mapped["User"] = relationship(back_populates="blocked_by_relationships", foreign_keys=[blocked_id])
