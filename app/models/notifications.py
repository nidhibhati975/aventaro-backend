from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class NotificationStatus(str, Enum):
    """Notification delivery status."""
    pending = "pending"
    sent = "sent"
    failed = "failed"


class NotificationPriority(str, Enum):
    """Notification priority levels."""
    low = "low"
    normal = "normal"
    high = "high"
    urgent = "urgent"


class Notification(Base):
    __tablename__ = "app_notifications"
    __table_args__ = (
        Index("ix_app_notifications_user_read_created_at", "user_id", "is_read", "created_at"),
        Index("ix_app_notifications_status_priority", "status", "priority"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    message: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    
    # Enhanced fields for advanced notification system
    status: Mapped[NotificationStatus] = mapped_column(
        String(20),
        default=NotificationStatus.pending,
        nullable=False,
    )
    priority: Mapped[NotificationPriority] = mapped_column(
        String(20),
        default=NotificationPriority.normal,
        nullable=False,
    )
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deep_link: Mapped[str | None] = mapped_column(String(512), nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="notifications")


class PushDevice(Base):
    __tablename__ = "app_push_devices"
    __table_args__ = (
        UniqueConstraint("token", name="uq_app_push_devices_token"),
        Index("ix_app_push_devices_user_is_active", "user_id", "is_active"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(512), nullable=False)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="push_devices")
