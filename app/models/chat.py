from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, Enum as SqlEnum, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.trip import Trip
    from app.models.user import User


class ConversationType(str, Enum):
    direct = "direct"
    group = "group"


class MessageStatus(str, Enum):
    sent = "sent"
    delivered = "delivered"
    read = "read"


class Conversation(Base):
    __tablename__ = "app_conversations"
    __table_args__ = (
        UniqueConstraint("participant_one_id", "participant_two_id", name="uq_direct_conversation_pair"),
        CheckConstraint(
            "(conversation_type = 'direct' AND participant_one_id IS NOT NULL AND participant_two_id IS NOT NULL) "
            "OR (conversation_type = 'group' AND trip_id IS NOT NULL)",
            name="ck_app_conversations_type_shape",
        ),
        CheckConstraint(
            "participant_one_id IS NULL OR participant_two_id IS NULL OR participant_one_id <> participant_two_id",
            name="ck_app_conversations_distinct_participants",
        ),
        Index("ix_app_conversations_participant_one_last_message_at", "participant_one_id", "last_message_at"),
        Index("ix_app_conversations_participant_two_last_message_at", "participant_two_id", "last_message_at"),
        Index("ix_app_conversations_trip_id", "trip_id", unique=True),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    conversation_type: Mapped[ConversationType] = mapped_column(
        SqlEnum(ConversationType, native_enum=False),
        default=ConversationType.direct,
        nullable=False,
    )
    participant_one_id: Mapped[int | None] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    participant_two_id: Mapped[int | None] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    participant_one: Mapped["User | None"] = relationship(foreign_keys=[participant_one_id])
    participant_two: Mapped["User | None"] = relationship(foreign_keys=[participant_two_id])
    trip: Mapped["Trip | None"] = relationship(back_populates="group_conversation")
    messages: Mapped[list["Message"]] = relationship(back_populates="conversation", cascade="all, delete-orphan")
    members: Mapped[list["ConversationMember"]] = relationship(back_populates="conversation", cascade="all, delete-orphan")

    @property
    def participants(self) -> list["User"]:
        if self.conversation_type == ConversationType.group:
            return [member.user for member in self.members if member.user is not None]
        return [participant for participant in (self.participant_one, self.participant_two) if participant is not None]


class ConversationMember(Base):
    __tablename__ = "app_conversation_members"
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id", name="uq_app_conversation_members_pair"),
        Index("ix_app_conversation_members_user_id", "user_id"),
    )

    conversation_id: Mapped[str] = mapped_column(ForeignKey("app_conversations.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), primary_key=True)

    conversation: Mapped["Conversation"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="conversation_memberships")


class Message(Base):
    __tablename__ = "app_messages"
    __table_args__ = (
        Index("ix_app_messages_conversation_created_at", "conversation_id", "created_at"),
        Index("ix_app_messages_conversation_status_created_at", "conversation_id", "message_status", "created_at"),
        Index("ix_app_messages_recipient_read_created_at", "recipient_id", "read_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("app_conversations.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    recipient_id: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=True, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_status: Mapped[MessageStatus] = mapped_column(
        SqlEnum(MessageStatus, native_enum=False),
        default=MessageStatus.sent,
        nullable=False,
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
    sender: Mapped["User"] = relationship(foreign_keys=[sender_id], back_populates="sent_messages")
    recipient: Mapped["User | None"] = relationship(foreign_keys=[recipient_id], back_populates="received_messages")
