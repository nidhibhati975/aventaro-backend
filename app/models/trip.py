from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, DateTime, Enum as SqlEnum, Float, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.chat import Conversation
    from app.models.booking import Booking
    from app.models.user import User


class TripMemberRole(str, Enum):
    owner = "owner"
    member = "member"


class TripMembershipStatus(str, Enum):
    pending = "pending"
    approved = "approved"


class TripVisibility(str, Enum):
    public = "public"
    private = "private"


class TripStatus(str, Enum):
    planned = "planned"
    active = "active"
    completed = "completed"


class TripLifecycleStatus(str, Enum):
    draft = "draft"
    planned = "planned"
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


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
        CheckConstraint(
            "(start_date IS NULL OR end_date IS NULL) OR start_date <= end_date",
            name="ck_app_trips_date_range",
        ),
        Index("ix_app_trips_location_created_at", "location", "created_at"),
        Index("ix_app_trips_visibility", "visibility"),
        Index("ix_app_trips_lifecycle_status", "lifecycle_status"),
        Index("ix_app_trips_start_date", "start_date"),
        Index("ix_app_trips_end_date", "end_date"),
        Index("ix_app_trips_lat_lon", "latitude", "longitude"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    location: Mapped[str] = mapped_column(String(150), nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    budget_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    budget_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    interests: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    visibility: Mapped[TripVisibility] = mapped_column(
        SqlEnum(TripVisibility, native_enum=False),
        default=TripVisibility.public,
        nullable=False,
    )
    status: Mapped[TripStatus] = mapped_column(
        SqlEnum(TripStatus, native_enum=False),
        default=TripStatus.planned,
        nullable=False,
    )
    lifecycle_status: Mapped[TripLifecycleStatus] = mapped_column(
        SqlEnum(TripLifecycleStatus, native_enum=False),
        default=TripLifecycleStatus.draft,
        nullable=False,
    )
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
    itinerary_items: Mapped[list["TripItineraryItem"]] = relationship(back_populates="trip", cascade="all, delete-orphan", order_by="TripItineraryItem.order_index")
    itinerary_days: Mapped[list["TripItineraryDay"]] = relationship(back_populates="trip", cascade="all, delete-orphan", order_by="TripItineraryDay.day_date")
    places: Mapped[list["TripPlace"]] = relationship(back_populates="trip", cascade="all, delete-orphan", order_by="TripPlace.order_index")
    polls: Mapped[list["TripPoll"]] = relationship(back_populates="trip", cascade="all, delete-orphan", order_by="TripPoll.created_at.desc()")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="trip", cascade="all, delete-orphan")


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


class TripItineraryItem(Base):
    __tablename__ = "app_trip_itinerary_items"
    __table_args__ = (
        Index("ix_app_trip_itinerary_trip_order", "trip_id", "order_index"),
        Index("ix_app_trip_itinerary_trip_created_at", "trip_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    item_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    trip: Mapped["Trip"] = relationship(back_populates="itinerary_items")


class TripItineraryDay(Base):
    __tablename__ = "app_trip_itinerary_days"
    __table_args__ = (
        UniqueConstraint("trip_id", "day_date", name="uq_app_trip_itinerary_days_trip_day"),
        Index("ix_app_trip_itinerary_days_trip_date", "trip_id", "day_date"),
        Index("ix_app_trip_itinerary_days_created_by", "created_by_user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(150), nullable=True)
    day_date: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    trip: Mapped["Trip"] = relationship(back_populates="itinerary_days")
    created_by: Mapped["User"] = relationship(foreign_keys=[created_by_user_id])
    places: Mapped[list["TripPlace"]] = relationship(back_populates="day", cascade="all, delete-orphan", order_by="TripPlace.order_index")
    polls: Mapped[list["TripPoll"]] = relationship(back_populates="day", cascade="all, delete-orphan", order_by="TripPoll.created_at.desc()")


class TripPlace(Base):
    __tablename__ = "app_trip_places"
    __table_args__ = (
        Index("ix_app_trip_places_trip_order", "trip_id", "order_index"),
        Index("ix_app_trip_places_trip_day", "trip_id", "day_id"),
        Index("ix_app_trip_places_created_by", "created_by_user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False, index=True)
    day_id: Mapped[int | None] = mapped_column(ForeignKey("app_trip_itinerary_days.id", ondelete="SET NULL"), nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    external_place_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    trip: Mapped["Trip"] = relationship(back_populates="places")
    day: Mapped["TripItineraryDay | None"] = relationship(back_populates="places")
    created_by: Mapped["User"] = relationship(foreign_keys=[created_by_user_id])


class TripPoll(Base):
    __tablename__ = "app_trip_polls"
    __table_args__ = (
        Index("ix_app_trip_polls_trip_created_at", "trip_id", "created_at"),
        Index("ix_app_trip_polls_day_id", "day_id"),
        Index("ix_app_trip_polls_created_by", "created_by_user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False, index=True)
    day_id: Mapped[int | None] = mapped_column(ForeignKey("app_trip_itinerary_days.id", ondelete="SET NULL"), nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    question: Mapped[str] = mapped_column(String(255), nullable=False)
    options: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    trip: Mapped["Trip"] = relationship(back_populates="polls")
    day: Mapped["TripItineraryDay | None"] = relationship(back_populates="polls")
    created_by: Mapped["User"] = relationship(foreign_keys=[created_by_user_id])
    votes: Mapped[list["TripVote"]] = relationship(back_populates="poll", cascade="all, delete-orphan")


class TripVote(Base):
    __tablename__ = "app_trip_votes"
    __table_args__ = (
        UniqueConstraint("poll_id", "user_id", name="uq_app_trip_votes_poll_user"),
        Index("ix_app_trip_votes_trip_id", "trip_id"),
        Index("ix_app_trip_votes_poll_option", "poll_id", "option_index"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False)
    poll_id: Mapped[int] = mapped_column(ForeignKey("app_trip_polls.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    option_index: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    poll: Mapped["TripPoll"] = relationship(back_populates="votes")
    user: Mapped["User"] = relationship(foreign_keys=[user_id])


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
