from __future__ import annotations

import json
import logging
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator

from app.services.ai.openai_client import generate_response_sync
from app.services.redis_runtime import build_cache_key, get_cache
from app.utils.config import get_settings


logger = logging.getLogger("aventaro.ai")

PlannerMood = Literal["chill", "adventure", "party", "luxury"]
TripContextStatus = Literal["past", "active", "saved", "candidate"]


class TravelerProfileContext(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    home_base: str | None = Field(default=None, max_length=120)
    travel_style: str | None = Field(default=None, max_length=80)
    interests: list[str] = Field(default_factory=list, max_length=12)
    budget_min: float | None = Field(default=None, ge=0, le=1_000_000)
    budget_max: float | None = Field(default=None, ge=0, le=1_000_000)


class TripContextSnapshot(BaseModel):
    title: str | None = Field(default=None, max_length=150)
    location: str = Field(min_length=2, max_length=150)
    status: TripContextStatus = "past"
    budget_min: float | None = Field(default=None, ge=0, le=1_000_000)
    budget_max: float | None = Field(default=None, ge=0, le=1_000_000)
    interests: list[str] = Field(default_factory=list, max_length=12)
    start_date: str | None = Field(default=None, max_length=40)
    end_date: str | None = Field(default=None, max_length=40)


class TripPlanRequest(BaseModel):
    budget: float = Field(gt=0, le=1_000_000)
    days: int = Field(ge=1, le=30)
    destination: str | None = Field(default=None, max_length=120)
    mood: PlannerMood
    traveler_count: int | None = Field(default=None, ge=1, le=20)
    travel_style: str | None = Field(default=None, max_length=80)
    profile_context: TravelerProfileContext | None = None
    past_trips: list[TripContextSnapshot] = Field(default_factory=list, max_length=10)
    active_trip: TripContextSnapshot | None = None
    saved_destinations: list[str] = Field(default_factory=list, max_length=12)
    candidate_destinations: list[str] = Field(default_factory=list, max_length=12)
    must_include: list[str] = Field(default_factory=list, max_length=12)
    avoid: list[str] = Field(default_factory=list, max_length=12)


class TripDayPlan(BaseModel):
    day: int = Field(ge=1, le=30)
    activities: list[str]
    estimated_cost: float = Field(ge=0)


class TripPlanOverview(BaseModel):
    headline: str = Field(min_length=1, max_length=200)
    destination: str = Field(min_length=1, max_length=120)
    duration_days: int = Field(ge=1, le=30)
    vibe: str = Field(min_length=1, max_length=120)
    best_travel_window: str = Field(min_length=1, max_length=120)
    stay_strategy: str = Field(min_length=1, max_length=200)
    transport_strategy: str = Field(min_length=1, max_length=200)
    personalization_notes: list[str] = Field(default_factory=list, max_length=6)


class DestinationSuggestion(BaseModel):
    destination: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=1, max_length=220)
    best_for: list[str] = Field(default_factory=list, max_length=5)
    estimated_total_cost: float = Field(ge=0)
    ideal_days: int = Field(ge=1, le=30)
    best_travel_window: str = Field(min_length=1, max_length=120)


class BudgetBreakdownItem(BaseModel):
    category: Literal["stay", "transport", "food", "activities", "buffer"]
    label: str = Field(min_length=1, max_length=80)
    amount: float = Field(ge=0)
    note: str = Field(min_length=1, max_length=180)


class TripPlanResponse(BaseModel):
    overview: TripPlanOverview
    destination_suggestions: list[DestinationSuggestion]
    budget_breakdown: list[BudgetBreakdownItem]
    itinerary: list[TripDayPlan]
    total_estimated_cost: float = Field(ge=0)
    recommended_stays: list[str]
    travel_routes: list[str]
    tips: list[str]
    follow_up_prompts: list[str]

    @model_validator(mode="after")
    def validate_itinerary(self) -> "TripPlanResponse":
        if not self.itinerary:
            raise ValueError("itinerary cannot be empty")
        seen_days = set()
        for item in self.itinerary:
            if item.day in seen_days:
                raise ValueError("itinerary days must be unique")
            seen_days.add(item.day)
        return self


def _clean_text_list(values: list[str] | None, *, limit: int = 8) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values or []:
        value = raw.strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        normalized.append(value)
        seen.add(key)
        if len(normalized) >= limit:
            break
    return normalized


def _profile_interests(payload: TripPlanRequest) -> list[str]:
    if payload.profile_context and payload.profile_context.interests:
        return _clean_text_list(payload.profile_context.interests, limit=6)

    collected: list[str] = []
    if payload.active_trip and payload.active_trip.interests:
        collected.extend(payload.active_trip.interests)
    for trip in payload.past_trips:
        collected.extend(trip.interests)
    return _clean_text_list(collected, limit=6)


def _build_activity_templates(payload: TripPlanRequest, destination: str) -> list[list[str]]:
    interests = _profile_interests(payload)
    profile = payload.profile_context
    style = payload.travel_style or (profile.travel_style if profile else None) or payload.mood
    must_include = _clean_text_list(payload.must_include, limit=4)
    focus_pool = must_include or interests or [style]

    mood_templates: dict[PlannerMood, tuple[str, str, str]] = {
        "chill": (
            "slow breakfast and low-pressure neighborhood wandering",
            "one scenic highlight with plenty of downtime between stops",
            "sunset food crawl and an early reset for the next day",
        ),
        "adventure": (
            "an active morning block with a strong anchor experience",
            "an outdoor or high-energy afternoon circuit",
            "an easy recovery evening with local food and logistics prep",
        ),
        "party": (
            "a late start with social cafes and casual exploration",
            "a nightlife-friendly daytime build with easy transport links",
            "a safe evening plan centered on music, food, and late returns",
        ),
        "luxury": (
            "a polished morning start with premium comfort built in",
            "a curated afternoon experience worth pre-booking",
            "a refined evening with standout dining and smooth transfers",
        ),
    }
    morning_template, afternoon_template, evening_template = mood_templates[payload.mood]

    activity_sets: list[list[str]] = []
    for day_index in range(1, payload.days + 1):
        focus = focus_pool[(day_index - 1) % len(focus_pool)]
        activity_sets.append(
            [
                f"Day {day_index}: {morning_template} in {destination}",
                f"Use the afternoon for {focus.lower()} around {destination} without overpacking the schedule",
                f"Finish with {evening_template} while staying close to your base in {destination}",
            ]
        )
    return activity_sets


def _build_stay_recommendations(daily_budget: float, mood: PlannerMood) -> list[str]:
    if mood == "luxury" or daily_budget >= 400:
        return [
            "Upscale boutique hotel in the main activity zone",
            "High-review stay with concierge support and airport transfer options",
            "Choose neighborhoods that cut transfer time rather than nightly rate",
        ]
    if daily_budget >= 180:
        return [
            "Comfort hotel or serviced apartment near transit",
            "Walkable neighborhood stay with late food options",
            "Mix of taxi and public transit to protect energy and budget",
        ]
    if daily_budget >= 80:
        return [
            "Budget hotel or guesthouse in a transit-friendly district",
            "Stay slightly outside the premium core to unlock better value",
            "Pre-book shared transfers for arrival and departure days",
        ]
    return [
        "Hostel private room or compact guesthouse near public transit",
        "Base yourself on a well-connected transit corridor",
        "Use shared transfers and walkable neighborhoods wherever possible",
    ]


def _build_destination_pool(payload: TripPlanRequest) -> list[str]:
    default_by_mood: dict[PlannerMood, list[str]] = {
        "chill": ["Udaipur", "Bali", "Lisbon"],
        "adventure": ["Rishikesh", "Queenstown", "Cape Town"],
        "party": ["Goa", "Bangkok", "Barcelona"],
        "luxury": ["Dubai", "Maldives", "Paris"],
    }

    candidates: list[str] = []
    if payload.destination:
        candidates.append(payload.destination)
    if payload.active_trip:
        candidates.append(payload.active_trip.location)
    candidates.extend(payload.saved_destinations)
    candidates.extend(payload.candidate_destinations)
    candidates.extend(trip.location for trip in payload.past_trips)
    candidates.extend(default_by_mood[payload.mood])
    return _clean_text_list(candidates, limit=4)


def _best_travel_window(payload: TripPlanRequest) -> str:
    interests = [interest.lower() for interest in _profile_interests(payload)]
    if any(keyword in interests for keyword in {"beach", "surf", "island"}):
        return "Shoulder season with stable weather and softer hotel pricing"
    if any(keyword in interests for keyword in {"hiking", "trek", "outdoor", "adventure"}):
        return "Peak outdoor season with a one-week booking buffer"
    if payload.mood == "luxury":
        return "Peak comfort season with premium stays booked early"
    if payload.mood == "party":
        return "Festival or weekend-heavy window with transport locked in first"
    return "Shoulder season for smoother crowds and better value"


def _build_destination_reason(payload: TripPlanRequest, destination: str, index: int) -> str:
    if payload.destination and payload.destination.strip().lower() == destination.lower():
        return "Matches the destination you are already leaning toward, so the plan can move from ideation to execution."

    if payload.active_trip and payload.active_trip.location.strip().lower() == destination.lower():
        return "Keeps planning aligned with your current Aventaro trip momentum and existing logistics."

    if any(saved.lower() == destination.lower() for saved in payload.saved_destinations):
        return "Shows up in places you have already saved, which signals strong traveler intent."

    if any(trip.location.strip().lower() == destination.lower() for trip in payload.past_trips):
        return "Connects with a location pattern in your past trips, making it a safer fit for your travel style."

    if index == 0:
        return "Best overall match for your current budget, vibe, and recent travel behavior."

    return "Adds variety without drifting too far from your profile, budget, or trip pacing."


def _build_destination_suggestions(payload: TripPlanRequest) -> list[DestinationSuggestion]:
    best_window = _best_travel_window(payload)
    interests = _profile_interests(payload)
    destination_pool = _build_destination_pool(payload)
    budget_variants = [1.0, 0.93, 1.08, 1.15]
    suggestions: list[DestinationSuggestion] = []

    for index, destination in enumerate(destination_pool):
        budget_multiplier = budget_variants[index] if index < len(budget_variants) else 1.0
        estimated_total = round(payload.budget * budget_multiplier, 2)
        ideal_days = max(2, min(10, payload.days + (0 if index == 0 else index - 1)))
        best_for = _clean_text_list(
            interests
            + [payload.travel_style or payload.mood, "balanced pacing" if index == 0 else "fresh scenery"],
            limit=3,
        )
        suggestions.append(
            DestinationSuggestion(
                destination=destination,
                reason=_build_destination_reason(payload, destination, index),
                best_for=best_for,
                estimated_total_cost=estimated_total,
                ideal_days=ideal_days,
                best_travel_window=best_window,
            )
        )
        if len(suggestions) >= 3:
            break

    return suggestions


def _normalize_allocations(mood: PlannerMood) -> dict[str, float]:
    allocations: dict[str, float]
    if mood == "luxury":
        allocations = {"stay": 0.40, "transport": 0.18, "food": 0.18, "activities": 0.16, "buffer": 0.08}
    elif mood == "party":
        allocations = {"stay": 0.30, "transport": 0.18, "food": 0.16, "activities": 0.26, "buffer": 0.10}
    elif mood == "adventure":
        allocations = {"stay": 0.28, "transport": 0.24, "food": 0.16, "activities": 0.22, "buffer": 0.10}
    else:
        allocations = {"stay": 0.33, "transport": 0.20, "food": 0.20, "activities": 0.17, "buffer": 0.10}

    total = sum(allocations.values()) or 1.0
    return {key: value / total for key, value in allocations.items()}


def _budget_note(category: str, payload: TripPlanRequest, destination: str) -> str:
    if category == "stay":
        return f"Use {destination} as a single base to avoid expensive mid-trip hotel switches."
    if category == "transport":
        return "Book the longest transfer first, then keep the rest of the trip neighborhood-clustered."
    if category == "food":
        return "Mix one anchor meal with casual local spots so food stays memorable without dragging the budget."
    if category == "activities":
        return "Reserve money for one signature experience and keep the surrounding schedule flexible."
    return "Keep this untouched until the main bookings are locked."


def _build_budget_breakdown(payload: TripPlanRequest, destination: str) -> list[BudgetBreakdownItem]:
    allocations = _normalize_allocations(payload.mood)
    labels = {
        "stay": "Stay",
        "transport": "Transport",
        "food": "Food",
        "activities": "Activities",
        "buffer": "Buffer",
    }

    items: list[BudgetBreakdownItem] = []
    running_total = 0.0
    categories = ["stay", "transport", "food", "activities", "buffer"]
    for index, category in enumerate(categories):
        if index == len(categories) - 1:
            amount = round(max(payload.budget - running_total, 0), 2)
        else:
            amount = round(payload.budget * allocations[category], 2)
            running_total += amount
        items.append(
            BudgetBreakdownItem(
                category=category,  # type: ignore[arg-type]
                label=labels[category],
                amount=amount,
                note=_budget_note(category, payload, destination),
            )
        )
    return items


def _build_personalization_notes(payload: TripPlanRequest, destination: str) -> list[str]:
    notes: list[str] = []
    profile = payload.profile_context

    if profile and profile.home_base:
        notes.append(f"Starting from {profile.home_base} helps frame realistic transfer and timing choices.")

    interests = _profile_interests(payload)
    if interests:
        notes.append(f"Built around your strongest interests: {', '.join(interests[:3])}.")

    if payload.active_trip:
        notes.append(f"Your active trip to {payload.active_trip.location} was used as a pacing and budget anchor.")

    if payload.past_trips:
        past_locations = ", ".join(trip.location for trip in payload.past_trips[:2])
        notes.append(f"Past trip signals from {past_locations} were used to shape destination fit.")

    if payload.saved_destinations:
        notes.append(f"Saved places like {payload.saved_destinations[0]} influenced the recommendation set.")

    if not notes:
        notes.append(f"This plan is tuned to your stated budget and {payload.mood} travel mood for {destination}.")

    return notes[:4]


def _transport_strategy(payload: TripPlanRequest, destination: str) -> str:
    travelers = payload.traveler_count or 1
    if travelers >= 4:
        return f"Keep {destination} anchored to one base and compare private transfers against group public transit costs."
    if payload.days <= 3:
        return f"Minimize long transfers in {destination} and stay close to the core activity zone."
    return f"Use one main arrival transfer, then cluster daily movement within the same district in {destination}."


def _build_follow_up_prompts(payload: TripPlanRequest, destination: str) -> list[str]:
    prompts = [
        f"Reduce this {destination} plan by 20 percent",
        f"Make this {destination} trip more {payload.mood}",
        "Turn this into a family-friendly version",
        "Suggest a cheaper destination with a similar vibe",
    ]
    return prompts[:4]


def _fallback_trip_plan(payload: TripPlanRequest) -> TripPlanResponse:
    destination_suggestions = _build_destination_suggestions(payload)
    primary_destination = destination_suggestions[0].destination if destination_suggestions else (payload.destination or "your destination")
    best_window = destination_suggestions[0].best_travel_window if destination_suggestions else _best_travel_window(payload)
    daily_budget = round(payload.budget / payload.days, 2)
    itinerary = [
        TripDayPlan(
            day=day_index,
            activities=activities,
            estimated_cost=round(daily_budget, 2),
        )
        for day_index, activities in enumerate(_build_activity_templates(payload, primary_destination), start=1)
    ]
    budget_breakdown = _build_budget_breakdown(payload, primary_destination)
    profile = payload.profile_context
    travel_style = payload.travel_style or (profile.travel_style if profile else None) or payload.mood

    return TripPlanResponse(
        overview=TripPlanOverview(
            headline=f"{primary_destination} trip blueprint tuned for your {payload.mood} travel mood",
            destination=primary_destination,
            duration_days=payload.days,
            vibe=f"{travel_style.title()} pace with realistic budget discipline",
            best_travel_window=best_window,
            stay_strategy=_build_stay_recommendations(daily_budget, payload.mood)[0],
            transport_strategy=_transport_strategy(payload, primary_destination),
            personalization_notes=_build_personalization_notes(payload, primary_destination),
        ),
        destination_suggestions=destination_suggestions,
        budget_breakdown=budget_breakdown,
        itinerary=itinerary,
        total_estimated_cost=round(sum(item.amount for item in budget_breakdown), 2),
        recommended_stays=_build_stay_recommendations(daily_budget, payload.mood),
        travel_routes=[
            f"Use a central base in {primary_destination} to cut daily transfer time.",
            "Group nearby activities together so transport spend does not leak across the week.",
            "Book the arrival and departure transfer first, then leave intra-city movement flexible.",
        ],
        tips=[
            "Keep 8 to 10 percent of the budget unassigned until transport and stay are locked.",
            "Choose one anchor activity per day and leave recovery time around it.",
            "Use your saved destinations and past trip patterns as filters, not as a script to copy.",
        ],
        follow_up_prompts=_build_follow_up_prompts(payload, primary_destination),
    )


def plan_trip(payload: TripPlanRequest, request_context: dict[str, object] | None = None) -> TripPlanResponse:
    settings = get_settings()
    cache_key = build_cache_key("ai:trip", payload=payload.model_dump(mode="json"))
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        logger.info(
            "ai_cache_hit",
            extra={
                "event_type": "ai_cache_hit",
                "request_id": (request_context or {}).get("request_id"),
                "user_id": (request_context or {}).get("user_id"),
                "endpoint": (request_context or {}).get("endpoint"),
                "ai_operation": "trip_plan",
                "model": settings.model_name,
                "cache_hit": True,
                "fallback_used": False,
            },
        )
        return TripPlanResponse.model_validate(cached)

    fallback = _fallback_trip_plan(payload)
    system_prompt = (
        "You are an expert travel planner. Return valid JSON only. "
        "Build a full trip plan, not just a day-wise itinerary. "
        "Use this exact shape: "
        "overview{headline,destination,duration_days,vibe,best_travel_window,stay_strategy,transport_strategy,personalization_notes},"
        "destination_suggestions[{destination,reason,best_for,estimated_total_cost,ideal_days,best_travel_window}],"
        "budget_breakdown[{category,label,amount,note}],"
        "itinerary[{day,activities,estimated_cost}],"
        "total_estimated_cost,recommended_stays,travel_routes,tips,follow_up_prompts. "
        "Respect the user's budget, day count, history, active trip, saved places, and travel preferences."
    )
    prompt = json.dumps(
        {
            "task": "Build a practical full-trip planner output",
            "input": payload.model_dump(mode="json"),
            "rules": {
                "currency": "plain numeric values only",
                "day_count_must_match": payload.days,
                "activities_per_day": "2 to 4",
                "suggestions_count": "2 to 3 destination matches",
                "tips_count": "3 to 5",
                "follow_up_prompts_count": "3 to 4",
            },
        },
        separators=(",", ":"),
    )
    response = generate_response_sync(
        prompt,
        system_prompt,
        0.4,
        fallback_payload=fallback.model_dump(mode="json"),
        request_context={**(request_context or {}), "ai_operation": "trip_plan"},
    )
    try:
        parsed = TripPlanResponse.model_validate_json(response.content)
    except ValidationError:
        parsed = fallback

    get_cache().set_json(cache_key, parsed.model_dump(mode="json"), ttl_seconds=settings.ai_cache_ttl_seconds)
    return parsed
