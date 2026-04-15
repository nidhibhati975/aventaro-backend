from __future__ import annotations

from collections.abc import Callable

from fastapi import HTTPException, Request, status
from redis.exceptions import RedisError

from app.services.redis_runtime import get_redis_client


class RateLimiter:
    def __init__(self) -> None:
        self._redis = get_redis_client()

    def hit(self, key: str, limit: int, window_seconds: int) -> None:
        try:
            current = self._redis.incr(key)
            if current == 1:
                self._redis.expire(key, window_seconds)
            if current > limit:
                retry_after = max(int(self._redis.ttl(key)), 1)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Rate limit exceeded",
                    headers={"Retry-After": str(retry_after)},
                )
        except RedisError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Rate limiting is temporarily unavailable",
            ) from exc


rate_limiter = RateLimiter()


def get_request_identity(request: Request) -> str:
    payload = getattr(request.state, "auth_payload", None)
    if isinstance(payload, dict) and payload.get("sub"):
        return f"user:{payload['sub']}"

    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        first_hop = forwarded_for.split(",", maxsplit=1)[0].strip()
        if first_hop:
            return f"ip:{first_hop}"

    client_host = request.client.host if request.client else "unknown"
    return f"ip:{client_host}"


def rate_limit(scope: str, limit: int, window_seconds: int) -> Callable[[Request], None]:
    def dependency(request: Request) -> None:
        identity = get_request_identity(request)
        key = f"rate_limit:{scope}:{identity}"
        rate_limiter.hit(key=key, limit=limit, window_seconds=window_seconds)

    return dependency
