from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class RewardType(str, Enum):
    coins = "coins"
    credits = "credits"
    premium_days = "premium_days"


class TransactionType(str, Enum):
    earned = "earned"
    spent = "spent"
    bonus = "bonus"
    refund = "refund"


class RewardTransaction(Base):
    __tablename__ = "app_reward_transactions"
    __table_args__ = (
        Index("ix_app_reward_transactions_user_type_created_at", "user_id", "transaction_type", "created_at"),
        Index("ix_app_reward_transactions_user_balance", "user_id", "balance_after"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    transaction_type: Mapped[TransactionType] = mapped_column(String(20), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reference_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reference_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="reward_transactions")


class UserRewardBalance(Base):
    __tablename__ = "app_user_reward_balances"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True, unique=True)
    coins: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lifetime_coins: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="reward_balance")


class RewardAction(Base):
    __tablename__ = "app_reward_actions"
    __table_args__ = (
        UniqueConstraint("action_type", name="uq_app_reward_actions_action_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    action_type: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    coins: Mapped[int] = mapped_column(Integer, nullable=False)
    max_per_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)


class BoostPurchase(Base):
    __tablename__ = "app_boost_purchases"
    __table_args__ = (
        Index("ix_app_boost_purchases_user_type_created_at", "user_id", "boost_type", "created_at"),
        Index("ix_app_boost_purchases_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    boost_type: Mapped[str] = mapped_column(String(20), nullable=False)
    amount_paid: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False)
    transaction_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="boost_purchases")


class CommissionRecord(Base):
    __tablename__ = "app_commission_records"
    __table_args__ = (
        Index("ix_app_commission_records_booking_id", "booking_id"),
        Index("ix_app_commission_records_user_id", "user_id"),
        Index("ix_app_commission_records_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("app_bookings.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False)
    commission_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    commission_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    service_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class RevenueMetrics(Base):
    __tablename__ = "app_revenue_metrics"
    __table_args__ = (
        Index("ix_app_revenue_metrics_date", "date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    subscription_revenue: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    boost_revenue: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    commission_revenue: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    total_revenue: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    new_subscriptions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cancelled_subscriptions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_active_subscribers: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
