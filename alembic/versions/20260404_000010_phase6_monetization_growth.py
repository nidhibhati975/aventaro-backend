"""phase6_monetization_growth

Revision ID: 20260404_000010
Revises: 20260404_000009
Create Date: 2026-04-04 23:30:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260404_000010"
down_revision = "20260404_000009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_users", sa.Column("referral_code", sa.String(length=32), nullable=True))
    op.execute("UPDATE app_users SET referral_code = 'AV' || LPAD(id::text, 6, '0') WHERE referral_code IS NULL")
    op.create_index("ix_app_users_referral_code", "app_users", ["referral_code"], unique=True)

    op.add_column("app_subscriptions", sa.Column("plan_type", sa.String(length=20), nullable=False, server_default="free"))
    op.add_column("app_subscriptions", sa.Column("stripe_customer_id", sa.String(length=255), nullable=True))
    op.alter_column("app_subscriptions", "stripe_subscription_id", existing_type=sa.String(length=255), nullable=True)
    op.execute(
        """
        UPDATE app_subscriptions AS s
        SET plan_type = CASE WHEN s.stripe_subscription_id IS NOT NULL THEN 'premium' ELSE 'free' END,
            stripe_customer_id = u.stripe_customer_id
        FROM app_users AS u
        WHERE u.id = s.user_id
        """
    )
    op.alter_column("app_subscriptions", "plan_type", server_default=None)
    op.create_index("ix_app_subscriptions_stripe_customer_id", "app_subscriptions", ["stripe_customer_id"], unique=False)
    op.create_index("ix_app_subscriptions_user_plan_status", "app_subscriptions", ["user_id", "plan_type", "status"], unique=False)

    op.create_table(
        "app_boosts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("boost_type", sa.String(length=20), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_boosts_user_id", "app_boosts", ["user_id"], unique=False)
    op.create_index("ix_app_boosts_user_type_expires_at", "app_boosts", ["user_id", "boost_type", "expires_at"], unique=False)
    op.create_index("ix_app_boosts_type_expires_at", "app_boosts", ["boost_type", "expires_at"], unique=False)

    op.create_table(
        "app_referrals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("referrer_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("referred_user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reward_given", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("referred_user_id", name="uq_app_referrals_referred_user_id"),
    )
    op.alter_column("app_referrals", "reward_given", server_default=None)
    op.create_index("ix_app_referrals_referrer_id", "app_referrals", ["referrer_id"], unique=False)
    op.create_index("ix_app_referrals_referred_user_id", "app_referrals", ["referred_user_id"], unique=False)
    op.create_index("ix_app_referrals_referrer_reward", "app_referrals", ["referrer_id", "reward_given"], unique=False)

    op.create_table(
        "app_analytics_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_analytics_events_user_id", "app_analytics_events", ["user_id"], unique=False)
    op.create_index("ix_app_analytics_events_user_type_created_at", "app_analytics_events", ["user_id", "event_type", "created_at"], unique=False)
    op.create_index("ix_app_analytics_events_type_created_at", "app_analytics_events", ["event_type", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_app_analytics_events_type_created_at", table_name="app_analytics_events")
    op.drop_index("ix_app_analytics_events_user_type_created_at", table_name="app_analytics_events")
    op.drop_index("ix_app_analytics_events_user_id", table_name="app_analytics_events")
    op.drop_table("app_analytics_events")

    op.drop_index("ix_app_referrals_referrer_reward", table_name="app_referrals")
    op.drop_index("ix_app_referrals_referred_user_id", table_name="app_referrals")
    op.drop_index("ix_app_referrals_referrer_id", table_name="app_referrals")
    op.drop_table("app_referrals")

    op.drop_index("ix_app_boosts_type_expires_at", table_name="app_boosts")
    op.drop_index("ix_app_boosts_user_type_expires_at", table_name="app_boosts")
    op.drop_index("ix_app_boosts_user_id", table_name="app_boosts")
    op.drop_table("app_boosts")

    op.drop_index("ix_app_subscriptions_user_plan_status", table_name="app_subscriptions")
    op.drop_index("ix_app_subscriptions_stripe_customer_id", table_name="app_subscriptions")
    op.alter_column("app_subscriptions", "stripe_subscription_id", existing_type=sa.String(length=255), nullable=False)
    op.drop_column("app_subscriptions", "stripe_customer_id")
    op.drop_column("app_subscriptions", "plan_type")

    op.drop_index("ix_app_users_referral_code", table_name="app_users")
    op.drop_column("app_users", "referral_code")
