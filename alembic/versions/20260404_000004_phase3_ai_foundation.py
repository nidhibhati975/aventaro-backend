"""phase3_ai_foundation

Revision ID: 20260404_000004
Revises: 20260404_000003
Create Date: 2026-04-04 12:15:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260404_000004"
down_revision = "20260404_000003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_profiles", sa.Column("travel_style", sa.String(length=64), nullable=True))
    op.create_index("ix_app_profiles_travel_style", "app_profiles", ["travel_style"], unique=False)

    op.add_column("app_matches", sa.Column("compatibility_score", sa.Integer(), nullable=True))
    op.add_column("app_matches", sa.Column("compatibility_reason", sa.String(length=255), nullable=True))
    op.create_index("ix_app_matches_compatibility_score", "app_matches", ["compatibility_score"], unique=False)
    op.create_check_constraint(
        "ck_app_matches_compatibility_score_range",
        "app_matches",
        "(compatibility_score IS NULL) OR (compatibility_score >= 0 AND compatibility_score <= 100)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_app_matches_compatibility_score_range", "app_matches", type_="check")
    op.drop_index("ix_app_matches_compatibility_score", table_name="app_matches")
    op.drop_column("app_matches", "compatibility_reason")
    op.drop_column("app_matches", "compatibility_score")

    op.drop_index("ix_app_profiles_travel_style", table_name="app_profiles")
    op.drop_column("app_profiles", "travel_style")
