"""phase4_social_completion

Revision ID: 20260404_000006
Revises: 20260404_000005
Create Date: 2026-04-04 17:40:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260404_000006"
down_revision = "20260404_000005"
branch_labels = None
depends_on = None


media_type_enum = sa.Enum("image", "video", name="mediatype", native_enum=False)
report_target_type_enum = sa.Enum("post", "user", name="reporttargettype", native_enum=False)


def upgrade() -> None:
    op.add_column("app_posts", sa.Column("watch_time", sa.Float(), nullable=False, server_default="0"))
    op.alter_column("app_posts", "watch_time", server_default=None)

    op.create_table(
        "app_post_watches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("post_id", sa.Integer(), sa.ForeignKey("app_posts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("watch_time", sa.Float(), nullable=False),
        sa.Column("viewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("watch_time >= 0", name="ck_app_post_watches_watch_time_positive"),
        sa.UniqueConstraint("user_id", "post_id", name="uq_app_post_watches_user_post"),
    )
    op.create_index("ix_app_post_watches_post_id", "app_post_watches", ["post_id"], unique=False)
    op.create_index("ix_app_post_watches_user_id", "app_post_watches", ["user_id"], unique=False)

    op.create_table(
        "app_stories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("media_url", sa.String(length=2048), nullable=False),
        sa.Column("media_type", media_type_enum, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_stories_user_id", "app_stories", ["user_id"], unique=False)
    op.create_index("ix_app_stories_user_created_at", "app_stories", ["user_id", "created_at"], unique=False)
    op.create_index("ix_app_stories_expires_at", "app_stories", ["expires_at"], unique=False)
    op.create_index("ix_app_stories_user_expires_at", "app_stories", ["user_id", "expires_at"], unique=False)

    op.create_table(
        "app_story_views",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("story_id", sa.Integer(), sa.ForeignKey("app_stories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("viewer_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("viewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("story_id", "viewer_id", name="uq_app_story_views_story_viewer"),
    )
    op.create_index("ix_app_story_views_story_id", "app_story_views", ["story_id"], unique=False)
    op.create_index("ix_app_story_views_viewer_id", "app_story_views", ["viewer_id"], unique=False)

    op.create_table(
        "app_hashtags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tag", sa.String(length=64), nullable=False),
        sa.UniqueConstraint("tag", name="uq_app_hashtags_tag"),
    )
    op.create_index("ix_app_hashtags_tag", "app_hashtags", ["tag"], unique=False)

    op.create_table(
        "app_post_hashtags",
        sa.Column("post_id", sa.Integer(), sa.ForeignKey("app_posts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("hashtag_id", sa.Integer(), sa.ForeignKey("app_hashtags.id", ondelete="CASCADE"), nullable=False),
        sa.PrimaryKeyConstraint("post_id", "hashtag_id", name="pk_app_post_hashtags"),
        sa.UniqueConstraint("post_id", "hashtag_id", name="uq_app_post_hashtags_post_hashtag"),
    )
    op.create_index("ix_app_post_hashtags_hashtag_id", "app_post_hashtags", ["hashtag_id"], unique=False)

    op.create_table(
        "app_collections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "name", name="uq_app_collections_user_name"),
    )
    op.create_index("ix_app_collections_user_id", "app_collections", ["user_id"], unique=False)
    op.create_index("ix_app_collections_user_created_at", "app_collections", ["user_id", "created_at"], unique=False)

    op.create_table(
        "app_collection_posts",
        sa.Column("collection_id", sa.Integer(), sa.ForeignKey("app_collections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("post_id", sa.Integer(), sa.ForeignKey("app_posts.id", ondelete="CASCADE"), nullable=False),
        sa.PrimaryKeyConstraint("collection_id", "post_id", name="pk_app_collection_posts"),
        sa.UniqueConstraint("collection_id", "post_id", name="uq_app_collection_posts_collection_post"),
    )
    op.create_index("ix_app_collection_posts_post_id", "app_collection_posts", ["post_id"], unique=False)

    op.create_table(
        "app_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reporter_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_type", report_target_type_enum, nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_app_reports_reporter_id", "app_reports", ["reporter_id"], unique=False)
    op.create_index("ix_app_reports_target_id", "app_reports", ["target_id"], unique=False)
    op.create_index("ix_app_reports_target_created_at", "app_reports", ["target_type", "target_id", "created_at"], unique=False)
    op.create_index("ix_app_reports_reporter_created_at", "app_reports", ["reporter_id", "created_at"], unique=False)

    op.create_table(
        "app_blocks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("blocker_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("blocked_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.CheckConstraint("blocker_id <> blocked_id", name="ck_app_blocks_distinct_users"),
        sa.UniqueConstraint("blocker_id", "blocked_id", name="uq_app_blocks_pair"),
    )
    op.create_index("ix_app_blocks_blocker_id", "app_blocks", ["blocker_id"], unique=False)
    op.create_index("ix_app_blocks_blocked_id", "app_blocks", ["blocked_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_app_blocks_blocked_id", table_name="app_blocks")
    op.drop_index("ix_app_blocks_blocker_id", table_name="app_blocks")
    op.drop_table("app_blocks")

    op.drop_index("ix_app_reports_reporter_created_at", table_name="app_reports")
    op.drop_index("ix_app_reports_target_created_at", table_name="app_reports")
    op.drop_index("ix_app_reports_target_id", table_name="app_reports")
    op.drop_index("ix_app_reports_reporter_id", table_name="app_reports")
    op.drop_table("app_reports")

    op.drop_index("ix_app_collection_posts_post_id", table_name="app_collection_posts")
    op.drop_table("app_collection_posts")

    op.drop_index("ix_app_collections_user_created_at", table_name="app_collections")
    op.drop_index("ix_app_collections_user_id", table_name="app_collections")
    op.drop_table("app_collections")

    op.drop_index("ix_app_post_hashtags_hashtag_id", table_name="app_post_hashtags")
    op.drop_table("app_post_hashtags")

    op.drop_index("ix_app_hashtags_tag", table_name="app_hashtags")
    op.drop_table("app_hashtags")

    op.drop_index("ix_app_story_views_viewer_id", table_name="app_story_views")
    op.drop_index("ix_app_story_views_story_id", table_name="app_story_views")
    op.drop_table("app_story_views")

    op.drop_index("ix_app_stories_user_expires_at", table_name="app_stories")
    op.drop_index("ix_app_stories_expires_at", table_name="app_stories")
    op.drop_index("ix_app_stories_user_created_at", table_name="app_stories")
    op.drop_index("ix_app_stories_user_id", table_name="app_stories")
    op.drop_table("app_stories")

    op.drop_index("ix_app_post_watches_user_id", table_name="app_post_watches")
    op.drop_index("ix_app_post_watches_post_id", table_name="app_post_watches")
    op.drop_table("app_post_watches")

    op.drop_column("app_posts", "watch_time")
