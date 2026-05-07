"""final_production_completion

Revision ID: 20260507_000016
Revises: 20260506_000015
Create Date: 2026-05-07 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260507_000016"
down_revision = "20260506_000015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
                RAISE EXCEPTION 'PostGIS extension is required before applying final production completion';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'app_profiles' AND column_name = 'location_geog'
            ) THEN
                RAISE EXCEPTION 'app_profiles.location_geog is missing';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'app_trips' AND column_name = 'location_geog'
            ) THEN
                RAISE EXCEPTION 'app_trips.location_geog is missing';
            END IF;
        END $$;
        """
    )

    op.add_column("app_users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_app_users_locked_until", "app_users", ["locked_until"], unique=False)

    op.add_column("app_payments", sa.Column("provider_payment_id", sa.String(length=255), nullable=True))
    op.add_column("app_payments", sa.Column("refund_provider_id", sa.String(length=255), nullable=True))
    op.add_column("app_payments", sa.Column("refunded_amount", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("app_payments", sa.Column("failure_reason", sa.String(length=255), nullable=True))
    op.add_column("app_payments", sa.Column("dispute_status", sa.String(length=64), nullable=True))
    op.add_column("app_payments", sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("app_payments", "refunded_amount", server_default=None)
    op.create_index("ix_app_payments_provider_payment_id", "app_payments", ["provider_payment_id"], unique=False)
    op.create_index("ix_app_payments_refund_provider_id", "app_payments", ["refund_provider_id"], unique=False)
    op.create_check_constraint(
        "ck_app_payments_refunded_amount_range",
        "app_payments",
        "refunded_amount >= 0 AND refunded_amount <= amount",
    )

    op.add_column("app_ai_jobs", sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("app_ai_jobs", sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"))
    op.add_column("app_ai_jobs", sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("app_ai_jobs", sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("app_ai_jobs", sa.Column("dead_lettered_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("app_ai_jobs", "attempts", server_default=None)
    op.alter_column("app_ai_jobs", "max_attempts", server_default=None)
    op.create_index("ix_app_ai_jobs_status_next_run_at", "app_ai_jobs", ["status", "next_run_at"], unique=False)
    op.create_index("ix_app_ai_jobs_locked_at", "app_ai_jobs", ["locked_at"], unique=False)

    op.add_column("app_client_analytics_events", sa.Column("schema_version", sa.String(length=16), nullable=False, server_default="1.0"))
    op.alter_column("app_client_analytics_events", "schema_version", server_default=None)
    op.create_index(
        "ix_app_client_analytics_events_schema_version",
        "app_client_analytics_events",
        ["schema_version"],
        unique=False,
    )

    op.add_column("app_analytics_events", sa.Column("event_id", sa.String(length=128), nullable=True))
    op.add_column("app_analytics_events", sa.Column("schema_version", sa.String(length=16), nullable=False, server_default="1.0"))
    op.execute("UPDATE app_analytics_events SET event_id = 'evt_' || id::text WHERE event_id IS NULL")
    op.alter_column("app_analytics_events", "event_id", nullable=False)
    op.alter_column("app_analytics_events", "schema_version", server_default=None)
    op.create_unique_constraint("uq_app_analytics_events_event_id", "app_analytics_events", ["event_id"])
    op.create_index("ix_app_analytics_events_event_id", "app_analytics_events", ["event_id"], unique=False)
    op.create_index("ix_app_analytics_events_schema_version", "app_analytics_events", ["schema_version"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_app_analytics_events_schema_version", table_name="app_analytics_events")
    op.drop_index("ix_app_analytics_events_event_id", table_name="app_analytics_events")
    op.drop_constraint("uq_app_analytics_events_event_id", "app_analytics_events", type_="unique")
    op.drop_column("app_analytics_events", "schema_version")
    op.drop_column("app_analytics_events", "event_id")

    op.drop_index("ix_app_client_analytics_events_schema_version", table_name="app_client_analytics_events")
    op.drop_column("app_client_analytics_events", "schema_version")

    op.drop_index("ix_app_ai_jobs_locked_at", table_name="app_ai_jobs")
    op.drop_index("ix_app_ai_jobs_status_next_run_at", table_name="app_ai_jobs")
    op.drop_column("app_ai_jobs", "dead_lettered_at")
    op.drop_column("app_ai_jobs", "locked_at")
    op.drop_column("app_ai_jobs", "next_run_at")
    op.drop_column("app_ai_jobs", "max_attempts")
    op.drop_column("app_ai_jobs", "attempts")

    op.drop_constraint("ck_app_payments_refunded_amount_range", "app_payments", type_="check")
    op.drop_index("ix_app_payments_refund_provider_id", table_name="app_payments")
    op.drop_index("ix_app_payments_provider_payment_id", table_name="app_payments")
    op.drop_column("app_payments", "refunded_at")
    op.drop_column("app_payments", "dispute_status")
    op.drop_column("app_payments", "failure_reason")
    op.drop_column("app_payments", "refunded_amount")
    op.drop_column("app_payments", "refund_provider_id")
    op.drop_column("app_payments", "provider_payment_id")

    op.drop_index("ix_app_users_locked_until", table_name="app_users")
    op.drop_column("app_users", "locked_until")
