from __future__ import annotations

import hashlib
import json
import logging
from functools import lru_cache
from typing import Any

from redis import Redis
from redis.exceptions import RedisError

from app.utils.config import get_settings


logger = logging.getLogger("aventaro.cache")

# Cache TTL constants (in seconds)
MATCH_CACHE_TTL = 300        # 5 minutes
DISCOVER_CACHE_TTL = 120     # 2 minutes
PROFILE_CACHE_TTL = 600      # 10 minutes

# Cache key prefixes
CACHE_KEY_MATCH = "match"
CACHE_KEY_DISCOVER = "discover"
CACHE_KEY_PROFILE = "profile"


@lru_cache(maxsize=1)
def get_redis_client() -> Redis:
    settings = get_settings()
    return Redis.from_url(settings.redis_url, decode_responses=True)


def ping_redis() -> None:
    try:
        if not get_redis_client().ping():
            raise RuntimeError("Redis healthcheck failed")
    except RedisError as exc:
        raise RuntimeError("Redis is not reachable") from exc


class RedisCache:
    """Redis cache with fallback on failure."""
    
    def __init__(self, client: Redis) -> None:
        self._client = client
        self._fallback_mode = False

    def get_json(self, key: str) -> Any | None:
        try:
            payload = self._client.get(key)
        except RedisError as e:
            logger.warning("cache_get_failed", extra={"key": key, "error": str(e)})
            return None
        if payload is None:
            return None
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return None

    def set_json(self, key: str, value: Any, ttl_seconds: int) -> bool:
        try:
            self._client.setex(key, ttl_seconds, json.dumps(value, default=str, separators=(",", ":")))
            return True
        except RedisError as e:
            logger.warning("cache_set_failed", extra={"key": key, "error": str(e)})
            return False

    def delete(self, key: str) -> bool:
        try:
            return bool(self._client.delete(key))
        except RedisError as e:
            logger.warning("cache_delete_failed", extra={"key": key, "error": str(e)})
            return False

    def delete_pattern(self, pattern: str) -> int:
        try:
            keys = list(self._client.scan_iter(match=pattern))
            if keys:
                return self._client.delete(*keys)
            return 0
        except RedisError as e:
            logger.warning("cache_delete_pattern_failed", extra={"pattern": pattern, "error": str(e)})
            return 0


@lru_cache(maxsize=1)
def get_cache() -> RedisCache:
    return RedisCache(get_redis_client())


def build_cache_key(namespace: str, **values: object) -> str:
    """Build a cache key with hash of parameters."""
    normalized = json.dumps(values, sort_keys=True, default=str, separators=(",", ":"))
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    return f"{namespace}:{digest}"


def build_match_cache_key(user_id: int, limit: int = 10) -> str:
    """Build cache key for match suggestions."""
    return f"match:user:{user_id}:limit:{limit}"


def build_discover_cache_key(user_id: int, filters: dict[str, Any]) -> str:
    """Build cache key for discover feed."""
    return build_cache_key(f"discover:user:{user_id}", **filters)


def build_profile_cache_key(user_id: int) -> str:
    """Build cache key for user profile."""
    return f"profile:user:{user_id}"


# Cache retrieval with fallback
def get_match_suggestions(user_id: int, limit: int = 10) -> Any | None:
    """Get cached match suggestions. Returns None if not cached or on error."""
    key = build_match_cache_key(user_id, limit)
    return get_cache().get_json(key)


def set_match_suggestions(user_id: int, data: Any, limit: int = 10) -> bool:
    """Cache match suggestions with TTL."""
    key = build_match_cache_key(user_id, limit)
    return get_cache().set_json(key, data, MATCH_CACHE_TTL)


def get_discover_feed(user_id: int, filters: dict[str, Any]) -> Any | None:
    """Get cached discover feed. Returns None if not cached or on error."""
    key = build_discover_cache_key(user_id, filters)
    return get_cache().get_json(key)


def set_discover_feed(user_id: int, filters: dict[str, Any], data: Any) -> bool:
    """Cache discover feed with TTL."""
    key = build_discover_cache_key(user_id, filters)
    return get_cache().set_json(key, data, DISCOVER_CACHE_TTL)


def get_user_profile(user_id: int) -> Any | None:
    """Get cached user profile. Returns None if not cached or on error."""
    key = build_profile_cache_key(user_id)
    return get_cache().get_json(key)


def set_user_profile(user_id: int, data: Any) -> bool:
    """Cache user profile with TTL."""
    key = build_profile_cache_key(user_id)
    return get_cache().set_json(key, data, PROFILE_CACHE_TTL)


# Invalidation functions
def invalidate_discover_cache(user_id: int | None = None) -> None:
    """Invalidate discover cache for user or all users."""
    if user_id is None:
        get_cache().delete_pattern("discover:*")
    else:
        get_cache().delete_pattern(f"discover:user:{user_id}:*")


def invalidate_match_suggestions_cache(user_id: int | None = None) -> None:
    """Invalidate match suggestions cache for user or all users."""
    if user_id is None:
        get_cache().delete_pattern("match:*")
    else:
        get_cache().delete_pattern(f"match:user:{user_id}:*")


def invalidate_user_profile_cache(user_id: int) -> None:
    """Invalidate user profile cache."""
    key = build_profile_cache_key(user_id)
    get_cache().delete(key)


def invalidate_social_cache() -> None:
    """Invalidate social-related cache."""
    get_cache().delete_pattern("social:*")


def invalidate_on_profile_update(user_id: int) -> None:
    """Invalidate all caches when user profile is updated."""
    invalidate_user_profile_cache(user_id)
    invalidate_match_suggestions_cache(user_id)


def invalidate_on_new_trip(user_id: int) -> None:
    """Invalidate discover cache when user creates new trip."""
    invalidate_discover_cache(user_id)


def invalidate_on_match_action(user_id: int) -> None:
    """Invalidate match cache when user takes match action."""
    invalidate_match_suggestions_cache(user_id)
