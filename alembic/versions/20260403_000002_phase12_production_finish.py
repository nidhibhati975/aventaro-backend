"""phase12_production_finish

Revision ID: 20260403_000002
Revises: 4a6b7c8d9e10
Create Date: 2026-04-03 23:55:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260403_000002"
down_revision = "4a6b7c8d9e10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_users", sa.Column("stripe_customer_id", sa.String(length=255), nullable=True))
    op.create_index("ix_app_users_created_at", "app_users", ["created_at"], unique=False)
    op.create_index("ix_app_users_stripe_customer_id", "app_users", ["stripe_customer_id"], unique=True)

    op.create_check_constraint(
        "ck_app_profiles_budget_range",
        "app_profiles",
        "(budget_min IS NULL OR budget_max IS NULL) OR budget_min <= budget_max",
    )
    op.create_check_constraint("ck_app_profiles_adult_age", "app_profiles", "(age IS NULL) OR age >= 18")

    op.create_index(
        "ux_app_matches_user_pair_canonical",
        "app_matches",
        [sa.text("LEAST(sender_id, receiver_id)"), sa.text("GREATEST(sender_id, receiver_id)")],
        unique=True,
    )

    op.create_check_constraint(
        "ck_app_trips_budget_range",
        "app_trips",
        "(budget_min IS NULL OR budget_max IS NULL) OR budget_min <= budget_max",
    )

    op.add_column("app_payments", sa.Column("stripe_customer_id", sa.String(length=255), nullable=True))
    op.add_column("app_payments", sa.Column("stripe_price_id", sa.String(length=255), nullable=True))
    op.add_column("app_payments", sa.Column("checkout_url", sa.String(length=2048), nullable=True))
    op.add_column("app_payments", sa.Column("checkout_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_app_payments_stripe_customer_id", "app_payments", ["stripe_customer_id"], unique=False)
    op.create_index("ix_app_payments_stripe_price_id", "app_payments", ["stripe_price_id"], unique=False)
    op.create_index(
        "ix_app_payments_user_price_status",
        "app_payments",
        ["user_id", "stripe_price_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_app_payments_user_price_status", table_name="app_payments")
    op.drop_index("ix_app_payments_stripe_price_id", table_name="app_payments")
    op.drop_index("ix_app_payments_stripe_customer_id", table_name="app_payments")
    op.drop_column("app_payments", "checkout_expires_at")
    op.drop_column("app_payments", "checkout_url")
    op.drop_column("app_payments", "stripe_price_id")
    op.drop_column("app_payments", "stripe_customer_id")

    op.drop_constraint("ck_app_trips_budget_range", "app_trips", type_="check")

    op.drop_index("ux_app_matches_user_pair_canonical", table_name="app_matches")

    op.drop_constraint("ck_app_profiles_adult_age", "app_profiles", type_="check")
    op.drop_constraint("ck_app_profiles_budget_range", "app_profiles", type_="check")

    op.drop_index("ix_app_users_stripe_customer_id", table_name="app_users")
    op.drop_index("ix_app_users_created_at", table_name="app_users")
    op.drop_column("app_users", "stripe_customer_id")
