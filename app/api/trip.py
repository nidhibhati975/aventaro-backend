from __future__ import annotations

from anyio import from_thread
from datetime import date, datetime, timezone
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, ValidationInfo
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.chat import MessageStatus
from app.models.trip import ExpenseSplitStatus, Trip, TripLifecycleStatus, TripMemberRole, TripMembershipStatus
from app.models.user import User
from app.services.auth import get_current_user
from app.services.chat_realtime import chat_connection_manager
from app.services.redis_runtime import invalidate_discover_cache
from app.services.subscriptions import enforce_trip_join_limit
from app.services.trip_collaboration import (
    build_trip_room_name,
    calculate_trip_balances,
    cast_trip_vote,
    create_trip_itinerary_day,
    create_trip_itinerary_item,
    create_trip_place,
    create_trip_poll,
    delete_trip_itinerary_item,
    delete_trip_place,
    get_trip_workspace,
    get_trip_chat,
    list_trip_activities,
    list_trip_expenses,
    list_trip_itinerary,
    update_trip_itinerary_item,
    update_trip_place,
)
from app.services.trip import (
    approve_member,
    create_trip as create_trip_service,
    ensure_trip_mutable,
    fetch_trip_visible_to_user,
    fetch_trip_with_members,
    leave_trip as leave_trip_service,
    list_trips as list_trips_service,
    list_visible_trips as list_visible_trips_service,
    reject_member,
    request_join_trip,
    validate_lifecycle_transition,
)
from app.services.geo import normalize_coordinate_pair, validate_coordinates


router = APIRouter(prefix="/trip")


def _normalize_datetime_to_utc(dt: datetime | None) -> datetime | None:
    """Normalize a datetime to UTC timezone."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        # Assume naive datetime is in UTC
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


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


class UserSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    profile: ProfileRead | None = None


class TripVisibility(str, Enum):
    public = "public"
    private = "private"


class TripStatus(str, Enum):
    planned = "planned"
    active = "active"
    completed = "completed"


class TripLifecycleStatus(str, Enum):
    draft = "draft"
    planned = "planned"
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class TripCreateRequest(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    location: str = Field(min_length=2, max_length=150)
    capacity: int = Field(ge=1, le=100)
    budget_min: int | None = Field(default=None, ge=0)
    budget_max: int | None = Field(default=None, ge=0)
    interests: list[str] | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    visibility: TripVisibility = TripVisibility.public
    status: TripStatus = TripStatus.planned
    lifecycle_status: TripLifecycleStatus = TripLifecycleStatus.draft
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("budget_max")
    @classmethod
    def validate_budget_max(cls, v: int | None, info: "ValidationInfo") -> int | None:
        if v is not None and v < 0:
            raise ValueError("budget_max must be >= 0")
        budget_min = info.data.get("budget_min")
        if budget_min is not None and v is not None and v < budget_min:
            raise ValueError("budget_max must be >= budget_min")
        return v

    @field_validator("end_date")
    @classmethod
    def validate_dates(cls, v: datetime | None, info: "ValidationInfo") -> datetime | None:
        if v is None:
            return v
        start_date = info.data.get("start_date")
        if start_date is not None and v < start_date:
            raise ValueError("end_date must be after start_date")
        return v


class TripApprovalRequest(BaseModel):
    user_id: int = Field(gt=0)


class TripMemberRead(BaseModel):
    user: UserSummary
    role: TripMemberRole
    status: TripMembershipStatus


class TripItineraryItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None = None
    item_date: date | None = None
    order_index: int
    created_at: object


class TripItineraryItemCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    description: str | None = Field(default=None, max_length=500)
    item_date: date | None = None
    order_index: int = Field(default=0, ge=0)


class TripItineraryItemUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=150)
    description: str | None = Field(default=None, max_length=500)
    item_date: date | None = None
    order_index: int | None = Field(default=None, ge=0)


class TripItineraryDayCreateRequest(BaseModel):
    day_date: date
    title: str | None = Field(default=None, max_length=150)
    notes: str | None = Field(default=None, max_length=1000)


class TripItineraryDayRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_by_user_id: int
    day_date: date
    title: str | None = None
    notes: str | None = None
    created_at: object
    updated_at: object


class TripPlaceCreateRequest(BaseModel):
    day_id: int | None = Field(default=None, gt=0)
    name: str = Field(min_length=1, max_length=180)
    address: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=1000)
    external_place_id: str | None = Field(default=None, max_length=255)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    order_index: int = Field(default=0, ge=0)


class TripPlaceUpdateRequest(BaseModel):
    day_id: int | None = Field(default=None, ge=0)
    name: str | None = Field(default=None, min_length=1, max_length=180)
    address: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=1000)
    external_place_id: str | None = Field(default=None, max_length=255)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    order_index: int | None = Field(default=None, ge=0)


class TripPlaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trip_id: int
    day_id: int | None = None
    created_by_user_id: int
    name: str
    address: str | None = None
    notes: str | None = None
    external_place_id: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    order_index: int
    created_at: object
    updated_at: object


class TripPollCreateRequest(BaseModel):
    day_id: int | None = Field(default=None, gt=0)
    question: str = Field(min_length=5, max_length=255)
    options: list[str] = Field(min_length=2, max_length=10)
    closes_at: datetime | None = None


class TripVoteCreateRequest(BaseModel):
    poll_id: int = Field(gt=0)
    option_index: int = Field(ge=0)


class TripVoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    option_index: int
    created_at: object
    updated_at: object


class TripPollRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trip_id: int
    day_id: int | None = None
    created_by_user_id: int
    question: str
    options: list[str]
    closes_at: datetime | None = None
    created_at: object
    updated_at: object
    votes: list[TripVoteRead] = Field(default_factory=list)


class TripItineraryDayWorkspaceRead(TripItineraryDayRead):
    places: list[TripPlaceRead] = Field(default_factory=list)
    polls: list[TripPollRead] = Field(default_factory=list)


class TripWorkspaceRead(BaseModel):
    days: list[TripItineraryDayWorkspaceRead] = Field(default_factory=list)
    places: list[TripPlaceRead] = Field(default_factory=list)
    polls: list[TripPollRead] = Field(default_factory=list)
    unassigned_places: list[TripPlaceRead] = Field(default_factory=list)
    unassigned_polls: list[TripPollRead] = Field(default_factory=list)


class TripRead(BaseModel):
    id: int
    title: str
    location: str
    capacity: int
    budget_min: int | None = None
    budget_max: int | None = None
    interests: list[str] | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    visibility: TripVisibility
    status: TripStatus
    lifecycle_status: TripLifecycleStatus
    latitude: float | None = None
    longitude: float | None = None
    owner: UserSummary
    members: list[TripMemberRead]
    approved_member_count: int
    current_user_status: TripMembershipStatus | None = None
    itinerary: list[TripItineraryItemRead] = Field(default_factory=list)


class TripChatMessageRead(BaseModel):
    id: int
    conversation_id: str
    content: str
    message_status: MessageStatus
    read_at: object | None = None
    created_at: object
    sender: UserSummary


class TripChatReadReceiptRead(BaseModel):
    conversation_id: str
    user_id: int
    updated_count: int
    last_read_message_id: int
    read_at: object


class TripChatRead(BaseModel):
    conversation_id: str
    trip_id: int
    members: list[UserSummary]
    messages: list[TripChatMessageRead]
    next_cursor: str | None = None


class ExpenseSplitRead(BaseModel):
    id: int
    user: UserSummary
    amount: float
    status: ExpenseSplitStatus


class ExpenseRead(BaseModel):
    id: int
    trip_id: int
    paid_by: UserSummary
    amount: float
    description: str
    created_at: object
    splits: list[ExpenseSplitRead]


class BalanceMemberRead(BaseModel):
    user: UserSummary
    total_paid: float
    total_owed: float
    outstanding_credit: float
    net_balance: float


class BalanceSettlementRead(BaseModel):
    from_user: UserSummary
    to_user: UserSummary
    amount: float


class TripBalancesRead(BaseModel):
    trip_id: int
    members: list[BalanceMemberRead]
    settlements: list[BalanceSettlementRead]


class TripActivityRead(BaseModel):
    id: int
    trip_id: int
    user: UserSummary | None = None
    type: str
    metadata: dict[str, object] | None = None
    created_at: object


class TripActivityPageRead(BaseModel):
    items: list[TripActivityRead]
    next_cursor: str | None = None


def _serialize_trip(trip: Trip, current_user_id: int) -> TripRead:
    members = [
        TripMemberRead(
            user=UserSummary.model_validate(member.user),
            role=member.role,
            status=member.status,
        )
        for member in trip.members
    ]
    current_status = next((member.status for member in trip.members if member.user_id == current_user_id), None)
    approved_count = sum(1 for member in trip.members if member.status == TripMembershipStatus.approved)
    return TripRead(
        id=trip.id,
        title=trip.title,
        location=trip.location,
        capacity=trip.capacity,
        budget_min=trip.budget_min,
        budget_max=trip.budget_max,
        interests=trip.interests,
        start_date=trip.start_date,
        end_date=trip.end_date,
        visibility=trip.visibility,
        status=trip.status,
        lifecycle_status=trip.lifecycle_status,
        latitude=trip.latitude,
        longitude=trip.longitude,
        owner=UserSummary.model_validate(trip.owner),
        members=members,
        approved_member_count=approved_count,
        current_user_status=current_status,
        itinerary=[
            TripItineraryItemRead(
                id=item.id,
                title=item.title,
                description=item.description,
                item_date=item.item_date,
                order_index=item.order_index,
                created_at=item.created_at,
            )
            for item in getattr(trip, "itinerary_items", [])
        ],
    )


@router.post("/create", response_model=TripRead, status_code=status.HTTP_201_CREATED)
def create_trip(
    payload: TripCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripRead:
    if payload.lifecycle_status != TripLifecycleStatus.draft and (
        payload.start_date is None or payload.end_date is None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date and end_date are required once a trip leaves draft state",
        )
    if payload.start_date is not None and payload.end_date is not None and payload.start_date > payload.end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date cannot be after end_date")
    try:
        latitude, longitude = normalize_coordinate_pair(payload.latitude, payload.longitude)
        validate_coordinates(latitude, longitude)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    try:
        trip = create_trip_service(
            db=db,
            owner_id=current_user.id,
            title=payload.title,
            location=payload.location,
            capacity=payload.capacity,
            budget_min=payload.budget_min,
            budget_max=payload.budget_max,
            interests=payload.interests,
            start_date=payload.start_date,
            end_date=payload.end_date,
            visibility=payload.visibility,
            status=payload.status,
            lifecycle_status=payload.lifecycle_status,
            latitude=latitude,
            longitude=longitude,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    invalidate_discover_cache()
    return _serialize_trip(trip, current_user.id)


@router.get("", response_model=list[TripRead])
def list_trips(
    visibility: TripVisibility | None = None,
    lifecycle_status: TripLifecycleStatus | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TripRead]:
    trips = list_visible_trips_service(db=db, current_user_id=current_user.id)
    if visibility is not None:
        trips = [trip for trip in trips if trip.visibility == visibility]
    if lifecycle_status is not None:
        trips = [trip for trip in trips if trip.lifecycle_status == lifecycle_status]
    return [_serialize_trip(trip, current_user.id) for trip in trips]


class TripMetaUpdateRequest(BaseModel):
    start_date: datetime | None = None
    end_date: datetime | None = None
    visibility: TripVisibility | None = None
    lifecycle_status: TripLifecycleStatus | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


@router.put("/{trip_id}/meta", response_model=TripRead)
def update_trip_meta(
    trip_id: int,
    payload: TripMetaUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripRead:
    trip = fetch_trip_visible_to_user(db=db, trip_id=trip_id, current_user_id=current_user.id)
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    if trip.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only trip owner can update trip metadata")

    next_start = _normalize_datetime_to_utc(payload.start_date) if payload.start_date is not None else trip.start_date
    next_end = _normalize_datetime_to_utc(payload.end_date) if payload.end_date is not None else trip.end_date
    if next_start is not None and next_end is not None and next_start > next_end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date cannot be after end_date")

    if payload.lifecycle_status is not None and not validate_lifecycle_transition(trip.lifecycle_status, payload.lifecycle_status):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid lifecycle transition from {trip.lifecycle_status.value} to {payload.lifecycle_status.value}",
        )
    next_lifecycle_status = payload.lifecycle_status or trip.lifecycle_status
    if next_lifecycle_status != TripLifecycleStatus.draft and (next_start is None or next_end is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date and end_date are required once a trip leaves draft state",
        )
    effective_latitude = payload.latitude if payload.latitude is not None else trip.latitude
    effective_longitude = payload.longitude if payload.longitude is not None else trip.longitude
    try:
        normalized_latitude, normalized_longitude = normalize_coordinate_pair(effective_latitude, effective_longitude)
        validate_coordinates(normalized_latitude, normalized_longitude)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    trip.start_date = next_start
    trip.end_date = next_end
    if payload.latitude is not None:
        trip.latitude = normalized_latitude
    if payload.longitude is not None:
        trip.longitude = normalized_longitude
    if payload.visibility is not None:
        trip.visibility = payload.visibility
    if payload.lifecycle_status is not None:
        trip.lifecycle_status = payload.lifecycle_status

    db.commit()
    db.refresh(trip)
    invalidate_discover_cache()
    return _serialize_trip(trip, current_user.id)


@router.get("/{trip_id}", response_model=TripRead)
def get_trip(
    trip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripRead:
    trip = fetch_trip_visible_to_user(db=db, trip_id=trip_id, current_user_id=current_user.id)
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return _serialize_trip(trip, current_user.id)


@router.get("/{trip_id}/workspace", response_model=TripWorkspaceRead)
def get_workspace(
    trip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripWorkspaceRead:
    try:
        trip = get_trip_workspace(db=db, trip_id=trip_id, current_user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    day_payloads = [
        TripItineraryDayWorkspaceRead(
            **TripItineraryDayRead.model_validate(day).model_dump(mode="json"),
            places=[TripPlaceRead.model_validate(place) for place in day.places],
            polls=[TripPollRead.model_validate(poll) for poll in day.polls],
        )
        for day in trip.itinerary_days
    ]
    place_payloads = [TripPlaceRead.model_validate(place) for place in trip.places]
    poll_payloads = [TripPollRead.model_validate(poll) for poll in trip.polls]
    return TripWorkspaceRead(
        days=day_payloads,
        places=place_payloads,
        polls=poll_payloads,
        unassigned_places=[place for place in place_payloads if place.day_id is None],
        unassigned_polls=[poll for poll in poll_payloads if poll.day_id is None],
    )


@router.get("/{trip_id}/itinerary", response_model=list[TripItineraryItemRead])
def get_trip_itinerary(
    trip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TripItineraryItemRead]:
    try:
        items = list_trip_itinerary(db=db, trip_id=trip_id, current_user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return [TripItineraryItemRead.model_validate(item).model_dump(mode="json") for item in items]


@router.post("/{trip_id}/itinerary", response_model=TripItineraryItemRead, status_code=status.HTTP_201_CREATED)
def create_trip_itinerary(
    trip_id: int,
    payload: TripItineraryItemCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripItineraryItemRead:
    try:
        item = create_trip_itinerary_item(
            db=db,
            trip_id=trip_id,
            current_user_id=current_user.id,
            title=payload.title,
            description=payload.description,
            item_date=payload.item_date,
            order_index=payload.order_index,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TripItineraryItemRead.model_validate(item)


@router.put("/{trip_id}/itinerary/{item_id}", response_model=TripItineraryItemRead)
def update_trip_itinerary(
    trip_id: int,
    item_id: int,
    payload: TripItineraryItemUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripItineraryItemRead:
    try:
        item = update_trip_itinerary_item(
            db=db,
            trip_id=trip_id,
            item_id=item_id,
            current_user_id=current_user.id,
            title=payload.title,
            description=payload.description,
            item_date=payload.item_date,
            order_index=payload.order_index,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TripItineraryItemRead.model_validate(item)


@router.delete("/{trip_id}/itinerary/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip_itinerary(
    trip_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    try:
        delete_trip_itinerary_item(
            db=db,
            trip_id=trip_id,
            item_id=item_id,
            current_user_id=current_user.id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{trip_id}/itinerary/day", response_model=TripItineraryDayRead, status_code=status.HTTP_201_CREATED)
def create_itinerary_day(
    trip_id: int,
    payload: TripItineraryDayCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripItineraryDayRead:
    try:
        item = create_trip_itinerary_day(
            db=db,
            trip_id=trip_id,
            current_user_id=current_user.id,
            day_date=payload.day_date,
            title=payload.title,
            notes=payload.notes,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    payload_json = TripItineraryDayRead.model_validate(item).model_dump(mode="json")
    from_thread.run(
        chat_connection_manager.broadcast_to_room,
        build_trip_room_name(trip_id),
        {"type": "trip.itinerary.updated", "data": {"trip_id": trip_id, "action": "day_created", "day": payload_json}},
    )
    return TripItineraryDayRead.model_validate(item)


@router.post("/{trip_id}/place", response_model=TripPlaceRead, status_code=status.HTTP_201_CREATED)
def create_place(
    trip_id: int,
    payload: TripPlaceCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripPlaceRead:
    try:
        place = create_trip_place(
            db=db,
            trip_id=trip_id,
            current_user_id=current_user.id,
            day_id=payload.day_id,
            name=payload.name,
            address=payload.address,
            notes=payload.notes,
            external_place_id=payload.external_place_id,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            order_index=payload.order_index,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    payload_json = TripPlaceRead.model_validate(place).model_dump(mode="json")
    from_thread.run(
        chat_connection_manager.broadcast_to_room,
        build_trip_room_name(trip_id),
        {"type": "trip.itinerary.updated", "data": {"trip_id": trip_id, "action": "place_created", "place": payload_json}},
    )
    return TripPlaceRead.model_validate(place)


@router.put("/{trip_id}/place/{place_id}", response_model=TripPlaceRead)
def update_place(
    trip_id: int,
    place_id: int,
    payload: TripPlaceUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripPlaceRead:
    try:
        place = update_trip_place(
            db=db,
            trip_id=trip_id,
            place_id=place_id,
            current_user_id=current_user.id,
            day_id=payload.day_id,
            name=payload.name,
            address=payload.address,
            notes=payload.notes,
            external_place_id=payload.external_place_id,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            order_index=payload.order_index,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    payload_json = TripPlaceRead.model_validate(place).model_dump(mode="json")
    from_thread.run(
        chat_connection_manager.broadcast_to_room,
        build_trip_room_name(trip_id),
        {"type": "trip.itinerary.updated", "data": {"trip_id": trip_id, "action": "place_updated", "place": payload_json}},
    )
    return TripPlaceRead.model_validate(place)


@router.delete("/{trip_id}/place/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_place(
    trip_id: int,
    place_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    try:
        delete_trip_place(db=db, trip_id=trip_id, place_id=place_id, current_user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    from_thread.run(
        chat_connection_manager.broadcast_to_room,
        build_trip_room_name(trip_id),
        {"type": "trip.itinerary.updated", "data": {"trip_id": trip_id, "action": "place_deleted", "place_id": place_id}},
    )


@router.post("/{trip_id}/poll", response_model=TripPollRead, status_code=status.HTTP_201_CREATED)
def create_poll(
    trip_id: int,
    payload: TripPollCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripPollRead:
    try:
        poll = create_trip_poll(
            db=db,
            trip_id=trip_id,
            current_user_id=current_user.id,
            day_id=payload.day_id,
            question=payload.question,
            options=payload.options,
            closes_at=payload.closes_at,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    payload_json = TripPollRead.model_validate(poll).model_dump(mode="json")
    from_thread.run(
        chat_connection_manager.broadcast_to_room,
        build_trip_room_name(trip_id),
        {"type": "trip.poll.updated", "data": {"trip_id": trip_id, "action": "poll_created", "poll": payload_json}},
    )
    return TripPollRead.model_validate(poll)


@router.post("/{trip_id}/vote", response_model=TripPollRead)
def vote_trip_poll(
    trip_id: int,
    payload: TripVoteCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripPollRead:
    try:
        poll = cast_trip_vote(
            db=db,
            trip_id=trip_id,
            poll_id=payload.poll_id,
            current_user_id=current_user.id,
            option_index=payload.option_index,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    payload_json = TripPollRead.model_validate(poll).model_dump(mode="json")
    from_thread.run(
        chat_connection_manager.broadcast_to_room,
        build_trip_room_name(trip_id),
        {"type": "trip.poll.updated", "data": {"trip_id": trip_id, "action": "vote_cast", "poll": payload_json}},
    )
    return TripPollRead.model_validate(poll)


@router.get("/{trip_id}/chat", response_model=TripChatRead)
def get_trip_group_chat(
    trip_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripChatRead:
    try:
        payload = get_trip_chat(
            db=db,
            trip_id=trip_id,
            current_user_id=current_user.id,
            limit=limit,
            cursor=cursor,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    read_receipt = payload.pop("read_receipt", None)
    if read_receipt is not None:
        from_thread.run(
            chat_connection_manager.broadcast_to_room,
            build_trip_room_name(trip_id),
            {"type": "chat.read", "data": TripChatReadReceiptRead.model_validate(read_receipt).model_dump(mode="json")},
        )
    return TripChatRead.model_validate(payload)


@router.get("/{trip_id}/expenses", response_model=list[ExpenseRead])
def get_trip_expenses(
    trip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ExpenseRead]:
    try:
        expenses = list_trip_expenses(db=db, trip_id=trip_id, current_user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return [ExpenseRead.model_validate(expense) for expense in expenses]


@router.get("/{trip_id}/balances", response_model=TripBalancesRead)
def get_trip_balances(
    trip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripBalancesRead:
    try:
        payload = calculate_trip_balances(db=db, trip_id=trip_id, current_user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return TripBalancesRead.model_validate(payload)


@router.get("/{trip_id}/activity", response_model=TripActivityPageRead)
def get_trip_activity(
    trip_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripActivityPageRead:
    try:
        items = list_trip_activities(
            db=db,
            trip_id=trip_id,
            current_user_id=current_user.id,
            limit=limit,
            cursor=cursor,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TripActivityPageRead.model_validate(items)


@router.post("/{trip_id}/join", response_model=TripRead)
def join_trip(
    trip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripRead:
    enforce_trip_join_limit(db, current_user.id)
    trip = fetch_trip_with_members(db=db, trip_id=trip_id)
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    if trip.owner_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner is already part of the trip")

    existing = next((member for member in trip.members if member.user_id == current_user.id), None)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Trip request already exists")

    try:
        trip = request_join_trip(db=db, trip=trip, user_id=current_user.id)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    invalidate_discover_cache()
    return _serialize_trip(trip, current_user.id)


@router.post("/{trip_id}/leave", response_model=TripRead)
def leave_trip(
    trip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripRead:
    trip = fetch_trip_with_members(db=db, trip_id=trip_id)
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    if trip.owner_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Trip owner cannot leave the trip")

    leaving_user = UserSummary.model_validate(current_user).model_dump(mode="json")
    try:
        trip = leave_trip_service(db=db, trip=trip, user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    invalidate_discover_cache()
    from_thread.run(
        chat_connection_manager.broadcast_to_room,
        build_trip_room_name(trip_id),
        {"type": "trip.left", "data": {"trip_id": trip_id, "user": leaving_user}},
    )
    return _serialize_trip(trip, current_user.id)


@router.post("/{trip_id}/approve", response_model=TripRead)
def approve_trip_member(
    trip_id: int,
    payload: TripApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripRead:
    trip = fetch_trip_with_members(db=db, trip_id=trip_id)
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    if trip.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the trip owner can approve members")

    try:
        trip = approve_member(db=db, trip=trip, user_id=payload.user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    invalidate_discover_cache()
    approved_member = next((member for member in trip.members if member.user_id == payload.user_id), None)
    if approved_member is not None:
        from_thread.run(
            chat_connection_manager.broadcast_to_room,
            build_trip_room_name(trip_id),
            {
                "type": "trip.joined",
                "data": {
                    "trip_id": trip_id,
                    "user": UserSummary.model_validate(approved_member.user).model_dump(mode="json"),
                },
            },
        )
    return _serialize_trip(trip, current_user.id)


@router.post("/{trip_id}/reject", response_model=TripRead)
def reject_trip_member(
    trip_id: int,
    payload: TripApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripRead:
    trip = fetch_trip_with_members(db=db, trip_id=trip_id)
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    if trip.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the trip owner can reject members")

    try:
        trip = reject_member(db=db, trip=trip, user_id=payload.user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    invalidate_discover_cache()
    return _serialize_trip(trip, current_user.id)
