from __future__ import annotations

from anyio import from_thread
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.chat import MessageStatus
from app.models.trip import ExpenseSplitStatus, Trip, TripMemberRole, TripMembershipStatus
from app.models.user import User
from app.services.auth import get_current_user
from app.services.chat_realtime import chat_connection_manager
from app.services.redis_runtime import invalidate_discover_cache
from app.services.subscriptions import enforce_trip_join_limit
from app.services.trip_collaboration import (
    build_trip_room_name,
    calculate_trip_balances,
    get_trip_chat,
    list_trip_activities,
    list_trip_expenses,
)
from app.services.trip import (
    approve_member,
    create_trip as create_trip_service,
    fetch_trip_with_members,
    leave_trip as leave_trip_service,
    list_trips as list_trips_service,
    reject_member,
    request_join_trip,
)


router = APIRouter(prefix="/trip")


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


class TripCreateRequest(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    location: str = Field(min_length=2, max_length=150)
    capacity: int = Field(ge=1, le=100)
    budget_min: int | None = Field(default=None, ge=0)
    budget_max: int | None = Field(default=None, ge=0)
    interests: list[str] | None = None


class TripApprovalRequest(BaseModel):
    user_id: int = Field(gt=0)


class TripMemberRead(BaseModel):
    user: UserSummary
    role: TripMemberRole
    status: TripMembershipStatus


class TripRead(BaseModel):
    id: int
    title: str
    location: str
    capacity: int
    budget_min: int | None = None
    budget_max: int | None = None
    interests: list[str] | None = None
    owner: UserSummary
    members: list[TripMemberRead]
    approved_member_count: int
    current_user_status: TripMembershipStatus | None = None


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
        owner=UserSummary.model_validate(trip.owner),
        members=members,
        approved_member_count=approved_count,
        current_user_status=current_status,
    )


@router.post("/create", response_model=TripRead, status_code=status.HTTP_201_CREATED)
def create_trip(
    payload: TripCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripRead:
    trip = create_trip_service(
        db=db,
        owner_id=current_user.id,
        title=payload.title,
        location=payload.location,
        capacity=payload.capacity,
        budget_min=payload.budget_min,
        budget_max=payload.budget_max,
        interests=payload.interests,
    )
    invalidate_discover_cache()
    return _serialize_trip(trip, current_user.id)


@router.get("", response_model=list[TripRead])
def list_trips(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TripRead]:
    trips = list_trips_service(db=db)
    return [_serialize_trip(trip, current_user.id) for trip in trips]


@router.get("/{trip_id}", response_model=TripRead)
def get_trip(
    trip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TripRead:
    trip = fetch_trip_with_members(db=db, trip_id=trip_id)
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return _serialize_trip(trip, current_user.id)


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
