from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.analytics import ClientAnalyticsEvent
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
        event_id=uuid4().hex,
        user_id=user_id,
        event_type=event_type,
        schema_version="1.0",
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


def ingest_client_events(
    db: Session,
    *,
    user_id: int,
    events: list[dict[str, object]],
) -> dict[str, int]:
    accepted = 0
    duplicates = 0
    rejected = 0
    for item in events:
        event_id = str(item.get("id") or item.get("event_id") or uuid4().hex).strip()
        event_type = str(item.get("event_type") or item.get("eventType") or "").strip()
        if not event_type:
            rejected += 1
            continue
        timestamp_value = item.get("timestamp")
        client_timestamp = None
        if isinstance(timestamp_value, str) and timestamp_value:
            try:
                client_timestamp = datetime.fromisoformat(timestamp_value.replace("Z", "+00:00"))
            except ValueError:
                client_timestamp = None
        if db.scalar(select(ClientAnalyticsEvent.id).where(ClientAnalyticsEvent.event_id == event_id)) is not None:
            duplicates += 1
            continue
        event = ClientAnalyticsEvent(
            event_id=event_id,
            user_id=user_id,
            event_type=event_type[:80],
            schema_version=str(item.get("schema_version") or item.get("schemaVersion") or "1.0")[:16],
            session_id=str(item.get("session_id") or item.get("sessionId") or "")[:128] or None,
            source=str(item.get("source") or "mobile")[:32],
            client_timestamp=client_timestamp,
            properties=item.get("properties") if isinstance(item.get("properties"), dict) else None,
        )
        try:
            with db.begin_nested():
                db.add(event)
                db.flush()
            accepted += 1
        except IntegrityError:
            duplicates += 1
    db.commit()
    return {"accepted": accepted, "duplicates": duplicates, "rejected": rejected}


# Phase 3: Enhanced Analytics Functions

def track_event(
    event_type: str,
    user_id: int | None = None,
    entity_id: int | None = None,
    entity_type: str | None = None,
    metadata: dict[str, object] | None = None,
) -> None:
    """Track an analytics event via structured logging.
    
    In production, this could also write to a dedicated analytics DB/warehouse.
    """
    logger = logging.getLogger("aventaro.analytics")
    logger.info(
        "analytics_event",
        extra={
            "event_type": "analytics",
            "analytics_event_type": event_type,
            "user_id": user_id,
            "entity_id": entity_id,
            "entity_type": entity_type,
            "metadata": metadata or {},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


def calculate_match_success_rate(
    db: Session,
    days: int = 30,
) -> dict[str, object]:
    """Calculate match acceptance rate over a period."""
    from app.models.match import Match, MatchStatus
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    
    total_matches = db.scalar(
        select(func.count(Match.id))
        .where(Match.created_at >= cutoff)
    ) or 0
    
    accepted = db.scalar(
        select(func.count(Match.id))
        .where(
            Match.created_at >= cutoff,
            Match.status == MatchStatus.accepted,
        )
    ) or 0
    
    rejected = db.scalar(
        select(func.count(Match.id))
        .where(
            Match.created_at >= cutoff,
            Match.status == MatchStatus.rejected,
        )
    ) or 0
    
    pending = total_matches - accepted - rejected
    acceptance_rate = (accepted / total_matches * 100) if total_matches > 0 else 0
    
    return {
        "period_days": days,
        "total_matches": total_matches,
        "accepted": accepted,
        "rejected": rejected,
        "pending": pending,
        "acceptance_rate": round(acceptance_rate, 2),
    }


def calculate_trip_join_rate(
    db: Session,
    days: int = 30,
) -> dict[str, object]:
    """Calculate trip join/approval rate over a period."""
    from app.models.trip import TripMember, TripMembershipStatus
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    
    total_requests = db.scalar(
        select(func.count(TripMember.id))
        .where(TripMember.created_at >= cutoff)
    ) or 0
    
    approved = db.scalar(
        select(func.count(TripMember.id))
        .where(
            TripMember.created_at >= cutoff,
            TripMember.status == TripMembershipStatus.approved,
        )
    ) or 0
    
    pending = db.scalar(
        select(func.count(TripMember.id))
        .where(
            TripMember.created_at >= cutoff,
            TripMember.status == TripMembershipStatus.pending,
        )
    ) or 0
    
    join_rate = (approved / total_requests * 100) if total_requests > 0 else 0
    
    return {
        "period_days": days,
        "total_requests": total_requests,
        "approved": approved,
        "pending": pending,
        "join_rate": round(join_rate, 2),
    }


def calculate_booking_conversion_rate(
    db: Session,
    days: int = 30,
) -> dict[str, object]:
    """Calculate booking conversion rate (created -> completed)."""
    from app.models.booking import Booking, BookingStatus
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    
    total_created = db.scalar(
        select(func.count(Booking.id))
        .where(Booking.created_at >= cutoff)
    ) or 0
    
    completed = db.scalar(
        select(func.count(Booking.id))
        .where(
            Booking.created_at >= cutoff,
            Booking.status == BookingStatus.completed,
        )
    ) or 0
    
    cancelled = db.scalar(
        select(func.count(Booking.id))
        .where(
            Booking.created_at >= cutoff,
            Booking.status == BookingStatus.cancelled,
        )
    ) or 0
    
    conversion_rate = (completed / total_created * 100) if total_created > 0 else 0
    
    return {
        "period_days": days,
        "total_created": total_created,
        "completed": completed,
        "cancelled": cancelled,
        "conversion_rate": round(conversion_rate, 2),
    }


def get_analytics_summary(
    db: Session,
    days: int = 30,
) -> dict[str, object]:
    """Get comprehensive analytics summary."""
    return {
        "period_days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "match_success_rate": calculate_match_success_rate(db, days),
        "trip_join_rate": calculate_trip_join_rate(db, days),
        "booking_conversion_rate": calculate_booking_conversion_rate(db, days),
    }
