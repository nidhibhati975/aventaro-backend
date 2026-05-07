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
    from app.models.user import User
    from app.models.trip import Trip


class BookingStatus(str, Enum):
    pending = "pending"
    payment_initiated = "payment_initiated"
    confirmed = "confirmed"
    completed = "completed"
    cancelled = "cancelled"
    refunded = "refunded"
    failed = "failed"


class BookingItemType(str, Enum):
    hotel = "hotel"
    flight = "flight"
    activity = "activity"


class ReservationStatus(str, Enum):
    pending = "pending"
    confirmed = "confirmed"
    failed = "failed"
    cancelled = "cancelled"
    refunded = "refunded"


class OrderAction(str, Enum):
    created = "created"
    payment_initiated = "payment_initiated"
    paid = "paid"
    payment_failed = "payment_failed"
    reservation_created = "reservation_created"
    reservation_failed = "reservation_failed"
    cancelled = "cancelled"
    refunded = "refunded"


class Booking(Base):
    __tablename__ = "app_bookings"
    __table_args__ = (
        CheckConstraint("total_amount > 0", name="ck_app_bookings_positive_amount"),
        Index("ix_app_bookings_user_id", "user_id"),
        Index("ix_app_bookings_trip_id", "trip_id"),
        Index("ix_app_bookings_status", "status"),
        Index("ix_app_bookings_last_event_id", "last_event_id"),
        Index("ix_app_bookings_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False)
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("app_trips.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[BookingStatus] = mapped_column(
        SqlEnum(BookingStatus, native_enum=False),
        default=BookingStatus.pending,
        nullable=False,
    )
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    last_event_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="bookings")
    trip: Mapped["Trip | None"] = relationship(back_populates="bookings")
    items: Mapped[list["BookingItem"]] = relationship(back_populates="booking", cascade="all, delete-orphan")
    order_history: Mapped[list["OrderHistory"]] = relationship(back_populates="booking", cascade="all, delete-orphan")


class BookingItem(Base):
    __tablename__ = "app_booking_items"
    __table_args__ = (
        Index("ix_app_booking_items_booking_id", "booking_id"),
        Index("ix_app_booking_items_item_type", "item_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("app_bookings.id", ondelete="CASCADE"), nullable=False)
    item_type: Mapped[BookingItemType] = mapped_column(
        SqlEnum(BookingItemType, native_enum=False),
        nullable=False,
    )
    provider_name: Mapped[str] = mapped_column(String(100), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    booking: Mapped["Booking"] = relationship(back_populates="items")
    provider_reservation: Mapped["ProviderReservation | None"] = relationship(
        back_populates="booking_item",
        uselist=False,
        cascade="all, delete-orphan",
    )


class ProviderReservation(Base):
    __tablename__ = "app_provider_reservations"
    __table_args__ = (
        UniqueConstraint("provider_name", "provider_reference", name="uq_app_provider_reservations_provider_ref"),
        Index("ix_app_provider_reservations_booking_item_id", "booking_item_id"),
        Index("ix_app_provider_reservations_status", "reservation_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    booking_item_id: Mapped[int] = mapped_column(
        ForeignKey("app_booking_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    provider_name: Mapped[str] = mapped_column(String(100), nullable=False)
    provider_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    confirmation_number: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_response: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    reservation_status: Mapped[ReservationStatus] = mapped_column(
        SqlEnum(ReservationStatus, native_enum=False),
        default=ReservationStatus.pending,
        nullable=False,
    )

    booking_item: Mapped["BookingItem"] = relationship(back_populates="provider_reservation")


class OrderHistory(Base):
    __tablename__ = "app_order_history"
    __table_args__ = (
        Index("ix_app_order_history_user_id", "user_id"),
        Index("ix_app_order_history_booking_id", "booking_id"),
        Index("ix_app_order_history_action_timestamp", "action", "timestamp"),
        Index("ix_app_order_history_timestamp", "timestamp"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False)
    booking_id: Mapped[int] = mapped_column(ForeignKey("app_bookings.id", ondelete="CASCADE"), nullable=False)
    action: Mapped[OrderAction] = mapped_column(
        SqlEnum(OrderAction, native_enum=False),
        nullable=False,
    )
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    booking: Mapped["Booking"] = relationship(back_populates="order_history")
    user: Mapped["User"] = relationship(back_populates="order_history_entries")
