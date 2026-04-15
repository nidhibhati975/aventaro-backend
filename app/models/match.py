from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, Enum as SqlEnum, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class MatchStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"


class Match(Base):
    __tablename__ = "app_matches"
    __table_args__ = (
        UniqueConstraint("sender_id", "receiver_id", name="uq_match_sender_receiver"),
        Index(
            "ux_app_matches_user_pair_canonical",
            text("LEAST(sender_id, receiver_id)"),
            text("GREATEST(sender_id, receiver_id)"),
            unique=True,
        ),
        CheckConstraint("sender_id <> receiver_id", name="ck_app_matches_distinct_users"),
        CheckConstraint(
            "(compatibility_score IS NULL) OR (compatibility_score >= 0 AND compatibility_score <= 100)",
            name="ck_app_matches_compatibility_score_range",
        ),
        Index("ix_app_matches_sender_status", "sender_id", "status"),
        Index("ix_app_matches_receiver_status", "receiver_id", "status"),
        Index("ix_app_matches_compatibility_score", "compatibility_score"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    receiver_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[MatchStatus] = mapped_column(
        SqlEnum(MatchStatus, native_enum=False),
        default=MatchStatus.pending,
        nullable=False,
    )
    compatibility_score: Mapped[int | None] = mapped_column(nullable=True)
    compatibility_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    sender: Mapped["User"] = relationship(back_populates="sent_matches", foreign_keys=[sender_id])
    receiver: Mapped["User"] = relationship(back_populates="received_matches", foreign_keys=[receiver_id])
