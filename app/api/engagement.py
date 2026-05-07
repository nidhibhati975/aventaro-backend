from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.growth import AnalyticsEvent, Referral
from app.models.user import User
from app.services.analytics import record_analytics_event, utcnow
from app.services.auth import get_current_user
from app.services.growth import apply_referral_code, generate_referral_code, get_request_ip, resolve_referrer_by_code
from app.services.match import explain_match_score


router = APIRouter()

REFERRAL_REWARD_TIERS = [
    {"id": "tier_1", "tier": 1, "name": "Welcome Bonus", "description": "Referral milestone reward", "required_referrals": 3, "reward_value": 100, "reward_type": "points"},
    {"id": "tier_2", "tier": 2, "name": "Silver Explorer", "description": "Referral milestone reward", "required_referrals": 5, "reward_value": 250, "reward_type": "points"},
    {"id": "tier_3", "tier": 3, "name": "Gold Traveler", "description": "Referral milestone reward", "required_referrals": 10, "reward_value": 500, "reward_type": "points"},
    {"id": "tier_4", "tier": 4, "name": "Platinum Adventurer", "description": "Referral milestone reward", "required_referrals": 20, "reward_value": 1000, "reward_type": "points"},
    {"id": "tier_5", "tier": 5, "name": "Diamond Voyager", "description": "Referral milestone reward", "required_referrals": 50, "reward_value": 2500, "reward_type": "premium"},
]


class ReferralCodePayload(BaseModel):
    code: str | None = None
    referral_code: str | None = None


class ReferralClaimPayload(BaseModel):
    reward_id: str | None = None
    tier: int | None = None


class ReferralFraudCheckPayload(BaseModel):
    referee_id: int | None = None
    referrer_id: int | None = None
    referral_code: str


class ReferralReportPayload(BaseModel):
    type: str = Field(max_length=40)
    details: dict[str, Any] = Field(default_factory=dict)
    timestamp: str | None = None


class BehaviorSwipePayload(BaseModel):
    swipes: list[dict[str, Any]] = Field(default_factory=list)


class BehaviorPreferencePayload(BaseModel):
    preferences: list[dict[str, Any]] = Field(default_factory=list)


class BehaviorRankingBatchPayload(BaseModel):
    target_user_ids: list[int] = Field(default_factory=list, max_length=100)


def _ensure_referral_code(db: Session, user: User) -> str:
    if user.referral_code:
        return user.referral_code
    user.referral_code = generate_referral_code(user.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        user.referral_code = f"{generate_referral_code(user.id)}X"
        db.commit()
    db.refresh(user)
    return user.referral_code or generate_referral_code(user.id)


def _referral_counts(db: Session, user_id: int) -> dict[str, int]:
    total = int(db.scalar(select(func.count(Referral.id)).where(Referral.referrer_id == user_id)) or 0)
    successful = int(
        db.scalar(
            select(func.count(Referral.id)).where(
                Referral.referrer_id == user_id,
                Referral.reward_given.is_(True),
                Referral.suspicious.is_(False),
            )
        )
        or 0
    )
    pending = max(total - successful, 0)
    return {"total": total, "successful": successful, "pending": pending}


def _current_tier(successful_referrals: int) -> int:
    tier = 0
    for item in REFERRAL_REWARD_TIERS:
        if successful_referrals >= int(item["required_referrals"]):
            tier = int(item["tier"])
    return tier


def _next_tier_at(successful_referrals: int) -> int:
    for item in REFERRAL_REWARD_TIERS:
        required = int(item["required_referrals"])
        if successful_referrals < required:
            return required
    return int(REFERRAL_REWARD_TIERS[-1]["required_referrals"])


def _referral_stats(db: Session, user: User) -> dict[str, Any]:
    code = _ensure_referral_code(db, user)
    counts = _referral_counts(db, user.id)
    earned = [
        str(item["id"])
        for item in REFERRAL_REWARD_TIERS
        if counts["successful"] >= int(item["required_referrals"])
    ]
    return {
        "referral_code": code,
        "total_referrals": counts["total"],
        "successful_referrals": counts["successful"],
        "pending_referrals": counts["pending"],
        "total_rewards": len(earned),
        "rewards_earned": earned,
        "current_tier": _current_tier(counts["successful"]),
        "next_tier_at": _next_tier_at(counts["successful"]),
    }


def _serialize_referral(referral: Referral, code: str) -> dict[str, Any]:
    return {
        "id": referral.id,
        "referrer_id": referral.referrer_id,
        "referee_id": referral.referred_user_id,
        "referral_code": code,
        "status": "rewarded" if referral.reward_given else "pending",
        "rewarded_at": referral.created_at.isoformat() if referral.reward_given else None,
        "reward_amount": 1 if referral.reward_given else 0,
        "created_at": referral.created_at.isoformat(),
    }


def _streak_payload(db: Session, user_id: int) -> dict[str, Any]:
    events = db.scalars(
        select(AnalyticsEvent)
        .where(AnalyticsEvent.user_id == user_id, AnalyticsEvent.event_type == "daily_login")
        .order_by(AnalyticsEvent.created_at.desc())
        .limit(400)
    ).all()
    dates = sorted({event.created_at.date() for event in events if event.created_at}, reverse=True)
    date_set = set(dates)
    today = utcnow().date()
    cursor = today if today in date_set else today - timedelta(days=1)
    current_streak = 0
    while cursor in date_set:
        current_streak += 1
        cursor -= timedelta(days=1)
    longest_streak = 0
    run = 0
    previous: date | None = None
    for item in sorted(date_set):
        if previous is not None and item == previous + timedelta(days=1):
            run += 1
        else:
            run = 1
        longest_streak = max(longest_streak, run)
        previous = item
    next_milestone = 7 if current_streak < 7 else 30 if current_streak < 30 else 100
    return {
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "last_active_date": dates[0].isoformat() if dates else "",
        "next_milestone": next_milestone,
        "next_milestone_reward": "Profile Boost" if next_milestone == 7 else "Premium Reward",
    }


def _default_preference_profile(user_id: int) -> dict[str, Any]:
    now = utcnow().isoformat()
    return {
        "user_id": user_id,
        "preferred_destinations": [],
        "preferred_travel_styles": [],
        "preferred_budget_min": 0,
        "preferred_budget_max": 0,
        "preferred_trip_duration": {"min": 0, "max": 0},
        "preferred_age_range": {"min": 18, "max": 99},
        "preferred_distance": 0,
        "preferred_interests": [],
        "active_hours": [],
        "preferred_session_length": 0,
        "notification_response_rate": 0,
        "updated_at": now,
    }


def _swipe_behavior(db: Session, user_id: int) -> dict[str, Any]:
    swipes = db.scalars(
        select(AnalyticsEvent)
        .where(AnalyticsEvent.user_id == user_id, AnalyticsEvent.event_type == "behavior_swipe")
        .order_by(AnalyticsEvent.created_at.desc())
        .limit(1000)
    ).all()
    right = left = up = 0
    for event in swipes:
        direction = (event.event_metadata or {}).get("direction")
        if direction == "right":
            right += 1
        elif direction == "left":
            left += 1
        elif direction == "up":
            up += 1
    total = right + left + up
    last = swipes[0].created_at.isoformat() if swipes else ""
    return {
        "user_id": user_id,
        "total_swipes": total,
        "swipe_right": right,
        "swipe_left": left,
        "swipe_up": up,
        "match_rate": round(right / total, 4) if total else 0,
        "avg_response_time": 0,
        "last_swipe_at": last,
        "updated_at": utcnow().isoformat(),
    }


def _behavior_profile(db: Session, user_id: int) -> dict[str, Any]:
    swipe_behavior = _swipe_behavior(db, user_id)
    total_swipes = int(swipe_behavior["total_swipes"])
    engagement_level = "high" if total_swipes >= 50 else "medium" if total_swipes >= 10 else "low"
    streak = _streak_payload(db, user_id)
    return {
        "user_id": user_id,
        "swipe_behavior": swipe_behavior,
        "preference_profile": _default_preference_profile(user_id),
        "match_rankings": [],
        "engagement_level": engagement_level,
        "streak_data": {
            "current_streak": streak["current_streak"],
            "best_streak": streak["longest_streak"],
            "last_active_at": streak["last_active_date"],
        },
        "last_synced_at": utcnow().isoformat(),
    }


def _ranking_payload(db: Session, user: User, target_user_id: int) -> dict[str, Any]:
    target = db.scalar(
        select(User)
        .options(selectinload(User.profile), selectinload(User.owned_trips))
        .where(User.id == target_user_id)
    )
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")
    explanation = explain_match_score(user, target, db=db)
    score = round(float(explanation.score), 4)
    breakdown = explanation.breakdown
    return {
        "user_id": user.id,
        "target_user_id": target_user_id,
        "compatibility_score": score,
        "behavioral_score": float((breakdown.get("behavior") or {}).get("normalized") or 0),
        "preference_score": score,
        "final_score": score,
        "factors": {
            "travel_compatibility": float((breakdown.get("destination") or {}).get("normalized") or score),
            "interest_overlap": float((breakdown.get("interest") or {}).get("normalized") or 0),
            "activity_match": float((breakdown.get("behavior") or {}).get("normalized") or 0),
            "recency_score": float((breakdown.get("recency") or {}).get("normalized") or 0),
        },
        "updated_at": utcnow().isoformat(),
    }


@router.get("/user/streak")
def get_user_streak(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return _streak_payload(db, current_user.id)


@router.post("/user/streak/activity")
def record_user_streak_activity(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    today_start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    existing = db.scalar(
        select(AnalyticsEvent.id).where(
            AnalyticsEvent.user_id == current_user.id,
            AnalyticsEvent.event_type == "daily_login",
            AnalyticsEvent.created_at >= today_start,
        )
    )
    if existing is None:
        record_analytics_event(
            db,
            event_type="daily_login",
            user_id=current_user.id,
            metadata={"source": "streak"},
            commit=True,
        )
    return _streak_payload(db, current_user.id)


@router.get("/user/referral")
def get_user_referral(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return _referral_stats(db, current_user)


@router.post("/user/referral/apply")
def apply_user_referral(
    payload: ReferralCodePayload,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    code = payload.code or payload.referral_code
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Referral code is required")
    apply_referral_code(db, referred_user=current_user, referral_code=code, referral_ip=get_request_ip(request))
    return {"success": True, "message": "Referral applied"}


@router.get("/user/referral/rewards")
def get_user_referral_rewards(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    stats = _referral_stats(db, current_user)
    earned = set(stats["rewards_earned"])
    return [{**item, "is_claimed": item["id"] in earned} for item in REFERRAL_REWARD_TIERS]


@router.post("/user/referral/claim")
def claim_user_referral_reward(
    payload: ReferralClaimPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    stats = _referral_stats(db, current_user)
    reward_id = payload.reward_id or (f"tier_{payload.tier}" if payload.tier else None)
    if not reward_id or reward_id not in set(stats["rewards_earned"]):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Referral reward is not available")
    return {"success": True, "message": "Referral reward available"}


@router.get("/referral/code")
def get_referral_code(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    stats = _referral_stats(db, current_user)
    return {
        "code": stats["referral_code"],
        "user_id": current_user.id,
        "created_at": current_user.created_at.isoformat(),
        "usage_count": stats["total_referrals"],
        "reward_tier": stats["current_tier"],
        "is_active": True,
    }


@router.post("/referral/validate")
def validate_referral_code(
    payload: ReferralCodePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    code = payload.code or payload.referral_code
    if not code:
        return {"valid": False, "error": "Referral code is required"}
    referrer = resolve_referrer_by_code(db, code)
    if referrer.id == current_user.id:
        return {"valid": False, "error": "Cannot use your own referral code"}
    return {"valid": True, "referrer_id": referrer.id, "reward_available": True}


@router.post("/referral/track")
def track_referral(
    payload: ReferralCodePayload,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    code = payload.referral_code or payload.code
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Referral code is required")
    referral = apply_referral_code(db, referred_user=current_user, referral_code=code, referral_ip=get_request_ip(request))
    return _serialize_referral(referral, code.strip().upper())


@router.get("/referral/status")
def get_referral_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    referral = db.scalar(select(Referral).where(Referral.referred_user_id == current_user.id))
    if referral is None:
        return {"was_referred": False}
    referrer = db.scalar(select(User).where(User.id == referral.referrer_id))
    return {
        "was_referred": True,
        "referrer_id": referral.referrer_id,
        "referral_code": referrer.referral_code if referrer else None,
    }


@router.get("/referral/stats")
def get_referral_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return _referral_stats(db, current_user)


@router.get("/referral/pending-rewards")
def get_pending_referral_rewards(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    stats = _referral_stats(db, current_user)
    return [
        item
        for item in REFERRAL_REWARD_TIERS
        if stats["successful_referrals"] >= int(item["required_referrals"])
    ]


@router.post("/referral/claim")
def claim_referral_reward(
    payload: ReferralClaimPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return claim_user_referral_reward(payload, db, current_user)


@router.post("/referral/fraud-check")
def check_referral_fraud(
    payload: ReferralFraudCheckPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    referrer = resolve_referrer_by_code(db, payload.referral_code)
    referee_id = payload.referee_id or current_user.id
    if payload.referrer_id is not None and payload.referrer_id != referrer.id:
        return {"is_valid": False, "reason": "referrer_mismatch"}
    if referrer.id == referee_id:
        return {"is_valid": False, "reason": "self_referral"}
    existing = db.scalar(select(Referral.id).where(Referral.referred_user_id == referee_id))
    if existing is not None:
        return {"is_valid": False, "reason": "duplicate_referral"}
    return {"is_valid": True}


@router.post("/referral/report")
def report_referral_issue(
    payload: ReferralReportPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    record_analytics_event(
        db,
        event_type="referral_report",
        user_id=current_user.id,
        metadata={"type": payload.type, "details": payload.details, "timestamp": payload.timestamp},
        commit=True,
    )
    return {"success": True}


@router.post("/behavior/swipes")
def record_behavior_swipes(
    payload: BehaviorSwipePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, int]:
    accepted = 0
    for item in payload.swipes:
        record_analytics_event(db, event_type="behavior_swipe", user_id=current_user.id, metadata=item, commit=False)
        accepted += 1
    db.commit()
    return {"accepted": accepted}


@router.post("/behavior/preferences")
def record_behavior_preferences(
    payload: BehaviorPreferencePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, int]:
    accepted = 0
    for item in payload.preferences:
        record_analytics_event(db, event_type="behavior_preference", user_id=current_user.id, metadata=item, commit=False)
        accepted += 1
    db.commit()
    return {"accepted": accepted}


@router.get("/behavior/profile")
def get_behavior_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return _behavior_profile(db, current_user.id)


@router.get("/behavior/ranking/{target_user_id}")
def get_behavior_ranking(
    target_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return _ranking_payload(db, current_user, target_user_id)


@router.post("/behavior/ranking/batch")
def get_behavior_rankings_batch(
    payload: BehaviorRankingBatchPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return [_ranking_payload(db, current_user, target_id) for target_id in payload.target_user_ids]
