from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.discover import DiscoverPeopleFilters, DiscoverTripFilters, fetch_people_discover, fetch_trip_discover
from app.services.redis_runtime import build_cache_key, get_cache


router = APIRouter(prefix="/discover")


class ProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str | None = None
    age: int | None = None
    bio: str | None = None
    location: str | None = None
    gender: str | None = None
    travel_style: str | None = None
    interests: list[str] | None = None
    budget_min: int | None = None
    budget_max: int | None = None


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    profile: ProfileRead | None = None


class TripRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    location: str
    capacity: int
    budget_min: int | None = None
    budget_max: int | None = None
    interests: list[str] | None = None
    owner: UserRead


@router.get("/people", response_model=list[UserRead])
def discover_people(
    budget_min: int | None = None,
    budget_max: int | None = None,
    location: str | None = None,
    gender: str | None = None,
    interests: list[str] | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserRead]:
    filters = DiscoverPeopleFilters(
        budget_min=budget_min,
        budget_max=budget_max,
        location=location,
        gender=gender,
        interests=interests,
    )
    cache_key = build_cache_key(
        "discover:people",
        user_id=current_user.id,
        limit=limit,
        filters=filters.__dict__,
    )
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        return cached

    users = fetch_people_discover(db=db, current_user_id=current_user.id, filters=filters, limit=limit)
    payload = [UserRead.model_validate(user).model_dump(mode="json") for user in users]
    get_cache().set_json(cache_key, payload, ttl_seconds=30)
    return payload


@router.get("/trips", response_model=list[TripRead])
def discover_trips(
    budget_min: int | None = None,
    budget_max: int | None = None,
    location: str | None = None,
    interests: list[str] | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TripRead]:
    filters = DiscoverTripFilters(
        budget_min=budget_min,
        budget_max=budget_max,
        location=location,
        interests=interests,
    )
    cache_key = build_cache_key(
        "discover:trips",
        user_id=current_user.id,
        limit=limit,
        filters=filters.__dict__,
    )
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        return cached

    trips = fetch_trip_discover(db=db, current_user_id=current_user.id, filters=filters, limit=limit)
    payload = [TripRead.model_validate(trip).model_dump(mode="json") for trip in trips]
    get_cache().set_json(cache_key, payload, ttl_seconds=30)
    return payload
