from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.booking import Booking
from app.models.payments import Payment
from app.models.user import User
from app.services.auth import get_current_user
from app.services.booking import create_booking_payment
from app.services.payments import (
    construct_razorpay_webhook_event,
    construct_webhook_event,
    create_subscription_checkout_session,
    process_razorpay_webhook_event,
    process_webhook_event,
)


router = APIRouter()
subscription_router = APIRouter(prefix="/payments")
compat_router = APIRouter(prefix="/payment")


class CheckoutSessionRequest(BaseModel):
    success_url: str = Field(min_length=10)
    cancel_url: str = Field(min_length=10)
    price_id: str | None = None


class CheckoutSessionResponse(BaseModel):
    session_id: str
    checkout_url: str
    amount_total: int | None = None
    currency: str | None = None


class BookingPaymentCreateRequest(BaseModel):
    booking_id: int
    amount: float | None = None
    currency: str | None = None
    provider: str | None = None
    method: str | None = None
    idempotency_key: str | None = None


class PaymentStatusRead(BaseModel):
    transaction_id: str
    status: str
    booking_status: str | None = None
    checkout_url: str | None = None


@subscription_router.post("/create-session", response_model=CheckoutSessionResponse)
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


@subscription_router.post("/webhook")
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
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe webhook payload") from exc

    process_webhook_event(db=db, event=event)
    return {"status": "ok"}


@subscription_router.post("/razorpay/webhook")
async def razorpay_webhook(
    request: Request,
    db: Session = Depends(get_db),
    razorpay_signature: str | None = Header(default=None, alias="X-Razorpay-Signature"),
    razorpay_event_id: str | None = Header(default=None, alias="X-Razorpay-Event-Id"),
) -> dict[str, str]:
    payload = await request.body()
    event = construct_razorpay_webhook_event(payload, razorpay_signature)
    process_razorpay_webhook_event(db=db, event=event, event_id=razorpay_event_id)
    return {"status": "ok"}


@compat_router.post("/create", response_model=dict)
def create_booking_payment_compat(
    payload: BookingPaymentCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    try:
        payment = create_booking_payment(
            db=db,
            booking_id=payload.booking_id,
            user_id=current_user.id,
            idempotency_key=payload.idempotency_key,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (ValueError, HTTPException) as exc:
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {
        "transaction_id": payment["payment_id"],
        "status": payment["status"],
        "booking_id": payment["booking_id"],
        "amount": payment["amount"],
        "currency": payment["currency"],
        "approval_url": payment["checkout_url"],
        "checkout_url": payment["checkout_url"],
        "expires_at": payment["expires_at"],
        "qr_image": None,
    }


def _serialize_payment_state(payment: Payment) -> PaymentStatusRead:
    booking_status = None
    if payment.booking_id is not None:
        booking_status = payment.booking.status.value if payment.booking is not None else None
    normalized_status = payment.status.lower()
    if normalized_status == "paid":
        normalized_status = "success"
    return PaymentStatusRead(
        transaction_id=payment.stripe_session_id,
        status=normalized_status,
        booking_status=booking_status,
        checkout_url=payment.checkout_url,
    )


@compat_router.get("/upi/status/{transaction_id}", response_model=PaymentStatusRead)
def get_upi_status(
    transaction_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaymentStatusRead:
    payment = db.scalar(
        select(Payment)
        .where(Payment.stripe_session_id == transaction_id, Payment.user_id == current_user.id)
    )
    if payment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
    return _serialize_payment_state(payment)


@compat_router.post("/paypal/capture/{transaction_id}", response_model=PaymentStatusRead)
def capture_paypal_compat(
    transaction_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaymentStatusRead:
    payment = db.scalar(
        select(Payment)
        .where(Payment.stripe_session_id == transaction_id, Payment.user_id == current_user.id)
    )
    if payment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
    return _serialize_payment_state(payment)


router.include_router(subscription_router)
router.include_router(compat_router)
