from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class Profile(Base):
    __tablename__ = "app_profiles"
    __table_args__ = (
        CheckConstraint(
            "(budget_min IS NULL OR budget_max IS NULL) OR budget_min <= budget_max",
            name="ck_app_profiles_budget_range",
        ),
        CheckConstraint("(age IS NULL) OR age >= 18", name="ck_app_profiles_adult_age"),
        Index("ix_app_profiles_location", "location"),
        Index("ix_app_profiles_gender", "gender"),
        Index("ix_app_profiles_travel_style", "travel_style"),
    )

    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(32), nullable=True)
    travel_style: Mapped[str | None] = mapped_column(String(64), nullable=True)
    interests: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    budget_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    budget_max: Mapped[int | None] = mapped_column(Integer, nullable=True)

    user: Mapped["User"] = relationship(back_populates="profile")
