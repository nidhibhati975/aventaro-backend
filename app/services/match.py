from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.match import Match, MatchStatus
from app.models.user import User
from app.services.ai.openai_client import generate_response_sync
from app.services.chat import get_or_create_direct_conversation
from app.services.notifications import create_notification
from app.services.redis_runtime import build_cache_key, get_cache
from app.utils.config import get_settings


logger = logging.getLogger("aventaro.ai")


@dataclass(frozen=True)
class MatchScoreResult:
    score: int
    reason: str


def _normalized_tags(values: list[str] | None) -> set[str]:
    if not values:
        return set()
    return {value.strip().lower() for value in values if value and value.strip()}


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
    if profile1 is None or profile2 is None or not profile1.location or not profile2.location:
        return (0, None)
    left = profile1.location.strip().lower()
    right = profile2.location.strip().lower()
    if left == right:
        return (15, "same location")
    if left in right or right in left:
        return (10, "nearby location")
    return (0, None)


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


def _deterministic_match_score(user1: User, user2: User) -> MatchScoreResult:
    score = 0
    reasons: list[str] = []
    for score_part, reason in (
        _interest_score(user1, user2),
        _budget_overlap_score(user1, user2),
        _travel_style_score(user1, user2),
        _location_score(user1, user2),
    ):
        score += score_part
        if reason:
            reasons.append(reason)

    if not reasons:
        reasons.append("limited shared profile details")
    return MatchScoreResult(score=min(score, 100), reason="; ".join(reasons)[:255])


def calculate_match_score(
    user1: User,
    user2: User,
    *,
    allow_ai: bool = True,
    request_context: dict[str, object] | None = None,
) -> MatchScoreResult:
    settings = get_settings()
    base_result = _deterministic_match_score(user1, user2)
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
    }


def _populate_missing_match_scores(db: Session, matches: list[Match]) -> list[Match]:
    updated = False
    for match in matches:
        if match.compatibility_score is not None:
            continue
        result = calculate_match_score(match.sender, match.receiver, allow_ai=False)
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

    return db.scalars(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id.not_in(excluded_ids))
        .order_by(User.created_at.desc())
        .limit(limit)
    ).all()


def create_match_request(
    db: Session,
    current_user: User,
    target_user_id: int,
    request_context: dict[str, object] | None = None,
) -> Match:
    if target_user_id == current_user.id:
        raise ValueError("Cannot match with yourself")

    target_user = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == target_user_id))
    if target_user is None:
        raise LookupError("Target user not found")

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

    score_result = calculate_match_score(current_user, target_user, request_context=request_context)
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
        commit=False,
    )
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
            commit=False,
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise RuntimeError("Unable to update match status") from exc
    db.refresh(match_request)
    return match_request
