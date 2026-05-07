from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.monetization import get_user_commissions


router = APIRouter(prefix="/affiliate")


class AffiliateDashboardRead(BaseModel):
    total_earnings: float
    pending_payouts: float
    total_referrals: int
    conversion_rate: float


class CommissionRead(BaseModel):
    id: int
    amount: float
    currency: str
    status: str
    created_at: object


class PayoutRequestCreate(BaseModel):
    amount: float = Field(gt=0)
    payment_method: str = Field(min_length=2, max_length=32)


@router.get("/dashboard", response_model=AffiliateDashboardRead)
def get_affiliate_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AffiliateDashboardRead:
    commissions = get_user_commissions(db=db, user_id=current_user.id)
    total_earnings = sum(float(item.commission_amount) for item in commissions)
    pending_payouts = sum(float(item.commission_amount) for item in commissions if item.status == "pending")
    return AffiliateDashboardRead(
        total_earnings=total_earnings,
        pending_payouts=pending_payouts,
        total_referrals=0,
        conversion_rate=0.0,
    )


@router.get("/commissions", response_model=list[CommissionRead])
def get_commissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[CommissionRead]:
    commissions = get_user_commissions(db=db, user_id=current_user.id)
    return [
        CommissionRead(
            id=item.id,
            amount=float(item.commission_amount),
            currency="USD",
            status=item.status,
            created_at=item.created_at,
        )
        for item in commissions
    ]


@router.post("/payout/request")
def request_payout(
    payload: PayoutRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    commissions = get_user_commissions(db=db, user_id=current_user.id, status="pending")
    available = sum(float(item.commission_amount) for item in commissions)
    if payload.amount > available:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Requested payout exceeds available commission balance",
        )
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Affiliate payout processing is not configured yet",
    )
