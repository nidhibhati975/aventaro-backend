from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, or_, select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.chat import Conversation, ConversationType, Message
from app.models.growth import AnalyticsEvent
from app.models.match import Match, MatchStatus
from app.models.trip import Trip, TripMember, TripMembershipStatus, TripLifecycleStatus
from app.models.user import User
from app.services.ai.openai_client import generate_response_sync
from app.services.analytics import record_analytics_event
from app.services.chat import get_or_create_direct_conversation
from app.services.jobs import enqueue_job, enqueue_job_with_delay, JobPriority
from app.services.notifications import NOTIFICATION_ENTITY_TYPE_MATCH, create_notification
from app.services.redis_runtime import build_cache_key, get_cache
from app.services.social import has_block_relationship
from app.utils.config import get_settings


logger = logging.getLogger("aventaro.ai")

# Match scoring weights (must sum to 1.0)
MATCH_WEIGHTS = {
    "interest": 0.20,
    "location": 0.15,
    "date": 0.20,
    "destination": 0.15,
    "intent": 0.15,
    "behavior": 0.10,
    "recency": 0.05,
}

# Cache TTL configuration
MATCH_CACHE_TTL = 300  # 5 minutes
DISCOVER_CACHE_TTL = 120  # 2 minutes
PROFILE_CACHE_TTL = 600  # 10 minutes

# Travel intent types
TRAVEL_INTENTS = {"adventure", "luxury", "budget", "social", "relaxation", "cultural", "nature", "city"}


def _normalize_travel_intent(value: str | None) -> str | None:
    """Normalize travel intent to standard set."""
    if not value:
        return None
    normalized = value.strip().lower()
    return normalized if normalized in TRAVEL_INTENTS else None


@dataclass(frozen=True)
class MatchScoreResult:
    score: int
    reason: str


@dataclass(frozen=True)
class MatchEligibilityResult:
    eligible: bool
    reasons: list[str]
    overlap_score: float


def _normalized_tags(values: list[str] | None) -> set[str]:
    if not values:
        return set()
    return {value.strip().lower() for value in values if value and value.strip()}


def _normalize_date_like(value: date | datetime | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    return value


def _ensure_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _budget_overlap_score(user1: User, user2: User) -> tuple[int, str | None]:
    profile1 = user1.profile
    profile2 = user2.profile
    if profile1 is None or profile2 is None:
        return (0, None)
    if profile1.budget_min is None and profile1.budget_max is None:
        return (0, None)
    if profile2.budget_min is None and profile2.budget_max is None:
        return (0, None)

    min1 = profile1.budget_min if profile1.budget_min is not None else profile1.budget_max
    max1 = profile1.budget_max if profile1.budget_max is not None else profile1.budget_min
    min2 = profile2.budget_min if profile2.budget_min is not None else profile2.budget_max
    max2 = profile2.budget_max if profile2.budget_max is not None else profile2.budget_min
    if min1 is None or max1 is None or min2 is None or max2 is None:
        return (0, None)
    if min1 <= max2 and max1 >= min2:
        return (25, "compatible budget range")
    return (0, None)


def _location_score(user1: User, user2: User) -> tuple[int, str | None]:
    profile1 = user1.profile
    profile2 = user2.profile
    if profile1 is None or profile2 is None:
        return (0, None)
    if (
        profile1.latitude is not None
        and profile1.longitude is not None
        and profile2.latitude is not None
        and profile2.longitude is not None
    ):
        distance_km = _haversine_km(profile1.latitude, profile1.longitude, profile2.latitude, profile2.longitude)
        if distance_km <= 25:
            return (15, "within 25 km")
        if distance_km <= 100:
            return (10, "within 100 km")
        if distance_km <= 250:
            return (5, "within regional travel radius")
    if not profile1.location or not profile2.location:
        return (0, None)
    left = profile1.location.strip().lower()
    right = profile2.location.strip().lower()
    if left == right:
        return (15, "same location")
    if left in right or right in left:
        return (10, "nearby location")
    return (0, None)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0088
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return radius_km * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _travel_style_score(user1: User, user2: User) -> tuple[int, str | None]:
    profile1 = user1.profile
    profile2 = user2.profile
    if profile1 is None or profile2 is None or not profile1.travel_style or not profile2.travel_style:
        return (0, None)
    left = profile1.travel_style.strip().lower()
    right = profile2.travel_style.strip().lower()
    if left == right:
        return (20, "similar travel style")
    return (0, None)


def _interest_score(user1: User, user2: User) -> tuple[int, str | None]:
    interests1 = _normalized_tags(user1.profile.interests if user1.profile else None)
    interests2 = _normalized_tags(user2.profile.interests if user2.profile else None)
    if not interests1 or not interests2:
        return (0, None)
    overlap = interests1.intersection(interests2)
    if not overlap:
        return (0, None)
    score = min(40, len(overlap) * 12)
    return (score, f"shared interests in {', '.join(sorted(overlap)[:3])}")


def _extract_user_travel_window(user: User) -> tuple[date | None, date | None]:
    profile = user.profile
    if profile is not None and profile.travel_start_date is not None and profile.travel_end_date is not None:
        if profile.travel_start_date <= profile.travel_end_date:
            return profile.travel_start_date, profile.travel_end_date

    ranges: list[tuple[date, date]] = []
    for membership in getattr(user, "trip_memberships", []):
        if membership.status != TripMembershipStatus.approved:
            continue
        trip = getattr(membership, "trip", None)
        if trip is None:
            continue
        if trip.lifecycle_status in [TripLifecycleStatus.completed, TripLifecycleStatus.cancelled]:
            continue
        trip_start = _normalize_date_like(trip.start_date)
        trip_end = _normalize_date_like(trip.end_date)
        if trip_start is None or trip_end is None:
            continue
        if trip_start > trip_end:
            continue
        ranges.append((trip_start, trip_end))

    if not ranges:
        return (None, None)

    return min(ranges, key=lambda value: value[0])


def _date_overlap_ratio(
    start1: date | None,
    end1: date | None,
    start2: date | None,
    end2: date | None,
) -> tuple[float, int, int]:
    if start1 is None or end1 is None or start2 is None or end2 is None:
        return (0.0, 0, 0)
    overlap_start = max(start1, start2)
    overlap_end = min(end1, end2)
    if overlap_start > overlap_end:
        return (0.0, 0, 0)
    overlap_days = (overlap_end - overlap_start).days + 1
    total_days = (max(end1, end2) - min(start1, start2)).days + 1
    if total_days <= 0:
        return (0.0, 0, 0)
    return (min(1.0, overlap_days / total_days), overlap_days, total_days)


def _profile_overlap_ratio(user1: User, user2: User) -> tuple[float, int, int]:
    profile1 = user1.profile
    profile2 = user2.profile
    if profile1 is None or profile2 is None:
        return (0.0, 0, 0)
    return _date_overlap_ratio(
        profile1.travel_start_date,
        profile1.travel_end_date,
        profile2.travel_start_date,
        profile2.travel_end_date,
    )


def _active_trip_overlap_ratio(user1: User, user2: User) -> tuple[float, int, int, Trip | None, Trip | None]:
    best_ratio = 0.0
    best_overlap_days = 0
    best_total_days = 0
    best_pair: tuple[Trip | None, Trip | None] = (None, None)
    for left_trip in _get_user_active_trips(user1):
        for right_trip in _get_user_active_trips(user2):
            ratio, overlap_days, total_days = _date_overlap_ratio(
                _normalize_date_like(left_trip.start_date),
                _normalize_date_like(left_trip.end_date),
                _normalize_date_like(right_trip.start_date),
                _normalize_date_like(right_trip.end_date),
            )
            if ratio > best_ratio:
                best_ratio = ratio
                best_overlap_days = overlap_days
                best_total_days = total_days
                best_pair = (left_trip, right_trip)
    return (best_ratio, best_overlap_days, best_total_days, best_pair[0], best_pair[1])


def _date_overlap_score(user1: User, user2: User) -> tuple[int, str | None]:
    profile_ratio, profile_overlap_days, profile_total_days = _profile_overlap_ratio(user1, user2)
    trip_ratio, trip_overlap_days, trip_total_days, left_trip, right_trip = _active_trip_overlap_ratio(user1, user2)

    ratio = profile_ratio
    overlap_days = profile_overlap_days
    total_days = profile_total_days
    reason: str | None = None
    if trip_ratio > ratio:
        ratio = trip_ratio
        overlap_days = trip_overlap_days
        total_days = trip_total_days
        if left_trip is not None and right_trip is not None:
            if left_trip.location.strip().lower() == right_trip.location.strip().lower():
                reason = f"{overlap_days}-day overlap for trips to {left_trip.location}"
            else:
                reason = (
                    f"{overlap_days}-day overlap across upcoming trips in "
                    f"{left_trip.location} and {right_trip.location}"
                )
    elif profile_ratio > 0:
        reason = f"{overlap_days}-day overlap across planned travel dates"

    if ratio <= 0:
        # Fall back to the broadest user-level travel window if the profile or active trip pair is unavailable.
        start1, end1 = _extract_user_travel_window(user1)
        start2, end2 = _extract_user_travel_window(user2)
        ratio, overlap_days, total_days = _date_overlap_ratio(start1, end1, start2, end2)
        if ratio > 0:
            reason = f"{overlap_days}-day overlap across {total_days}-day combined travel window"

    if ratio <= 0:
        return (0, None)

    score = int(round(ratio * 30))
    return (score, reason or f"{overlap_days}-day overlap across {total_days}-day combined window")


def _destination_overlap_score(user1: User, user2: User) -> tuple[int, str | None]:
    """Score based on destination overlap from trip memberships."""
    profile1 = user1.profile
    profile2 = user2.profile
    
    # Get user's active trips
    user1_trips = _get_user_active_trips(user1)
    user2_trips = _get_user_active_trips(user2)
    
    if not user1_trips or not user2_trips:
        # Fall back to profile location as destination
        if profile1 and profile2 and profile1.location and profile2.location:
            loc1 = profile1.location.strip().lower()
            loc2 = profile2.location.strip().lower()
            if loc1 == loc2:
                return (20, "same location as destination")
            # Check for country-level match
            loc1_parts = loc1.split(",")
            loc2_parts = loc2.split(",")
            if len(loc1_parts) > 1 and len(loc2_parts) > 1:
                if loc1_parts[-1].strip() == loc2_parts[-1].strip():
                    return (15, "same country")
        return (0, None)
    
    # Compare trip destinations
    dests1 = {t.location.strip().lower() for t in user1_trips if t.location}
    dests2 = {t.location.strip().lower() for t in user2_trips if t.location}
    
    exact_match = dests1 & dests2
    if exact_match:
        return (25, f"same destination: {next(iter(exact_match))}")
    
    # Check for nearby/partial match
    for d1 in dests1:
        for d2 in dests2:
            if d1 in d2 or d2 in d1:
                return (15, "nearby destination")
            # Country match
            parts1 = d1.split(",")
            parts2 = d2.split(",")
            if len(parts1) > 1 and len(parts2) > 1:
                if parts1[-1].strip() == parts2[-1].strip():
                    return (12, "same country as destination")
    
    return (0, None)


def _trip_intent_score(user1: User, user2: User) -> tuple[int, str | None]:
    """Score based on travel intent matching (adventure, luxury, budget, social)."""
    profile1 = user1.profile
    profile2 = user2.profile
    
    if profile1 is None or profile2 is None:
        return (0, None)
    
    intent1 = _normalize_travel_intent(profile1.travel_style)
    intent2 = _normalize_travel_intent(profile2.travel_style)
    
    if not intent1 or not intent2:
        return (0, None)
    
    if intent1 == intent2:
        return (18, f"same travel intent: {intent1}")
    
    # Compatible intents get partial score
    compatible_groups = {
        {"adventure", "nature", "cultural"},
        {"luxury", "relaxation", "city"},
        {"budget", "social", "city"},
    }
    for group in compatible_groups:
        if intent1 in group and intent2 in group:
            return (10, f"compatible travel intent")
    
    return (0, None)


def _behavioral_score(user1: User, user2: User, db: Session | None = None) -> tuple[int, str | None]:
    """Score based on persisted behavioral signals."""
    score = 0
    reasons: list[str] = []

    shared_trip_ids = _get_user_active_trip_ids(user1).intersection(_get_user_active_trip_ids(user2))
    if shared_trip_ids:
        score += min(6, len(shared_trip_ids) * 3)
        reasons.append("shared active trip history")

    if db is not None:
        direct_message_count = int(
            db.scalar(
                select(func.count(Message.id))
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(
                    Conversation.conversation_type == ConversationType.direct,
                    or_(
                        and_(
                            Conversation.participant_one_id == user1.id,
                            Conversation.participant_two_id == user2.id,
                        ),
                        and_(
                            Conversation.participant_one_id == user2.id,
                            Conversation.participant_two_id == user1.id,
                        ),
                    ),
                )
            )
            or 0
        )
        if direct_message_count >= 10:
            score += 4
            reasons.append("strong prior conversation engagement")
        elif direct_message_count >= 3:
            score += 2
            reasons.append("existing conversation activity")

        recent_cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        recent_activity_users = int(
            db.scalar(
                select(func.count(func.distinct(AnalyticsEvent.user_id)))
                .where(
                    AnalyticsEvent.user_id.in_([user1.id, user2.id]),
                    AnalyticsEvent.created_at >= recent_cutoff,
                )
            )
            or 0
        )
        if recent_activity_users == 2:
            score += 2
            reasons.append("both travelers are recently active")

    return (min(score, 10), None if score == 0 else "; ".join(reasons))


def _recency_boost(user: User) -> int:
    """Return recency boost based on user activity."""
    reference_timestamp = user.last_login or user.created_at
    if reference_timestamp:
        days_since_reference = (datetime.now(timezone.utc) - _ensure_aware_utc(reference_timestamp)).days
        if days_since_reference < 7:
            return 5
        elif days_since_reference < 30:
            return 3
        elif days_since_reference < 90:
            return 1
    return 0


def _get_user_active_trips(user: User) -> list[Trip]:
    """Get user's active (non-completed, non-cancelled) trips."""
    trips = []
    for membership in getattr(user, "trip_memberships", []):
        if membership.status != TripMembershipStatus.approved:
            continue
        trip = getattr(membership, "trip", None)
        if trip is None:
            continue
        if trip.lifecycle_status in [TripLifecycleStatus.completed, TripLifecycleStatus.cancelled]:
            continue
        trips.append(trip)
    return trips


def _get_user_active_trip_ids(user: User) -> set[int]:
    return {trip.id for trip in _get_user_active_trips(user)}


def calculate_date_overlap_score(user_trip: Trip, candidate_trip: Trip) -> float:
    """Calculate normalized date overlap score between two trips (0 to 1)."""
    ratio, _, _ = _date_overlap_ratio(
        _normalize_date_like(user_trip.start_date),
        _normalize_date_like(user_trip.end_date),
        _normalize_date_like(candidate_trip.start_date),
        _normalize_date_like(candidate_trip.end_date),
    )
    return ratio


def get_match_eligibility(
    user1: User,
    user2: User,
    *,
    db: Session | None = None,
) -> MatchEligibilityResult:
    reasons: list[str] = []
    if user1.id == user2.id:
        return MatchEligibilityResult(eligible=False, reasons=["cannot match with yourself"], overlap_score=0.0)
    if db is not None and has_block_relationship(db, user1.id, user2.id):
        return MatchEligibilityResult(eligible=False, reasons=["blocked users cannot be matched"], overlap_score=0.0)

    profile_ratio, _, _ = _profile_overlap_ratio(user1, user2)
    trip_ratio, _, _, _, _ = _active_trip_overlap_ratio(user1, user2)
    window_start1, window_end1 = _extract_user_travel_window(user1)
    window_start2, window_end2 = _extract_user_travel_window(user2)
    broad_ratio, _, _ = _date_overlap_ratio(window_start1, window_end1, window_start2, window_end2)
    overlap_score = max(profile_ratio, trip_ratio, broad_ratio)

    if overlap_score <= 0:
        if window_start1 is None or window_end1 is None:
            reasons.append("your profile does not have an active travel window yet")
        if window_start2 is None or window_end2 is None:
            reasons.append("candidate does not have an active travel window yet")
        if not reasons:
            reasons.append("travel dates do not overlap")
        return MatchEligibilityResult(eligible=False, reasons=reasons, overlap_score=0.0)

    reasons.append("travel dates overlap")
    if trip_ratio > 0:
        reasons.append("active trip dates overlap")
    return MatchEligibilityResult(eligible=True, reasons=reasons, overlap_score=overlap_score)


def _deterministic_match_score(user1: User, user2: User, db: Session | None = None) -> MatchScoreResult:
    """Calculate deterministic match score with normalized weights (0-1)."""
    interest_score, interest_reason = _interest_score(user1, user2)
    location_score, location_reason = _location_score(user1, user2)
    date_score, date_reason = _date_overlap_score(user1, user2)
    destination_score, destination_reason = _destination_overlap_score(user1, user2)
    intent_score, intent_reason = _trip_intent_score(user1, user2)
    behavior_score, behavior_reason = _behavioral_score(user1, user2, db=db)

    # Raw scores (max values based on original implementation)
    raw_scores = {
        "interest": interest_score,
        "location": location_score,
        "date": date_score,
        "destination": destination_score,
        "intent": intent_score,
        "behavior": behavior_score,
        "recency": _recency_boost(user1) + _recency_boost(user2),
    }
    
    # Max possible raw scores
    max_raw = {
        "interest": 40,
        "location": 15,
        "date": 30,
        "destination": 25,
        "intent": 18,
        "behavior": 10,
        "recency": 10,
    }
    
    # Normalize each component to 0-1
    normalized = {}
    reasons: list[str] = []
    component_reasons = {
        "interest": interest_reason,
        "location": location_reason,
        "date": date_reason,
        "destination": destination_reason,
        "intent": intent_reason,
        "behavior": behavior_reason,
    }
    for component, weight in MATCH_WEIGHTS.items():
        raw = raw_scores.get(component, 0)
        max_val = max_raw.get(component, 1)
        normalized[component] = raw / max_val if max_val > 0 else 0.0
        reason = component_reasons.get(component)
        if reason:
            reasons.append(reason)
    
    # Calculate final weighted score (0-1)
    final_score = sum(normalized[comp] * weight for comp, weight in MATCH_WEIGHTS.items())
    final_score = min(max(final_score, 0.0), 1.0)  # Clamp to 0-1
    
    if not reasons:
        reasons.append("limited shared profile details")
    
    return MatchScoreResult(
        score=int(final_score * 100),  # Convert to 0-100 for compatibility
        reason="; ".join(reasons)[:255]
    )


@dataclass(frozen=True)
class ExplainedMatchScore:
    """Explained match score with reasons for each component."""
    score: float
    reasons: list[str]
    breakdown: dict[str, Any]


def explain_match_score(
    user1: User,
    user2: User,
    db: Session | None = None,
) -> ExplainedMatchScore:
    """Generate detailed match score explanation with breakdown.
    
    Returns:
        ExplainedMatchScore with score (0-1), reasons, and component breakdown
    """
    eligibility = get_match_eligibility(user1, user2, db=db)
    reasons: list[str] = []
    breakdown: dict[str, Any] = {}
    
    # Max raw scores for normalization
    max_raw = {
        "interest": 40,
        "location": 15,
        "date": 30,
        "destination": 25,
        "intent": 18,
        "behavior": 10,
        "recency": 10,
    }
    
    # Calculate normalized components using MATCH_WEIGHTS
    for component, weight in MATCH_WEIGHTS.items():
        if component == "interest":
            raw, reason = _interest_score(user1, user2)
        elif component == "location":
            raw, reason = _location_score(user1, user2)
        elif component == "date":
            raw, reason = _date_overlap_score(user1, user2)
        elif component == "destination":
            raw, reason = _destination_overlap_score(user1, user2)
        elif component == "intent":
            raw, reason = _trip_intent_score(user1, user2)
        elif component == "behavior":
            raw, reason = _behavioral_score(user1, user2, db=db)
        elif component == "recency":
            raw = _recency_boost(user1) + _recency_boost(user2)
            reason = None
        else:
            raw, reason = 0, None
        
        max_val = max_raw.get(component, 1)
        normalized = raw / max_val if max_val > 0 else 0.0
        
        breakdown[component] = {
            "raw_score": raw,
            "max_raw": max_val,
            "normalized": round(normalized, 3),
            "weight": weight,
            "weighted_contribution": round(normalized * weight, 3),
            "reason": reason,
        }
        
        if reason:
            reasons.append(reason)
    
    # Calculate final score (0-1)
    final_score = sum(breakdown[c]["normalized"] * MATCH_WEIGHTS[c] for c in MATCH_WEIGHTS)
    final_score = min(max(final_score, 0.0), 1.0)
    
    # Add recency to breakdown
    breakdown["recency"]["user1_boost"] = _recency_boost(user1)
    breakdown["recency"]["user2_boost"] = _recency_boost(user2)

    breakdown["eligibility"] = {
        "eligible": eligibility.eligible,
        "overlap_score": round(eligibility.overlap_score, 3),
        "reasons": eligibility.reasons,
    }
    if not eligibility.eligible:
        reasons.extend(eligibility.reasons)
        return ExplainedMatchScore(
            score=0.0,
            reasons=reasons[:5],
            breakdown=breakdown,
        )

    if not reasons:
        reasons.append("limited shared profile details")
    
    return ExplainedMatchScore(
        score=round(final_score, 2),
        reasons=reasons[:5],  # Top 5 reasons
        breakdown=breakdown,
    )


def calculate_match_score(
    user1: User,
    user2: User,
    *,
    db: Session | None = None,
    allow_ai: bool = False,
    request_context: dict[str, object] | None = None,
) -> MatchScoreResult:
    settings = get_settings()
    base_result = _deterministic_match_score(user1, user2, db=db)
    if not allow_ai:
        return base_result

    cache_key = build_cache_key(
        "ai:match",
        user1=_serialize_user_for_scoring(user1),
        user2=_serialize_user_for_scoring(user2),
    )
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        logger.info(
            "ai_cache_hit",
            extra={
                "event_type": "ai_cache_hit",
                "request_id": (request_context or {}).get("request_id"),
                "user_id": (request_context or {}).get("user_id"),
                "endpoint": (request_context or {}).get("endpoint"),
                "ai_operation": "match_score",
                "model": settings.model_name,
                "cache_hit": True,
                "fallback_used": False,
            },
        )
        return MatchScoreResult(score=int(cached["score"]), reason=str(cached["reason"]))

    prompt = json.dumps(
        {
            "task": "Refine a compatibility score between two travelers",
            "base_score": base_result.score,
            "user1": _serialize_user_for_scoring(user1),
            "user2": _serialize_user_for_scoring(user2),
            "rules": {
                "adjustment_range": "integer between -10 and 10",
                "reason_max_characters": 160,
            },
        },
        separators=(",", ":"),
    )
    system_prompt = (
        "You score travel compatibility. Return valid JSON only with this exact shape: "
        "score_adjustment, reason. Ground the result in interests, budget fit, travel style, and location."
    )
    fallback_payload = {"score_adjustment": 0, "reason": base_result.reason}
    response = generate_response_sync(
        prompt,
        system_prompt,
        0.2,
        fallback_payload=fallback_payload,
        request_context={**(request_context or {}), "ai_operation": "match_score"},
    )
    adjustment = 0
    reason = base_result.reason
    try:
        parsed = json.loads(response.content)
        adjustment = int(parsed.get("score_adjustment") or 0)
        adjustment = max(-10, min(10, adjustment))
        parsed_reason = str(parsed.get("reason") or "").strip()
        if parsed_reason:
            reason = parsed_reason[:255]
    except (TypeError, ValueError, json.JSONDecodeError):
        adjustment = 0

    final_result = MatchScoreResult(score=max(0, min(100, base_result.score + adjustment)), reason=reason)
    get_cache().set_json(
        cache_key,
        {"score": final_result.score, "reason": final_result.reason},
        ttl_seconds=settings.ai_cache_ttl_seconds,
    )
    return final_result


def _serialize_user_for_scoring(user: User) -> dict[str, object]:
    profile = user.profile
    return {
        "id": user.id,
        "location": profile.location if profile else None,
        "travel_style": profile.travel_style if profile else None,
        "interests": profile.interests if profile and profile.interests else [],
        "budget_min": profile.budget_min if profile else None,
        "budget_max": profile.budget_max if profile else None,
        "travel_start_date": profile.travel_start_date.isoformat() if profile and profile.travel_start_date else None,
        "travel_end_date": profile.travel_end_date.isoformat() if profile and profile.travel_end_date else None,
    }


def _populate_missing_match_scores(db: Session, matches: list[Match]) -> list[Match]:
    updated = False
    for match in matches:
        if match.compatibility_score is not None:
            continue
        result = calculate_match_score(match.sender, match.receiver, db=db, allow_ai=False)
        match.compatibility_score = result.score
        match.compatibility_reason = result.reason
        updated = True
    if updated:
        db.commit()
    return matches


def list_suggestion_candidates(db: Session, current_user_id: int, limit: int) -> list[User]:
    existing_requests = db.scalars(
        select(Match).where(or_(Match.sender_id == current_user_id, Match.receiver_id == current_user_id))
    ).all()
    excluded_ids = {current_user_id}
    for request in existing_requests:
        excluded_ids.add(request.sender_id)
        excluded_ids.add(request.receiver_id)

    current_user = db.scalar(
        select(User)
        .options(
            selectinload(User.profile),
            selectinload(User.trip_memberships).selectinload(TripMember.trip),
        )
        .where(User.id == current_user_id)
    )
    if current_user is None:
        return []

    candidates = db.scalars(
        select(User)
        .options(
            selectinload(User.profile),
            selectinload(User.trip_memberships).selectinload(TripMember.trip),
        )
        .where(User.id.not_in(excluded_ids))
        .order_by(User.created_at.desc())
        .limit(limit * 2)  # Get more candidates for better sorting
    ).all()
    candidates = [
        user
        for user in candidates
        if get_match_eligibility(current_user, user, db=db).eligible
    ]

    def candidate_score(user: User) -> tuple[int, int]:
        eligibility = get_match_eligibility(current_user, user, db=db)
        trip_score = 0
        user_trips = [
            membership.trip
            for membership in getattr(user, "trip_memberships", [])
            if membership.status == TripMembershipStatus.approved
            and membership.trip.lifecycle_status not in [TripLifecycleStatus.completed, TripLifecycleStatus.cancelled]
        ]
        current_user_trips = [
            membership.trip
            for membership in getattr(current_user, "trip_memberships", [])
            if membership.status == TripMembershipStatus.approved
            and membership.trip.lifecycle_status not in [TripLifecycleStatus.completed, TripLifecycleStatus.cancelled]
        ]

        if user_trips and current_user_trips:
            max_overlap = 0.0
            for user_trip in user_trips:
                for curr_trip in current_user_trips:
                    overlap = calculate_date_overlap_score(curr_trip, user_trip)
                    max_overlap = max(max_overlap, overlap)
            trip_score = int(max_overlap * 50)

            user_destinations = {trip.location.lower() for trip in user_trips}
            curr_destinations = {trip.location.lower() for trip in current_user_trips}
            if user_destinations & curr_destinations:
                trip_score += 20

        date_score = _date_overlap_score(current_user, user)[0]
        eligibility_bonus = int(round(eligibility.overlap_score * 100))
        return (trip_score + date_score + eligibility_bonus, user.id)

    candidates.sort(key=candidate_score, reverse=True)

    return candidates[:limit]


def create_match_request(
    db: Session,
    current_user: User,
    target_user_id: int,
    request_context: dict[str, object] | None = None,
) -> Match:
    if target_user_id == current_user.id:
        raise ValueError("Cannot match with yourself")

    target_user = db.scalar(
        select(User)
        .options(
            selectinload(User.profile),
            selectinload(User.trip_memberships).selectinload(TripMember.trip),
        )
        .where(User.id == target_user_id)
    )
    if target_user is None:
        raise LookupError("Target user not found")
    eligibility = get_match_eligibility(current_user, target_user, db=db)
    if not eligibility.eligible:
        raise ValueError("; ".join(eligibility.reasons))

    existing = db.scalar(
        select(Match).where(
            or_(
                and_(Match.sender_id == current_user.id, Match.receiver_id == target_user_id),
                and_(Match.sender_id == target_user_id, Match.receiver_id == current_user.id),
            )
        )
    )
    if existing is not None:
        raise RuntimeError("Match request already exists")

    score_result = calculate_match_score(current_user, target_user, db=db, allow_ai=False, request_context=request_context)
    match_request = Match(
        sender_id=current_user.id,
        receiver_id=target_user_id,
        compatibility_score=score_result.score,
        compatibility_reason=score_result.reason,
    )
    db.add(match_request)
    create_notification(
        db=db,
        user_id=target_user_id,
        notification_type="match_request",
        message=f"{current_user.profile.name or current_user.email} sent you a match request",
        entity_id=match_request.id,
        entity_type=NOTIFICATION_ENTITY_TYPE_MATCH,
        commit=False,
    )
    # Track analytics event
    record_analytics_event(
        db=db,
        event_type="match_request_created",
        user_id=current_user.id,
        metadata={
            "target_user_id": target_user_id,
            "compatibility_score": score_result.score,
            "sender_id": current_user.id,
            "receiver_id": target_user_id,
        },
        commit=False,
    )
    
    # Invalidate match cache for both users
    from app.services.redis_runtime import invalidate_match_suggestions_cache
    invalidate_match_suggestions_cache(current_user.id)
    invalidate_match_suggestions_cache(target_user_id)
    
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise RuntimeError("Match request already exists") from exc
    match = db.scalar(
        select(Match)
        .options(
            selectinload(Match.sender).selectinload(User.profile),
            selectinload(Match.receiver).selectinload(User.profile),
        )
        .where(Match.id == match_request.id)
    )
    return match


def list_matches(db: Session, current_user_id: int) -> list[Match]:
    matches = db.scalars(
        select(Match)
        .options(
            selectinload(Match.sender).selectinload(User.profile),
            selectinload(Match.receiver).selectinload(User.profile),
        )
        .where(or_(Match.sender_id == current_user_id, Match.receiver_id == current_user_id))
        .order_by(Match.created_at.desc())
    ).all()
    return _populate_missing_match_scores(db, matches)


def list_received_matches(db: Session, current_user_id: int) -> list[Match]:
    matches = db.scalars(
        select(Match)
        .options(
            selectinload(Match.sender).selectinload(User.profile),
            selectinload(Match.receiver).selectinload(User.profile),
        )
        .where(Match.receiver_id == current_user_id)
        .order_by(Match.created_at.desc())
    ).all()
    return _populate_missing_match_scores(db, matches)


def list_sent_matches(db: Session, current_user_id: int) -> list[Match]:
    matches = db.scalars(
        select(Match)
        .options(
            selectinload(Match.sender).selectinload(User.profile),
            selectinload(Match.receiver).selectinload(User.profile),
        )
        .where(Match.sender_id == current_user_id)
        .order_by(Match.created_at.desc())
    ).all()
    return _populate_missing_match_scores(db, matches)


def update_match_status(db: Session, match_id: int, current_user_id: int, new_status: MatchStatus) -> Match:
    match_request = db.scalar(
        select(Match)
        .options(
            selectinload(Match.sender).selectinload(User.profile),
            selectinload(Match.receiver).selectinload(User.profile),
        )
        .where(Match.id == match_id)
    )
    if match_request is None:
        raise LookupError("Match request not found")
    if match_request.receiver_id != current_user_id:
        raise PermissionError("Not allowed to update this match")
    if match_request.status != MatchStatus.pending:
        raise RuntimeError("Match request already processed")

    match_request.status = new_status
    if new_status == MatchStatus.accepted:
        get_or_create_direct_conversation(db, match_request.sender, match_request.receiver)
        create_notification(
            db=db,
            user_id=match_request.sender_id,
            notification_type="match_accepted",
            message=f"{match_request.receiver.profile.name or match_request.receiver.email} accepted your match request",
            entity_id=match_request.id,
            entity_type=NOTIFICATION_ENTITY_TYPE_MATCH,
            commit=False,
        )
        # Track analytics event
        record_analytics_event(
            db=db,
            event_type="match_accepted",
            user_id=current_user_id,
            metadata={
                "match_id": match_id,
                "other_user_id": match_request.sender_id,
                "compatibility_score": match_request.compatibility_score,
            },
            commit=False,
        )
    elif new_status == MatchStatus.rejected:
        record_analytics_event(
            db=db,
            event_type="match_rejected",
            user_id=current_user_id,
            metadata={
                "match_id": match_id,
                "other_user_id": match_request.sender_id,
            },
            commit=False,
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise RuntimeError("Unable to update match status") from exc
    db.refresh(match_request)
    return match_request


# Background job functions for async processing

def _generate_match_suggestions_job(user_id: int, limit: int = 10) -> list[dict[str, Any]]:
    """Background job to generate match suggestions for a user.
    
    This runs asynchronously to avoid blocking API responses.
    """
    from app.db.session import SessionLocal
    
    db = SessionLocal()
    try:
        users = list_suggestion_candidates(db=db, current_user_id=user_id, limit=limit)
        # Store results in cache for quick retrieval
        cache_key = f"match:suggestions:user:{user_id}:limit:{limit}"
        response_payload = [
            {
                "id": user.id,
                "name": user.profile.name if user.profile else None,
                "avatar_url": getattr(user.profile, "avatar_url", None) if user.profile else None,
            }
            for user in users
        ]
        get_cache().set_json(cache_key, response_payload, ttl_seconds=MATCH_CACHE_TTL)
        return response_payload
    finally:
        db.close()


def enqueue_match_suggestions(user_id: int, limit: int = 10) -> str:
    """Enqueue a background job to generate match suggestions.
    
    Returns:
        Job ID
    """
    return enqueue_job(
        _generate_match_suggestions_job,
        user_id,
        limit,
        priority=JobPriority.DEFAULT,
    )
