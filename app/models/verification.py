from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum as SqlEnum, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class VerificationType(str, Enum):
    id = "id"
    selfie = "selfie"
    social = "social"


class VerificationStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class VerificationLevel(str, Enum):
    none = "none"
    basic = "basic"
    full = "full"


class VerificationRequest(Base):
    __tablename__ = "app_verification_requests"
    __table_args__ = (
        Index("ix_app_verification_requests_user_id", "user_id"),
        Index("ix_app_verification_requests_type", "type"),
        Index("ix_app_verification_requests_status", "status"),
        Index("ix_app_verification_requests_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[VerificationType] = mapped_column(
        SqlEnum(VerificationType, native_enum=False),
        nullable=False,
    )
    status: Mapped[VerificationStatus] = mapped_column(
        SqlEnum(VerificationStatus, native_enum=False),
        default=VerificationStatus.pending,
        nullable=False,
    )
    document_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="verification_requests", foreign_keys=[user_id])
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by])
