"""add_missing_model_indexes

Revision ID: 20260508_000018
Revises: 20260508_000017
Create Date: 2026-05-08 00:00:00.000000

"""
from __future__ import annotations

from alembic import op


revision = "20260508_000018"
down_revision = "20260508_000017"
branch_labels = None
depends_on = None


INDEXES: tuple[tuple[str, str, list[str], bool], ...] = (
    ("ix_app_ai_jobs_user_id", "app_ai_jobs", ["user_id"], False),
    ("ix_app_auth_sessions_refresh_token_jti", "app_auth_sessions", ["refresh_token_jti"], False),
    ("ix_app_boost_purchases_transaction_id", "app_boost_purchases", ["transaction_id"], False),
    ("ix_app_boost_purchases_user_id", "app_boost_purchases", ["user_id"], False),
    ("ix_app_media_assets_user_id", "app_media_assets", ["user_id"], False),
    ("ix_app_mfa_challenges_user_id", "app_mfa_challenges", ["user_id"], False),
    ("ix_app_payments_booking_id", "app_payments", ["booking_id"], False),
    ("ix_app_reward_transactions_user_id", "app_reward_transactions", ["user_id"], False),
    ("ix_app_trip_itinerary_days_created_by_user_id", "app_trip_itinerary_days", ["created_by_user_id"], False),
    ("ix_app_trip_itinerary_days_trip_id", "app_trip_itinerary_days", ["trip_id"], False),
    ("ix_app_trip_places_created_by_user_id", "app_trip_places", ["created_by_user_id"], False),
    ("ix_app_trip_places_trip_id", "app_trip_places", ["trip_id"], False),
    ("ix_app_trip_polls_created_by_user_id", "app_trip_polls", ["created_by_user_id"], False),
    ("ix_app_trip_polls_trip_id", "app_trip_polls", ["trip_id"], False),
    ("ix_app_trip_votes_poll_id", "app_trip_votes", ["poll_id"], False),
    ("ix_app_trip_votes_user_id", "app_trip_votes", ["user_id"], False),
    ("ix_app_trips_lifecycle_status", "app_trips", ["lifecycle_status"], False),
    ("ix_app_trips_visibility", "app_trips", ["visibility"], False),
    ("ix_app_user_reward_balances_user_id", "app_user_reward_balances", ["user_id"], True),
    ("ix_app_verification_requests_reviewed_by", "app_verification_requests", ["reviewed_by"], False),
    ("ix_app_webhook_events_stripe_event_id", "app_webhook_events", ["stripe_event_id"], False),
)


def upgrade() -> None:
    for name, table_name, columns, unique in INDEXES:
        op.create_index(name, table_name, columns, unique=unique)


def downgrade() -> None:
    for name, table_name, _columns, _unique in reversed(INDEXES):
        op.drop_index(name, table_name=table_name)
