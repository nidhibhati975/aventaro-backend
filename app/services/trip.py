from __future__ import annotations

from datetime import date, datetime, timezone
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.trip import (
    Trip,
    TripLifecycleStatus,
    TripMember,
    TripMemberRole,
    TripMembershipStatus,
    TripStatus,
    TripVisibility,
)
from app.models.user import User
from app.services.analytics import record_analytics_event
from app.services.notifications import create_notification
from app.services.trip_collaboration import ensure_trip_group_conversation, log_trip_activity


def _normalize_datetime_to_utc(dt: datetime | None) -> datetime | None:
    """Normalize a datetime to UTC timezone."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        # Assume naive datetime is in UTC
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


LIFECYCLE_TRANSITIONS: dict[TripLifecycleStatus, set[TripLifecycleStatus]] = {
    TripLifecycleStatus.draft: {TripLifecycleStatus.planned, TripLifecycleStatus.cancelled},
    TripLifecycleStatus.planned: {TripLifecycleStatus.active, TripLifecycleStatus.cancelled},
    TripLifecycleStatus.active: {TripLifecycleStatus.completed, TripLifecycleStatus.cancelled},
    TripLifecycleStatus.completed: set(),
    TripLifecycleStatus.cancelled: set(),
}


def validate_lifecycle_transition(current_status: TripLifecycleStatus, new_status: TripLifecycleStatus) -> bool:
    if current_status == new_status:
        return True
    return new_status in LIFECYCLE_TRANSITIONS.get(current_status, set())


def ensure_trip_allows_join_requests(trip: Trip) -> None:
    if trip.lifecycle_status == TripLifecycleStatus.draft:
        raise RuntimeError("Trip is still in draft state")
    if trip.lifecycle_status == TripLifecycleStatus.completed:
        raise RuntimeError("Cannot join a completed trip")
    if trip.lifecycle_status == TripLifecycleStatus.cancelled:
        raise RuntimeError("Cannot join a cancelled trip")


def ensure_trip_mutable(trip: Trip) -> None:
    if trip.lifecycle_status == TripLifecycleStatus.completed:
        raise RuntimeError("Cannot modify a completed trip")
    if trip.lifecycle_status == TripLifecycleStatus.cancelled:
        raise RuntimeError("Cannot modify a cancelled trip")


def is_trip_visible_to_user(trip: Trip, user_id: int) -> bool:
    """Check if a trip is visible to a user based on visibility settings and membership."""
    if trip.visibility == TripVisibility.public:
        return True
    # Private trips are only visible to owners and approved members
    return trip.owner_id == user_id or any(
        member.user_id == user_id and member.status == TripMembershipStatus.approved
        for member in trip.members
    )


def fetch_trip_with_members(db: Session, trip_id: int) -> Trip | None:
    return db.scalar(
        select(Trip)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Trip.owner).selectinload(User.profile),
            selectinload(Trip.members).selectinload(TripMember.user).selectinload(User.profile),
        )
        .where(Trip.id == trip_id)
    )


def list_trips(db: Session) -> list[Trip]:
    return db.scalars(
        select(Trip)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Trip.owner).selectinload(User.profile),
            selectinload(Trip.members).selectinload(TripMember.user).selectinload(User.profile),
        )
        .order_by(Trip.created_at.desc())
    ).all()


def list_visible_trips(db: Session, current_user_id: int) -> list[Trip]:
    membership_subquery = select(TripMember.trip_id).where(TripMember.user_id == current_user_id)
    return db.scalars(
        select(Trip)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Trip.owner).selectinload(User.profile),
            selectinload(Trip.members).selectinload(TripMember.user).selectinload(User.profile),
        )
        .where(
            or_(
                Trip.visibility == TripVisibility.public,
                Trip.owner_id == current_user_id,
                Trip.id.in_(membership_subquery),
            )
        )
        .order_by(Trip.created_at.desc())
    ).all()


def fetch_trip_visible_to_user(db: Session, trip_id: int, current_user_id: int) -> Trip | None:
    membership_subquery = select(TripMember.trip_id).where(TripMember.user_id == current_user_id)
    return db.scalar(
        select(Trip)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Trip.owner).selectinload(User.profile),
            selectinload(Trip.members).selectinload(TripMember.user).selectinload(User.profile),
        )
        .where(
            Trip.id == trip_id,
            or_(
                Trip.visibility == TripVisibility.public,
                Trip.owner_id == current_user_id,
                Trip.id.in_(membership_subquery),
            ),
        )
    )


def create_trip(
    db: Session,
    owner_id: int,
    title: str,
    location: str,
    capacity: int,
    budget_min: int | None,
    budget_max: int | None,
    interests: list[str] | None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    visibility: TripVisibility = TripVisibility.public,
    status: TripStatus = TripStatus.planned,
    lifecycle_status: TripLifecycleStatus = TripLifecycleStatus.draft,
    latitude: float | None = None,
    longitude: float | None = None,
) -> Trip:
    if lifecycle_status != TripLifecycleStatus.draft and (start_date is None or end_date is None):
        raise ValueError("start_date and end_date are required once a trip leaves draft state")
    trip = Trip(
        owner_id=owner_id,
        title=title,
        location=location,
        capacity=capacity,
        budget_min=budget_min,
        budget_max=budget_max,
        interests=interests,
        start_date=_normalize_datetime_to_utc(start_date),
        end_date=_normalize_datetime_to_utc(end_date),
        visibility=visibility,
        status=status,
        lifecycle_status=lifecycle_status,
        latitude=latitude,
        longitude=longitude,
    )
    db.add(trip)
    db.flush()
    owner_membership = TripMember(
        trip_id=trip.id,
        user_id=owner_id,
        role=TripMemberRole.owner,
        status=TripMembershipStatus.approved,
    )
    db.add(owner_membership)
    db.flush()
    trip.members.append(owner_membership)
    ensure_trip_group_conversation(db, trip)
    log_trip_activity(
        db,
        trip_id=trip.id,
        user_id=owner_id,
        activity_type="join",
        metadata={"role": TripMemberRole.owner.value},
        commit=False,
    )
    # Track analytics event
    record_analytics_event(
        db=db,
        event_type="trip_created",
        user_id=owner_id,
        metadata={
            "trip_id": trip.id,
            "location": location,
            "capacity": capacity,
            "budget_min": budget_min,
            "budget_max": budget_max,
            "visibility": visibility.value,
        },
        commit=False,
    )
    
    # Invalidate discover cache for all users when new trip is created
    from app.services.redis_runtime import invalidate_discover_cache
    invalidate_discover_cache()
    
    db.commit()
    return fetch_trip_with_members(db, trip.id)


def request_join_trip(db: Session, trip: Trip, user_id: int) -> Trip:
    # Use SELECT FOR UPDATE to prevent race condition on trip capacity
    trip_lock = db.scalar(
        select(Trip)
        .options(selectinload(Trip.members))
        .where(Trip.id == trip.id)
        .with_for_update()
    )
    if trip_lock is None:
        raise LookupError("Trip not found")
    ensure_trip_allows_join_requests(trip_lock)
    
    approved_count = sum(1 for member in trip_lock.members if member.status == TripMembershipStatus.approved)
    if approved_count >= trip_lock.capacity:
        raise RuntimeError("Trip is full")

    # Check for existing membership to prevent duplicate
    existing_member = next((m for m in trip_lock.members if m.user_id == user_id), None)
    if existing_member is not None:
        if existing_member.status == TripMembershipStatus.approved:
            raise RuntimeError("Already a member of this trip")
        if existing_member.status == TripMembershipStatus.pending:
            raise RuntimeError("Trip request already exists")

    requester = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == user_id))
    db.add(
        TripMember(
            trip_id=trip.id,
            user_id=user_id,
            role=TripMemberRole.member,
            status=TripMembershipStatus.pending,
        )
    )
    if requester is not None:
        create_notification(
            db=db,
            user_id=trip.owner_id,
            notification_type="trip_join",
            message=f"{requester.profile.name or requester.email} requested to join {trip.title}",
            entity_id=trip.id,
            entity_type="trip",
            commit=False,
        )
        # Track analytics event
        record_analytics_event(
            db=db,
            event_type="trip_join_requested",
            user_id=user_id,
            metadata={
                "trip_id": trip.id,
                "trip_owner_id": trip.owner_id,
            },
            commit=False,
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise RuntimeError("Trip request already exists") from exc
    return fetch_trip_with_members(db, trip.id)


def leave_trip(db: Session, trip: Trip, user_id: int) -> Trip:
    ensure_trip_mutable(trip)
    member = next((item for item in trip.members if item.user_id == user_id), None)
    if member is None:
        raise LookupError("Trip membership not found")

    approved_member = member.status == TripMembershipStatus.approved
    db.delete(member)
    db.flush()
    if approved_member:
        ensure_trip_group_conversation(db, trip)
        log_trip_activity(
            db,
            trip_id=trip.id,
            user_id=user_id,
            activity_type="leave",
            metadata=None,
            commit=False,
        )
    db.commit()
    return fetch_trip_with_members(db, trip.id)


def approve_member(db: Session, trip: Trip, user_id: int) -> Trip:
    # Use SELECT FOR UPDATE to prevent race condition on trip capacity
    trip_lock = db.scalar(
        select(Trip)
        .options(selectinload(Trip.members))
        .where(Trip.id == trip.id)
        .with_for_update()
    )
    if trip_lock is None:
        raise LookupError("Trip not found")
    ensure_trip_allows_join_requests(trip_lock)
    
    member = next((item for item in trip_lock.members if item.user_id == user_id), None)
    if member is None:
        raise LookupError("Trip member not found")
    if member.status != TripMembershipStatus.pending:
        raise RuntimeError("Trip member already processed")

    approved_count = sum(1 for item in trip_lock.members if item.status == TripMembershipStatus.approved)
    if approved_count >= trip_lock.capacity:
        raise RuntimeError("Trip is full")

    member.status = TripMembershipStatus.approved
    db.flush()
    ensure_trip_group_conversation(db, trip)
    log_trip_activity(
        db,
        trip_id=trip.id,
        user_id=user_id,
        activity_type="join",
        metadata={"role": member.role.value},
        commit=False,
    )
    create_notification(
        db=db,
        user_id=user_id,
        notification_type="trip_approved",
        message=f"Your request to join {trip.title} was approved",
        entity_id=trip.id,
        entity_type="trip",
        commit=False,
    )
    # Track analytics event
    record_analytics_event(
        db=db,
        event_type="trip_member_approved",
        user_id=user_id,
        metadata={
            "trip_id": trip.id,
            "trip_owner_id": trip.owner_id,
        },
        commit=False,
    )
    db.commit()
    return fetch_trip_with_members(db, trip.id)


def reject_member(db: Session, trip: Trip, user_id: int) -> Trip:
    ensure_trip_mutable(trip)
    member = next((item for item in trip.members if item.user_id == user_id), None)
    if member is None:
        raise LookupError("Trip member not found")
    if member.status != TripMembershipStatus.pending:
        raise RuntimeError("Trip member already processed")
    db.delete(member)
    db.commit()
    return fetch_trip_with_members(db, trip.id)
