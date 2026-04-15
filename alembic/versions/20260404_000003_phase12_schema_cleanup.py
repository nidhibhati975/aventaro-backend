"""phase12_schema_cleanup

Revision ID: 20260404_000003
Revises: 20260403_000002
Create Date: 2026-04-04 00:03:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260404_000003"
down_revision = "20260403_000002"
branch_labels = None
depends_on = None


trip_member_role = sa.Enum("owner", "member", name="tripmemberrole", native_enum=False)


def upgrade() -> None:
    op.add_column(
        "app_trip_members",
        sa.Column(
            "role",
            trip_member_role,
            nullable=False,
            server_default="member",
        ),
    )
    op.execute(
        """
        UPDATE app_trip_members AS members
        SET role = 'owner'
        FROM app_trips AS trips
        WHERE trips.id = members.trip_id
          AND trips.owner_id = members.user_id
        """
    )
    op.alter_column("app_trip_members", "role", server_default=None)

    op.add_column("app_messages", sa.Column("read_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_app_messages_recipient_read_created_at",
        "app_messages",
        ["recipient_id", "read_at", "created_at"],
        unique=False,
    )

    op.execute("DROP TABLE IF EXISTS app_chat_messages CASCADE")
    op.execute("DROP TABLE IF EXISTS app_match_requests CASCADE")


def downgrade() -> None:
    op.create_table(
        "app_match_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("requester_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("addressee_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "accepted", "rejected", name="matchstatus", native_enum=False),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("requester_id", "addressee_id", name="uq_match_request_pair"),
    )
    op.create_index("ix_app_match_requests_requester_id", "app_match_requests", ["requester_id"], unique=False)
    op.create_index("ix_app_match_requests_addressee_id", "app_match_requests", ["addressee_id"], unique=False)

    op.create_table(
        "app_chat_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("conversation_id", sa.String(length=128), nullable=False),
        sa.Column("sender_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_chat_messages_conversation_id", "app_chat_messages", ["conversation_id"], unique=False)
    op.create_index("ix_app_chat_messages_sender_id", "app_chat_messages", ["sender_id"], unique=False)
    op.create_index("ix_app_chat_messages_recipient_id", "app_chat_messages", ["recipient_id"], unique=False)

    op.drop_index("ix_app_messages_recipient_read_created_at", table_name="app_messages")
    op.drop_column("app_messages", "read_at")

    op.drop_column("app_trip_members", "role")
