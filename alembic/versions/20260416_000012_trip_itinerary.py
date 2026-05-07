"""trip_and_platform_completion

Revision ID: 20260416_000014
Revises: 20260416_000013
Create Date: 2026-04-16 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260416_000014"
down_revision = "20260416_000013"
branch_labels = None
depends_on = None


booking_status = sa.Enum(
    "pending",
    "payment_initiated",
    "confirmed",
    "completed",
    "cancelled",
    "refunded",
    "failed",
    name="bookingstatus",
    native_enum=False,
)
booking_item_type = sa.Enum("hotel", "flight", "activity", name="bookingitemtype", native_enum=False)
reservation_status = sa.Enum(
    "pending",
    "confirmed",
    "failed",
    "cancelled",
    "refunded",
    name="reservationstatus",
    native_enum=False,
)
order_action = sa.Enum(
    "created",
    "payment_initiated",
    "paid",
    "payment_failed",
    "reservation_created",
    "reservation_failed",
    "cancelled",
    "refunded",
    name="orderaction",
    native_enum=False,
)
verification_type = sa.Enum("id", "selfie", "social", name="verificationtype", native_enum=False)
verification_status = sa.Enum("pending", "approved", "rejected", name="verificationstatus", native_enum=False)
moderation_case_status = sa.Enum("open", "reviewing", "resolved", name="moderationcasestatus", native_enum=False)


def upgrade() -> None:
    op.add_column("app_users", sa.Column("role", sa.String(length=20), nullable=False, server_default="user"))
    op.add_column("app_users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("app_users", sa.Column("last_login", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_app_users_is_active", "app_users", ["is_active"], unique=False)
    op.alter_column("app_users", "role", server_default=None)
    op.alter_column("app_users", "is_active", server_default=None)

    op.add_column("app_profiles", sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("app_profiles", sa.Column("verification_level", sa.String(length=32), nullable=False, server_default="none"))
    op.alter_column("app_profiles", "is_verified", server_default=None)
    op.alter_column("app_profiles", "verification_level", server_default=None)

    op.add_column("app_notifications", sa.Column("entity_id", sa.Integer(), nullable=True))
    op.add_column("app_notifications", sa.Column("entity_type", sa.String(length=50), nullable=True))
    op.add_column("app_notifications", sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"))
    op.add_column("app_notifications", sa.Column("priority", sa.String(length=20), nullable=False, server_default="normal"))
    op.add_column("app_notifications", sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("app_notifications", sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("app_notifications", sa.Column("deep_link", sa.String(length=512), nullable=True))
    op.create_index("ix_app_notifications_status_priority", "app_notifications", ["status", "priority"], unique=False)
    op.alter_column("app_notifications", "status", server_default=None)
    op.alter_column("app_notifications", "priority", server_default=None)
    op.alter_column("app_notifications", "retry_count", server_default=None)

    op.create_table(
        "app_trip_itinerary_days",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("trip_id", sa.Integer(), sa.ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=150), nullable=True),
        sa.Column("day_date", sa.Date(), nullable=False),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("trip_id", "day_date", name="uq_app_trip_itinerary_days_trip_day"),
    )
    op.create_index("ix_app_trip_itinerary_days_trip_date", "app_trip_itinerary_days", ["trip_id", "day_date"], unique=False)
    op.create_index("ix_app_trip_itinerary_days_created_by", "app_trip_itinerary_days", ["created_by_user_id"], unique=False)

    op.create_table(
        "app_trip_places",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("trip_id", sa.Integer(), sa.ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_id", sa.Integer(), sa.ForeignKey("app_trip_itinerary_days.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column("external_place_id", sa.String(length=255), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.alter_column("app_trip_places", "order_index", server_default=None)
    op.create_index("ix_app_trip_places_trip_order", "app_trip_places", ["trip_id", "order_index"], unique=False)
    op.create_index("ix_app_trip_places_trip_day", "app_trip_places", ["trip_id", "day_id"], unique=False)
    op.create_index("ix_app_trip_places_created_by", "app_trip_places", ["created_by_user_id"], unique=False)

    op.create_table(
        "app_trip_polls",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("trip_id", sa.Integer(), sa.ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_id", sa.Integer(), sa.ForeignKey("app_trip_itinerary_days.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question", sa.String(length=255), nullable=False),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("closes_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_trip_polls_trip_created_at", "app_trip_polls", ["trip_id", "created_at"], unique=False)
    op.create_index("ix_app_trip_polls_day_id", "app_trip_polls", ["day_id"], unique=False)
    op.create_index("ix_app_trip_polls_created_by", "app_trip_polls", ["created_by_user_id"], unique=False)

    op.create_table(
        "app_trip_votes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("trip_id", sa.Integer(), sa.ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("poll_id", sa.Integer(), sa.ForeignKey("app_trip_polls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("option_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("poll_id", "user_id", name="uq_app_trip_votes_poll_user"),
    )
    op.create_index("ix_app_trip_votes_trip_id", "app_trip_votes", ["trip_id"], unique=False)
    op.create_index("ix_app_trip_votes_poll_option", "app_trip_votes", ["poll_id", "option_index"], unique=False)

    op.create_table(
        "app_bookings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("trip_id", sa.Integer(), sa.ForeignKey("app_trips.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", booking_status, nullable=False, server_default="pending"),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="USD"),
        sa.Column("last_event_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("total_amount > 0", name="ck_app_bookings_positive_amount"),
    )
    op.alter_column("app_bookings", "status", server_default=None)
    op.alter_column("app_bookings", "currency", server_default=None)
    op.create_index("ix_app_bookings_user_id", "app_bookings", ["user_id"], unique=False)
    op.create_index("ix_app_bookings_trip_id", "app_bookings", ["trip_id"], unique=False)
    op.create_index("ix_app_bookings_status", "app_bookings", ["status"], unique=False)
    op.create_index("ix_app_bookings_last_event_id", "app_bookings", ["last_event_id"], unique=False)
    op.create_index("ix_app_bookings_created_at", "app_bookings", ["created_at"], unique=False)

    op.add_column("app_payments", sa.Column("booking_id", sa.Integer(), nullable=True))
    op.add_column("app_payments", sa.Column("payment_type", sa.String(length=32), nullable=False, server_default="subscription"))
    op.create_foreign_key(
        "fk_app_payments_booking_id_app_bookings",
        "app_payments",
        "app_bookings",
        ["booking_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_app_payments_booking_status", "app_payments", ["booking_id", "status"], unique=False)
    op.alter_column("app_payments", "payment_type", server_default=None)

    op.create_table(
        "app_booking_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("booking_id", sa.Integer(), sa.ForeignKey("app_bookings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_type", booking_item_type, nullable=False),
        sa.Column("provider_name", sa.String(length=100), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
    )
    op.alter_column("app_booking_items", "quantity", server_default=None)
    op.create_index("ix_app_booking_items_booking_id", "app_booking_items", ["booking_id"], unique=False)
    op.create_index("ix_app_booking_items_item_type", "app_booking_items", ["item_type"], unique=False)

    op.create_table(
        "app_provider_reservations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("booking_item_id", sa.Integer(), sa.ForeignKey("app_booking_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider_name", sa.String(length=100), nullable=False),
        sa.Column("provider_reference", sa.String(length=255), nullable=True),
        sa.Column("confirmation_number", sa.String(length=255), nullable=True),
        sa.Column("provider_response", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("reservation_status", reservation_status, nullable=False, server_default="pending"),
        sa.UniqueConstraint("provider_name", "provider_reference", name="uq_app_provider_reservations_provider_ref"),
    )
    op.alter_column("app_provider_reservations", "reservation_status", server_default=None)
    op.create_index("ix_app_provider_reservations_booking_item_id", "app_provider_reservations", ["booking_item_id"], unique=False)
    op.create_index("ix_app_provider_reservations_status", "app_provider_reservations", ["reservation_status"], unique=False)

    op.create_table(
        "app_order_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("booking_id", sa.Integer(), sa.ForeignKey("app_bookings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", order_action, nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_order_history_user_id", "app_order_history", ["user_id"], unique=False)
    op.create_index("ix_app_order_history_booking_id", "app_order_history", ["booking_id"], unique=False)
    op.create_index("ix_app_order_history_action_timestamp", "app_order_history", ["action", "timestamp"], unique=False)
    op.create_index("ix_app_order_history_timestamp", "app_order_history", ["timestamp"], unique=False)

    op.create_table(
        "app_verification_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", verification_type, nullable=False),
        sa.Column("status", verification_status, nullable=False, server_default="pending"),
        sa.Column("document_url", sa.String(length=512), nullable=True),
        sa.Column("rejection_reason", sa.String(length=255), nullable=True),
        sa.Column("reviewed_by", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.alter_column("app_verification_requests", "status", server_default=None)
    op.create_index("ix_app_verification_requests_user_id", "app_verification_requests", ["user_id"], unique=False)
    op.create_index("ix_app_verification_requests_type", "app_verification_requests", ["type"], unique=False)
    op.create_index("ix_app_verification_requests_status", "app_verification_requests", ["status"], unique=False)
    op.create_index("ix_app_verification_requests_created_at", "app_verification_requests", ["created_at"], unique=False)

    op.create_table(
        "app_moderation_cases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_id", sa.Integer(), sa.ForeignKey("app_reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", moderation_case_status, nullable=False, server_default="open"),
        sa.Column("admin_action", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.alter_column("app_moderation_cases", "status", server_default=None)
    op.create_index("ix_app_moderation_cases_report_id", "app_moderation_cases", ["report_id"], unique=False)
    op.create_index("ix_app_moderation_cases_status", "app_moderation_cases", ["status"], unique=False)
    op.create_index("ix_app_moderation_cases_created_at", "app_moderation_cases", ["created_at"], unique=False)

    op.create_table(
        "app_reward_transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("transaction_type", sa.String(length=20), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("balance_after", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("reference_type", sa.String(length=50), nullable=True),
        sa.Column("reference_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_reward_transactions_user_type_created_at", "app_reward_transactions", ["user_id", "transaction_type", "created_at"], unique=False)
    op.create_index("ix_app_reward_transactions_user_balance", "app_reward_transactions", ["user_id", "balance_after"], unique=False)

    op.create_table(
        "app_user_reward_balances",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("coins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lifetime_coins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.alter_column("app_user_reward_balances", "coins", server_default=None)
    op.alter_column("app_user_reward_balances", "lifetime_coins", server_default=None)

    op.create_table(
        "app_reward_actions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("action_type", sa.String(length=50), nullable=False, unique=True),
        sa.Column("coins", sa.Integer(), nullable=False),
        sa.Column("max_per_day", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.UniqueConstraint("action_type", name="uq_app_reward_actions_action_type"),
    )
    op.alter_column("app_reward_actions", "is_active", server_default=None)

    op.create_table(
        "app_boost_purchases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("boost_type", sa.String(length=20), nullable=False),
        sa.Column("amount_paid", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="INR"),
        sa.Column("payment_method", sa.String(length=20), nullable=False),
        sa.Column("transaction_id", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.alter_column("app_boost_purchases", "currency", server_default=None)
    op.alter_column("app_boost_purchases", "status", server_default=None)
    op.create_index("ix_app_boost_purchases_user_type_created_at", "app_boost_purchases", ["user_id", "boost_type", "created_at"], unique=False)
    op.create_index("ix_app_boost_purchases_status", "app_boost_purchases", ["status"], unique=False)

    op.create_table(
        "app_commission_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("booking_id", sa.Integer(), sa.ForeignKey("app_bookings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("commission_rate", sa.Numeric(5, 2), nullable=False),
        sa.Column("commission_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("service_fee", sa.Numeric(12, 2), nullable=False),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.alter_column("app_commission_records", "status", server_default=None)
    op.create_index("ix_app_commission_records_booking_id", "app_commission_records", ["booking_id"], unique=False)
    op.create_index("ix_app_commission_records_user_id", "app_commission_records", ["user_id"], unique=False)
    op.create_index("ix_app_commission_records_created_at", "app_commission_records", ["created_at"], unique=False)

    op.create_table(
        "app_revenue_metrics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("subscription_revenue", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("boost_revenue", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("commission_revenue", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_revenue", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("new_subscriptions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cancelled_subscriptions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_active_subscribers", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.alter_column("app_revenue_metrics", "subscription_revenue", server_default=None)
    op.alter_column("app_revenue_metrics", "boost_revenue", server_default=None)
    op.alter_column("app_revenue_metrics", "commission_revenue", server_default=None)
    op.alter_column("app_revenue_metrics", "total_revenue", server_default=None)
    op.alter_column("app_revenue_metrics", "new_subscriptions", server_default=None)
    op.alter_column("app_revenue_metrics", "cancelled_subscriptions", server_default=None)
    op.alter_column("app_revenue_metrics", "total_active_subscribers", server_default=None)
    op.create_index("ix_app_revenue_metrics_date", "app_revenue_metrics", ["date"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_app_revenue_metrics_date", table_name="app_revenue_metrics")
    op.drop_table("app_revenue_metrics")

    op.drop_index("ix_app_commission_records_created_at", table_name="app_commission_records")
    op.drop_index("ix_app_commission_records_user_id", table_name="app_commission_records")
    op.drop_index("ix_app_commission_records_booking_id", table_name="app_commission_records")
    op.drop_table("app_commission_records")

    op.drop_index("ix_app_boost_purchases_status", table_name="app_boost_purchases")
    op.drop_index("ix_app_boost_purchases_user_type_created_at", table_name="app_boost_purchases")
    op.drop_table("app_boost_purchases")

    op.drop_table("app_reward_actions")
    op.drop_table("app_user_reward_balances")

    op.drop_index("ix_app_reward_transactions_user_balance", table_name="app_reward_transactions")
    op.drop_index("ix_app_reward_transactions_user_type_created_at", table_name="app_reward_transactions")
    op.drop_table("app_reward_transactions")

    op.drop_index("ix_app_moderation_cases_created_at", table_name="app_moderation_cases")
    op.drop_index("ix_app_moderation_cases_status", table_name="app_moderation_cases")
    op.drop_index("ix_app_moderation_cases_report_id", table_name="app_moderation_cases")
    op.drop_table("app_moderation_cases")

    op.drop_index("ix_app_verification_requests_created_at", table_name="app_verification_requests")
    op.drop_index("ix_app_verification_requests_status", table_name="app_verification_requests")
    op.drop_index("ix_app_verification_requests_type", table_name="app_verification_requests")
    op.drop_index("ix_app_verification_requests_user_id", table_name="app_verification_requests")
    op.drop_table("app_verification_requests")

    op.drop_index("ix_app_order_history_timestamp", table_name="app_order_history")
    op.drop_index("ix_app_order_history_action_timestamp", table_name="app_order_history")
    op.drop_index("ix_app_order_history_booking_id", table_name="app_order_history")
    op.drop_index("ix_app_order_history_user_id", table_name="app_order_history")
    op.drop_table("app_order_history")

    op.drop_index("ix_app_provider_reservations_status", table_name="app_provider_reservations")
    op.drop_index("ix_app_provider_reservations_booking_item_id", table_name="app_provider_reservations")
    op.drop_table("app_provider_reservations")

    op.drop_index("ix_app_booking_items_item_type", table_name="app_booking_items")
    op.drop_index("ix_app_booking_items_booking_id", table_name="app_booking_items")
    op.drop_table("app_booking_items")

    op.drop_index("ix_app_bookings_created_at", table_name="app_bookings")
    op.drop_index("ix_app_bookings_last_event_id", table_name="app_bookings")
    op.drop_index("ix_app_bookings_status", table_name="app_bookings")
    op.drop_index("ix_app_bookings_trip_id", table_name="app_bookings")
    op.drop_index("ix_app_bookings_user_id", table_name="app_bookings")
    op.drop_table("app_bookings")

    op.drop_index("ix_app_trip_votes_poll_option", table_name="app_trip_votes")
    op.drop_index("ix_app_trip_votes_trip_id", table_name="app_trip_votes")
    op.drop_table("app_trip_votes")

    op.drop_index("ix_app_trip_polls_created_by", table_name="app_trip_polls")
    op.drop_index("ix_app_trip_polls_day_id", table_name="app_trip_polls")
    op.drop_index("ix_app_trip_polls_trip_created_at", table_name="app_trip_polls")
    op.drop_table("app_trip_polls")

    op.drop_index("ix_app_trip_places_created_by", table_name="app_trip_places")
    op.drop_index("ix_app_trip_places_trip_day", table_name="app_trip_places")
    op.drop_index("ix_app_trip_places_trip_order", table_name="app_trip_places")
    op.drop_table("app_trip_places")

    op.drop_index("ix_app_trip_itinerary_days_created_by", table_name="app_trip_itinerary_days")
    op.drop_index("ix_app_trip_itinerary_days_trip_date", table_name="app_trip_itinerary_days")
    op.drop_table("app_trip_itinerary_days")

    op.drop_index("ix_app_payments_booking_status", table_name="app_payments")
    op.drop_constraint("fk_app_payments_booking_id_app_bookings", "app_payments", type_="foreignkey")
    op.drop_column("app_payments", "payment_type")
    op.drop_column("app_payments", "booking_id")

    op.drop_index("ix_app_notifications_status_priority", table_name="app_notifications")
    op.drop_column("app_notifications", "deep_link")
    op.drop_column("app_notifications", "sent_at")
    op.drop_column("app_notifications", "retry_count")
    op.drop_column("app_notifications", "priority")
    op.drop_column("app_notifications", "status")
    op.drop_column("app_notifications", "entity_type")
    op.drop_column("app_notifications", "entity_id")

    op.drop_column("app_profiles", "verification_level")
    op.drop_column("app_profiles", "is_verified")

    op.drop_index("ix_app_users_is_active", table_name="app_users")
    op.drop_column("app_users", "last_login")
    op.drop_column("app_users", "is_active")
    op.drop_column("app_users", "role")
