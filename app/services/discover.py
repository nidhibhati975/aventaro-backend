from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.profile import Profile
from app.models.trip import Trip
from app.models.user import User
from app.services.social import build_blocked_user_ids_subquery
from app.services.subscriptions import (
    BOOST_PROFILE,
    BOOST_TRIP,
    get_active_boost_user_ids,
    get_current_subscription_map,
    is_premium_record,
)
from app.utils.config import get_settings


@dataclass(frozen=True)
class DiscoverPeopleFilters:
    budget_min: int | None = None
    budget_max: int | None = None
    location: str | None = None
    gender: str | None = None
    interests: list[str] | None = None


@dataclass(frozen=True)
class DiscoverTripFilters:
    budget_min: int | None = None
    budget_max: int | None = None
    location: str | None = None
    interests: list[str] | None = None


def _score_interest_overlap(target: Iterable[str] | None, desired: Iterable[str] | None) -> int:
    if not target or not desired:
        return 0
    target_set = {item.strip().lower() for item in target if item}
    desired_set = {item.strip().lower() for item in desired if item}
    return len(target_set.intersection(desired_set))


def _budget_overlap_score(min_value: int | None, max_value: int | None, desired_min: int | None, desired_max: int | None) -> int:
    if desired_min is None and desired_max is None:
        return 0
    if min_value is None and max_value is None:
        return 0
    actual_min = min_value if min_value is not None else desired_min
    actual_max = max_value if max_value is not None else desired_max
    if actual_min is None or actual_max is None:
        return 0
    if desired_min is None:
        desired_min = actual_min
    if desired_max is None:
        desired_max = actual_max
    return 1 if actual_min <= desired_max and actual_max >= desired_min else 0


def fetch_people_discover(
    db: Session,
    current_user_id: int,
    filters: DiscoverPeopleFilters,
    limit: int,
) -> list[User]:
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    query = (
        select(User)
        .join(Profile, isouter=True)
        .options(selectinload(User.profile))
        .where(User.id != current_user_id, User.id.not_in(select(blocked_users.c.user_id)))
    )

    if filters.location:
        query = query.where(Profile.location.ilike(f"%{filters.location}%"))
    if filters.gender:
        query = query.where(Profile.gender == filters.gender)
    if filters.budget_min is not None:
        query = query.where(or_(Profile.budget_max.is_(None), Profile.budget_max >= filters.budget_min))
    if filters.budget_max is not None:
        query = query.where(or_(Profile.budget_min.is_(None), Profile.budget_min <= filters.budget_max))
    if filters.interests:
        query = query.where(Profile.interests.contains(filters.interests))

    candidates = db.scalars(query.order_by(User.created_at.desc()).limit(limit * 3)).all()

    settings = get_settings()
    candidate_user_ids = [user.id for user in candidates]
    subscription_map = get_current_subscription_map(db, candidate_user_ids)
    boosted_user_ids = get_active_boost_user_ids(db, user_ids=candidate_user_ids, boost_type=BOOST_PROFILE)

    def score_user(user: User) -> tuple[int, int]:
        profile = user.profile
        if profile is None:
            return (0, 0)
        score = 0
        if filters.location and profile.location and filters.location.lower() in profile.location.lower():
            score += 2
        if filters.gender and profile.gender == filters.gender:
            score += 1
        score += _score_interest_overlap(profile.interests, filters.interests)
        score += _budget_overlap_score(profile.budget_min, profile.budget_max, filters.budget_min, filters.budget_max)
        if is_premium_record(subscription_map.get(user.id)):
            score += settings.premium_people_ranking_boost
        if user.id in boosted_user_ids:
            score += settings.profile_boost_ranking_boost
        return (score, user.id)

    ranked = sorted(candidates, key=score_user, reverse=True)
    return ranked[:limit]


def fetch_trip_discover(
    db: Session,
    current_user_id: int,
    filters: DiscoverTripFilters,
    limit: int,
) -> list[Trip]:
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    query = (
        select(Trip)
        .options(selectinload(Trip.owner).selectinload(User.profile))
        .where(Trip.owner_id.not_in(select(blocked_users.c.user_id)))
    )
    if filters.location:
        query = query.where(Trip.location.ilike(f"%{filters.location}%"))
    if filters.budget_min is not None:
        query = query.where(or_(Trip.budget_max.is_(None), Trip.budget_max >= filters.budget_min))
    if filters.budget_max is not None:
        query = query.where(or_(Trip.budget_min.is_(None), Trip.budget_min <= filters.budget_max))
    if filters.interests:
        query = query.where(Trip.interests.contains(filters.interests))

    candidates = db.scalars(query.order_by(Trip.created_at.desc()).limit(limit * 3)).all()

    settings = get_settings()
    owner_ids = [trip.owner_id for trip in candidates]
    subscription_map = get_current_subscription_map(db, owner_ids)
    boosted_owner_ids = get_active_boost_user_ids(db, user_ids=owner_ids, boost_type=BOOST_TRIP)

    def score_trip(trip: Trip) -> tuple[int, int]:
        score = 0
        if filters.location and filters.location.lower() in trip.location.lower():
            score += 2
        score += _score_interest_overlap(trip.interests, filters.interests)
        score += _budget_overlap_score(trip.budget_min, trip.budget_max, filters.budget_min, filters.budget_max)
        if is_premium_record(subscription_map.get(trip.owner_id)):
            score += settings.premium_trip_ranking_boost
        if trip.owner_id in boosted_owner_ids:
            score += settings.trip_boost_ranking_boost
        return (score, trip.id)

    ranked = sorted(candidates, key=score_trip, reverse=True)
    return ranked[:limit]
