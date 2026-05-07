"""trip_lifecycle_status_and_datetime_dates

Revision ID: 20260416_000013
Revises: 20260416_000012
Create Date: 2026-04-16 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260416_000013"
down_revision = "20260416_000012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Change start_date and end_date from Date to DateTime(timezone=True)
    op.alter_column("app_trips", "start_date", type_=sa.DateTime(timezone=True), existing_nullable=True)
    op.alter_column("app_trips", "end_date", type_=sa.DateTime(timezone=True), existing_nullable=True)

    # Add lifecycle_status column with default 'draft'
    op.add_column(
        "app_trips",
        sa.Column(
            "lifecycle_status",
            sa.Enum("draft", "planned", "active", "completed", "cancelled", native_enum=False),
            nullable=False,
            server_default="draft",
        ),
    )
    op.alter_column("app_trips", "lifecycle_status", server_default=None)


def downgrade() -> None:
    op.drop_column("app_trips", "lifecycle_status")

    # Change back to Date (note: this may lose time information)
    op.alter_column("app_trips", "start_date", type_=sa.Date(), existing_nullable=True)
    op.alter_column("app_trips", "end_date", type_=sa.Date(), existing_nullable=True)
