from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, Enum as SqlEnum, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.chat import Conversation
    from app.models.user import User


class TripMemberRole(str, Enum):
    owner = "owner"
    member = "member"


class TripMembershipStatus(str, Enum):
    pending = "pending"
    approved = "approved"


class ExpenseSplitStatus(str, Enum):
    owed = "owed"
    settled = "settled"


class ExpenseSplitType(str, Enum):
    equal = "equal"
    percentage = "percentage"
    custom = "custom"


class Trip(Base):
    __tablename__ = "app_trips"
    __table_args__ = (
        CheckConstraint("capacity > 0", name="ck_app_trips_positive_capacity"),
        CheckConstraint(
            "(budget_min IS NULL OR budget_max IS NULL) OR budget_min <= budget_max",
            name="ck_app_trips_budget_range",
        ),
        Index("ix_app_trips_location_created_at", "location", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    location: Mapped[str] = mapped_column(String(150), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    budget_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    budget_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    interests: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    owner: Mapped["User"] = relationship(back_populates="owned_trips")
    members: Mapped[list["TripMember"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    group_conversation: Mapped["Conversation | None"] = relationship(back_populates="trip", uselist=False)
    expenses: Mapped[list["Expense"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    activities: Mapped[list["TripActivity"]] = relationship(back_populates="trip", cascade="all, delete-orphan")


class TripMember(Base):
    __tablename__ = "app_trip_members"
    __table_args__ = (
        UniqueConstraint("trip_id", "user_id", name="uq_trip_member"),
        Index("ix_app_trip_members_trip_status", "trip_id", "status"),
        Index("ix_app_trip_members_user_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[TripMemberRole] = mapped_column(
        SqlEnum(TripMemberRole, native_enum=False),
        default=TripMemberRole.member,
        nullable=False,
    )
    status: Mapped[TripMembershipStatus] = mapped_column(
        SqlEnum(TripMembershipStatus, native_enum=False),
        default=TripMembershipStatus.pending,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    trip: Mapped["Trip"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="trip_memberships")


class Expense(Base):
    __tablename__ = "app_expenses"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_app_expenses_positive_amount"),
        Index("ix_app_expenses_trip_created_at", "trip_id", "created_at"),
        Index("ix_app_expenses_paid_by_created_at", "paid_by", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False, index=True)
    paid_by: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    split_type: Mapped[ExpenseSplitType] = mapped_column(
        SqlEnum(ExpenseSplitType, native_enum=False),
        default=ExpenseSplitType.equal,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    trip: Mapped["Trip"] = relationship(back_populates="expenses")
    payer: Mapped["User"] = relationship(back_populates="paid_expenses")
    splits: Mapped[list["ExpenseSplit"]] = relationship(back_populates="expense", cascade="all, delete-orphan")


class ExpenseSplit(Base):
    __tablename__ = "app_expense_splits"
    __table_args__ = (
        UniqueConstraint("expense_id", "user_id", name="uq_app_expense_splits_pair"),
        Index("ix_app_expense_splits_user_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("app_expenses.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[ExpenseSplitStatus] = mapped_column(
        SqlEnum(ExpenseSplitStatus, native_enum=False),
        default=ExpenseSplitStatus.owed,
        nullable=False,
    )

    expense: Mapped["Expense"] = relationship(back_populates="splits")
    user: Mapped["User"] = relationship(back_populates="expense_splits")


class TripActivity(Base):
    __tablename__ = "app_trip_activities"
    __table_args__ = (
        Index("ix_app_trip_activities_trip_created_at", "trip_id", "created_at"),
        Index("ix_app_trip_activities_user_created_at", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    activity_type: Mapped[str] = mapped_column("type", String(50), nullable=False)
    activity_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    trip: Mapped["Trip"] = relationship(back_populates="activities")
    user: Mapped["User | None"] = relationship(back_populates="trip_activities")
