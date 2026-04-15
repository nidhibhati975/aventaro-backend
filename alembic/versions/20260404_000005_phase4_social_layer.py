"""phase4_social_layer

Revision ID: 20260404_000005
Revises: 20260404_000004
Create Date: 2026-04-04 13:20:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260404_000005"
down_revision = "20260404_000004"
branch_labels = None
depends_on = None


media_type_enum = sa.Enum("image", "video", name="mediatype", native_enum=False)


def upgrade() -> None:
    op.create_table(
        "app_posts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("media_url", sa.String(length=2048), nullable=False),
        sa.Column("media_type", media_type_enum, nullable=False),
        sa.Column("location", sa.String(length=150), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_posts_user_id", "app_posts", ["user_id"], unique=False)
    op.create_index("ix_app_posts_user_created_at", "app_posts", ["user_id", "created_at"], unique=False)
    op.create_index("ix_app_posts_media_type_created_at", "app_posts", ["media_type", "created_at"], unique=False)
    op.create_index("ix_app_posts_location_created_at", "app_posts", ["location", "created_at"], unique=False)

    op.create_table(
        "app_likes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("post_id", sa.Integer(), sa.ForeignKey("app_posts.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("user_id", "post_id", name="uq_app_likes_user_post"),
    )
    op.create_index("ix_app_likes_post_id", "app_likes", ["post_id"], unique=False)
    op.create_index("ix_app_likes_user_id", "app_likes", ["user_id"], unique=False)

    op.create_table(
        "app_comments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("post_id", sa.Integer(), sa.ForeignKey("app_posts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("char_length(trim(comment)) > 0", name="ck_app_comments_not_blank"),
    )
    op.create_index("ix_app_comments_user_id", "app_comments", ["user_id"], unique=False)
    op.create_index("ix_app_comments_post_id", "app_comments", ["post_id"], unique=False)
    op.create_index("ix_app_comments_post_created_at", "app_comments", ["post_id", "created_at"], unique=False)
    op.create_index("ix_app_comments_user_created_at", "app_comments", ["user_id", "created_at"], unique=False)

    op.create_table(
        "app_follows",
        sa.Column("follower_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("following_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.CheckConstraint("follower_id <> following_id", name="ck_app_follows_distinct_users"),
        sa.PrimaryKeyConstraint("follower_id", "following_id", name="pk_app_follows"),
        sa.UniqueConstraint("follower_id", "following_id", name="uq_app_follows_pair"),
    )
    op.create_index("ix_app_follows_follower_id", "app_follows", ["follower_id"], unique=False)
    op.create_index("ix_app_follows_following_id", "app_follows", ["following_id"], unique=False)

    op.create_table(
        "app_saved_posts",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("post_id", sa.Integer(), sa.ForeignKey("app_posts.id", ondelete="CASCADE"), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "post_id", name="pk_app_saved_posts"),
        sa.UniqueConstraint("user_id", "post_id", name="uq_app_saved_posts_user_post"),
    )
    op.create_index("ix_app_saved_posts_user_id", "app_saved_posts", ["user_id"], unique=False)
    op.create_index("ix_app_saved_posts_post_id", "app_saved_posts", ["post_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_app_saved_posts_post_id", table_name="app_saved_posts")
    op.drop_index("ix_app_saved_posts_user_id", table_name="app_saved_posts")
    op.drop_table("app_saved_posts")

    op.drop_index("ix_app_follows_following_id", table_name="app_follows")
    op.drop_index("ix_app_follows_follower_id", table_name="app_follows")
    op.drop_table("app_follows")

    op.drop_index("ix_app_comments_user_created_at", table_name="app_comments")
    op.drop_index("ix_app_comments_post_created_at", table_name="app_comments")
    op.drop_index("ix_app_comments_post_id", table_name="app_comments")
    op.drop_index("ix_app_comments_user_id", table_name="app_comments")
    op.drop_table("app_comments")

    op.drop_index("ix_app_likes_user_id", table_name="app_likes")
    op.drop_index("ix_app_likes_post_id", table_name="app_likes")
    op.drop_table("app_likes")

    op.drop_index("ix_app_posts_location_created_at", table_name="app_posts")
    op.drop_index("ix_app_posts_media_type_created_at", table_name="app_posts")
    op.drop_index("ix_app_posts_user_created_at", table_name="app_posts")
    op.drop_index("ix_app_posts_user_id", table_name="app_posts")
    op.drop_table("app_posts")
