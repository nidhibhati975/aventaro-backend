from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.trip import Trip, TripMember, TripMemberRole, TripMembershipStatus
from app.models.user import User
from app.services.notifications import create_notification
from app.services.trip_collaboration import ensure_trip_group_conversation, log_trip_activity


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


def create_trip(
    db: Session,
    owner_id: int,
    title: str,
    location: str,
    capacity: int,
    budget_min: int | None,
    budget_max: int | None,
    interests: list[str] | None,
) -> Trip:
    trip = Trip(
        owner_id=owner_id,
        title=title,
        location=location,
        capacity=capacity,
        budget_min=budget_min,
        budget_max=budget_max,
        interests=interests,
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
    db.commit()
    return fetch_trip_with_members(db, trip.id)


def request_join_trip(db: Session, trip: Trip, user_id: int) -> Trip:
    approved_count = sum(1 for member in trip.members if member.status == TripMembershipStatus.approved)
    if approved_count >= trip.capacity:
        raise RuntimeError("Trip is full")

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
            commit=False,
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise RuntimeError("Trip request already exists") from exc
    return fetch_trip_with_members(db, trip.id)


def leave_trip(db: Session, trip: Trip, user_id: int) -> Trip:
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
    member = next((item for item in trip.members if item.user_id == user_id), None)
    if member is None:
        raise LookupError("Trip member not found")
    if member.status != TripMembershipStatus.pending:
        raise RuntimeError("Trip member already processed")

    approved_count = sum(1 for item in trip.members if item.status == TripMembershipStatus.approved)
    if approved_count >= trip.capacity:
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
        commit=False,
    )
    db.commit()
    return fetch_trip_with_members(db, trip.id)


def reject_member(db: Session, trip: Trip, user_id: int) -> Trip:
    member = next((item for item in trip.members if item.user_id == user_id), None)
    if member is None:
        raise LookupError("Trip member not found")
    if member.status != TripMembershipStatus.pending:
        raise RuntimeError("Trip member already processed")
    db.delete(member)
    db.commit()
    return fetch_trip_with_members(db, trip.id)
