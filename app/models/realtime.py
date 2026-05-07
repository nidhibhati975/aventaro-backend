from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.chat import Message
    from app.models.user import User


class MessageDelivery(Base):
    __tablename__ = "app_message_deliveries"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_app_message_deliveries_message_user"),
        Index("ix_app_message_deliveries_user_status_created_at", "user_id", "status", "created_at"),
        Index("ix_app_message_deliveries_stream_id", "redis_stream_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("app_messages.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    redis_stream_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    message: Mapped["Message"] = relationship(back_populates="deliveries")
    user: Mapped["User"] = relationship()


class ChatOutboxEvent(Base):
    __tablename__ = "app_chat_outbox_events"
    __table_args__ = (
        UniqueConstraint("event_id", name="uq_app_chat_outbox_events_event_id"),
        Index("ix_app_chat_outbox_events_status_created_at", "status", "created_at"),
        Index("ix_app_chat_outbox_events_stream_id", "redis_stream_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    conversation_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    message_id: Mapped[int | None] = mapped_column(ForeignKey("app_messages.id", ondelete="CASCADE"), nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    redis_stream_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    message: Mapped["Message | None"] = relationship()

