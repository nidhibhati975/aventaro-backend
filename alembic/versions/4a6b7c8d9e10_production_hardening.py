"""production_hardening

Revision ID: 4a6b7c8d9e10
Revises: 8270637b3e88
Create Date: 2026-04-03 09:15:00.000000

"""
from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "4a6b7c8d9e10"
down_revision = "8270637b3e88"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_app_profiles_location", "app_profiles", ["location"], unique=False)
    op.create_index("ix_app_profiles_gender", "app_profiles", ["gender"], unique=False)

    op.create_check_constraint("ck_app_matches_distinct_users", "app_matches", "sender_id <> receiver_id")
    op.create_index("ix_app_matches_sender_status", "app_matches", ["sender_id", "status"], unique=False)
    op.create_index("ix_app_matches_receiver_status", "app_matches", ["receiver_id", "status"], unique=False)

    op.create_check_constraint("ck_app_trips_positive_capacity", "app_trips", "capacity > 0")
    op.create_index("ix_app_trips_location_created_at", "app_trips", ["location", "created_at"], unique=False)
    op.create_index("ix_app_trip_members_trip_status", "app_trip_members", ["trip_id", "status"], unique=False)
    op.create_index("ix_app_trip_members_user_status", "app_trip_members", ["user_id", "status"], unique=False)

    op.create_check_constraint("ck_app_conversations_distinct_participants", "app_conversations", "participant_one_id <> participant_two_id")
    op.create_index(
        "ix_app_conversations_participant_one_last_message_at",
        "app_conversations",
        ["participant_one_id", "last_message_at"],
        unique=False,
    )
    op.create_index(
        "ix_app_conversations_participant_two_last_message_at",
        "app_conversations",
        ["participant_two_id", "last_message_at"],
        unique=False,
    )
    op.create_index("ix_app_messages_conversation_created_at", "app_messages", ["conversation_id", "created_at"], unique=False)

    op.create_index(
        "ix_app_notifications_user_read_created_at",
        "app_notifications",
        ["user_id", "is_read", "created_at"],
        unique=False,
    )

    op.create_unique_constraint("uq_app_payments_stripe_session_id", "app_payments", ["stripe_session_id"])
    op.create_check_constraint("ck_app_payments_non_negative_amount", "app_payments", "amount >= 0")
    op.create_index(
        "ix_app_payments_user_status_created_at",
        "app_payments",
        ["user_id", "status", "created_at"],
        unique=False,
    )

    op.create_unique_constraint(
        "uq_app_subscriptions_stripe_subscription_id",
        "app_subscriptions",
        ["stripe_subscription_id"],
    )
    op.create_index(
        "ix_app_subscriptions_user_status_created_at",
        "app_subscriptions",
        ["user_id", "status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_app_subscriptions_user_status_created_at", table_name="app_subscriptions")
    op.drop_constraint("uq_app_subscriptions_stripe_subscription_id", "app_subscriptions", type_="unique")

    op.drop_index("ix_app_payments_user_status_created_at", table_name="app_payments")
    op.drop_constraint("ck_app_payments_non_negative_amount", "app_payments", type_="check")
    op.drop_constraint("uq_app_payments_stripe_session_id", "app_payments", type_="unique")

    op.drop_index("ix_app_notifications_user_read_created_at", table_name="app_notifications")

    op.drop_index("ix_app_messages_conversation_created_at", table_name="app_messages")
    op.drop_index("ix_app_conversations_participant_two_last_message_at", table_name="app_conversations")
    op.drop_index("ix_app_conversations_participant_one_last_message_at", table_name="app_conversations")
    op.drop_constraint("ck_app_conversations_distinct_participants", "app_conversations", type_="check")

    op.drop_index("ix_app_trip_members_user_status", table_name="app_trip_members")
    op.drop_index("ix_app_trip_members_trip_status", table_name="app_trip_members")
    op.drop_index("ix_app_trips_location_created_at", table_name="app_trips")
    op.drop_constraint("ck_app_trips_positive_capacity", "app_trips", type_="check")

    op.drop_index("ix_app_matches_receiver_status", table_name="app_matches")
    op.drop_index("ix_app_matches_sender_status", table_name="app_matches")
    op.drop_constraint("ck_app_matches_distinct_users", "app_matches", type_="check")

    op.drop_index("ix_app_profiles_gender", table_name="app_profiles")
    op.drop_index("ix_app_profiles_location", table_name="app_profiles")
