from __future__ import annotations

import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = PROJECT_ROOT / ".env"
if not ENV_PATH.exists():
    raise RuntimeError(f"Missing required environment file: {ENV_PATH}")
load_dotenv(ENV_PATH)
SAFE_PROVIDER_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,49}$")
SAFE_BUCKET_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
SAFE_HOST_PATTERN = re.compile(r"^[A-Za-z0-9.-]+$")
PLACEHOLDER_MARKERS = {
    "",
    "replace",
    "replace_me",
    "changeme",
    "change_me",
    "todo",
    "tbd",
    "dummy",
    "placeholder",
    "example",
    "your_key_here",
    "your_secret_here",
}
DEV_REQUIRED_DEFAULTS = {
    "JWT_SECRET": "development-placeholder-jwt-secret-change-before-launch",
    "JWT_ALGORITHM": "HS256",
    "OPENAI_API_KEY": "sk-development-placeholder-key-not-used",
}


@dataclass(frozen=True)
class Settings:
    database_url: str
    database_url_fallback: str | None
    database_fallback_enabled: bool
    database_prefer_fallback: bool
    jwt_secret: str
    jwt_algorithm: str
    redis_url: str
    aws_access_key_id: str | None
    aws_secret_access_key: str | None
    openai_api_key: str
    cors_allowed_origins: tuple[str, ...] = ()
    model_name: str = "gpt-4.1-mini"
    ai_cache_ttl_seconds: int = 3600
    ai_request_timeout_seconds: float = 2.2
    ai_max_output_tokens: int = 800
    ai_prompt_max_chars: int = 6000
    social_cache_ttl_seconds: int = 120
    trip_idempotency_ttl_seconds: int = 24 * 60 * 60
    websocket_presence_ttl_seconds: int = 120
    websocket_presence_heartbeat_seconds: int = 30
    free_daily_match_limit: int = 5
    free_daily_trip_join_limit: int = 3
    free_daily_ai_limit: int = 10
    premium_people_ranking_boost: int = 12
    premium_trip_ranking_boost: int = 12
    profile_boost_hours: int = 24
    trip_boost_hours: int = 24
    boost_cooldown_hours: int = 24
    profile_boost_ranking_boost: int = 20
    trip_boost_ranking_boost: int = 20
    referral_reward_premium_days: int = 7
    subscription_expiry_job_interval_seconds: int = 3600
    trip_lifecycle_job_interval_seconds: int = 3600
    analytics_metrics_window_days: int = 30
    fcm_server_key: str | None = None
    fcm_request_timeout_seconds: float = 3.0
    media_allowed_domains: tuple[str, ...] = ()
    media_max_image_bytes: int = 15 * 1024 * 1024
    media_max_video_bytes: int = 250 * 1024 * 1024
    media_max_video_duration_seconds: float = 4 * 60 * 60
    stripe_secret_key: str | None = None
    stripe_publishable_key: str | None = None
    stripe_premium_price_id: str | None = None
    stripe_webhook_secret: str | None = None
    stripe_booking_success_url: str | None = None
    stripe_booking_cancel_url: str | None = None
    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    razorpay_webhook_secret: str | None = None
    s3_media_bucket: str | None = None
    s3_media_region: str = "ap-south-1"
    s3_presign_expiry_seconds: int = 900
    cloudfront_media_domain: str | None = None
    cloudinary_cloud_name: str | None = None
    cloudinary_api_key: str | None = None
    cloudinary_api_secret: str | None = None
    media_upload_prefix: str = "uploads"
    duffel_access_token: str | None = None
    duffel_api_base_url: str = "https://api.duffel.com"
    duffel_version: str = "v2"
    duffel_webhook_secret: str | None = None
    sendgrid_api_key: str | None = None
    sendgrid_from_email: str | None = None
    msg91_auth_key: str | None = None
    msg91_template_id: str | None = None
    msg91_sender_id: str | None = None
    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5
    auth_access_token_minutes: int = 30
    auth_refresh_token_days: int = 30
    auth_lockout_threshold: int = 5
    auth_lockout_minutes: int = 15
    webhook_signature_tolerance_seconds: int = 300
    redis_stream_chat_events: str = "aventaro:chat:events"
    redis_stream_chat_group: str = "aventaro-chat-delivery"
    ai_job_poll_timeout_seconds: float = 18.0
    ai_job_ttl_seconds: int = 24 * 60 * 60
    ai_job_max_attempts: int = 3
    ai_job_retry_base_seconds: int = 30
    maintenance_job_interval_seconds: int = 300
    media_orphan_grace_minutes: int = 60
    media_cleanup_batch_size: int = 100
    cloudfront_distribution_id: str | None = None
    sentry_dsn: str | None = None
    otel_service_name: str = "aventaro-api"
    otel_exporter_otlp_endpoint: str | None = None
    trace_sample_rate: float = 0.2
    booking_provider: str = "duffel"
    app_env: str = "development"
    run_embedded_workers: bool = True

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


def _read_required_env(*names: str) -> str:
    value = _read_optional_env(*names)
    if value is None:
        if _placeholder_config_allowed():
            for name in names:
                if name in DEV_REQUIRED_DEFAULTS:
                    return DEV_REQUIRED_DEFAULTS[name]
        raise RuntimeError(f"Missing required environment variable: {' or '.join(names)}")
    return value


def _placeholder_config_allowed() -> bool:
    raw_value = os.getenv("ALLOW_PLACEHOLDER_CONFIG", "true")
    return raw_value.strip().lower() not in {"0", "false", "no", "off"}


def _is_placeholder_value(value: str) -> bool:
    normalized = value.strip().strip('"\'').lower()
    return (
        normalized in PLACEHOLDER_MARKERS
        or normalized.startswith("replace_")
        or normalized.startswith("your_")
        or normalized.startswith("<")
        or normalized.endswith(">")
    )


def _read_optional_env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value is None or not value.strip():
            continue
        cleaned = value.strip()
        if _is_placeholder_value(cleaned):
            continue
        return cleaned
    return None


def _read_env_value(name: str, default: str, *aliases: str) -> str:
    value = _read_optional_env(name, *aliases)
    return value if value is not None else default


def _read_int_env(name: str, default: int, *aliases: str) -> int:
    raw = _read_env_value(name, str(default), *aliases)
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc


def _read_float_env(name: str, default: float, *aliases: str) -> float:
    raw = _read_env_value(name, str(default), *aliases)
    try:
        return float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number") from exc


def _read_bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be a boolean value")


def normalize_database_url(value: str) -> str:
    normalized = value.strip()
    if normalized.startswith("postgres://"):
        normalized = f"postgresql://{normalized[len('postgres://'):]}"
    if normalized.startswith("postgresql://"):
        return f"postgresql+psycopg2://{normalized[len('postgresql://'):]}"
    return normalized


def normalize_booking_provider(value: str | None) -> str:
    normalized = (value or "duffel").strip().lower()
    if not normalized or normalized in {"auto", "default", "none"}:
        return "duffel"
    if normalized in {"mock", "fallback"}:
        raise RuntimeError("Mock/fallback booking providers are not allowed in production configuration")
    if not SAFE_PROVIDER_NAME_PATTERN.match(normalized):
        raise RuntimeError("BOOKING_PROVIDER must be a safe provider identifier")
    return normalized


def _is_valid_postgresql_url(value: str | None) -> bool:
    if value is None or not value.strip():
        return False
    normalized = normalize_database_url(value)
    if not normalized.startswith("postgresql"):
        return False
    parsed = urlparse(normalized)
    return bool(parsed.hostname)


def _is_valid_http_url(value: str | None) -> bool:
    if value is None or not value.strip():
        return False
    parsed = urlparse(value.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _is_valid_host_or_url(value: str | None) -> bool:
    if value is None or not value.strip():
        return False
    normalized = value.strip().rstrip("/")
    parsed = urlparse(normalized if "://" in normalized else f"https://{normalized}")
    return bool(parsed.hostname) and bool(SAFE_HOST_PATTERN.match(parsed.hostname))


def _validate_optional_prefix(name: str, value: str | None, prefixes: tuple[str, ...], min_length: int = 1) -> None:
    if value and (not value.startswith(prefixes) or len(value) < min_length):
        raise RuntimeError(f"{name} has an invalid format")


def validate_settings(settings: Settings) -> None:
    primary_database_valid = _is_valid_postgresql_url(settings.database_url)
    fallback_database_valid = _is_valid_postgresql_url(settings.database_url_fallback)
    if not primary_database_valid and not fallback_database_valid:
        raise RuntimeError(
            "DATABASE_URL must use a PostgreSQL driver and include a valid host, "
            "or DATABASE_URL_FALLBACK must provide a valid PostgreSQL URL"
        )
    if not settings.jwt_algorithm:
        raise RuntimeError("JWT_ALGORITHM must be configured")
    if not settings.redis_url.startswith(("redis://", "rediss://")):
        raise RuntimeError("REDIS_URL must use the redis:// or rediss:// scheme")
    parsed_redis_url = urlparse(settings.redis_url)
    if not parsed_redis_url.hostname:
        raise RuntimeError("REDIS_URL must include a valid host")
    if not settings.jwt_secret.strip():
        raise RuntimeError("JWT_SECRET must be configured")
    if settings.is_production and len(settings.jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 characters when APP_ENV=production")
    if not settings.openai_api_key.startswith("sk-") or len(settings.openai_api_key) < 20:
        raise RuntimeError("OPENAI_API_KEY must be a valid OpenAI API key")
    if not settings.model_name.strip():
        raise RuntimeError("MODEL_NAME must be configured")
    if settings.ai_cache_ttl_seconds < 60:
        raise RuntimeError("AI_CACHE_TTL_SECONDS must be at least 60 seconds")
    if settings.social_cache_ttl_seconds < 30:
        raise RuntimeError("SOCIAL_CACHE_TTL_SECONDS must be at least 30 seconds")
    if settings.trip_idempotency_ttl_seconds < 60:
        raise RuntimeError("TRIP_IDEMPOTENCY_TTL_SECONDS must be at least 60 seconds")
    if settings.free_daily_match_limit < 1:
        raise RuntimeError("FREE_DAILY_MATCH_LIMIT must be at least 1")
    if settings.free_daily_trip_join_limit < 1:
        raise RuntimeError("FREE_DAILY_TRIP_JOIN_LIMIT must be at least 1")
    if settings.free_daily_ai_limit < 1:
        raise RuntimeError("FREE_DAILY_AI_LIMIT must be at least 1")
    if settings.profile_boost_hours < 1:
        raise RuntimeError("PROFILE_BOOST_HOURS must be at least 1")
    if settings.trip_boost_hours < 1:
        raise RuntimeError("TRIP_BOOST_HOURS must be at least 1")
    if settings.boost_cooldown_hours < 1:
        raise RuntimeError("BOOST_COOLDOWN_HOURS must be at least 1")
    if settings.referral_reward_premium_days < 1:
        raise RuntimeError("REFERRAL_REWARD_PREMIUM_DAYS must be at least 1")
    if settings.subscription_expiry_job_interval_seconds < 60:
        raise RuntimeError("SUBSCRIPTION_EXPIRY_JOB_INTERVAL_SECONDS must be at least 60 seconds")
    if settings.trip_lifecycle_job_interval_seconds < 60:
        raise RuntimeError("TRIP_LIFECYCLE_JOB_INTERVAL_SECONDS must be at least 60 seconds")
    if settings.analytics_metrics_window_days < 1:
        raise RuntimeError("ANALYTICS_METRICS_WINDOW_DAYS must be at least 1")
    if settings.ai_request_timeout_seconds <= 0:
        raise RuntimeError("AI_REQUEST_TIMEOUT_SECONDS must be greater than 0")
    if settings.fcm_request_timeout_seconds <= 0:
        raise RuntimeError("FCM_REQUEST_TIMEOUT_SECONDS must be greater than 0")
    if settings.websocket_presence_ttl_seconds < 30:
        raise RuntimeError("WEBSOCKET_PRESENCE_TTL_SECONDS must be at least 30 seconds")
    if settings.websocket_presence_heartbeat_seconds <= 0:
        raise RuntimeError("WEBSOCKET_PRESENCE_HEARTBEAT_SECONDS must be greater than 0")
    if settings.websocket_presence_heartbeat_seconds >= settings.websocket_presence_ttl_seconds:
        raise RuntimeError("WEBSOCKET_PRESENCE_HEARTBEAT_SECONDS must be less than WEBSOCKET_PRESENCE_TTL_SECONDS")
    if settings.ai_max_output_tokens < 128:
        raise RuntimeError("AI_MAX_OUTPUT_TOKENS must be at least 128")
    if settings.ai_prompt_max_chars < 1000:
        raise RuntimeError("AI_PROMPT_MAX_CHARS must be at least 1000")
    if settings.media_max_image_bytes <= 0:
        raise RuntimeError("MEDIA_MAX_IMAGE_BYTES must be greater than 0")
    if settings.media_max_video_bytes <= 0:
        raise RuntimeError("MEDIA_MAX_VIDEO_BYTES must be greater than 0")
    if settings.media_max_video_duration_seconds <= 0:
        raise RuntimeError("MEDIA_MAX_VIDEO_DURATION_SECONDS must be greater than 0")
    if settings.s3_presign_expiry_seconds < 60:
        raise RuntimeError("S3_PRESIGN_EXPIRY_SECONDS must be at least 60 seconds")
    if settings.auth_access_token_minutes < 5:
        raise RuntimeError("AUTH_ACCESS_TOKEN_MINUTES must be at least 5")
    if settings.auth_refresh_token_days < 1:
        raise RuntimeError("AUTH_REFRESH_TOKEN_DAYS must be at least 1")
    if settings.auth_lockout_threshold < 1:
        raise RuntimeError("AUTH_LOCKOUT_THRESHOLD must be at least 1")
    if settings.auth_lockout_minutes < 1:
        raise RuntimeError("AUTH_LOCKOUT_MINUTES must be at least 1")
    if settings.otp_ttl_seconds < 60:
        raise RuntimeError("OTP_TTL_SECONDS must be at least 60")
    if settings.otp_max_attempts < 1:
        raise RuntimeError("OTP_MAX_ATTEMPTS must be at least 1")
    if settings.webhook_signature_tolerance_seconds < 60:
        raise RuntimeError("WEBHOOK_SIGNATURE_TOLERANCE_SECONDS must be at least 60")
    if settings.ai_job_max_attempts < 1:
        raise RuntimeError("AI_JOB_MAX_ATTEMPTS must be at least 1")
    if settings.ai_job_retry_base_seconds < 1:
        raise RuntimeError("AI_JOB_RETRY_BASE_SECONDS must be at least 1")
    if settings.maintenance_job_interval_seconds < 60:
        raise RuntimeError("MAINTENANCE_JOB_INTERVAL_SECONDS must be at least 60 seconds")
    if settings.media_orphan_grace_minutes < 5:
        raise RuntimeError("MEDIA_ORPHAN_GRACE_MINUTES must be at least 5")
    if settings.media_cleanup_batch_size < 1:
        raise RuntimeError("MEDIA_CLEANUP_BATCH_SIZE must be at least 1")
    if settings.trace_sample_rate < 0 or settings.trace_sample_rate > 1:
        raise RuntimeError("TRACE_SAMPLE_RATE must be between 0 and 1")

    _validate_optional_prefix("AWS_ACCESS_KEY_ID", settings.aws_access_key_id, ("AKIA", "ASIA"), min_length=16)
    if settings.aws_secret_access_key and len(settings.aws_secret_access_key) < 30:
        raise RuntimeError("AWS_SECRET_ACCESS_KEY has an invalid format")
    if settings.s3_media_bucket and not SAFE_BUCKET_NAME_PATTERN.match(settings.s3_media_bucket):
        raise RuntimeError("S3_MEDIA_BUCKET must be a valid S3 bucket name")
    if settings.cloudfront_media_domain and not _is_valid_host_or_url(settings.cloudfront_media_domain):
        raise RuntimeError("CLOUDFRONT_MEDIA_DOMAIN must be a valid hostname or URL")
    if settings.cloudfront_distribution_id and not re.match(r"^[A-Z0-9]{8,32}$", settings.cloudfront_distribution_id):
        raise RuntimeError("CLOUDFRONT_DISTRIBUTION_ID has an invalid format")
    if settings.cloudinary_cloud_name and not re.match(r"^[A-Za-z0-9_-]+$", settings.cloudinary_cloud_name):
        raise RuntimeError("CLOUDINARY_CLOUD_NAME has an invalid format")
    if settings.cloudinary_api_key and (len(settings.cloudinary_api_key) < 8 or not settings.cloudinary_api_key.isdigit()):
        raise RuntimeError("CLOUDINARY_API_KEY has an invalid format")
    if settings.cloudinary_api_secret and len(settings.cloudinary_api_secret) < 16:
        raise RuntimeError("CLOUDINARY_API_SECRET has an invalid format")
    _validate_optional_prefix("STRIPE_SECRET_KEY", settings.stripe_secret_key, ("sk_test_", "sk_live_"), min_length=20)
    _validate_optional_prefix("STRIPE_PUBLISHABLE_KEY", settings.stripe_publishable_key, ("pk_test_", "pk_live_"), min_length=20)
    _validate_optional_prefix("STRIPE_PREMIUM_PRICE_ID", settings.stripe_premium_price_id, ("price_",), min_length=10)
    _validate_optional_prefix("STRIPE_WEBHOOK_SECRET", settings.stripe_webhook_secret, ("whsec_",), min_length=20)
    _validate_optional_prefix("RAZORPAY_KEY_ID", settings.razorpay_key_id, ("rzp_test_", "rzp_live_"), min_length=14)
    if settings.razorpay_key_secret and len(settings.razorpay_key_secret) < 16:
        raise RuntimeError("RAZORPAY_KEY_SECRET has an invalid format")
    if settings.razorpay_webhook_secret and len(settings.razorpay_webhook_secret) < 16:
        raise RuntimeError("RAZORPAY_WEBHOOK_SECRET has an invalid format")
    _validate_optional_prefix("DUFFEL_ACCESS_TOKEN", settings.duffel_access_token, ("duffel_test_", "duffel_live_"), min_length=20)
    if not _is_valid_http_url(settings.duffel_api_base_url):
        raise RuntimeError("DUFFEL_API_BASE_URL must be a valid HTTP(S) URL")
    if settings.duffel_version not in {"v1", "v2", "v2.1"}:
        raise RuntimeError("DUFFEL_VERSION must be a supported Duffel API version")
    if settings.duffel_webhook_secret and len(settings.duffel_webhook_secret) < 16:
        raise RuntimeError("DUFFEL_WEBHOOK_SECRET has an invalid format")
    _validate_optional_prefix("SENDGRID_API_KEY", settings.sendgrid_api_key, ("SG.",), min_length=20)
    if settings.sendgrid_from_email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", settings.sendgrid_from_email):
        raise RuntimeError("SENDGRID_FROM_EMAIL must be a valid email address")
    if settings.msg91_auth_key and len(settings.msg91_auth_key) < 16:
        raise RuntimeError("MSG91_AUTH_KEY has an invalid format")
    if settings.msg91_template_id and len(settings.msg91_template_id) < 4:
        raise RuntimeError("MSG91_TEMPLATE_ID has an invalid format")
    if settings.msg91_sender_id and not re.match(r"^[A-Za-z0-9]{3,10}$", settings.msg91_sender_id):
        raise RuntimeError("MSG91_SENDER_ID has an invalid format")
    if settings.sentry_dsn and not _is_valid_http_url(settings.sentry_dsn):
        raise RuntimeError("SENTRY_DSN must be a valid HTTP(S) DSN")
    if settings.otel_exporter_otlp_endpoint and not _is_valid_http_url(settings.otel_exporter_otlp_endpoint):
        raise RuntimeError("OTEL_EXPORTER_OTLP_ENDPOINT must be a valid HTTP(S) URL")
    if settings.is_production:
        required_production_settings = {
            "AWS_ACCESS_KEY_ID": settings.aws_access_key_id,
            "AWS_SECRET_ACCESS_KEY": settings.aws_secret_access_key,
            "S3_MEDIA_BUCKET": settings.s3_media_bucket,
            "CLOUDFRONT_MEDIA_DOMAIN": settings.cloudfront_media_domain,
            "CLOUDINARY_CLOUD_NAME": settings.cloudinary_cloud_name,
            "CLOUDINARY_API_KEY": settings.cloudinary_api_key,
            "CLOUDINARY_API_SECRET": settings.cloudinary_api_secret,
            "STRIPE_SECRET_KEY": settings.stripe_secret_key,
            "STRIPE_PREMIUM_PRICE_ID": settings.stripe_premium_price_id,
            "STRIPE_WEBHOOK_SECRET": settings.stripe_webhook_secret,
            "STRIPE_BOOKING_SUCCESS_URL": settings.stripe_booking_success_url,
            "STRIPE_BOOKING_CANCEL_URL": settings.stripe_booking_cancel_url,
            "RAZORPAY_KEY_ID": settings.razorpay_key_id,
            "RAZORPAY_KEY_SECRET": settings.razorpay_key_secret,
            "RAZORPAY_WEBHOOK_SECRET": settings.razorpay_webhook_secret,
            "DUFFEL_ACCESS_TOKEN": settings.duffel_access_token,
            "DUFFEL_WEBHOOK_SECRET": settings.duffel_webhook_secret,
            "SENDGRID_API_KEY": settings.sendgrid_api_key,
            "SENDGRID_FROM_EMAIL": settings.sendgrid_from_email,
            "MSG91_AUTH_KEY": settings.msg91_auth_key,
            "MSG91_TEMPLATE_ID": settings.msg91_template_id,
            "SENTRY_DSN": settings.sentry_dsn,
            "OTEL_EXPORTER_OTLP_ENDPOINT": settings.otel_exporter_otlp_endpoint,
        }
        missing = [name for name, value in required_production_settings.items() if not value]
        if _placeholder_config_allowed():
            missing = []
        if missing:
            raise RuntimeError(f"Missing required production settings: {', '.join(missing)}")
        if settings.stripe_booking_success_url and not _is_valid_http_url(settings.stripe_booking_success_url):
            raise RuntimeError("STRIPE_BOOKING_SUCCESS_URL must be a valid HTTP(S) URL")
        if settings.stripe_booking_cancel_url and not _is_valid_http_url(settings.stripe_booking_cancel_url):
            raise RuntimeError("STRIPE_BOOKING_CANCEL_URL must be a valid HTTP(S) URL")
    if settings.is_production and not settings.cors_allowed_origins and not _placeholder_config_allowed():
        raise RuntimeError("CORS_ALLOWED_ORIGINS must be configured when APP_ENV=production")
    normalize_booking_provider(settings.booking_provider)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    primary_database_url = normalize_database_url(_read_required_env("DATABASE_URL"))
    fallback_database_url = _read_optional_env("DATABASE_URL_FALLBACK")
    if fallback_database_url is not None:
        fallback_database_url = normalize_database_url(fallback_database_url)
    cors_allowed_origins = tuple(
        origin.strip()
        for origin in _read_env_value("CORS_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    )
    media_allowed_domains = tuple(
        domain.strip().lower()
        for domain in _read_env_value("MEDIA_ALLOWED_DOMAINS", "").split(",")
        if domain.strip()
    )
    app_env = _read_env_value("APP_ENV", "development").strip().lower() or "development"
    settings = Settings(
        database_url=primary_database_url,
        database_url_fallback=fallback_database_url,
        database_fallback_enabled=_read_bool_env(
            "DATABASE_ENABLE_FALLBACK",
            default=app_env != "production",
        ),
        database_prefer_fallback=_read_bool_env("DATABASE_PREFER_FALLBACK", default=False),
        jwt_secret=_read_required_env("JWT_SECRET"),
        jwt_algorithm=_read_required_env("JWT_ALGORITHM"),
        redis_url=_read_required_env("REDIS_URL"),
        aws_access_key_id=_read_optional_env("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=_read_optional_env("AWS_SECRET_ACCESS_KEY"),
        openai_api_key=_read_required_env("OPENAI_API_KEY"),
        cors_allowed_origins=cors_allowed_origins,
        model_name=_read_env_value("MODEL_NAME", "gpt-4.1-mini").strip() or "gpt-4.1-mini",
        ai_cache_ttl_seconds=_read_int_env("AI_CACHE_TTL_SECONDS", 3600),
        ai_request_timeout_seconds=_read_float_env("AI_REQUEST_TIMEOUT_SECONDS", 2.2),
        ai_max_output_tokens=_read_int_env("AI_MAX_OUTPUT_TOKENS", 800),
        ai_prompt_max_chars=_read_int_env("AI_PROMPT_MAX_CHARS", 6000),
        social_cache_ttl_seconds=_read_int_env("SOCIAL_CACHE_TTL_SECONDS", 120),
        trip_idempotency_ttl_seconds=_read_int_env("TRIP_IDEMPOTENCY_TTL_SECONDS", 24 * 60 * 60),
        websocket_presence_ttl_seconds=_read_int_env("WEBSOCKET_PRESENCE_TTL_SECONDS", 120),
        websocket_presence_heartbeat_seconds=_read_int_env("WEBSOCKET_PRESENCE_HEARTBEAT_SECONDS", 30),
        free_daily_match_limit=_read_int_env("FREE_DAILY_MATCH_LIMIT", 5),
        free_daily_trip_join_limit=_read_int_env("FREE_DAILY_TRIP_JOIN_LIMIT", 3),
        free_daily_ai_limit=_read_int_env("FREE_DAILY_AI_LIMIT", 10),
        premium_people_ranking_boost=_read_int_env("PREMIUM_PEOPLE_RANKING_BOOST", 12),
        premium_trip_ranking_boost=_read_int_env("PREMIUM_TRIP_RANKING_BOOST", 12),
        profile_boost_hours=_read_int_env("PROFILE_BOOST_HOURS", 24),
        trip_boost_hours=_read_int_env("TRIP_BOOST_HOURS", 24),
        boost_cooldown_hours=_read_int_env("BOOST_COOLDOWN_HOURS", 24),
        profile_boost_ranking_boost=_read_int_env("PROFILE_BOOST_RANKING_BOOST", 20),
        trip_boost_ranking_boost=_read_int_env("TRIP_BOOST_RANKING_BOOST", 20),
        referral_reward_premium_days=_read_int_env("REFERRAL_REWARD_PREMIUM_DAYS", 7),
        subscription_expiry_job_interval_seconds=_read_int_env("SUBSCRIPTION_EXPIRY_JOB_INTERVAL_SECONDS", 3600),
        trip_lifecycle_job_interval_seconds=_read_int_env("TRIP_LIFECYCLE_JOB_INTERVAL_SECONDS", 3600),
        analytics_metrics_window_days=_read_int_env("ANALYTICS_METRICS_WINDOW_DAYS", 30),
        fcm_server_key=_read_optional_env("FCM_SERVER_KEY"),
        fcm_request_timeout_seconds=_read_float_env("FCM_REQUEST_TIMEOUT_SECONDS", 3.0),
        media_allowed_domains=media_allowed_domains,
        media_max_image_bytes=_read_int_env("MEDIA_MAX_IMAGE_BYTES", 15 * 1024 * 1024),
        media_max_video_bytes=_read_int_env("MEDIA_MAX_VIDEO_BYTES", 250 * 1024 * 1024),
        media_max_video_duration_seconds=_read_float_env("MEDIA_MAX_VIDEO_DURATION_SECONDS", 4 * 60 * 60),
        stripe_secret_key=_read_optional_env("STRIPE_SECRET_KEY"),
        stripe_publishable_key=_read_optional_env("STRIPE_PUBLISHABLE_KEY"),
        stripe_premium_price_id=_read_optional_env("STRIPE_PREMIUM_PRICE_ID"),
        stripe_webhook_secret=_read_optional_env("STRIPE_WEBHOOK_SECRET"),
        stripe_booking_success_url=_read_optional_env("STRIPE_BOOKING_SUCCESS_URL"),
        stripe_booking_cancel_url=_read_optional_env("STRIPE_BOOKING_CANCEL_URL"),
        razorpay_key_id=_read_optional_env("RAZORPAY_KEY_ID"),
        razorpay_key_secret=_read_optional_env("RAZORPAY_KEY_SECRET"),
        razorpay_webhook_secret=_read_optional_env("RAZORPAY_WEBHOOK_SECRET"),
        s3_media_bucket=_read_optional_env("S3_MEDIA_BUCKET", "AWS_S3_BUCKET"),
        s3_media_region=_read_env_value("S3_MEDIA_REGION", "ap-south-1", "AWS_REGION").strip(),
        s3_presign_expiry_seconds=_read_int_env("S3_PRESIGN_EXPIRY_SECONDS", 900),
        cloudfront_media_domain=_read_optional_env("CLOUDFRONT_MEDIA_DOMAIN", "CLOUDFRONT_DOMAIN"),
        cloudinary_cloud_name=_read_optional_env("CLOUDINARY_CLOUD_NAME"),
        cloudinary_api_key=_read_optional_env("CLOUDINARY_API_KEY"),
        cloudinary_api_secret=_read_optional_env("CLOUDINARY_API_SECRET"),
        media_upload_prefix=_read_env_value("MEDIA_UPLOAD_PREFIX", "uploads").strip().strip("/"),
        duffel_access_token=_read_optional_env("DUFFEL_ACCESS_TOKEN", "DUFFEL_API_KEY"),
        duffel_api_base_url=_read_env_value("DUFFEL_API_BASE_URL", "https://api.duffel.com").strip().rstrip("/"),
        duffel_version=_read_env_value("DUFFEL_VERSION", "v2").strip(),
        duffel_webhook_secret=_read_optional_env("DUFFEL_WEBHOOK_SECRET"),
        sendgrid_api_key=_read_optional_env("SENDGRID_API_KEY"),
        sendgrid_from_email=_read_optional_env("SENDGRID_FROM_EMAIL", "EMAIL_FROM"),
        msg91_auth_key=_read_optional_env("MSG91_AUTH_KEY"),
        msg91_template_id=_read_optional_env("MSG91_TEMPLATE_ID"),
        msg91_sender_id=_read_optional_env("MSG91_SENDER_ID"),
        otp_ttl_seconds=_read_int_env("OTP_TTL_SECONDS", 300),
        otp_max_attempts=_read_int_env("OTP_MAX_ATTEMPTS", 5),
        auth_access_token_minutes=_read_int_env("AUTH_ACCESS_TOKEN_MINUTES", 30, "ACCESS_TOKEN_EXPIRE_MINUTES"),
        auth_refresh_token_days=_read_int_env("AUTH_REFRESH_TOKEN_DAYS", 30, "REFRESH_TOKEN_EXPIRE_DAYS"),
        webhook_signature_tolerance_seconds=_read_int_env("WEBHOOK_SIGNATURE_TOLERANCE_SECONDS", 300),
        redis_stream_chat_events=_read_env_value("REDIS_STREAM_CHAT_EVENTS", "aventaro:chat:events").strip(),
        redis_stream_chat_group=_read_env_value("REDIS_STREAM_CHAT_GROUP", "aventaro-chat-delivery").strip(),
        ai_job_poll_timeout_seconds=_read_float_env("AI_JOB_POLL_TIMEOUT_SECONDS", 18.0),
        ai_job_ttl_seconds=_read_int_env("AI_JOB_TTL_SECONDS", 24 * 60 * 60),
        ai_job_max_attempts=_read_int_env("AI_JOB_MAX_ATTEMPTS", 3),
        ai_job_retry_base_seconds=_read_int_env("AI_JOB_RETRY_BASE_SECONDS", 30),
        maintenance_job_interval_seconds=_read_int_env("MAINTENANCE_JOB_INTERVAL_SECONDS", 300),
        media_orphan_grace_minutes=_read_int_env("MEDIA_ORPHAN_GRACE_MINUTES", 60),
        media_cleanup_batch_size=_read_int_env("MEDIA_CLEANUP_BATCH_SIZE", 100),
        cloudfront_distribution_id=_read_optional_env("CLOUDFRONT_DISTRIBUTION_ID"),
        sentry_dsn=_read_optional_env("SENTRY_DSN"),
        otel_service_name=_read_env_value("OTEL_SERVICE_NAME", "aventaro-api").strip(),
        otel_exporter_otlp_endpoint=_read_optional_env("OTEL_EXPORTER_OTLP_ENDPOINT"),
        trace_sample_rate=_read_float_env("TRACE_SAMPLE_RATE", 0.2),
        booking_provider=normalize_booking_provider(_read_env_value("BOOKING_PROVIDER", "duffel")),
        app_env=app_env,
        run_embedded_workers=_read_bool_env("RUN_EMBEDDED_WORKERS", default=app_env != "production"),
    )
    validate_settings(settings)
    return settings
