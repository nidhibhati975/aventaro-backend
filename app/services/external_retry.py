from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

import httpx


RETRYABLE_HTTP_STATUS_CODES = {408, 429, 500, 502, 503, 504}
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_BASE_DELAY_SECONDS = 0.25

T = TypeVar("T")


def _delay_seconds(attempt: int, base_delay_seconds: float = DEFAULT_BASE_DELAY_SECONDS) -> float:
    return min(base_delay_seconds * (2 ** max(0, attempt - 1)), 2.0)


def is_retryable_http_status(status_code: int) -> bool:
    return status_code in RETRYABLE_HTTP_STATUS_CODES


async def async_http_request_with_retries(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    **kwargs,
) -> httpx.Response:
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = await client.request(method, url, **kwargs)
            if is_retryable_http_status(response.status_code) and attempt < max_attempts:
                await asyncio.sleep(_delay_seconds(attempt))
                continue
            return response
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_exc = exc
            if attempt >= max_attempts:
                raise
            await asyncio.sleep(_delay_seconds(attempt))
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("HTTP retry loop exited without a response")


def http_request_with_retries(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    **kwargs,
) -> httpx.Response:
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = client.request(method, url, **kwargs)
            if is_retryable_http_status(response.status_code) and attempt < max_attempts:
                time.sleep(_delay_seconds(attempt))
                continue
            return response
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_exc = exc
            if attempt >= max_attempts:
                raise
            time.sleep(_delay_seconds(attempt))
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("HTTP retry loop exited without a response")


async def async_call_with_retries(
    call: Callable[[], Awaitable[T]],
    *,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
) -> T:
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return await call()
        except Exception as exc:
            last_exc = exc
            if attempt >= max_attempts:
                raise
            await asyncio.sleep(_delay_seconds(attempt))
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("Retry loop exited without a result")


def call_with_retries(
    call: Callable[[], T],
    *,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
) -> T:
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return call()
        except Exception as exc:
            last_exc = exc
            if attempt >= max_attempts:
                raise
            time.sleep(_delay_seconds(attempt))
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("Retry loop exited without a result")
