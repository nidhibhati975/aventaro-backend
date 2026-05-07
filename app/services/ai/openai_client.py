from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from functools import partial
from typing import Any

import anyio
import httpx
from anyio import from_thread

from app.utils.config import get_settings


logger = logging.getLogger("aventaro.ai")
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"


@dataclass(frozen=True)
class OpenAIResponse:
    content: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    fallback_used: bool = False


def _safe_json_content(fallback_payload: dict[str, Any] | None) -> str:
    if fallback_payload is not None:
        return json.dumps(fallback_payload, separators=(",", ":"), default=str)
    return json.dumps(
        {"message": "The AI assistant is temporarily unavailable. Please try again shortly."},
        separators=(",", ":"),
    )


def _truncate_text(value: str, max_chars: int) -> str:
    normalized = value.strip()
    if len(normalized) <= max_chars:
        return normalized
    return f"{normalized[: max_chars - 64].rstrip()}\n\n[truncated]"


def _extract_responses_text(response_payload: dict[str, Any]) -> str:
    direct = response_payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct
    parts: list[str] = []
    for item in response_payload.get("output") or []:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str):
                parts.append(text)
    if parts:
        return "".join(parts)
    raise ValueError("OpenAI response did not include output text")


def _log_usage(
    *,
    request_context: dict[str, Any] | None,
    duration_ms: float,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    fallback_used: bool,
) -> None:
    context = request_context or {}
    usage_collector = context.get("usage_collector")
    if isinstance(usage_collector, dict):
        usage_collector["model"] = model
        usage_collector["prompt_tokens"] = int(usage_collector.get("prompt_tokens") or 0) + prompt_tokens
        usage_collector["completion_tokens"] = int(usage_collector.get("completion_tokens") or 0) + completion_tokens
        usage_collector["total_tokens"] = int(usage_collector.get("total_tokens") or 0) + total_tokens
        usage_collector["fallback_used"] = bool(usage_collector.get("fallback_used")) or fallback_used
    logger.info(
        "ai_usage",
        extra={
            "event_type": "ai_usage",
            "request_id": context.get("request_id"),
            "user_id": context.get("user_id"),
            "endpoint": context.get("endpoint"),
            "ai_operation": context.get("ai_operation"),
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "cache_hit": False,
            "fallback_used": fallback_used,
            "duration_ms": round(duration_ms, 2),
        },
    )


async def generate_response(
    prompt: str,
    system_prompt: str,
    temperature: float,
    *,
    response_format: dict[str, Any] | None = None,
    max_output_tokens: int | None = None,
    fallback_payload: dict[str, Any] | None = None,
    request_context: dict[str, Any] | None = None,
) -> OpenAIResponse:
    settings = get_settings()
    prompt = _truncate_text(prompt, settings.ai_prompt_max_chars)
    system_prompt = _truncate_text(system_prompt, min(settings.ai_prompt_max_chars, 2500))
    request_started_at = time.perf_counter()
    timeout = httpx.Timeout(settings.ai_request_timeout_seconds, connect=1.0)
    text_format = response_format or {"type": "json_object"}
    payload = {
        "model": settings.model_name,
        "instructions": system_prompt,
        "input": prompt,
        "temperature": temperature,
        "max_output_tokens": max_output_tokens or settings.ai_max_output_tokens,
        "text": {"format": text_format},
    }
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }

    for attempt in range(1, 3):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(OPENAI_RESPONSES_URL, headers=headers, json=payload)
            if response.status_code in {500, 502, 503, 504} and attempt < 2:
                await asyncio.sleep(0.2 * attempt)
                continue
            response.raise_for_status()

            response_payload = response.json()
            content = _extract_responses_text(response_payload)
            usage = response_payload.get("usage") or {}
            result = OpenAIResponse(
                content=content,
                model=response_payload.get("model", settings.model_name),
                prompt_tokens=int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("output_tokens") or usage.get("completion_tokens") or 0),
                total_tokens=int(usage.get("total_tokens") or 0),
            )
            _log_usage(
                request_context=request_context,
                duration_ms=(time.perf_counter() - request_started_at) * 1000,
                model=result.model,
                prompt_tokens=result.prompt_tokens,
                completion_tokens=result.completion_tokens,
                total_tokens=result.total_tokens,
                fallback_used=False,
            )
            return result
        except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError, KeyError, ValueError) as exc:
            should_retry = False
            if isinstance(exc, httpx.HTTPStatusError):
                status_code = exc.response.status_code
                should_retry = status_code in {500, 502, 503, 504}
            elif isinstance(exc, (httpx.TimeoutException, httpx.TransportError)):
                should_retry = True
            if should_retry and attempt < 2:
                continue
            logger.warning(
                "ai_request_failed",
                extra={
                    "event_type": "ai_request_failed",
                    "request_id": (request_context or {}).get("request_id"),
                    "user_id": (request_context or {}).get("user_id"),
                    "endpoint": (request_context or {}).get("endpoint"),
                    "ai_operation": (request_context or {}).get("ai_operation"),
                    "model": settings.model_name,
                    "fallback_used": True,
                },
                exc_info=True,
            )
            break

    fallback = OpenAIResponse(
        content=_safe_json_content(fallback_payload),
        model=settings.model_name,
        fallback_used=True,
    )
    _log_usage(
        request_context=request_context,
        duration_ms=(time.perf_counter() - request_started_at) * 1000,
        model=fallback.model,
        prompt_tokens=0,
        completion_tokens=0,
        total_tokens=0,
        fallback_used=True,
    )
    return fallback


def generate_response_sync(
    prompt: str,
    system_prompt: str,
    temperature: float,
    *,
    response_format: dict[str, Any] | None = None,
    max_output_tokens: int | None = None,
    fallback_payload: dict[str, Any] | None = None,
    request_context: dict[str, Any] | None = None,
) -> OpenAIResponse:
    call = partial(
        generate_response,
        prompt,
        system_prompt,
        temperature,
        response_format=response_format,
        max_output_tokens=max_output_tokens,
        fallback_payload=fallback_payload,
        request_context=request_context,
    )
    try:
        return from_thread.run(call)
    except RuntimeError:
        return anyio.run(call)
