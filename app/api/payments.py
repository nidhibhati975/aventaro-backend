from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.payments import (
    construct_webhook_event,
    create_subscription_checkout_session,
    process_webhook_event,
)


router = APIRouter(prefix="/payments")


class CheckoutSessionRequest(BaseModel):
    success_url: str = Field(min_length=10)
    cancel_url: str = Field(min_length=10)
    price_id: str | None = None


class CheckoutSessionResponse(BaseModel):
    session_id: str
    checkout_url: str
    amount_total: int | None = None
    currency: str | None = None


@router.post("/create-session", response_model=CheckoutSessionResponse)
def create_checkout_session(
    payload: CheckoutSessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CheckoutSessionResponse:
    session = create_subscription_checkout_session(
        db=db,
        user=current_user,
        price_id=payload.price_id,
        success_url=payload.success_url,
        cancel_url=payload.cancel_url,
    )
    return CheckoutSessionResponse(
        session_id=session.id,
        checkout_url=session.url,
        amount_total=session.amount_total,
        currency=session.currency,
    )


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
) -> dict[str, str]:
    payload = await request.body()
    try:
        event = construct_webhook_event(payload, stripe_signature)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe webhook payload") from exc

    process_webhook_event(db=db, event=event)
    return {"status": "ok"}
