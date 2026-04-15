from __future__ import annotations

from anyio import from_thread
from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.trip import ExpenseSplitStatus, ExpenseSplitType
from app.models.user import User
from app.services.auth import get_current_user
from app.services.chat_realtime import chat_connection_manager
from app.services.idempotency import IdempotencyClaim, claim_idempotency, clear_idempotency_claim, store_idempotent_response
from app.services.push_notifications import send_push_notification
from app.services.rate_limit import rate_limit
from app.services.trip_collaboration import build_trip_room_name, create_trip_expense, settle_expense


router = APIRouter(prefix="/expenses")


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


class ExpenseSplitInput(BaseModel):
    user_id: int = Field(gt=0)
    amount: float | None = Field(default=None, gt=0)
    percentage: float | None = Field(default=None, gt=0, le=100)


class ExpenseCreateRequest(BaseModel):
    trip_id: int = Field(gt=0)
    amount: float = Field(gt=0)
    description: str = Field(min_length=1, max_length=255)
    split_type: ExpenseSplitType = ExpenseSplitType.equal
    splits: list[ExpenseSplitInput] | None = None

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Description cannot be blank")
        return normalized

    @model_validator(mode="after")
    def validate_split_payload(self) -> "ExpenseCreateRequest":
        if self.split_type == ExpenseSplitType.equal:
            if self.splits:
                raise ValueError("Equal split does not accept custom split rows")
            return self
        if not self.splits:
            raise ValueError("Split rows are required for this split type")
        if self.split_type == ExpenseSplitType.percentage:
            if any(item.percentage is None for item in self.splits):
                raise ValueError("Percentage split rows require percentage values")
            if any(item.amount is not None for item in self.splits):
                raise ValueError("Percentage split rows cannot include amount values")
            return self
        if any(item.amount is None for item in self.splits):
            raise ValueError("Custom split rows require amount values")
        if any(item.percentage is not None for item in self.splits):
            raise ValueError("Custom split rows cannot include percentage values")
        return self


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
    split_type: ExpenseSplitType
    created_at: object
    splits: list[ExpenseSplitRead]


class ExpenseSettlementRead(BaseModel):
    id: int
    expense_id: int
    trip_id: int
    amount: float
    status: ExpenseSplitStatus
    user: UserSummary


def _resolve_idempotency(scope: str, user_id: int, idempotency_key: str | None) -> IdempotencyClaim | JSONResponse | None:
    return claim_idempotency(scope=scope, user_id=user_id, request_key=idempotency_key)


@router.post("/create", response_model=ExpenseRead, status_code=status.HTTP_201_CREATED)
def create_expense_endpoint(
    payload: ExpenseCreateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("trip_expense_create", 60, 3600)),
) -> ExpenseRead | JSONResponse:
    idempotency = _resolve_idempotency("trip_expense_create", current_user.id, idempotency_key)
    if isinstance(idempotency, JSONResponse):
        return idempotency
    try:
        expense_payload, member_ids = create_trip_expense(
            db=db,
            trip_id=payload.trip_id,
            paid_by_user_id=current_user.id,
            amount=payload.amount,
            description=payload.description,
            split_type=payload.split_type,
            splits=[item.model_dump(mode="json", exclude_none=True) for item in (payload.splits or [])] or None,
        )
    except LookupError as exc:
        clear_idempotency_claim(idempotency if isinstance(idempotency, IdempotencyClaim) else None)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        clear_idempotency_claim(idempotency if isinstance(idempotency, IdempotencyClaim) else None)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        clear_idempotency_claim(idempotency if isinstance(idempotency, IdempotencyClaim) else None)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    response = ExpenseRead.model_validate(expense_payload)
    store_idempotent_response(
        idempotency if isinstance(idempotency, IdempotencyClaim) else None,
        status_code=status.HTTP_201_CREATED,
        payload=response.model_dump(mode="json"),
    )
    from_thread.run(
        chat_connection_manager.broadcast_to_room,
        build_trip_room_name(payload.trip_id),
        {"type": "expense.created", "data": response.model_dump(mode="json")},
    )
    offline_user_ids = chat_connection_manager.filter_offline_users(
        user_id for user_id in member_ids if user_id != current_user.id
    )
    send_push_notification(
        db,
        user_ids=offline_user_ids,
        title="New trip expense",
        body=payload.description,
        data={"type": "expense.created", "trip_id": payload.trip_id, "expense_id": response.id},
    )
    return response


@router.post("/{expense_id}/settle", response_model=ExpenseSettlementRead)
def settle_expense_endpoint(
    expense_id: int,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("trip_expense_settle", 120, 3600)),
) -> ExpenseSettlementRead | JSONResponse:
    idempotency = _resolve_idempotency("trip_expense_settle", current_user.id, idempotency_key)
    if isinstance(idempotency, JSONResponse):
        return idempotency
    try:
        split_payload, trip_id, member_ids = settle_expense(db=db, expense_id=expense_id, current_user_id=current_user.id)
    except LookupError as exc:
        clear_idempotency_claim(idempotency if isinstance(idempotency, IdempotencyClaim) else None)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        clear_idempotency_claim(idempotency if isinstance(idempotency, IdempotencyClaim) else None)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except RuntimeError as exc:
        clear_idempotency_claim(idempotency if isinstance(idempotency, IdempotencyClaim) else None)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    response = ExpenseSettlementRead.model_validate(split_payload)
    store_idempotent_response(
        idempotency if isinstance(idempotency, IdempotencyClaim) else None,
        status_code=status.HTTP_200_OK,
        payload=response.model_dump(mode="json"),
    )
    from_thread.run(
        chat_connection_manager.broadcast_to_room,
        build_trip_room_name(trip_id),
        {"type": "expense.settled", "data": response.model_dump(mode="json")},
    )
    offline_user_ids = chat_connection_manager.filter_offline_users(
        user_id for user_id in member_ids if user_id != current_user.id
    )
    send_push_notification(
        db,
        user_ids=offline_user_ids,
        title="Expense settled",
        body="A trip expense was settled",
        data={"type": "expense.settled", "trip_id": trip_id, "expense_id": expense_id, "split_id": response.id},
    )
    return response
