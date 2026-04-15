from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.social import ReportTargetType
from app.models.user import User
from app.services.auth import get_current_user
from app.services.rate_limit import rate_limit
from app.services.social import block_user, create_report


router = APIRouter()


class ReportCreateRequest(BaseModel):
    target_type: ReportTargetType
    target_id: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=255)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Reason cannot be blank")
        return normalized


class ReportRead(BaseModel):
    id: int
    target_type: ReportTargetType
    target_id: int
    reason: str
    created_at: object


class BlockRead(BaseModel):
    blocked: bool
    user_id: int


@router.post("/report", response_model=ReportRead, status_code=status.HTTP_201_CREATED)
def create_report_endpoint(
    payload: ReportCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("report_create", 40, 3600)),
) -> ReportRead:
    try:
        report = create_report(
            db=db,
            reporter_id=current_user.id,
            target_type=payload.target_type,
            target_id=payload.target_id,
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ReportRead.model_validate(report)


@router.post("/block/{user_id}", response_model=BlockRead)
def block_user_endpoint(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("block_user", 40, 3600)),
) -> BlockRead:
    try:
        result = block_user(db=db, blocker_id=current_user.id, blocked_id=user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return BlockRead.model_validate(result)
