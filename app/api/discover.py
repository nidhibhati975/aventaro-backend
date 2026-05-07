from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    latitude: float | None = None
    longitude: float | None = None


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
    start_date: object | None = None
    end_date: object | None = None
    visibility: str | None = None
    lifecycle_status: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    owner: UserRead


@router.get("/people")
def discover_people(
    budget_min: int | None = None,
    budget_max: int | None = None,
    location: str | None = None,
    gender: str | None = None,
    interests: list[str] | None = Query(default=None),
    travel_style: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0, le=500),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    # Parse date filters
    from datetime import datetime
    parsed_start = None
    parsed_end = None
    if start_date:
        try:
            parsed_start = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        except ValueError:
            pass
    if end_date:
        try:
            parsed_end = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        except ValueError:
            pass
    
    offset = (page - 1) * limit
    
    filters = DiscoverPeopleFilters(
        budget_min=budget_min,
        budget_max=budget_max,
        location=location,
        gender=gender,
        interests=interests,
        travel_style=travel_style,
        start_date=parsed_start,
        end_date=parsed_end,
        latitude=latitude,
        longitude=longitude,
        radius_km=radius_km,
    )
    
    # Try cache first
    cache_key = build_cache_key(
        "discover:people",
        user_id=current_user.id,
        page=page,
        limit=limit,
        filters=filters.__dict__,
    )
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        # Return data with meta for envelope middleware to pick up
        return {
            "data": cached["users"],
            "meta": {"page": page, "limit": limit, "total": cached.get("total", len(cached["users"]))},
        }

    try:
        users, total = fetch_people_discover(db=db, current_user_id=current_user.id, filters=filters, limit=limit, offset=offset)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    payload = {
        "data": [UserRead.model_validate(user).model_dump(mode="json") for user in users],
        "meta": {"page": page, "limit": limit, "total": total},
    }
    # Cache the full payload
    get_cache().set_json(cache_key, {"users": payload["data"], "total": total}, ttl_seconds=30)
    return payload


@router.get("/trips")
def discover_trips(
    budget_min: int | None = None,
    budget_max: int | None = None,
    location: str | None = None,
    interests: list[str] | None = Query(default=None),
    travel_style: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0, le=500),
    group_size_min: int | None = None,
    group_size_max: int | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    # Parse date filters
    from datetime import datetime
    parsed_start = None
    parsed_end = None
    if start_date:
        try:
            parsed_start = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        except ValueError:
            pass
    if end_date:
        try:
            parsed_end = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        except ValueError:
            pass
    
    offset = (page - 1) * limit
    
    filters = DiscoverTripFilters(
        budget_min=budget_min,
        budget_max=budget_max,
        location=location,
        interests=interests,
        travel_style=travel_style,
        start_date=parsed_start,
        end_date=parsed_end,
        group_size_min=group_size_min,
        group_size_max=group_size_max,
        latitude=latitude,
        longitude=longitude,
        radius_km=radius_km,
    )
    
    # Try cache first
    cache_key = build_cache_key(
        "discover:trips",
        user_id=current_user.id,
        page=page,
        limit=limit,
        filters=filters.__dict__,
    )
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        # Return data with meta for envelope middleware to pick up
        return {
            "data": cached["trips"],
            "meta": {"page": page, "limit": limit, "total": cached.get("total", len(cached["trips"]))},
        }

    try:
        trips, total = fetch_trip_discover(db=db, current_user_id=current_user.id, filters=filters, limit=limit, offset=offset)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    payload = {
        "data": [TripRead.model_validate(trip).model_dump(mode="json") for trip in trips],
        "meta": {"page": page, "limit": limit, "total": total},
    }
    # Cache the full payload
    get_cache().set_json(cache_key, {"trips": payload["data"], "total": total}, ttl_seconds=30)
    return payload
