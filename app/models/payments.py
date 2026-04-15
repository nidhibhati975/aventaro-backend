from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class Payment(Base):
    __tablename__ = "app_payments"
    __table_args__ = (
        UniqueConstraint("stripe_session_id", name="uq_app_payments_stripe_session_id"),
        CheckConstraint("amount >= 0", name="ck_app_payments_non_negative_amount"),
        Index("ix_app_payments_user_status_created_at", "user_id", "status", "created_at"),
        Index("ix_app_payments_user_price_status", "user_id", "stripe_price_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    stripe_session_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    stripe_price_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    checkout_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    checkout_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="usd")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="created")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="payments")


class Subscription(Base):
    __tablename__ = "app_subscriptions"
    __table_args__ = (
        UniqueConstraint("stripe_subscription_id", name="uq_app_subscriptions_stripe_subscription_id"),
        Index("ix_app_subscriptions_user_status_created_at", "user_id", "status", "created_at"),
        Index("ix_app_subscriptions_user_plan_status", "user_id", "plan_type", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_type: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="subscriptions")


class WebhookEvent(Base):
    __tablename__ = "app_webhook_events"
    __table_args__ = (
        UniqueConstraint("stripe_event_id", name="uq_app_webhook_events_stripe_event_id"),
        Index("ix_app_webhook_events_type_processed_created_at", "event_type", "processed", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    stripe_event_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    processed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
