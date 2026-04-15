from __future__ import annotations

from datetime import datetime, timedelta, timezone

import stripe
from fastapi import Depends, HTTPException, status
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.growth import Boost
from app.models.match import Match
from app.models.payments import Subscription
from app.models.trip import TripMember, TripMemberRole
from app.models.user import User
from app.services.analytics import (
    count_user_events_since,
    record_analytics_event,
    record_subscription_metrics_snapshot,
    utc_day_start,
)
from app.services.auth import get_current_user
from app.services.redis_runtime import invalidate_discover_cache
from app.utils.config import get_settings


FREE_PLAN = "free"
PREMIUM_PLAN = "premium"
STATUS_ACTIVE = "active"
STATUS_CANCELED = "canceled"
STATUS_EXPIRED = "expired"
BOOST_PROFILE = "profile"
BOOST_TRIP = "trip"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def build_premium_required_detail() -> dict[str, object]:
    return {
        "error": "premium_required",
        "message": "Upgrade to access this feature",
        "code": status.HTTP_403_FORBIDDEN,
    }


def raise_premium_required() -> None:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=build_premium_required_detail())


def _subscription_query(user_id: int):
    return (
        select(Subscription)
        .where(Subscription.user_id == user_id)
        .order_by(desc(Subscription.created_at), desc(Subscription.id))
    )


def get_current_subscription_record(db: Session, user_id: int) -> Subscription | None:
    return db.scalar(_subscription_query(user_id))


def _sync_expired_subscription(subscription: Subscription, *, now: datetime | None = None) -> bool:
    current = now or utcnow()
    if subscription.plan_type != PREMIUM_PLAN or subscription.status != STATUS_ACTIVE:
        return False
    if subscription.current_period_end is None or subscription.current_period_end > current:
        return False
    subscription.plan_type = FREE_PLAN
    subscription.status = STATUS_EXPIRED
    return True


def ensure_subscription_record(db: Session, user_id: int, *, commit: bool = True) -> Subscription:
    subscription = get_current_subscription_record(db, user_id)
    if subscription is not None:
        if _sync_expired_subscription(subscription):
            record_analytics_event(
                db,
                event_type="subscription_canceled",
                user_id=subscription.user_id,
                metadata={
                    "subscription_id": subscription.stripe_subscription_id,
                    "reason": "subscription_expired",
                },
                commit=False,
            )
            record_subscription_metrics_snapshot(db, reason="subscription_auto_expired", commit=False)
            invalidate_discover_cache()
            if commit:
                db.commit()
                db.refresh(subscription)
            else:
                db.flush()
        return subscription
    subscription = Subscription(
        user_id=user_id,
        plan_type=FREE_PLAN,
        status=STATUS_ACTIVE,
        current_period_end=None,
        stripe_customer_id=None,
        stripe_subscription_id=None,
    )
    db.add(subscription)
    if commit:
        db.commit()
        db.refresh(subscription)
    else:
        db.flush()
    return subscription


def is_premium_record(subscription: Subscription | None, now: datetime | None = None) -> bool:
    if subscription is None:
        return False
    current = now or utcnow()
    if subscription.plan_type != PREMIUM_PLAN or subscription.status != STATUS_ACTIVE:
        return False
    if subscription.current_period_end is not None and subscription.current_period_end <= current:
        return False
    return True


def get_subscription_payload(db: Session, user: User) -> dict[str, object]:
    subscription = ensure_subscription_record(db, user.id)
    return {
        "user_id": user.id,
        "plan_type": subscription.plan_type,
        "status": subscription.status,
        "current_period_end": subscription.current_period_end,
        "stripe_customer_id": subscription.stripe_customer_id or user.stripe_customer_id,
        "stripe_subscription_id": subscription.stripe_subscription_id,
        "is_premium": is_premium_record(subscription),
        "referral_code": user.referral_code,
    }


def get_current_subscription_map(db: Session, user_ids: list[int]) -> dict[int, Subscription]:
    if not user_ids:
        return {}
    subscriptions = db.scalars(
        select(Subscription)
        .where(Subscription.user_id.in_(user_ids))
        .order_by(Subscription.user_id.asc(), Subscription.created_at.desc(), Subscription.id.desc())
    ).all()
    subscription_map: dict[int, Subscription] = {}
    for subscription in subscriptions:
        subscription_map.setdefault(subscription.user_id, subscription)
    return subscription_map


def get_active_boost_user_ids(db: Session, *, user_ids: list[int], boost_type: str) -> set[int]:
    if not user_ids:
        return set()
    current = utcnow()
    boosts = db.scalars(
        select(Boost).where(
            Boost.user_id.in_(user_ids),
            Boost.boost_type == boost_type,
            Boost.expires_at > current,
        )
    ).all()
    return {boost.user_id for boost in boosts}


def activate_premium_subscription(
    db: Session,
    *,
    user_id: int,
    stripe_customer_id: str | None,
    stripe_subscription_id: str | None,
    current_period_end: datetime | None,
) -> Subscription:
    subscription = ensure_subscription_record(db, user_id)
    subscription.plan_type = PREMIUM_PLAN
    subscription.status = STATUS_ACTIVE
    subscription.current_period_end = current_period_end
    subscription.stripe_customer_id = stripe_customer_id
    subscription.stripe_subscription_id = stripe_subscription_id
    invalidate_discover_cache()
    return subscription


def expire_subscription(
    db: Session,
    *,
    user_id: int,
    stripe_subscription_id: str | None,
    status_value: str,
    current_period_end: datetime | None,
) -> Subscription:
    subscription = ensure_subscription_record(db, user_id)
    subscription.plan_type = FREE_PLAN
    subscription.status = status_value
    subscription.current_period_end = current_period_end
    subscription.stripe_subscription_id = stripe_subscription_id
    invalidate_discover_cache()
    return subscription


def _configure_stripe() -> None:
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Stripe is not configured")
    stripe.api_key = settings.stripe_secret_key


def cancel_current_subscription(db: Session, *, user: User) -> Subscription:
    subscription = ensure_subscription_record(db, user.id)
    if not is_premium_record(subscription):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active premium subscription")

    if subscription.stripe_subscription_id:
        _configure_stripe()
        try:
            stripe.Subscription.delete(subscription.stripe_subscription_id)
        except stripe.error.InvalidRequestError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stripe subscription not found") from exc
        except stripe.error.StripeError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe cancellation unavailable") from exc

    subscription.plan_type = FREE_PLAN
    subscription.status = STATUS_CANCELED
    subscription.current_period_end = utcnow()
    db.commit()
    db.refresh(subscription)
    record_analytics_event(
        db,
        event_type="subscription_canceled",
        user_id=user.id,
        metadata={"subscription_id": subscription.stripe_subscription_id},
        commit=True,
    )
    record_subscription_metrics_snapshot(db, reason="subscription_canceled")
    invalidate_discover_cache()
    return subscription


def require_premium(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    subscription = ensure_subscription_record(db, current_user.id)
    if not is_premium_record(subscription):
        raise_premium_required()
    return current_user


def _require_under_limit(current_count: int, limit: int, message: str) -> None:
    if current_count >= limit:
        raise_premium_required()


def enforce_match_request_limit(db: Session, user_id: int) -> None:
    subscription = ensure_subscription_record(db, user_id)
    if is_premium_record(subscription):
        return
    settings = get_settings()
    count = int(
        db.scalar(
            select(func.count(Match.id)).where(
                Match.sender_id == user_id,
                Match.created_at >= utc_day_start(),
            )
        )
        or 0
    )
    _require_under_limit(count, settings.free_daily_match_limit, "Daily match request limit reached for free plan")


def enforce_trip_join_limit(db: Session, user_id: int) -> None:
    subscription = ensure_subscription_record(db, user_id)
    if is_premium_record(subscription):
        return
    settings = get_settings()
    count = int(
        db.scalar(
            select(func.count(TripMember.id)).where(
                TripMember.user_id == user_id,
                TripMember.role != TripMemberRole.owner,
                TripMember.created_at >= utc_day_start(),
            )
        )
        or 0
    )
    _require_under_limit(count, settings.free_daily_trip_join_limit, "Daily trip join limit reached for free plan")


def enforce_ai_usage_limit(db: Session, user_id: int) -> None:
    subscription = ensure_subscription_record(db, user_id)
    if is_premium_record(subscription):
        return
    settings = get_settings()
    count = count_user_events_since(db, user_id=user_id, event_type="ai_usage", since=utc_day_start())
    _require_under_limit(count, settings.free_daily_ai_limit, "Daily AI usage limit reached for free plan")


def record_ai_usage(db: Session, *, user_id: int, ai_operation: str) -> None:
    record_analytics_event(
        db,
        event_type="ai_usage",
        user_id=user_id,
        metadata={"operation": ai_operation},
        commit=True,
    )


def grant_referral_premium_days(db: Session, *, user_id: int, reward_days: int) -> Subscription:
    subscription = ensure_subscription_record(db, user_id)
    base_time = subscription.current_period_end if is_premium_record(subscription) and subscription.current_period_end else utcnow()
    subscription.plan_type = PREMIUM_PLAN
    subscription.status = STATUS_ACTIVE
    subscription.current_period_end = base_time + timedelta(days=reward_days)
    db.flush()
    invalidate_discover_cache()
    return subscription


def expire_due_subscriptions(db: Session, *, now: datetime | None = None) -> int:
    current = now or utcnow()
    expired_subscriptions = db.scalars(
        select(Subscription).where(
            Subscription.plan_type == PREMIUM_PLAN,
            Subscription.status == STATUS_ACTIVE,
            Subscription.current_period_end.is_not(None),
            Subscription.current_period_end <= current,
        )
        .with_for_update(skip_locked=True)
    ).all()
    if not expired_subscriptions:
        return 0

    for subscription in expired_subscriptions:
        subscription.plan_type = FREE_PLAN
        subscription.status = STATUS_EXPIRED
        record_analytics_event(
            db,
            event_type="subscription_canceled",
            user_id=subscription.user_id,
            metadata={
                "subscription_id": subscription.stripe_subscription_id,
                "reason": "subscription_expired",
            },
            commit=False,
        )

    db.commit()
    invalidate_discover_cache()
    record_subscription_metrics_snapshot(db, reason="subscription_expired")
    return len(expired_subscriptions)
