from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.chat import ConversationMember, Message
    from app.models.match import Match
    from app.models.notifications import Notification, PushDevice
    from app.models.growth import AnalyticsEvent, Boost, Referral
    from app.models.payments import Payment, Subscription
    from app.models.profile import Profile
    from app.models.social import (
        Block,
        Collection,
        Follow,
        Post,
        PostComment,
        PostLike,
        PostWatch,
        Report,
        SavedPost,
        Story,
        StoryView,
    )
    from app.models.trip import Expense, ExpenseSplit, Trip, TripActivity, TripMember


class User(Base):
    __tablename__ = "app_users"
    __table_args__ = (Index("ix_app_users_created_at", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    referral_code: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    profile: Mapped["Profile | None"] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False,
    )
    sent_matches: Mapped[list["Match"]] = relationship(
        back_populates="sender",
        foreign_keys="Match.sender_id",
    )
    received_matches: Mapped[list["Match"]] = relationship(
        back_populates="receiver",
        foreign_keys="Match.receiver_id",
    )
    owned_trips: Mapped[list["Trip"]] = relationship(back_populates="owner")
    trip_memberships: Mapped[list["TripMember"]] = relationship(back_populates="user")
    sent_messages: Mapped[list["Message"]] = relationship(
        back_populates="sender",
        foreign_keys="Message.sender_id",
    )
    received_messages: Mapped[list["Message"]] = relationship(
        back_populates="recipient",
        foreign_keys="Message.recipient_id",
    )
    conversation_memberships: Mapped[list["ConversationMember"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    notifications: Mapped[list["Notification"]] = relationship(back_populates="user")
    push_devices: Mapped[list["PushDevice"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    subscriptions: Mapped[list["Subscription"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    boosts: Mapped[list["Boost"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    analytics_events: Mapped[list["AnalyticsEvent"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    referrals_sent: Mapped[list["Referral"]] = relationship(
        back_populates="referrer",
        foreign_keys="Referral.referrer_id",
        cascade="all, delete-orphan",
    )
    referral_received: Mapped["Referral | None"] = relationship(
        back_populates="referred_user",
        foreign_keys="Referral.referred_user_id",
        uselist=False,
    )
    posts: Mapped[list["Post"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    post_likes: Mapped[list["PostLike"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    post_comments: Mapped[list["PostComment"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    post_watches: Mapped[list["PostWatch"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    stories: Mapped[list["Story"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    story_views: Mapped[list["StoryView"]] = relationship(back_populates="viewer", cascade="all, delete-orphan")
    following_relationships: Mapped[list["Follow"]] = relationship(
        back_populates="follower",
        foreign_keys="Follow.follower_id",
        cascade="all, delete-orphan",
    )
    follower_relationships: Mapped[list["Follow"]] = relationship(
        back_populates="following",
        foreign_keys="Follow.following_id",
        cascade="all, delete-orphan",
    )
    collections: Mapped[list["Collection"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    saved_post_entries: Mapped[list["SavedPost"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    reports: Mapped[list["Report"]] = relationship(back_populates="reporter", cascade="all, delete-orphan")
    blocking_relationships: Mapped[list["Block"]] = relationship(
        back_populates="blocker",
        foreign_keys="Block.blocker_id",
        cascade="all, delete-orphan",
    )
    blocked_by_relationships: Mapped[list["Block"]] = relationship(
        back_populates="blocked",
        foreign_keys="Block.blocked_id",
        cascade="all, delete-orphan",
    )
    paid_expenses: Mapped[list["Expense"]] = relationship(back_populates="payer")
    expense_splits: Mapped[list["ExpenseSplit"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    trip_activities: Mapped[list["TripActivity"]] = relationship(back_populates="user")
