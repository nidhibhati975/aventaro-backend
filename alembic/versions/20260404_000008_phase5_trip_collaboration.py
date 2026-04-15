"""phase5_trip_collaboration

Revision ID: 20260404_000008
Revises: 20260404_000007
Create Date: 2026-04-04 19:40:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260404_000008"
down_revision = "20260404_000007"
branch_labels = None
depends_on = None


expense_split_status_enum = sa.Enum("owed", "settled", name="expensesplitstatus", native_enum=False)


def upgrade() -> None:
    op.add_column("app_conversations", sa.Column("trip_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_app_conversations_trip_id",
        "app_conversations",
        "app_trips",
        ["trip_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_app_conversations_trip_id", "app_conversations", ["trip_id"], unique=True)
    op.alter_column("app_conversations", "participant_one_id", existing_type=sa.Integer(), nullable=True)
    op.alter_column("app_conversations", "participant_two_id", existing_type=sa.Integer(), nullable=True)
    op.drop_constraint("ck_app_conversations_distinct_participants", "app_conversations", type_="check")
    op.create_check_constraint(
        "ck_app_conversations_type_shape",
        "app_conversations",
        "(conversation_type = 'direct' AND participant_one_id IS NOT NULL AND participant_two_id IS NOT NULL) "
        "OR (conversation_type = 'group' AND trip_id IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_app_conversations_distinct_participants",
        "app_conversations",
        "participant_one_id IS NULL OR participant_two_id IS NULL OR participant_one_id <> participant_two_id",
    )

    op.create_table(
        "app_conversation_members",
        sa.Column("conversation_id", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["app_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("conversation_id", "user_id", name="pk_app_conversation_members"),
        sa.UniqueConstraint("conversation_id", "user_id", name="uq_app_conversation_members_pair"),
    )
    op.create_index("ix_app_conversation_members_user_id", "app_conversation_members", ["user_id"], unique=False)

    op.alter_column("app_messages", "recipient_id", existing_type=sa.Integer(), nullable=True)

    op.create_table(
        "app_expenses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("trip_id", sa.Integer(), sa.ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("paid_by", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_app_expenses_positive_amount"),
    )
    op.create_index("ix_app_expenses_trip_id", "app_expenses", ["trip_id"], unique=False)
    op.create_index("ix_app_expenses_paid_by", "app_expenses", ["paid_by"], unique=False)
    op.create_index("ix_app_expenses_trip_created_at", "app_expenses", ["trip_id", "created_at"], unique=False)
    op.create_index("ix_app_expenses_paid_by_created_at", "app_expenses", ["paid_by", "created_at"], unique=False)

    op.create_table(
        "app_expense_splits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("expense_id", sa.Integer(), sa.ForeignKey("app_expenses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("status", expense_split_status_enum, nullable=False),
        sa.UniqueConstraint("expense_id", "user_id", name="uq_app_expense_splits_pair"),
    )
    op.create_index("ix_app_expense_splits_expense_id", "app_expense_splits", ["expense_id"], unique=False)
    op.create_index("ix_app_expense_splits_user_id", "app_expense_splits", ["user_id"], unique=False)
    op.create_index("ix_app_expense_splits_user_status", "app_expense_splits", ["user_id", "status"], unique=False)

    op.create_table(
        "app_trip_activities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("trip_id", sa.Integer(), sa.ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_trip_activities_trip_id", "app_trip_activities", ["trip_id"], unique=False)
    op.create_index("ix_app_trip_activities_user_id", "app_trip_activities", ["user_id"], unique=False)
    op.create_index("ix_app_trip_activities_trip_created_at", "app_trip_activities", ["trip_id", "created_at"], unique=False)
    op.create_index("ix_app_trip_activities_user_created_at", "app_trip_activities", ["user_id", "created_at"], unique=False)

    op.execute(
        """
        INSERT INTO app_conversation_members (conversation_id, user_id)
        SELECT id, participant_one_id
        FROM app_conversations
        WHERE participant_one_id IS NOT NULL
        ON CONFLICT (conversation_id, user_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO app_conversation_members (conversation_id, user_id)
        SELECT id, participant_two_id
        FROM app_conversations
        WHERE participant_two_id IS NOT NULL
        ON CONFLICT (conversation_id, user_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO app_conversations (id, conversation_type, participant_one_id, participant_two_id, trip_id, created_at, last_message_at)
        SELECT CONCAT('trip:', t.id), 'group', NULL, NULL, t.id, t.created_at, NULL
        FROM app_trips AS t
        WHERE NOT EXISTS (
            SELECT 1
            FROM app_conversations AS c
            WHERE c.trip_id = t.id
        )
        """
    )
    op.execute(
        """
        INSERT INTO app_conversation_members (conversation_id, user_id)
        SELECT CONCAT('trip:', tm.trip_id), tm.user_id
        FROM app_trip_members AS tm
        WHERE tm.status = 'approved'
        ON CONFLICT (conversation_id, user_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM app_messages
        WHERE conversation_id IN (
            SELECT id FROM app_conversations WHERE conversation_type = 'group'
        )
        """
    )
    op.execute("DELETE FROM app_conversations WHERE conversation_type = 'group'")

    op.drop_index("ix_app_trip_activities_user_created_at", table_name="app_trip_activities")
    op.drop_index("ix_app_trip_activities_trip_created_at", table_name="app_trip_activities")
    op.drop_index("ix_app_trip_activities_user_id", table_name="app_trip_activities")
    op.drop_index("ix_app_trip_activities_trip_id", table_name="app_trip_activities")
    op.drop_table("app_trip_activities")

    op.drop_index("ix_app_expense_splits_user_status", table_name="app_expense_splits")
    op.drop_index("ix_app_expense_splits_user_id", table_name="app_expense_splits")
    op.drop_index("ix_app_expense_splits_expense_id", table_name="app_expense_splits")
    op.drop_table("app_expense_splits")

    op.drop_index("ix_app_expenses_paid_by_created_at", table_name="app_expenses")
    op.drop_index("ix_app_expenses_trip_created_at", table_name="app_expenses")
    op.drop_index("ix_app_expenses_paid_by", table_name="app_expenses")
    op.drop_index("ix_app_expenses_trip_id", table_name="app_expenses")
    op.drop_table("app_expenses")

    op.alter_column("app_messages", "recipient_id", existing_type=sa.Integer(), nullable=False)

    op.drop_index("ix_app_conversation_members_user_id", table_name="app_conversation_members")
    op.drop_table("app_conversation_members")

    op.drop_constraint("ck_app_conversations_distinct_participants", "app_conversations", type_="check")
    op.drop_constraint("ck_app_conversations_type_shape", "app_conversations", type_="check")
    op.create_check_constraint(
        "ck_app_conversations_distinct_participants",
        "app_conversations",
        "participant_one_id <> participant_two_id",
    )
    op.alter_column("app_conversations", "participant_two_id", existing_type=sa.Integer(), nullable=False)
    op.alter_column("app_conversations", "participant_one_id", existing_type=sa.Integer(), nullable=False)
    op.drop_index("ix_app_conversations_trip_id", table_name="app_conversations")
    op.drop_constraint("fk_app_conversations_trip_id", "app_conversations", type_="foreignkey")
    op.drop_column("app_conversations", "trip_id")
