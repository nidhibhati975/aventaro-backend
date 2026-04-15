"""phase6_hardening

Revision ID: 20260404_000011
Revises: 20260404_000010
Create Date: 2026-04-04 23:55:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260404_000011"
down_revision = "20260404_000010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_webhook_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("stripe_event_id", sa.String(length=255), nullable=False),
        sa.Column("event_type", sa.String(length=255), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("processed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("stripe_event_id", name="uq_app_webhook_events_stripe_event_id"),
    )
    op.alter_column("app_webhook_events", "processed", server_default=None)
    op.create_index("ix_app_webhook_events_event_type", "app_webhook_events", ["event_type"], unique=False)
    op.create_index(
        "ix_app_webhook_events_type_processed_created_at",
        "app_webhook_events",
        ["event_type", "processed", "created_at"],
        unique=False,
    )

    op.add_column("app_boosts", sa.Column("last_activated_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE app_boosts SET last_activated_at = created_at WHERE last_activated_at IS NULL")
    op.execute(
        """
        DELETE FROM app_boosts
        WHERE id IN (
            SELECT id
            FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY user_id, boost_type
                        ORDER BY last_activated_at DESC, expires_at DESC, id DESC
                    ) AS row_number
                FROM app_boosts
            ) AS ranked
            WHERE ranked.row_number > 1
        )
        """
    )
    op.alter_column("app_boosts", "last_activated_at", nullable=False)
    op.create_index(
        "ix_app_boosts_user_type_last_activated_at",
        "app_boosts",
        ["user_id", "boost_type", "last_activated_at"],
        unique=False,
    )
    op.create_unique_constraint("uq_app_boosts_user_boost_type", "app_boosts", ["user_id", "boost_type"])

    op.add_column("app_referrals", sa.Column("referral_ip", sa.String(length=64), nullable=True))
    op.add_column("app_referrals", sa.Column("suspicious", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column("app_referrals", "suspicious", server_default=None)
    op.create_index(
        "ix_app_referrals_referral_ip_created_at",
        "app_referrals",
        ["referral_ip", "created_at"],
        unique=False,
    )
    op.create_unique_constraint(
        "uq_app_referrals_referrer_referral_ip",
        "app_referrals",
        ["referrer_id", "referral_ip"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_app_referrals_referrer_referral_ip", "app_referrals", type_="unique")
    op.drop_index("ix_app_referrals_referral_ip_created_at", table_name="app_referrals")
    op.drop_column("app_referrals", "suspicious")
    op.drop_column("app_referrals", "referral_ip")

    op.drop_constraint("uq_app_boosts_user_boost_type", "app_boosts", type_="unique")
    op.drop_index("ix_app_boosts_user_type_last_activated_at", table_name="app_boosts")
    op.drop_column("app_boosts", "last_activated_at")

    op.drop_index("ix_app_webhook_events_type_processed_created_at", table_name="app_webhook_events")
    op.drop_index("ix_app_webhook_events_event_type", table_name="app_webhook_events")
    op.drop_table("app_webhook_events")
