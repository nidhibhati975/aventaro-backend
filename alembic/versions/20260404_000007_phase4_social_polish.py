"""phase4_social_polish

Revision ID: 20260404_000007
Revises: 20260404_000006
Create Date: 2026-04-04 18:40:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260404_000007"
down_revision = "20260404_000006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_post_watches", sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("app_post_watches", sa.Column("skipped", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column("app_post_watches", "completed", server_default=None)
    op.alter_column("app_post_watches", "skipped", server_default=None)
    op.create_index("ix_app_post_watches_post_completed", "app_post_watches", ["post_id", "completed"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_app_post_watches_post_completed", table_name="app_post_watches")
    op.drop_column("app_post_watches", "skipped")
    op.drop_column("app_post_watches", "completed")
