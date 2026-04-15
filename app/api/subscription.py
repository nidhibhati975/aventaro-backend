from __future__ import annotations

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.payments import create_subscription_checkout_session
from app.services.subscriptions import cancel_current_subscription, get_subscription_payload


router = APIRouter(prefix="/subscription")


class SubscriptionRead(BaseModel):
    user_id: int
    plan_type: str
    status: str
    current_period_end: object | None = None
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    is_premium: bool
    referral_code: str | None = None


class SubscriptionUpgradeRequest(BaseModel):
    success_url: str = Field(min_length=10)
    cancel_url: str = Field(min_length=10)
    price_id: str | None = None


class SubscriptionUpgradeResponse(BaseModel):
    session_id: str
    checkout_url: str
    amount_total: int | None = None
    currency: str | None = None


@router.get("/me", response_model=SubscriptionRead)
def get_my_subscription(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionRead:
    return SubscriptionRead.model_validate(get_subscription_payload(db, current_user))


@router.post("/upgrade", response_model=SubscriptionUpgradeResponse, status_code=status.HTTP_201_CREATED)
def upgrade_subscription(
    payload: SubscriptionUpgradeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionUpgradeResponse:
    session = create_subscription_checkout_session(
        db=db,
        user=current_user,
        price_id=payload.price_id,
        success_url=payload.success_url,
        cancel_url=payload.cancel_url,
    )
    return SubscriptionUpgradeResponse(
        session_id=session.id,
        checkout_url=session.url,
        amount_total=session.amount_total,
        currency=session.currency,
    )


@router.post("/cancel", response_model=SubscriptionRead)
def cancel_subscription(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionRead:
    cancel_current_subscription(db=db, user=current_user)
    db.refresh(current_user)
    return SubscriptionRead.model_validate(get_subscription_payload(db, current_user))
