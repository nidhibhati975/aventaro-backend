"""trip_dates_visibility

Revision ID: 20260416_000012
Revises: 4a6b7c8d9e10
Create Date: 2026-04-16 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260416_000012"
down_revision = "20260404_000011"
branch_labels = None
depends_on = None


trip_visibility = sa.Enum("public", "private", name="tripvisibility", native_enum=False)
trip_status = sa.Enum("planned", "active", "completed", name="tripstatus", native_enum=False)


def upgrade() -> None:
    op.add_column("app_trips", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("app_trips", sa.Column("end_date", sa.Date(), nullable=True))
    op.add_column(
        "app_trips",
        sa.Column("visibility", trip_visibility, nullable=False, server_default="public"),
    )
    op.add_column(
        "app_trips",
        sa.Column("status", trip_status, nullable=False, server_default="planned"),
    )
    op.create_index("ix_app_trips_start_date", "app_trips", ["start_date"], unique=False)
    op.create_index("ix_app_trips_end_date", "app_trips", ["end_date"], unique=False)

    op.add_column("app_profiles", sa.Column("travel_start_date", sa.Date(), nullable=True))
    op.add_column("app_profiles", sa.Column("travel_end_date", sa.Date(), nullable=True))
    op.create_index("ix_app_profiles_travel_start_date", "app_profiles", ["travel_start_date"], unique=False)
    op.create_index("ix_app_profiles_travel_end_date", "app_profiles", ["travel_end_date"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_app_profiles_travel_end_date", table_name="app_profiles")
    op.drop_index("ix_app_profiles_travel_start_date", table_name="app_profiles")
    op.drop_column("app_profiles", "travel_end_date")
    op.drop_column("app_profiles", "travel_start_date")

    op.drop_index("ix_app_trips_end_date", table_name="app_trips")
    op.drop_index("ix_app_trips_start_date", table_name="app_trips")
    op.drop_column("app_trips", "status")
    op.drop_column("app_trips", "visibility")
    op.drop_column("app_trips", "end_date")
    op.drop_column("app_trips", "start_date")
