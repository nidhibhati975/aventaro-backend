"""production_stabilization

Revision ID: 20260506_000015
Revises: 20260416_000014
Create Date: 2026-05-06 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260506_000015"
down_revision = "20260416_000014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.add_column("app_users", sa.Column("failed_login_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("app_users", sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("app_users", sa.Column("mfa_channel", sa.String(length=16), nullable=True))
    op.add_column("app_users", sa.Column("phone_number", sa.String(length=32), nullable=True))
    op.add_column("app_users", sa.Column("last_password_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("app_users", "failed_login_count", server_default=None)
    op.alter_column("app_users", "mfa_enabled", server_default=None)

    op.add_column("app_profiles", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("app_profiles", sa.Column("longitude", sa.Float(), nullable=True))
    op.create_check_constraint("ck_app_profiles_latitude_range", "app_profiles", "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)")
    op.create_check_constraint("ck_app_profiles_longitude_range", "app_profiles", "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)")
    op.create_index("ix_app_profiles_lat_lon", "app_profiles", ["latitude", "longitude"], unique=False)
    op.execute(
        """
        ALTER TABLE app_profiles
        ADD COLUMN location_geog geography(Point, 4326)
        GENERATED ALWAYS AS (
            CASE
                WHEN latitude IS NOT NULL AND longitude IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
                ELSE NULL
            END
        ) STORED
        """
    )
    op.execute("CREATE INDEX ix_app_profiles_location_geog ON app_profiles USING GIST (location_geog)")

    op.add_column("app_trips", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("app_trips", sa.Column("longitude", sa.Float(), nullable=True))
    op.create_check_constraint("ck_app_trips_latitude_range", "app_trips", "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)")
    op.create_check_constraint("ck_app_trips_longitude_range", "app_trips", "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)")
    op.create_index("ix_app_trips_lat_lon", "app_trips", ["latitude", "longitude"], unique=False)
    op.execute(
        """
        ALTER TABLE app_trips
        ADD COLUMN location_geog geography(Point, 4326)
        GENERATED ALWAYS AS (
            CASE
                WHEN latitude IS NOT NULL AND longitude IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
                ELSE NULL
            END
        ) STORED
        """
    )
    op.execute("CREATE INDEX ix_app_trips_location_geog ON app_trips USING GIST (location_geog)")

    op.add_column("app_messages", sa.Column("client_message_id", sa.String(length=128), nullable=True))
    op.add_column("app_messages", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("app_messages", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_app_messages_client_message_id", "app_messages", ["client_message_id"], unique=False)

    op.add_column("app_payments", sa.Column("provider", sa.String(length=32), nullable=False, server_default="stripe"))
    op.add_column("app_payments", sa.Column("idempotency_key", sa.String(length=255), nullable=True))
    op.create_unique_constraint("uq_app_payments_idempotency_key", "app_payments", ["idempotency_key"])
    op.create_index("ix_app_payments_idempotency_key", "app_payments", ["idempotency_key"], unique=False)
    op.alter_column("app_payments", "provider", server_default=None)

    op.add_column("app_webhook_events", sa.Column("provider", sa.String(length=32), nullable=False, server_default="stripe"))
    op.add_column("app_webhook_events", sa.Column("provider_event_id", sa.String(length=255), nullable=True))
    op.execute("UPDATE app_webhook_events SET provider_event_id = stripe_event_id WHERE provider_event_id IS NULL")
    op.create_unique_constraint("uq_app_webhook_events_provider_event_id", "app_webhook_events", ["provider", "provider_event_id"])
    op.create_index("ix_app_webhook_events_provider_event_id", "app_webhook_events", ["provider_event_id"], unique=False)
    op.create_index("ix_app_webhook_events_provider_processed", "app_webhook_events", ["provider", "processed"], unique=False)
    op.alter_column("app_webhook_events", "provider", server_default=None)

    op.create_table(
        "app_auth_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("refresh_token_jti", sa.String(length=128), nullable=False),
        sa.Column("refresh_token_hash", sa.String(length=128), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(length=120), nullable=True),
        sa.UniqueConstraint("refresh_token_jti", name="uq_app_auth_sessions_refresh_token_jti"),
    )
    op.create_index("ix_app_auth_sessions_user_id", "app_auth_sessions", ["user_id"], unique=False)
    op.create_index("ix_app_auth_sessions_user_revoked_expires", "app_auth_sessions", ["user_id", "revoked_at", "expires_at"], unique=False)
    op.create_index("ix_app_auth_sessions_device", "app_auth_sessions", ["user_id", "device_id"], unique=False)

    op.create_table(
        "app_mfa_challenges",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("challenge_id", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("destination", sa.String(length=255), nullable=False),
        sa.Column("otp_hash", sa.String(length=128), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("challenge_id", name="uq_app_mfa_challenges_challenge_id"),
    )
    op.alter_column("app_mfa_challenges", "attempts", server_default=None)
    op.alter_column("app_mfa_challenges", "max_attempts", server_default=None)
    op.create_index("ix_app_mfa_challenges_challenge_id", "app_mfa_challenges", ["challenge_id"], unique=False)
    op.create_index("ix_app_mfa_challenges_user_purpose", "app_mfa_challenges", ["user_id", "purpose", "created_at"], unique=False)
    op.create_index("ix_app_mfa_challenges_expires_at", "app_mfa_challenges", ["expires_at"], unique=False)

    op.create_table(
        "app_security_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("risk_level", sa.String(length=16), nullable=False, server_default="low"),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.alter_column("app_security_audit_logs", "risk_level", server_default=None)
    op.create_index("ix_app_security_audit_logs_user_id", "app_security_audit_logs", ["user_id"], unique=False)
    op.create_index("ix_app_security_audit_logs_user_event_created_at", "app_security_audit_logs", ["user_id", "event_type", "created_at"], unique=False)
    op.create_index("ix_app_security_audit_logs_event_created_at", "app_security_audit_logs", ["event_type", "created_at"], unique=False)
    op.create_index("ix_app_security_audit_logs_ip_created_at", "app_security_audit_logs", ["ip_address", "created_at"], unique=False)

    op.create_table(
        "app_media_assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("upload_id", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("app_messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("media_type", sa.String(length=16), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("s3_bucket", sa.String(length=255), nullable=False),
        sa.Column("s3_key", sa.String(length=1024), nullable=False),
        sa.Column("cdn_url", sa.String(length=2048), nullable=False),
        sa.Column("cloudinary_url", sa.String(length=2048), nullable=True),
        sa.Column("checksum_sha256", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending_upload"),
        sa.Column("validation_error", sa.Text(), nullable=True),
        sa.Column("upload_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("file_size_bytes > 0", name="ck_app_media_assets_positive_size"),
        sa.UniqueConstraint("upload_id", name="uq_app_media_assets_upload_id"),
        sa.UniqueConstraint("s3_key", name="uq_app_media_assets_s3_key"),
    )
    op.alter_column("app_media_assets", "status", server_default=None)
    op.create_index("ix_app_media_assets_upload_id", "app_media_assets", ["upload_id"], unique=False)
    op.create_index("ix_app_media_assets_user_status_created_at", "app_media_assets", ["user_id", "status", "created_at"], unique=False)
    op.create_index("ix_app_media_assets_message_id", "app_media_assets", ["message_id"], unique=False)

    op.create_table(
        "app_message_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("app_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("redis_stream_id", sa.String(length=128), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("message_id", "user_id", name="uq_app_message_deliveries_message_user"),
    )
    op.alter_column("app_message_deliveries", "status", server_default=None)
    op.alter_column("app_message_deliveries", "attempts", server_default=None)
    op.create_index("ix_app_message_deliveries_message_id", "app_message_deliveries", ["message_id"], unique=False)
    op.create_index("ix_app_message_deliveries_user_id", "app_message_deliveries", ["user_id"], unique=False)
    op.create_index("ix_app_message_deliveries_user_status_created_at", "app_message_deliveries", ["user_id", "status", "created_at"], unique=False)
    op.create_index("ix_app_message_deliveries_stream_id", "app_message_deliveries", ["redis_stream_id"], unique=False)

    op.create_table(
        "app_chat_outbox_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.String(length=128), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("conversation_id", sa.String(length=128), nullable=False),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("app_messages.id", ondelete="CASCADE"), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("redis_stream_id", sa.String(length=128), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("event_id", name="uq_app_chat_outbox_events_event_id"),
    )
    op.alter_column("app_chat_outbox_events", "status", server_default=None)
    op.alter_column("app_chat_outbox_events", "attempts", server_default=None)
    op.create_index("ix_app_chat_outbox_events_conversation_id", "app_chat_outbox_events", ["conversation_id"], unique=False)
    op.create_index("ix_app_chat_outbox_events_status_created_at", "app_chat_outbox_events", ["status", "created_at"], unique=False)
    op.create_index("ix_app_chat_outbox_events_stream_id", "app_chat_outbox_events", ["redis_stream_id"], unique=False)

    op.create_table(
        "app_ledger_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_type", sa.String(length=32), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_type", "owner_id", "currency", name="uq_app_ledger_accounts_owner_currency"),
    )
    op.alter_column("app_ledger_accounts", "status", server_default=None)
    op.create_index("ix_app_ledger_accounts_owner", "app_ledger_accounts", ["owner_type", "owner_id"], unique=False)

    op.create_table(
        "app_ledger_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("app_ledger_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("currency", sa.String(length=16), nullable=False),
        sa.Column("entry_type", sa.String(length=64), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=True),
        sa.Column("provider_reference", sa.String(length=255), nullable=True),
        sa.Column("reference_type", sa.String(length=64), nullable=True),
        sa.Column("reference_id", sa.String(length=128), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("direction IN ('credit','debit')", name="ck_app_ledger_entries_direction"),
        sa.CheckConstraint("amount > 0", name="ck_app_ledger_entries_positive_amount"),
        sa.UniqueConstraint("idempotency_key", name="uq_app_ledger_entries_idempotency_key"),
    )
    op.create_index("ix_app_ledger_entries_user_id", "app_ledger_entries", ["user_id"], unique=False)
    op.create_index("ix_app_ledger_entries_account_created_at", "app_ledger_entries", ["account_id", "created_at"], unique=False)
    op.create_index("ix_app_ledger_entries_provider_reference", "app_ledger_entries", ["provider", "provider_reference"], unique=False)
    op.create_index("ix_app_ledger_entries_reference", "app_ledger_entries", ["reference_type", "reference_id"], unique=False)

    op.create_table(
        "app_reconciliation_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="running"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cursor", sa.String(length=512), nullable=True),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.alter_column("app_reconciliation_runs", "status", server_default=None)
    op.create_index("ix_app_reconciliation_runs_provider_status_created_at", "app_reconciliation_runs", ["provider", "status", "created_at"], unique=False)

    op.create_table(
        "app_ai_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operation", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
        sa.Column("request_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("response_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("rq_job_id", sa.String(length=128), nullable=True),
        sa.Column("cache_key", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("job_id", name="uq_app_ai_jobs_job_id"),
    )
    op.alter_column("app_ai_jobs", "status", server_default=None)
    op.create_index("ix_app_ai_jobs_job_id", "app_ai_jobs", ["job_id"], unique=False)
    op.create_index("ix_app_ai_jobs_user_status_created_at", "app_ai_jobs", ["user_id", "status", "created_at"], unique=False)

    op.create_table(
        "app_ai_usage_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("job_id", sa.String(length=128), nullable=True),
        sa.Column("operation", sa.String(length=64), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_hit", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("fallback_used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("prompt_tokens", "completion_tokens", "total_tokens", "cache_hit", "fallback_used"):
        op.alter_column("app_ai_usage_logs", column, server_default=None)
    op.create_index("ix_app_ai_usage_logs_user_id", "app_ai_usage_logs", ["user_id"], unique=False)
    op.create_index("ix_app_ai_usage_logs_user_operation_created_at", "app_ai_usage_logs", ["user_id", "operation", "created_at"], unique=False)
    op.create_index("ix_app_ai_usage_logs_job_id", "app_ai_usage_logs", ["job_id"], unique=False)

    op.create_table(
        "app_client_analytics_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("session_id", sa.String(length=128), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="mobile"),
        sa.Column("client_timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column("properties", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("event_id", name="uq_app_client_analytics_events_event_id"),
    )
    op.alter_column("app_client_analytics_events", "source", server_default=None)
    op.create_index("ix_app_client_analytics_events_user_id", "app_client_analytics_events", ["user_id"], unique=False)
    op.create_index("ix_app_client_analytics_events_user_type_client_ts", "app_client_analytics_events", ["user_id", "event_type", "client_timestamp"], unique=False)
    op.create_index("ix_app_client_analytics_events_type_ingested_at", "app_client_analytics_events", ["event_type", "ingested_at"], unique=False)
    op.create_index("ix_app_client_analytics_events_session_id", "app_client_analytics_events", ["session_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_app_client_analytics_events_session_id", table_name="app_client_analytics_events")
    op.drop_index("ix_app_client_analytics_events_type_ingested_at", table_name="app_client_analytics_events")
    op.drop_index("ix_app_client_analytics_events_user_type_client_ts", table_name="app_client_analytics_events")
    op.drop_index("ix_app_client_analytics_events_user_id", table_name="app_client_analytics_events")
    op.drop_table("app_client_analytics_events")

    op.drop_index("ix_app_ai_usage_logs_job_id", table_name="app_ai_usage_logs")
    op.drop_index("ix_app_ai_usage_logs_user_operation_created_at", table_name="app_ai_usage_logs")
    op.drop_index("ix_app_ai_usage_logs_user_id", table_name="app_ai_usage_logs")
    op.drop_table("app_ai_usage_logs")

    op.drop_index("ix_app_ai_jobs_user_status_created_at", table_name="app_ai_jobs")
    op.drop_index("ix_app_ai_jobs_job_id", table_name="app_ai_jobs")
    op.drop_table("app_ai_jobs")

    op.drop_index("ix_app_reconciliation_runs_provider_status_created_at", table_name="app_reconciliation_runs")
    op.drop_table("app_reconciliation_runs")

    op.drop_index("ix_app_ledger_entries_reference", table_name="app_ledger_entries")
    op.drop_index("ix_app_ledger_entries_provider_reference", table_name="app_ledger_entries")
    op.drop_index("ix_app_ledger_entries_account_created_at", table_name="app_ledger_entries")
    op.drop_index("ix_app_ledger_entries_user_id", table_name="app_ledger_entries")
    op.drop_table("app_ledger_entries")

    op.drop_index("ix_app_ledger_accounts_owner", table_name="app_ledger_accounts")
    op.drop_table("app_ledger_accounts")

    op.drop_index("ix_app_chat_outbox_events_stream_id", table_name="app_chat_outbox_events")
    op.drop_index("ix_app_chat_outbox_events_status_created_at", table_name="app_chat_outbox_events")
    op.drop_index("ix_app_chat_outbox_events_conversation_id", table_name="app_chat_outbox_events")
    op.drop_table("app_chat_outbox_events")

    op.drop_index("ix_app_message_deliveries_stream_id", table_name="app_message_deliveries")
    op.drop_index("ix_app_message_deliveries_user_status_created_at", table_name="app_message_deliveries")
    op.drop_index("ix_app_message_deliveries_user_id", table_name="app_message_deliveries")
    op.drop_index("ix_app_message_deliveries_message_id", table_name="app_message_deliveries")
    op.drop_table("app_message_deliveries")

    op.drop_index("ix_app_media_assets_message_id", table_name="app_media_assets")
    op.drop_index("ix_app_media_assets_user_status_created_at", table_name="app_media_assets")
    op.drop_index("ix_app_media_assets_upload_id", table_name="app_media_assets")
    op.drop_table("app_media_assets")

    op.drop_index("ix_app_security_audit_logs_ip_created_at", table_name="app_security_audit_logs")
    op.drop_index("ix_app_security_audit_logs_event_created_at", table_name="app_security_audit_logs")
    op.drop_index("ix_app_security_audit_logs_user_event_created_at", table_name="app_security_audit_logs")
    op.drop_index("ix_app_security_audit_logs_user_id", table_name="app_security_audit_logs")
    op.drop_table("app_security_audit_logs")

    op.drop_index("ix_app_mfa_challenges_expires_at", table_name="app_mfa_challenges")
    op.drop_index("ix_app_mfa_challenges_user_purpose", table_name="app_mfa_challenges")
    op.drop_index("ix_app_mfa_challenges_challenge_id", table_name="app_mfa_challenges")
    op.drop_table("app_mfa_challenges")

    op.drop_index("ix_app_auth_sessions_device", table_name="app_auth_sessions")
    op.drop_index("ix_app_auth_sessions_user_revoked_expires", table_name="app_auth_sessions")
    op.drop_index("ix_app_auth_sessions_user_id", table_name="app_auth_sessions")
    op.drop_table("app_auth_sessions")

    op.drop_index("ix_app_webhook_events_provider_processed", table_name="app_webhook_events")
    op.drop_index("ix_app_webhook_events_provider_event_id", table_name="app_webhook_events")
    op.drop_constraint("uq_app_webhook_events_provider_event_id", "app_webhook_events", type_="unique")
    op.drop_column("app_webhook_events", "provider_event_id")
    op.drop_column("app_webhook_events", "provider")

    op.drop_index("ix_app_payments_idempotency_key", table_name="app_payments")
    op.drop_constraint("uq_app_payments_idempotency_key", "app_payments", type_="unique")
    op.drop_column("app_payments", "idempotency_key")
    op.drop_column("app_payments", "provider")

    op.drop_index("ix_app_messages_client_message_id", table_name="app_messages")
    op.drop_column("app_messages", "deleted_at")
    op.drop_column("app_messages", "edited_at")
    op.drop_column("app_messages", "client_message_id")

    op.execute("DROP INDEX IF EXISTS ix_app_trips_location_geog")
    op.drop_index("ix_app_trips_lat_lon", table_name="app_trips")
    op.drop_constraint("ck_app_trips_longitude_range", "app_trips", type_="check")
    op.drop_constraint("ck_app_trips_latitude_range", "app_trips", type_="check")
    op.drop_column("app_trips", "location_geog")
    op.drop_column("app_trips", "longitude")
    op.drop_column("app_trips", "latitude")

    op.execute("DROP INDEX IF EXISTS ix_app_profiles_location_geog")
    op.drop_index("ix_app_profiles_lat_lon", table_name="app_profiles")
    op.drop_constraint("ck_app_profiles_longitude_range", "app_profiles", type_="check")
    op.drop_constraint("ck_app_profiles_latitude_range", "app_profiles", type_="check")
    op.drop_column("app_profiles", "location_geog")
    op.drop_column("app_profiles", "longitude")
    op.drop_column("app_profiles", "latitude")

    op.drop_column("app_users", "last_password_changed_at")
    op.drop_column("app_users", "phone_number")
    op.drop_column("app_users", "mfa_channel")
    op.drop_column("app_users", "mfa_enabled")
    op.drop_column("app_users", "failed_login_count")
