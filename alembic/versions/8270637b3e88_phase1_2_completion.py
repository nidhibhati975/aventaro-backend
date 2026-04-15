"""phase1_2_completion

Revision ID: 8270637b3e88
Revises: 20260403_000001
Create Date: 2026-04-03 07:40:06.780283

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "8270637b3e88"
down_revision = "20260403_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_matches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sender_id", sa.Integer(), nullable=False),
        sa.Column("receiver_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.Enum("pending", "accepted", "rejected", name="matchstatus", native_enum=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["sender_id"], ["app_users.id"], name=op.f("fk_app_matches_sender_id_app_users"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["receiver_id"], ["app_users.id"], name=op.f("fk_app_matches_receiver_id_app_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_app_matches")),
        sa.UniqueConstraint("sender_id", "receiver_id", name="uq_match_sender_receiver"),
    )
    op.create_index(op.f("ix_app_matches_sender_id"), "app_matches", ["sender_id"], unique=False)
    op.create_index(op.f("ix_app_matches_receiver_id"), "app_matches", ["receiver_id"], unique=False)

    op.create_table(
        "app_conversations",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("conversation_type", sa.Enum("direct", "group", name="conversationtype", native_enum=False), nullable=False),
        sa.Column("participant_one_id", sa.Integer(), nullable=False),
        sa.Column("participant_two_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["participant_one_id"], ["app_users.id"], name=op.f("fk_app_conversations_participant_one_id_app_users"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["participant_two_id"], ["app_users.id"], name=op.f("fk_app_conversations_participant_two_id_app_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_app_conversations")),
        sa.UniqueConstraint("participant_one_id", "participant_two_id", name="uq_direct_conversation_pair"),
    )
    op.create_index(op.f("ix_app_conversations_participant_one_id"), "app_conversations", ["participant_one_id"], unique=False)
    op.create_index(op.f("ix_app_conversations_participant_two_id"), "app_conversations", ["participant_two_id"], unique=False)

    op.create_table(
        "app_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.String(length=128), nullable=False),
        sa.Column("sender_id", sa.Integer(), nullable=False),
        sa.Column("recipient_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["app_conversations.id"], name=op.f("fk_app_messages_conversation_id_app_conversations"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["app_users.id"], name=op.f("fk_app_messages_sender_id_app_users"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recipient_id"], ["app_users.id"], name=op.f("fk_app_messages_recipient_id_app_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_app_messages")),
    )
    op.create_index(op.f("ix_app_messages_conversation_id"), "app_messages", ["conversation_id"], unique=False)
    op.create_index(op.f("ix_app_messages_sender_id"), "app_messages", ["sender_id"], unique=False)
    op.create_index(op.f("ix_app_messages_recipient_id"), "app_messages", ["recipient_id"], unique=False)

    op.create_table(
        "app_notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("message", sa.String(length=255), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], name=op.f("fk_app_notifications_user_id_app_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_app_notifications")),
    )
    op.create_index(op.f("ix_app_notifications_user_id"), "app_notifications", ["user_id"], unique=False)

    op.create_table(
        "app_payments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("stripe_session_id", sa.String(length=255), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], name=op.f("fk_app_payments_user_id_app_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_app_payments")),
    )
    op.create_index(op.f("ix_app_payments_user_id"), "app_payments", ["user_id"], unique=False)
    op.create_index(op.f("ix_app_payments_stripe_session_id"), "app_payments", ["stripe_session_id"], unique=False)

    op.create_table(
        "app_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("stripe_subscription_id", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], name=op.f("fk_app_subscriptions_user_id_app_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_app_subscriptions")),
    )
    op.create_index(op.f("ix_app_subscriptions_user_id"), "app_subscriptions", ["user_id"], unique=False)
    op.create_index(op.f("ix_app_subscriptions_stripe_subscription_id"), "app_subscriptions", ["stripe_subscription_id"], unique=False)

    op.add_column("app_profiles", sa.Column("location", sa.String(length=120), nullable=True))
    op.add_column("app_profiles", sa.Column("gender", sa.String(length=32), nullable=True))
    op.add_column("app_profiles", sa.Column("interests", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("app_profiles", sa.Column("budget_min", sa.Integer(), nullable=True))
    op.add_column("app_profiles", sa.Column("budget_max", sa.Integer(), nullable=True))

    op.add_column("app_trips", sa.Column("budget_min", sa.Integer(), nullable=True))
    op.add_column("app_trips", sa.Column("budget_max", sa.Integer(), nullable=True))
    op.add_column("app_trips", sa.Column("interests", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("app_trips", "interests")
    op.drop_column("app_trips", "budget_max")
    op.drop_column("app_trips", "budget_min")

    op.drop_column("app_profiles", "budget_max")
    op.drop_column("app_profiles", "budget_min")
    op.drop_column("app_profiles", "interests")
    op.drop_column("app_profiles", "gender")
    op.drop_column("app_profiles", "location")

    op.drop_index(op.f("ix_app_subscriptions_stripe_subscription_id"), table_name="app_subscriptions")
    op.drop_index(op.f("ix_app_subscriptions_user_id"), table_name="app_subscriptions")
    op.drop_table("app_subscriptions")

    op.drop_index(op.f("ix_app_payments_stripe_session_id"), table_name="app_payments")
    op.drop_index(op.f("ix_app_payments_user_id"), table_name="app_payments")
    op.drop_table("app_payments")

    op.drop_index(op.f("ix_app_notifications_user_id"), table_name="app_notifications")
    op.drop_table("app_notifications")

    op.drop_index(op.f("ix_app_messages_recipient_id"), table_name="app_messages")
    op.drop_index(op.f("ix_app_messages_sender_id"), table_name="app_messages")
    op.drop_index(op.f("ix_app_messages_conversation_id"), table_name="app_messages")
    op.drop_table("app_messages")

    op.drop_index(op.f("ix_app_conversations_participant_two_id"), table_name="app_conversations")
    op.drop_index(op.f("ix_app_conversations_participant_one_id"), table_name="app_conversations")
    op.drop_table("app_conversations")

    op.drop_index(op.f("ix_app_matches_receiver_id"), table_name="app_matches")
    op.drop_index(op.f("ix_app_matches_sender_id"), table_name="app_matches")
    op.drop_table("app_matches")
