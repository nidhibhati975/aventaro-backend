"""Analytics API endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user, require_admin
from app.services.analytics import (
    calculate_booking_conversion_rate,
    calculate_match_success_rate,
    calculate_trip_join_rate,
    get_analytics_summary,
    ingest_client_events,
)


router = APIRouter(prefix="/analytics")


class AnalyticsSummaryResponse(BaseModel):
    period_days: int
    generated_at: str
    match_success_rate: dict
    trip_join_rate: dict
    booking_conversion_rate: dict


class ClientAnalyticsEventIn(BaseModel):
    id: str | None = Field(default=None, max_length=128)
    event_id: str | None = Field(default=None, max_length=128)
    event_type: str = Field(min_length=1, max_length=80)
    timestamp: str | None = None
    properties: dict[str, object] | None = None
    session_id: str | None = Field(default=None, max_length=128)
    schema_version: str | None = Field(default="1.0", max_length=16)
    source: str | None = Field(default="mobile", max_length=32)


class ClientAnalyticsBatchIn(BaseModel):
    events: list[ClientAnalyticsEventIn] = Field(min_length=1, max_length=100)


class ClientAnalyticsIngestResponse(BaseModel):
    accepted: int
    duplicates: int
    rejected: int = 0


@router.post("/events", response_model=ClientAnalyticsIngestResponse)
def ingest_events(
    payload: ClientAnalyticsBatchIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ClientAnalyticsIngestResponse:
    result = ingest_client_events(
        db,
        user_id=current_user.id,
        events=[event.model_dump(mode="json") for event in payload.events],
    )
    return ClientAnalyticsIngestResponse(**result)


@router.get("/summary", response_model=AnalyticsSummaryResponse)
def get_analytics_summary_endpoint(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AnalyticsSummaryResponse:
    """Get comprehensive analytics summary for the platform."""
    summary = get_analytics_summary(db=db, days=days)
    return AnalyticsSummaryResponse(**summary)


@router.get("/matches", response_model=dict)
def get_match_analytics(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict:
    """Get match success rate analytics."""
    return calculate_match_success_rate(db=db, days=days)


@router.get("/trips", response_model=dict)
def get_trip_analytics(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict:
    """Get trip join rate analytics."""
    return calculate_trip_join_rate(db=db, days=days)


@router.get("/bookings", response_model=dict)
def get_booking_analytics(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict:
    """Get booking conversion rate analytics."""
    return calculate_booking_conversion_rate(db=db, days=days)
