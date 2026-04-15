from __future__ import annotations

import json
import time
from dataclasses import dataclass

from fastapi import HTTPException, status
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError

from app.services.redis_runtime import build_cache_key, get_redis_client
from app.utils.config import get_settings


PROCESSING_STATE = "processing"
COMPLETED_STATE = "completed"
WAIT_POLL_SECONDS = 0.1
WAIT_POLL_ATTEMPTS = 50


@dataclass(frozen=True)
class IdempotencyClaim:
    redis_key: str


def _storage_key(scope: str, user_id: int, request_key: str) -> str:
    return build_cache_key(f"idempotency:{scope}", user_id=user_id, request_key=request_key)


def _read_record(redis_key: str) -> dict[str, object] | None:
    payload = get_redis_client().get(redis_key)
    if payload is None:
        return None
    return json.loads(payload)


def _response_from_record(record: dict[str, object]) -> JSONResponse:
    return JSONResponse(
        status_code=int(record["status_code"]),
        content=record["payload"],
    )


def claim_idempotency(scope: str, user_id: int, request_key: str | None) -> IdempotencyClaim | JSONResponse | None:
    if request_key is None or not request_key.strip():
        return None

    ttl_seconds = get_settings().trip_idempotency_ttl_seconds
    normalized_key = request_key.strip()
    redis_key = _storage_key(scope, user_id, normalized_key)
    client = get_redis_client()

    try:
        record = _read_record(redis_key)
        if record and record.get("state") == COMPLETED_STATE:
            return _response_from_record(record)

        reserved = client.set(
            redis_key,
            json.dumps({"state": PROCESSING_STATE}, separators=(",", ":")),
            nx=True,
            ex=ttl_seconds,
        )
        if reserved:
            return IdempotencyClaim(redis_key=redis_key)

        for _ in range(WAIT_POLL_ATTEMPTS):
            time.sleep(WAIT_POLL_SECONDS)
            record = _read_record(redis_key)
            if record and record.get("state") == COMPLETED_STATE:
                return _response_from_record(record)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A request with this Idempotency-Key is already in progress",
        )
    except RedisError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Idempotency storage is temporarily unavailable",
        ) from exc


def store_idempotent_response(claim: IdempotencyClaim | None, *, status_code: int, payload: object) -> None:
    if claim is None:
        return
    ttl_seconds = get_settings().trip_idempotency_ttl_seconds
    try:
        get_redis_client().set(
            claim.redis_key,
            json.dumps(
                {
                    "state": COMPLETED_STATE,
                    "status_code": status_code,
                    "payload": payload,
                },
                separators=(",", ":"),
                default=str,
            ),
            ex=ttl_seconds,
        )
    except RedisError:
        return


def clear_idempotency_claim(claim: IdempotencyClaim | None) -> None:
    if claim is None:
        return
    try:
        get_redis_client().delete(claim.redis_key)
    except RedisError:
        return
