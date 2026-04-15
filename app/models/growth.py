from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class Boost(Base):
    __tablename__ = "app_boosts"
    __table_args__ = (
        UniqueConstraint("user_id", "boost_type", name="uq_app_boosts_user_boost_type"),
        Index("ix_app_boosts_user_type_expires_at", "user_id", "boost_type", "expires_at"),
        Index("ix_app_boosts_type_expires_at", "boost_type", "expires_at"),
        Index("ix_app_boosts_user_type_last_activated_at", "user_id", "boost_type", "last_activated_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    boost_type: Mapped[str] = mapped_column(String(20), nullable=False)
    last_activated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="boosts")


class Referral(Base):
    __tablename__ = "app_referrals"
    __table_args__ = (
        UniqueConstraint("referred_user_id", name="uq_app_referrals_referred_user_id"),
        UniqueConstraint("referrer_id", "referral_ip", name="uq_app_referrals_referrer_referral_ip"),
        Index("ix_app_referrals_referrer_reward", "referrer_id", "reward_given"),
        Index("ix_app_referrals_referral_ip_created_at", "referral_ip", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    referrer_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    referred_user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    referral_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reward_given: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    suspicious: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    referrer: Mapped["User"] = relationship(back_populates="referrals_sent", foreign_keys=[referrer_id])
    referred_user: Mapped["User"] = relationship(back_populates="referral_received", foreign_keys=[referred_user_id])


class AnalyticsEvent(Base):
    __tablename__ = "app_analytics_events"
    __table_args__ = (
        Index("ix_app_analytics_events_user_type_created_at", "user_id", "event_type", "created_at"),
        Index("ix_app_analytics_events_type_created_at", "event_type", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User | None"] = relationship(back_populates="analytics_events")
