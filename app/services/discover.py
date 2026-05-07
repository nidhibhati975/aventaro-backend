from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.profile import Profile
from app.models.trip import Trip, TripLifecycleStatus, TripMember, TripMembershipStatus, TripVisibility
from app.models.user import User
from app.services.social import build_blocked_user_ids_subquery
from app.services.subscriptions import (
    BOOST_PROFILE,
    BOOST_TRIP,
    get_active_boost_user_ids,
    get_current_subscription_map,
    is_premium_record,
)
from app.services.geo import (
    ensure_geospatial_ready,
    profile_distance_order,
    profile_radius_condition,
    trip_distance_order,
    trip_radius_condition,
    validate_coordinates,
)
from app.utils.config import get_settings


# Travel style options
TRAVEL_STYLES = {"adventure", "luxury", "budget", "social", "relaxation", "cultural", "nature", "city"}


@dataclass(frozen=True)
class DiscoverPeopleFilters:
    """Advanced filters for people discovery."""
    budget_min: int | None = None
    budget_max: int | None = None
    location: str | None = None
    gender: str | None = None
    interests: list[str] | None = None
    travel_style: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None
    radius_km: float | None = None


@dataclass(frozen=True)
class DiscoverTripFilters:
    """Advanced filters for trip discovery."""
    budget_min: int | None = None
    budget_max: int | None = None
    location: str | None = None
    interests: list[str] | None = None
    travel_style: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    group_size_min: int | None = None
    group_size_max: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    radius_km: float | None = None


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
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[User], int]:
    """Fetch people with advanced filtering, pagination, and indexed queries.
    
    Returns:
        Tuple of (users, total_count)
    """
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    base_filter = and_(
        User.id != current_user_id,
        User.id.not_in(select(blocked_users.c.user_id))
    )
    
    # Build filter conditions
    filter_conditions = []
    if filters.location:
        filter_conditions.append(Profile.location.ilike(f"%{filters.location}%"))
    if filters.gender:
        filter_conditions.append(Profile.gender == filters.gender)
    if filters.budget_min is not None:
        filter_conditions.append(or_(Profile.budget_max.is_(None), Profile.budget_max >= filters.budget_min))
    if filters.budget_max is not None:
        filter_conditions.append(or_(Profile.budget_min.is_(None), Profile.budget_min <= filters.budget_max))
    if filters.interests:
        filter_conditions.append(Profile.interests.contains(filters.interests))
    if filters.travel_style:
        normalized_style = filters.travel_style.strip().lower()
        filter_conditions.append(Profile.travel_style.ilike(f"%{normalized_style}%"))
    if filters.start_date is not None:
        filter_conditions.append(or_(Profile.travel_end_date.is_(None), Profile.travel_end_date >= filters.start_date))
    if filters.end_date is not None:
        filter_conditions.append(or_(Profile.travel_start_date.is_(None), Profile.travel_start_date <= filters.end_date))
    radius_search = validate_coordinates(filters.latitude, filters.longitude, filters.radius_km)
    if radius_search is not None:
        ensure_geospatial_ready(db)
        filter_conditions.append(profile_radius_condition(radius_search))
    
    # Count total matching users
    count_query = select(func.count(User.id)).where(base_filter)
    if filter_conditions:
        count_query = count_query.join(Profile, isouter=True).where(and_(*filter_conditions))
    total_count = db.scalar(count_query) or 0
    
    # Main query with pagination
    query = (
        select(User)
        .join(Profile, isouter=True)
        .options(selectinload(User.profile))
        .where(base_filter)
    )
    if filter_conditions:
        query = query.where(and_(*filter_conditions))
    
    # Use indexed created_at for ordering
    order_by = [User.created_at.desc()]
    if radius_search is not None:
        order_by.insert(0, profile_distance_order(radius_search))

    candidates = db.scalars(query.order_by(*order_by).limit(limit).offset(offset)).all()

    settings = get_settings()
    candidate_user_ids = [user.id for user in candidates]
    subscription_map = get_current_subscription_map(db, candidate_user_ids)
    boosted_user_ids = get_active_boost_user_ids(db, user_ids=candidate_user_ids, boost_type=BOOST_PROFILE)

    def score_user(user: User) -> tuple[int, int]:
        profile = user.profile
        if profile is None:
            return (0, 0)
        score = 0
        # Location match
        if filters.location and profile.location and filters.location.lower() in profile.location.lower():
            score += 2
        # Gender match
        if filters.gender and profile.gender == filters.gender:
            score += 1
        # Travel style match
        if filters.travel_style and profile.travel_style:
            if filters.travel_style.lower() in profile.travel_style.lower():
                score += 3
        # Interest overlap
        score += _score_interest_overlap(profile.interests, filters.interests)
        # Budget overlap
        score += _budget_overlap_score(profile.budget_min, profile.budget_max, filters.budget_min, filters.budget_max)
        # Premium boost
        if is_premium_record(subscription_map.get(user.id)):
            score += settings.premium_people_ranking_boost
        # Boosted user boost
        if user.id in boosted_user_ids:
            score += settings.profile_boost_ranking_boost
        return (score, user.id)

    ranked = sorted(candidates, key=score_user, reverse=True)
    return ranked[:limit], total_count


def fetch_trip_discover(
    db: Session,
    current_user_id: int,
    filters: DiscoverTripFilters,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[Trip], int]:
    """Fetch trips with advanced filtering, pagination, and indexed queries.
    
    Returns:
        Tuple of (trips, total_count)
    """
    blocked_users = build_blocked_user_ids_subquery(current_user_id)
    # Subquery for trips where user is a member
    member_trip_ids = select(TripMember.trip_id).where(
        TripMember.user_id == current_user_id,
        TripMember.status == TripMembershipStatus.approved,
    )
    
    query = (
        select(Trip)
        .options(selectinload(Trip.owner).selectinload(User.profile))
        .where(
            Trip.owner_id.not_in(select(blocked_users.c.user_id)),
            or_(
                Trip.visibility == TripVisibility.public,
                Trip.owner_id == current_user_id,  # Show own trips
                Trip.id.in_(member_trip_ids),  # Show trips where user is member
            ),
        )
    )
    if current_user_id:
        query = query.where(
            or_(
                Trip.owner_id == current_user_id,
                Trip.id.in_(member_trip_ids),
                Trip.lifecycle_status.in_([TripLifecycleStatus.planned, TripLifecycleStatus.active]),
            )
        )
    
    # Indexed filter queries
    if filters.location:
        query = query.where(Trip.location.ilike(f"%{filters.location}%"))
    if filters.budget_min is not None:
        query = query.where(or_(Trip.budget_max.is_(None), Trip.budget_max >= filters.budget_min))
    if filters.budget_max is not None:
        query = query.where(or_(Trip.budget_min.is_(None), Trip.budget_min <= filters.budget_max))
    if filters.interests:
        query = query.where(Trip.interests.contains(filters.interests))
    
    # Date range filtering (uses indexed start_date/end_date)
    if filters.start_date is not None:
        query = query.where(or_(
            Trip.end_date.is_(None),
            Trip.end_date >= filters.start_date
        ))
    if filters.end_date is not None:
        query = query.where(or_(
            Trip.start_date.is_(None),
            Trip.start_date <= filters.end_date
        ))
    
    # Group size filtering
    if filters.group_size_min is not None:
        query = query.where(Trip.capacity >= filters.group_size_min)
    if filters.group_size_max is not None:
        query = query.where(Trip.capacity <= filters.group_size_max)
    radius_search = validate_coordinates(filters.latitude, filters.longitude, filters.radius_km)
    if radius_search is not None:
        ensure_geospatial_ready(db)
        query = query.where(trip_radius_condition(radius_search))

    # Use indexed created_at for ordering
    count_query = select(func.count(Trip.id)).where(*query._where_criteria)
    total_count = db.scalar(count_query) or 0
    order_by = [Trip.created_at.desc()]
    if radius_search is not None:
        order_by.insert(0, trip_distance_order(radius_search))
    candidates = db.scalars(query.order_by(*order_by).limit(limit * 3).offset(offset)).all()

    settings = get_settings()
    owner_ids = [trip.owner_id for trip in candidates]
    subscription_map = get_current_subscription_map(db, owner_ids)
    boosted_owner_ids = get_active_boost_user_ids(db, user_ids=owner_ids, boost_type=BOOST_TRIP)

    def score_trip(trip: Trip) -> tuple[int, int]:
        score = 0
        # Location match
        if filters.location and filters.location.lower() in trip.location.lower():
            score += 2
        # Interest overlap
        score += _score_interest_overlap(trip.interests, filters.interests)
        # Budget overlap
        score += _budget_overlap_score(trip.budget_min, trip.budget_max, filters.budget_min, filters.budget_max)
        # Date overlap bonus
        if filters.start_date and trip.start_date:
            if filters.start_date <= trip.end_date:
                score += 3
        # Group size match
        if filters.group_size_min and trip.capacity >= filters.group_size_min:
            score += 1
        if filters.group_size_max and trip.capacity <= filters.group_size_max:
            score += 1
        # Premium boost
        if is_premium_record(subscription_map.get(trip.owner_id)):
            score += settings.premium_trip_ranking_boost
        # Boosted owner boost
        if trip.owner_id in boosted_owner_ids:
            score += settings.trip_boost_ranking_boost
        return (score, trip.id)

    ranked = sorted(candidates, key=score_trip, reverse=True)
    return ranked[:limit], total_count
