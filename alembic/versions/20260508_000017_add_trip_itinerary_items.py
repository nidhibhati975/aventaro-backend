"""add_trip_itinerary_items

Revision ID: 20260508_000017
Revises: 20260507_000016
Create Date: 2026-05-08 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260508_000017"
down_revision = "20260507_000016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_trip_itinerary_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("trip_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=150), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("item_date", sa.Date(), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["app_trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_app_trip_itinerary_items_trip_id", "app_trip_itinerary_items", ["trip_id"], unique=False)
    op.create_index("ix_app_trip_itinerary_trip_order", "app_trip_itinerary_items", ["trip_id", "order_index"], unique=False)
    op.create_index(
        "ix_app_trip_itinerary_trip_created_at",
        "app_trip_itinerary_items",
        ["trip_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_app_trip_itinerary_trip_created_at", table_name="app_trip_itinerary_items")
    op.drop_index("ix_app_trip_itinerary_trip_order", table_name="app_trip_itinerary_items")
    op.drop_index("ix_app_trip_itinerary_items_trip_id", table_name="app_trip_itinerary_items")
    op.drop_table("app_trip_itinerary_items")
