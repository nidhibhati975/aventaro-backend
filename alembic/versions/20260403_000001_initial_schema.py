"""Initial Phase 1 and Phase 2 schema.

Revision ID: 20260403_000001
Revises: 20260402_0012
Create Date: 2026-04-03 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260403_000001"
down_revision = "20260402_0012"
branch_labels = None
depends_on = None


match_status = sa.Enum("pending", "accepted", "rejected", name="matchstatus", native_enum=False)
trip_membership_status = sa.Enum("pending", "approved", name="tripmembershipstatus", native_enum=False)


def upgrade() -> None:
    op.create_table(
        "app_users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_users_id", "app_users", ["id"], unique=False)
    op.create_index("ix_app_users_email", "app_users", ["email"], unique=True)

    op.create_table(
        "app_profiles",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=True),
        sa.Column("age", sa.Integer(), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
    )

    op.create_table(
        "app_match_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("requester_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("addressee_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", match_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("requester_id", "addressee_id", name="uq_match_request_pair"),
    )
    op.create_index("ix_app_match_requests_requester_id", "app_match_requests", ["requester_id"], unique=False)
    op.create_index("ix_app_match_requests_addressee_id", "app_match_requests", ["addressee_id"], unique=False)

    op.create_table(
        "app_trips",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=150), nullable=False),
        sa.Column("location", sa.String(length=150), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_trips_owner_id", "app_trips", ["owner_id"], unique=False)

    op.create_table(
        "app_trip_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("trip_id", sa.Integer(), sa.ForeignKey("app_trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", trip_membership_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("trip_id", "user_id", name="uq_trip_member"),
    )
    op.create_index("ix_app_trip_members_trip_id", "app_trip_members", ["trip_id"], unique=False)
    op.create_index("ix_app_trip_members_user_id", "app_trip_members", ["user_id"], unique=False)

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


def downgrade() -> None:
    op.drop_index("ix_app_chat_messages_recipient_id", table_name="app_chat_messages")
    op.drop_index("ix_app_chat_messages_sender_id", table_name="app_chat_messages")
    op.drop_index("ix_app_chat_messages_conversation_id", table_name="app_chat_messages")
    op.drop_table("app_chat_messages")

    op.drop_index("ix_app_trip_members_user_id", table_name="app_trip_members")
    op.drop_index("ix_app_trip_members_trip_id", table_name="app_trip_members")
    op.drop_table("app_trip_members")

    op.drop_index("ix_app_trips_owner_id", table_name="app_trips")
    op.drop_table("app_trips")

    op.drop_index("ix_app_match_requests_addressee_id", table_name="app_match_requests")
    op.drop_index("ix_app_match_requests_requester_id", table_name="app_match_requests")
    op.drop_table("app_match_requests")

    op.drop_table("app_profiles")

    op.drop_index("ix_app_users_email", table_name="app_users")
    op.drop_index("ix_app_users_id", table_name="app_users")
    op.drop_table("app_users")
