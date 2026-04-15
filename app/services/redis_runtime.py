from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from typing import Any

from redis import Redis
from redis.exceptions import RedisError

from app.utils.config import get_settings


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
    def __init__(self, client: Redis) -> None:
        self._client = client

    def get_json(self, key: str) -> Any | None:
        try:
            payload = self._client.get(key)
        except RedisError:
            return None
        if payload is None:
            return None
        return json.loads(payload)

    def set_json(self, key: str, value: Any, ttl_seconds: int) -> None:
        try:
            self._client.setex(key, ttl_seconds, json.dumps(value, default=str, separators=(",", ":")))
        except RedisError:
            return

    def delete_pattern(self, pattern: str) -> None:
        try:
            keys = list(self._client.scan_iter(match=pattern))
            if keys:
                self._client.delete(*keys)
        except RedisError:
            return


@lru_cache(maxsize=1)
def get_cache() -> RedisCache:
    return RedisCache(get_redis_client())


def build_cache_key(namespace: str, **values: object) -> str:
    normalized = json.dumps(values, sort_keys=True, default=str, separators=(",", ":"))
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"{namespace}:{digest}"


def invalidate_discover_cache() -> None:
    get_cache().delete_pattern("discover:*")


def invalidate_match_suggestions_cache(user_id: int | None = None) -> None:
    if user_id is None:
        get_cache().delete_pattern("match:suggestions:*")
        return
    get_cache().delete_pattern(f"match:suggestions:user:{user_id}:*")


def invalidate_social_cache() -> None:
    get_cache().delete_pattern("social:*")
