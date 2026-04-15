"""phase5_production_scale

Revision ID: 20260404_000009
Revises: 20260404_000008
Create Date: 2026-04-04 22:05:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260404_000009"
down_revision = "20260404_000008"
branch_labels = None
depends_on = None


message_status_enum = sa.Enum("sent", "delivered", "read", name="messagestatus", native_enum=False)
expense_split_type_enum = sa.Enum("equal", "percentage", "custom", name="expensesplittype", native_enum=False)


def upgrade() -> None:
    op.add_column(
        "app_messages",
        sa.Column("message_status", message_status_enum, nullable=False, server_default="sent"),
    )
    op.alter_column("app_messages", "message_status", server_default=None)
    op.create_index(
        "ix_app_messages_conversation_status_created_at",
        "app_messages",
        ["conversation_id", "message_status", "created_at"],
        unique=False,
    )

    op.add_column(
        "app_expenses",
        sa.Column("split_type", expense_split_type_enum, nullable=False, server_default="equal"),
    )
    op.alter_column("app_expenses", "split_type", server_default=None)

    op.create_table(
        "app_push_devices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.String(length=512), nullable=False),
        sa.Column("platform", sa.String(length=32), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("token", name="uq_app_push_devices_token"),
    )
    op.alter_column("app_push_devices", "is_active", server_default=None)
    op.create_index("ix_app_push_devices_user_id", "app_push_devices", ["user_id"], unique=False)
    op.create_index("ix_app_push_devices_user_is_active", "app_push_devices", ["user_id", "is_active"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_app_push_devices_user_is_active", table_name="app_push_devices")
    op.drop_index("ix_app_push_devices_user_id", table_name="app_push_devices")
    op.drop_table("app_push_devices")

    op.drop_column("app_expenses", "split_type")

    op.drop_index("ix_app_messages_conversation_status_created_at", table_name="app_messages")
    op.drop_column("app_messages", "message_status")
