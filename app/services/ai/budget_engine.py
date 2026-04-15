from __future__ import annotations

import json
import logging

from pydantic import BaseModel, Field, ValidationError

from app.services.ai.openai_client import generate_response_sync
from app.services.redis_runtime import build_cache_key, get_cache
from app.utils.config import get_settings


logger = logging.getLogger("aventaro.ai")


class BudgetOptimizeRequest(BaseModel):
    budget: float = Field(gt=0, le=1_000_000)
    travelers: int = Field(ge=1, le=20)
    destination: str = Field(min_length=2, max_length=120)
    preferences: list[str] = Field(default_factory=list, max_length=10)


class BudgetOptimizeResponse(BaseModel):
    cost_split: float = Field(ge=0)
    optimized_plan: list[str]
    savings_tips: list[str]
    cheaper_alternatives: list[str]


def _fallback_budget_plan(payload: BudgetOptimizeRequest) -> BudgetOptimizeResponse:
    cost_split = round(payload.budget / payload.travelers, 2)
    nightly_target = round((payload.budget * 0.35) / max(payload.travelers, 1), 2)
    transport_target = round(payload.budget * 0.2, 2)
    food_target = round(payload.budget * 0.25, 2)
    return BudgetOptimizeResponse(
        cost_split=cost_split,
        optimized_plan=[
            f"Keep shared lodging near {payload.destination} transit lines at about {nightly_target} per traveler total",
            f"Cap all local and intercity transport at about {transport_target} total",
            f"Reserve about {food_target} total for meals and use one higher-spend meal per day at most",
        ],
        savings_tips=[
            "Book flights or long-distance transport outside peak evening slots",
            "Prioritize stays with breakfast or kitchen access",
            "Cluster attractions by area to reduce same-day transport costs",
        ],
        cheaper_alternatives=[
            f"Compare neighborhoods just outside the center of {payload.destination}",
            f"Use shared airport transfers in {payload.destination}",
            "Swap one paid activity for a free walking route or public beach/park day",
        ],
    )


def optimize_budget(
    payload: BudgetOptimizeRequest,
    request_context: dict[str, object] | None = None,
) -> BudgetOptimizeResponse:
    settings = get_settings()
    cache_key = build_cache_key("ai:budget", payload=payload.model_dump(mode="json"))
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        logger.info(
            "ai_cache_hit",
            extra={
                "event_type": "ai_cache_hit",
                "request_id": (request_context or {}).get("request_id"),
                "user_id": (request_context or {}).get("user_id"),
                "endpoint": (request_context or {}).get("endpoint"),
                "ai_operation": "budget_optimize",
                "model": settings.model_name,
                "cache_hit": True,
                "fallback_used": False,
            },
        )
        return BudgetOptimizeResponse.model_validate(cached)

    deterministic_cost_split = round(payload.budget / payload.travelers, 2)
    fallback = _fallback_budget_plan(payload)
    system_prompt = (
        "You are a travel budget optimizer. Return valid JSON only with this exact shape: "
        "cost_split, optimized_plan, savings_tips, cheaper_alternatives. "
        "Keep suggestions practical, specific, and cost-conscious."
    )
    prompt = json.dumps(
        {
            "task": "Optimize a shared travel budget",
            "input": payload.model_dump(mode="json"),
            "deterministic_rules": {
                "cost_split": deterministic_cost_split,
                "focus": [
                    "reduce lodging cost",
                    "reduce transport cost",
                    "suggest cheaper neighborhood, hotel, or nearby city alternatives",
                ],
            },
        },
        separators=(",", ":"),
    )
    response = generate_response_sync(
        prompt,
        system_prompt,
        0.3,
        fallback_payload=fallback.model_dump(mode="json"),
        request_context={**(request_context or {}), "ai_operation": "budget_optimize"},
    )
    try:
        parsed = BudgetOptimizeResponse.model_validate_json(response.content)
    except ValidationError:
        parsed = fallback

    parsed.cost_split = deterministic_cost_split
    get_cache().set_json(cache_key, parsed.model_dump(mode="json"), ttl_seconds=settings.ai_cache_ttl_seconds)
    return parsed
