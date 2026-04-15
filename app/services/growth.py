from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.growth import Boost, Referral
from app.models.user import User
from app.services.analytics import record_analytics_event, record_subscription_metrics_snapshot
from app.services.redis_runtime import invalidate_discover_cache
from app.services.subscriptions import BOOST_PROFILE, BOOST_TRIP, grant_referral_premium_days, utcnow
from app.utils.config import get_settings


logger = logging.getLogger(__name__)


def generate_referral_code(user_id: int) -> str:
    return f"AV{user_id:06d}"


def get_request_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        first_hop = forwarded_for.split(",", maxsplit=1)[0].strip()
        if first_hop:
            return first_hop
    if request.client and request.client.host:
        return request.client.host
    return None


def resolve_referrer_by_code(db: Session, referral_code: str) -> User:
    normalized_code = referral_code.strip().upper()
    referrer = db.scalar(select(User).where(User.referral_code == normalized_code))
    if referrer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Referral code not found")
    return referrer


def create_or_refresh_boost(db: Session, *, user_id: int, boost_type: str) -> Boost:
    if boost_type not in {BOOST_PROFILE, BOOST_TRIP}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid boost type")
    settings = get_settings()
    duration_hours = settings.profile_boost_hours if boost_type == BOOST_PROFILE else settings.trip_boost_hours
    current = utcnow()
    boost = db.scalar(
        select(Boost)
        .where(Boost.user_id == user_id, Boost.boost_type == boost_type)
        .with_for_update()
        .order_by(Boost.expires_at.desc(), Boost.id.desc())
    )
    if boost is None:
        boost = Boost(
            user_id=user_id,
            boost_type=boost_type,
            last_activated_at=current,
            expires_at=current + timedelta(hours=duration_hours),
        )
        db.add(boost)
    else:
        if boost.expires_at > current:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Boost already active")
        cooldown_cutoff = current - timedelta(hours=settings.boost_cooldown_hours)
        if boost.last_activated_at > cooldown_cutoff:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Boost cooldown active")
        boost.last_activated_at = current
        boost.expires_at = current + timedelta(hours=duration_hours)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Boost already active") from exc
    db.refresh(boost)
    record_analytics_event(
        db,
        event_type="boost_used",
        user_id=user_id,
        metadata={
            "boost_type": boost_type,
            "expires_at": boost.expires_at.isoformat(),
            "last_activated_at": boost.last_activated_at.isoformat(),
        },
        commit=True,
    )
    invalidate_discover_cache()
    return boost


def apply_referral_code(
    db: Session,
    *,
    referred_user: User,
    referral_code: str,
    referral_ip: str | None,
    commit: bool = True,
) -> Referral:
    referrer = resolve_referrer_by_code(db, referral_code)
    if referrer.id == referred_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot use your own referral code")

    existing = db.scalar(select(Referral).where(Referral.referred_user_id == referred_user.id))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Referral already used")
    if referral_ip:
        suspicious_duplicate = db.scalar(
            select(Referral).where(
                Referral.referrer_id == referrer.id,
                Referral.referral_ip == referral_ip,
            )
        )
        if suspicious_duplicate is not None:
            logger.warning(
                "Blocked suspicious referral reuse",
                extra={
                    "referrer_id": referrer.id,
                    "referred_user_id": referred_user.id,
                    "referral_ip": referral_ip,
                },
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Suspicious referral activity detected")

    referral = Referral(
        referrer_id=referrer.id,
        referred_user_id=referred_user.id,
        referral_ip=referral_ip,
        reward_given=True,
        suspicious=False,
    )
    db.add(referral)
    grant_referral_premium_days(
        db,
        user_id=referrer.id,
        reward_days=get_settings().referral_reward_premium_days,
    )
    record_analytics_event(
        db,
        event_type="referral_used",
        user_id=referrer.id,
        metadata={"referred_user_id": referred_user.id, "referral_ip": referral_ip},
        commit=False,
    )
    record_subscription_metrics_snapshot(db, reason="referral_reward", commit=False)
    if commit:
        db.commit()
        db.refresh(referral)
    else:
        db.flush()
    invalidate_discover_cache()
    return referral
