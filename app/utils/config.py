from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    database_url: str
    jwt_secret: str
    jwt_algorithm: str
    redis_url: str
    openai_api_key: str
    model_name: str = "gpt-4.1-mini"
    ai_cache_ttl_seconds: int = 3600
    ai_request_timeout_seconds: float = 2.2
    ai_max_output_tokens: int = 800
    ai_prompt_max_chars: int = 6000
    social_cache_ttl_seconds: int = 120
    trip_idempotency_ttl_seconds: int = 24 * 60 * 60
    websocket_pubsub_channel: str = "aventaro:websocket:events"
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
    app_env: str = "development"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


def _read_required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value.strip()


def _read_optional_env(name: str) -> str | None:
    value = os.getenv(name)
    if value is None or not value.strip():
        return None
    return value.strip()


def validate_settings(settings: Settings) -> None:
    if not settings.database_url.startswith("postgresql"):
        raise RuntimeError("DATABASE_URL must use a PostgreSQL driver")
    parsed_database_url = urlparse(settings.database_url)
    if not parsed_database_url.hostname:
        raise RuntimeError("DATABASE_URL must include a valid host")
    if not settings.jwt_algorithm:
        raise RuntimeError("JWT_ALGORITHM must be configured")
    if not settings.redis_url.startswith(("redis://", "rediss://")):
        raise RuntimeError("REDIS_URL must use the redis:// or rediss:// scheme")
    parsed_redis_url = urlparse(settings.redis_url)
    if not parsed_redis_url.hostname:
        raise RuntimeError("REDIS_URL must include a valid host")
    if not settings.jwt_secret.strip():
        raise RuntimeError("JWT_SECRET must be configured")
    if not settings.openai_api_key.startswith("sk-"):
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
    if not settings.websocket_pubsub_channel.strip():
        raise RuntimeError("WEBSOCKET_PUBSUB_CHANNEL must be configured")
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

    if settings.stripe_secret_key and not settings.stripe_secret_key.startswith("sk_"):
        raise RuntimeError("STRIPE_SECRET_KEY must be a valid Stripe secret key")
    if settings.stripe_publishable_key and not settings.stripe_publishable_key.startswith("pk_"):
        raise RuntimeError("STRIPE_PUBLISHABLE_KEY must be a valid Stripe publishable key")
    if settings.stripe_premium_price_id and not settings.stripe_premium_price_id.startswith("price_"):
        raise RuntimeError("STRIPE_PREMIUM_PRICE_ID must be a valid Stripe price ID")
    if settings.stripe_webhook_secret and not settings.stripe_webhook_secret.startswith("whsec_"):
        raise RuntimeError("STRIPE_WEBHOOK_SECRET must be a valid Stripe webhook secret")
    if settings.is_production and not settings.stripe_webhook_secret:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET is required when APP_ENV=production")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    media_allowed_domains = tuple(
        domain.strip().lower()
        for domain in (os.getenv("MEDIA_ALLOWED_DOMAINS", "") or "").split(",")
        if domain.strip()
    )
    settings = Settings(
        database_url=_read_required_env("DATABASE_URL"),
        jwt_secret=_read_required_env("JWT_SECRET"),
        jwt_algorithm=_read_required_env("JWT_ALGORITHM"),
        redis_url=_read_required_env("REDIS_URL"),
        openai_api_key=_read_required_env("OPENAI_API_KEY"),
        model_name=(os.getenv("MODEL_NAME", "gpt-4.1-mini") or "gpt-4.1-mini").strip() or "gpt-4.1-mini",
        ai_cache_ttl_seconds=int((os.getenv("AI_CACHE_TTL_SECONDS", "3600") or "3600").strip()),
        ai_request_timeout_seconds=float((os.getenv("AI_REQUEST_TIMEOUT_SECONDS", "2.2") or "2.2").strip()),
        ai_max_output_tokens=int((os.getenv("AI_MAX_OUTPUT_TOKENS", "800") or "800").strip()),
        ai_prompt_max_chars=int((os.getenv("AI_PROMPT_MAX_CHARS", "6000") or "6000").strip()),
        social_cache_ttl_seconds=int((os.getenv("SOCIAL_CACHE_TTL_SECONDS", "120") or "120").strip()),
        trip_idempotency_ttl_seconds=int((os.getenv("TRIP_IDEMPOTENCY_TTL_SECONDS", str(24 * 60 * 60)) or str(24 * 60 * 60)).strip()),
        websocket_pubsub_channel=(os.getenv("WEBSOCKET_PUBSUB_CHANNEL", "aventaro:websocket:events") or "aventaro:websocket:events").strip(),
        websocket_presence_ttl_seconds=int((os.getenv("WEBSOCKET_PRESENCE_TTL_SECONDS", "120") or "120").strip()),
        websocket_presence_heartbeat_seconds=int((os.getenv("WEBSOCKET_PRESENCE_HEARTBEAT_SECONDS", "30") or "30").strip()),
        free_daily_match_limit=int((os.getenv("FREE_DAILY_MATCH_LIMIT", "5") or "5").strip()),
        free_daily_trip_join_limit=int((os.getenv("FREE_DAILY_TRIP_JOIN_LIMIT", "3") or "3").strip()),
        free_daily_ai_limit=int((os.getenv("FREE_DAILY_AI_LIMIT", "10") or "10").strip()),
        premium_people_ranking_boost=int((os.getenv("PREMIUM_PEOPLE_RANKING_BOOST", "12") or "12").strip()),
        premium_trip_ranking_boost=int((os.getenv("PREMIUM_TRIP_RANKING_BOOST", "12") or "12").strip()),
        profile_boost_hours=int((os.getenv("PROFILE_BOOST_HOURS", "24") or "24").strip()),
        trip_boost_hours=int((os.getenv("TRIP_BOOST_HOURS", "24") or "24").strip()),
        boost_cooldown_hours=int((os.getenv("BOOST_COOLDOWN_HOURS", "24") or "24").strip()),
        profile_boost_ranking_boost=int((os.getenv("PROFILE_BOOST_RANKING_BOOST", "20") or "20").strip()),
        trip_boost_ranking_boost=int((os.getenv("TRIP_BOOST_RANKING_BOOST", "20") or "20").strip()),
        referral_reward_premium_days=int((os.getenv("REFERRAL_REWARD_PREMIUM_DAYS", "7") or "7").strip()),
        subscription_expiry_job_interval_seconds=int((os.getenv("SUBSCRIPTION_EXPIRY_JOB_INTERVAL_SECONDS", "3600") or "3600").strip()),
        analytics_metrics_window_days=int((os.getenv("ANALYTICS_METRICS_WINDOW_DAYS", "30") or "30").strip()),
        fcm_server_key=_read_optional_env("FCM_SERVER_KEY"),
        fcm_request_timeout_seconds=float((os.getenv("FCM_REQUEST_TIMEOUT_SECONDS", "3.0") or "3.0").strip()),
        media_allowed_domains=media_allowed_domains,
        media_max_image_bytes=int((os.getenv("MEDIA_MAX_IMAGE_BYTES", str(15 * 1024 * 1024)) or str(15 * 1024 * 1024)).strip()),
        media_max_video_bytes=int((os.getenv("MEDIA_MAX_VIDEO_BYTES", str(250 * 1024 * 1024)) or str(250 * 1024 * 1024)).strip()),
        media_max_video_duration_seconds=float((os.getenv("MEDIA_MAX_VIDEO_DURATION_SECONDS", str(4 * 60 * 60)) or str(4 * 60 * 60)).strip()),
        stripe_secret_key=_read_optional_env("STRIPE_SECRET_KEY"),
        stripe_publishable_key=_read_optional_env("STRIPE_PUBLISHABLE_KEY"),
        stripe_premium_price_id=_read_optional_env("STRIPE_PREMIUM_PRICE_ID"),
        stripe_webhook_secret=_read_optional_env("STRIPE_WEBHOOK_SECRET"),
        app_env=(os.getenv("APP_ENV", "development") or "development").strip().lower() or "development",
    )
    validate_settings(settings)
    return settings
