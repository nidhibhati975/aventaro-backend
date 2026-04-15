from __future__ import annotations

import json
import logging

from pydantic import BaseModel, Field, ValidationError

from app.models.user import User
from app.services.ai.openai_client import generate_response_sync
from app.services.redis_runtime import build_cache_key, get_cache
from app.utils.config import get_settings


logger = logging.getLogger("aventaro.ai")


class ProfileGenerationUserData(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    age: int | None = Field(default=None, ge=18, le=120)
    location: str | None = Field(default=None, max_length=120)
    destination: str | None = Field(default=None, max_length=120)
    travel_style: str | None = Field(default=None, max_length=64)
    interests: list[str] = Field(default_factory=list, max_length=12)
    budget_min: int | None = Field(default=None, ge=0)
    budget_max: int | None = Field(default=None, ge=0)
    bio_seed: str | None = Field(default=None, max_length=300)


class ProfileGenerateRequest(BaseModel):
    user_data: ProfileGenerationUserData


class ProfileGenerateResponse(BaseModel):
    bio: str = Field(min_length=1, max_length=320)
    tags: list[str]


def _fallback_profile_content(current_user: User, payload: ProfileGenerateRequest) -> ProfileGenerateResponse:
    profile = current_user.profile
    merged_name = payload.user_data.name or (profile.name if profile else None) or current_user.email.split("@", maxsplit=1)[0]
    merged_location = payload.user_data.location or (profile.location if profile else None) or "new places"
    merged_style = payload.user_data.travel_style or (profile.travel_style if profile else None) or "balanced"
    interests = payload.user_data.interests or (profile.interests if profile and profile.interests else []) or ["travel"]
    interest_text = ", ".join(interests[:3])
    bio = (
        f"{merged_name} is a {merged_style} traveler based around {merged_location}, "
        f"usually planning around {interest_text} with a practical budget mindset."
    )
    tags = [merged_style.lower().strip(), *(item.lower().strip() for item in interests[:4] if item)]
    unique_tags = list(dict.fromkeys(tag for tag in tags if tag))
    return ProfileGenerateResponse(bio=bio[:320], tags=unique_tags[:6] or ["traveler"])


def generate_profile_content(
    current_user: User,
    payload: ProfileGenerateRequest,
    request_context: dict[str, object] | None = None,
) -> ProfileGenerateResponse:
    settings = get_settings()
    profile = current_user.profile
    merged_payload = {
        "name": payload.user_data.name or (profile.name if profile else None),
        "age": payload.user_data.age or (profile.age if profile else None),
        "location": payload.user_data.location or (profile.location if profile else None),
        "destination": payload.user_data.destination,
        "travel_style": payload.user_data.travel_style or (profile.travel_style if profile else None),
        "interests": payload.user_data.interests or (profile.interests if profile and profile.interests else []),
        "budget_min": payload.user_data.budget_min if payload.user_data.budget_min is not None else (profile.budget_min if profile else None),
        "budget_max": payload.user_data.budget_max if payload.user_data.budget_max is not None else (profile.budget_max if profile else None),
        "bio_seed": payload.user_data.bio_seed,
    }
    cache_key = build_cache_key("ai:profile", user_id=current_user.id, payload=merged_payload)
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        logger.info(
            "ai_cache_hit",
            extra={
                "event_type": "ai_cache_hit",
                "request_id": (request_context or {}).get("request_id"),
                "user_id": current_user.id,
                "endpoint": (request_context or {}).get("endpoint"),
                "ai_operation": "profile_generate",
                "model": settings.model_name,
                "cache_hit": True,
                "fallback_used": False,
            },
        )
        return ProfileGenerateResponse.model_validate(cached)

    fallback = _fallback_profile_content(current_user, payload)
    system_prompt = (
        "You write short, authentic travel bios. Return valid JSON only with this exact shape: "
        "bio, tags. The bio should be 2 concise sentences and the tags list should contain 3 to 6 lowercase tags."
    )
    prompt = json.dumps(
        {
            "task": "Generate a travel profile bio and tags",
            "user_profile": merged_payload,
            "rules": {
                "bio_max_characters": 320,
                "avoid_hype": True,
                "tags_must_be_specific": True,
            },
        },
        separators=(",", ":"),
    )
    response = generate_response_sync(
        prompt,
        system_prompt,
        0.5,
        fallback_payload=fallback.model_dump(mode="json"),
        request_context={**(request_context or {}), "ai_operation": "profile_generate"},
    )
    try:
        parsed = ProfileGenerateResponse.model_validate_json(response.content)
    except ValidationError:
        parsed = fallback

    cleaned_tags = [tag.strip().lower() for tag in parsed.tags if tag and tag.strip()]
    parsed.tags = list(dict.fromkeys(cleaned_tags))[:6] or fallback.tags
    get_cache().set_json(cache_key, parsed.model_dump(mode="json"), ttl_seconds=settings.ai_cache_ttl_seconds)
    return parsed
