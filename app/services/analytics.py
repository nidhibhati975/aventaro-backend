from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.growth import AnalyticsEvent
from app.models.payments import Payment, Subscription
from app.utils.config import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def utc_day_start(now: datetime | None = None) -> datetime:
    current = now or utcnow()
    return current.replace(hour=0, minute=0, second=0, microsecond=0)


def record_analytics_event(
    db: Session,
    *,
    event_type: str,
    user_id: int | None,
    metadata: dict[str, object] | None = None,
    commit: bool = True,
) -> AnalyticsEvent:
    event = AnalyticsEvent(
        user_id=user_id,
        event_type=event_type,
        event_metadata=metadata,
    )
    db.add(event)
    if commit:
        db.commit()
        db.refresh(event)
    return event


def count_user_events_since(db: Session, *, user_id: int, event_type: str, since: datetime) -> int:
    return int(
        db.scalar(
            select(func.count(AnalyticsEvent.id)).where(
                AnalyticsEvent.user_id == user_id,
                AnalyticsEvent.event_type == event_type,
                AnalyticsEvent.created_at >= since,
            )
        )
        or 0
    )


def get_revenue_total(db: Session) -> int:
    return int(db.scalar(select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.status == "paid")) or 0)


def get_active_subscriptions(db: Session, *, now: datetime | None = None) -> int:
    current = now or utcnow()
    return int(
        db.scalar(
            select(func.count(Subscription.id)).where(
                Subscription.plan_type == "premium",
                Subscription.status == "active",
                or_(Subscription.current_period_end.is_(None), Subscription.current_period_end > current),
            )
        )
        or 0
    )


def get_churn_rate(db: Session, *, now: datetime | None = None) -> float:
    current = now or utcnow()
    settings = get_settings()
    since = current - timedelta(days=settings.analytics_metrics_window_days)
    canceled = int(
        db.scalar(
            select(func.count(AnalyticsEvent.id)).where(
                AnalyticsEvent.event_type == "subscription_canceled",
                AnalyticsEvent.created_at >= since,
            )
        )
        or 0
    )
    active = get_active_subscriptions(db, now=current)
    denominator = max(active + canceled, 1)
    return round(canceled / denominator, 4)


def record_subscription_metrics_snapshot(
    db: Session,
    *,
    reason: str,
    commit: bool = True,
) -> AnalyticsEvent:
    db.flush()
    return record_analytics_event(
        db,
        event_type="subscription_metrics",
        user_id=None,
        metadata={
            "reason": reason,
            "revenue_total": get_revenue_total(db),
            "active_subscriptions": get_active_subscriptions(db),
            "churn_rate": get_churn_rate(db),
        },
        commit=commit,
    )
