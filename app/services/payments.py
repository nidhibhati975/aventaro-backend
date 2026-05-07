from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
from typing import Any

import stripe
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.booking import Booking, BookingStatus
from app.models.payments import Payment, Subscription, WebhookEvent
from app.models.user import User
from app.services.analytics import record_analytics_event, record_subscription_metrics_snapshot
from app.services.external_retry import call_with_retries
from app.services.ledger import append_ledger_entry, get_or_create_ledger_account
from app.services.payment_gateways import PaymentRefundRequest, amount_major_to_minor, get_payment_gateway
from app.services.webhooks import parse_json_payload, verify_razorpay_webhook_signature
from app.services.notifications import NOTIFICATION_ENTITY_TYPE_PAYMENT, create_notification
from app.services.subscriptions import (
    STATUS_ACTIVE,
    STATUS_CANCELED,
    STATUS_EXPIRED,
    activate_premium_subscription,
    ensure_subscription_record,
    expire_subscription,
    get_current_subscription_record,
    is_premium_record,
)
from app.utils.config import get_settings


logger = logging.getLogger(__name__)
STRIPE_API_VERSION = "2026-02-25.clover"


@dataclass(frozen=True)
class CheckoutSessionResult:
    id: str
    url: str
    amount_total: int | None
    currency: str | None
    customer_id: str | None
    expires_at: datetime | None
    price_id: str


@dataclass(frozen=True)
class BookingCheckoutSessionResult:
    id: str
    url: str
    amount_total: int | None
    currency: str | None
    customer_id: str | None
    expires_at: datetime | None
    booking_id: int


def _configure_stripe() -> None:
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Stripe is not configured")
    stripe.api_key = settings.stripe_secret_key
    stripe.api_version = STRIPE_API_VERSION
    stripe.max_network_retries = 2


def _timestamp_to_datetime(value: int | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc)


def _ensure_customer(db: Session, user: User) -> str:
    if user.stripe_customer_id:
        try:
            stripe.Customer.retrieve(user.stripe_customer_id)
            return user.stripe_customer_id
        except stripe.error.InvalidRequestError:
            user.stripe_customer_id = None
            db.flush()
        except stripe.error.StripeError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe customer lookup unavailable") from exc

    try:
        customer = call_with_retries(
            lambda: stripe.Customer.create(
                email=user.email,
                metadata={"user_id": str(user.id)},
                idempotency_key=f"stripe_customer:{user.id}",
            )
        )
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe customer creation unavailable") from exc
    user.stripe_customer_id = customer.id
    db.flush()
    return customer.id


def _find_reusable_payment(db: Session, user_id: int, price_id: str) -> Payment | None:
    now = datetime.now(timezone.utc)
    return db.scalar(
        select(Payment)
        .where(
            Payment.user_id == user_id,
            Payment.stripe_price_id == price_id,
            Payment.status == "created",
            Payment.checkout_url.is_not(None),
            Payment.checkout_expires_at.is_not(None),
            Payment.checkout_expires_at > now,
        )
        .order_by(Payment.created_at.desc())
        .limit(1)
    )


def _find_reusable_booking_payment(db: Session, booking_id: int) -> Payment | None:
    now = datetime.now(timezone.utc)
    return db.scalar(
        select(Payment)
        .where(
            Payment.booking_id == booking_id,
            Payment.payment_type == "booking",
            Payment.status == "created",
            Payment.checkout_url.is_not(None),
            Payment.checkout_expires_at.is_not(None),
            Payment.checkout_expires_at > now,
        )
        .order_by(Payment.created_at.desc())
        .limit(1)
    )


def _find_payment_by_idempotency_key(db: Session, idempotency_key: str | None) -> Payment | None:
    if not idempotency_key:
        return None
    return db.scalar(select(Payment).where(Payment.idempotency_key == idempotency_key))


def create_subscription_checkout_session(
    db: Session,
    user: User,
    price_id: str | None,
    success_url: str,
    cancel_url: str,
) -> CheckoutSessionResult:
    settings = get_settings()
    _configure_stripe()
    price = price_id or settings.stripe_premium_price_id
    if not price:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Stripe price ID not configured")

    current_subscription = ensure_subscription_record(db, user.id)
    if is_premium_record(current_subscription):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Premium subscription already active")
    locked_user = db.scalar(select(User).where(User.id == user.id).with_for_update())
    if locked_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    reusable_payment = _find_reusable_payment(db=db, user_id=locked_user.id, price_id=price)
    if reusable_payment is not None and reusable_payment.checkout_url:
        return CheckoutSessionResult(
            id=reusable_payment.stripe_session_id,
            url=reusable_payment.checkout_url,
            amount_total=reusable_payment.amount,
            currency=reusable_payment.currency,
            customer_id=reusable_payment.stripe_customer_id,
            expires_at=reusable_payment.checkout_expires_at,
            price_id=price,
        )

    customer_id = _ensure_customer(db=db, user=locked_user)
    try:
        session = call_with_retries(
            lambda: stripe.checkout.Session.create(
                mode="subscription",
                success_url=success_url,
                cancel_url=cancel_url,
                customer=customer_id,
                line_items=[{"price": price, "quantity": 1}],
                client_reference_id=str(locked_user.id),
                metadata={"user_id": str(locked_user.id), "price_id": price},
                subscription_data={"metadata": {"user_id": str(locked_user.id), "price_id": price}},
                idempotency_key=f"subscription_checkout:{locked_user.id}:{price}",
            )
        )
    except stripe.error.InvalidRequestError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe checkout request") from exc
    except stripe.error.StripeError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe checkout unavailable") from exc

    payment = Payment(
        user_id=locked_user.id,
        stripe_session_id=session.id,
        stripe_customer_id=customer_id,
        stripe_price_id=price,
        checkout_url=session.url,
        checkout_expires_at=_timestamp_to_datetime(session.expires_at),
        amount=session.amount_total or 0,
        currency=session.currency or "usd",
        status="created",
        provider="stripe",
        idempotency_key=f"stripe:checkout:{session.id}",
    )
    db.add(payment)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        logger.exception("Unable to persist Stripe checkout session", exc_info=exc)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Checkout session already exists") from exc

    return CheckoutSessionResult(
        id=session.id,
        url=session.url,
        amount_total=session.amount_total,
        currency=session.currency,
        customer_id=customer_id,
        expires_at=_timestamp_to_datetime(session.expires_at),
        price_id=price,
    )


def create_booking_checkout_session(
    db: Session,
    *,
    booking: Booking,
    success_url: str | None = None,
    cancel_url: str | None = None,
    idempotency_key: str | None = None,
) -> BookingCheckoutSessionResult:
    settings = get_settings()
    _configure_stripe()
    locked_booking = db.scalar(select(Booking).where(Booking.id == booking.id).with_for_update())
    if locked_booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    if locked_booking.status not in {BookingStatus.pending, BookingStatus.payment_initiated}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot create payment for booking with status: {locked_booking.status.value}",
        )

    reusable_payment = _find_reusable_booking_payment(db=db, booking_id=locked_booking.id)
    reusable_payment = _find_payment_by_idempotency_key(db=db, idempotency_key=idempotency_key) or reusable_payment
    if reusable_payment is not None and reusable_payment.checkout_url:
        return BookingCheckoutSessionResult(
            id=reusable_payment.stripe_session_id,
            url=reusable_payment.checkout_url,
            amount_total=reusable_payment.amount,
            currency=reusable_payment.currency,
            customer_id=reusable_payment.stripe_customer_id,
            expires_at=reusable_payment.checkout_expires_at,
            booking_id=locked_booking.id,
        )

    user = db.scalar(select(User).where(User.id == locked_booking.user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking user not found")
    customer_id = _ensure_customer(db=db, user=user)

    resolved_success_url = success_url or getattr(settings, "stripe_booking_success_url", None)
    resolved_cancel_url = cancel_url or getattr(settings, "stripe_booking_cancel_url", None)
    if not resolved_success_url or not resolved_cancel_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Booking Stripe success/cancel URLs are not configured",
        )

    session_kwargs: dict[str, Any] = {
        "mode": "payment",
        "success_url": resolved_success_url,
        "cancel_url": resolved_cancel_url,
        "customer": customer_id,
        "client_reference_id": f"booking:{locked_booking.id}",
        "metadata": {
            "user_id": str(locked_booking.user_id),
            "booking_id": str(locked_booking.id),
            "payment_type": "booking",
        },
        "line_items": [
            {
                "price_data": {
                    "currency": locked_booking.currency.lower(),
                    "product_data": {"name": f"Aventaro Booking #{locked_booking.id}"},
                    "unit_amount": amount_major_to_minor(locked_booking.total_amount, locked_booking.currency),
                },
                "quantity": 1,
            }
        ],
    }
    try:
        if idempotency_key:
            session = call_with_retries(
                lambda: stripe.checkout.Session.create(**session_kwargs, idempotency_key=idempotency_key)
            )
        else:
            session = call_with_retries(lambda: stripe.checkout.Session.create(**session_kwargs))
    except stripe.error.InvalidRequestError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe booking checkout request") from exc
    except stripe.error.StripeError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe checkout unavailable") from exc

    locked_booking.status = BookingStatus.payment_initiated
    payment = Payment(
        user_id=locked_booking.user_id,
        booking_id=locked_booking.id,
        payment_type="booking",
        stripe_session_id=session.id,
        stripe_customer_id=customer_id,
        stripe_price_id=None,
        checkout_url=session.url,
        checkout_expires_at=_timestamp_to_datetime(session.expires_at),
        amount=session.amount_total or int(locked_booking.total_amount * 100),
        currency=session.currency or locked_booking.currency.lower(),
        status="created",
        provider="stripe",
        idempotency_key=idempotency_key,
    )
    db.add(payment)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Booking checkout session already exists") from exc

    return BookingCheckoutSessionResult(
        id=session.id,
        url=session.url,
        amount_total=session.amount_total,
        currency=session.currency,
        customer_id=customer_id,
        expires_at=_timestamp_to_datetime(session.expires_at),
        booking_id=locked_booking.id,
    )


def construct_webhook_event(payload: bytes, signature: str | None):
    settings = get_settings()
    _configure_stripe()
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Stripe webhook secret not configured")
    if signature is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Stripe signature header")
    try:
        return stripe.Webhook.construct_event(payload, signature, settings.stripe_webhook_secret)
    except stripe.error.SignatureVerificationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe webhook signature") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe webhook payload") from exc


def _normalize_stripe_event(event: Any) -> dict[str, object]:
    to_dict_recursive = getattr(event, "to_dict_recursive", None)
    if callable(to_dict_recursive):
        return to_dict_recursive()
    if isinstance(event, dict):
        return event
    return dict(event)


def _get_or_create_webhook_event_record(db: Session, event: Any) -> WebhookEvent:
    normalized_event = _normalize_stripe_event(event)
    stripe_event_id = str(normalized_event.get("id") or "").strip()
    if not stripe_event_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Stripe event id")

    existing = db.scalar(select(WebhookEvent).where(WebhookEvent.stripe_event_id == stripe_event_id))
    if existing is not None:
        return existing

    webhook_event = WebhookEvent(
        stripe_event_id=stripe_event_id,
        provider="stripe",
        provider_event_id=stripe_event_id,
        event_type=str(normalized_event.get("type") or "unknown"),
        payload=normalized_event,
        processed=False,
    )
    db.add(webhook_event)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(WebhookEvent).where(WebhookEvent.stripe_event_id == stripe_event_id))
        if existing is None:
            raise
        return existing
    db.refresh(webhook_event)
    return webhook_event


def construct_razorpay_webhook_event(payload: bytes, signature: str | None) -> dict[str, Any]:
    verify_razorpay_webhook_signature(payload, signature)
    return parse_json_payload(payload)


def _get_or_create_provider_webhook_event_record(
    db: Session,
    *,
    provider: str,
    provider_event_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> WebhookEvent:
    existing = db.scalar(
        select(WebhookEvent).where(
            WebhookEvent.provider == provider,
            WebhookEvent.provider_event_id == provider_event_id,
        )
    )
    if existing is not None:
        return existing
    event = WebhookEvent(
        stripe_event_id=f"{provider}:{provider_event_id}",
        provider=provider,
        provider_event_id=provider_event_id,
        event_type=event_type,
        payload=payload,
        processed=False,
    )
    db.add(event)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(WebhookEvent).where(
                WebhookEvent.provider == provider,
                WebhookEvent.provider_event_id == provider_event_id,
            )
        )
        if existing is None:
            raise
        return existing
    db.refresh(event)
    return event


def process_razorpay_webhook_event(db: Session, event: dict[str, Any], event_id: str | None) -> bool:
    provider_event_id = event_id or str(event.get("id") or event.get("event") or "")
    if not provider_event_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Razorpay event id")
    webhook_event = _get_or_create_provider_webhook_event_record(
        db,
        provider="razorpay",
        provider_event_id=provider_event_id,
        event_type=str(event.get("event") or "unknown"),
        payload=event,
    )
    try:
        locked_event = db.scalar(select(WebhookEvent).where(WebhookEvent.id == webhook_event.id).with_for_update())
        if locked_event is None:
            db.rollback()
            return False
        if locked_event.processed:
            db.rollback()
            return False
        event_type = locked_event.event_type
        payment_entity = (((locked_event.payload.get("payload") or {}).get("payment") or {}).get("entity") or {})
        if event_type == "payment.captured" and payment_entity:
            notes = payment_entity.get("notes") or {}
            raw_user_id = notes.get("user_id")
            if raw_user_id:
                user_id = int(raw_user_id)
                provider_reference = str(payment_entity.get("id") or provider_event_id)
                order_reference = str(payment_entity.get("order_id") or provider_reference)
                amount = int(payment_entity.get("amount") or 0)
                currency = str(payment_entity.get("currency") or "INR").lower()
                payment = db.scalar(
                    select(Payment).where(Payment.provider == "razorpay", Payment.stripe_session_id == order_reference)
                )
                if payment is None:
                    payment = Payment(
                        user_id=user_id,
                        payment_type=str(notes.get("payment_type") or "wallet"),
                        stripe_session_id=order_reference,
                        provider_payment_id=provider_reference,
                        amount=amount,
                        currency=currency,
                        status="paid",
                        provider="razorpay",
                        idempotency_key=f"razorpay:{order_reference}",
                    )
                    db.add(payment)
                    db.flush()
                else:
                    payment.status = "paid"
                    payment.provider_payment_id = provider_reference
                    payment.amount = amount or payment.amount
                    payment.currency = currency or payment.currency
                account = get_or_create_ledger_account(db, owner_type="user", owner_id=user_id, currency=currency.upper())
                append_ledger_entry(
                    db,
                    account=account,
                    user_id=user_id,
                    direction="credit",
                    amount=payment.amount,
                    entry_type=f"{payment.payment_type}_payment",
                    provider="razorpay",
                    provider_reference=provider_reference,
                    reference_type="payment",
                    reference_id=payment.id,
                    idempotency_key=f"razorpay:ledger:{provider_reference}",
                    description="Razorpay payment captured",
                    metadata={"razorpay_order_id": order_reference},
                )
                if payment.booking_id is not None or notes.get("booking_id"):
                    from app.services.booking import confirm_booking

                    booking_id = payment.booking_id or int(notes["booking_id"])
                    payment.booking_id = booking_id
                    confirm_booking(
                        db,
                        booking_id=booking_id,
                        event_id=provider_event_id,
                        provider_reference=provider_reference,
                    )
        if event_type == "payment.failed" and payment_entity:
            order_reference = str(payment_entity.get("order_id") or "")
            payment = db.scalar(
                select(Payment).where(Payment.provider == "razorpay", Payment.stripe_session_id == order_reference)
            )
            if payment is not None:
                payment.status = "failed"
                payment.failure_reason = str((payment_entity.get("error_description") or "razorpay_payment_failed"))[:255]
                if payment.booking_id is not None:
                    booking = db.scalar(select(Booking).where(Booking.id == payment.booking_id))
                    if booking is not None and booking.status == BookingStatus.payment_initiated:
                        booking.status = BookingStatus.failed
        refund_entity = (((locked_event.payload.get("payload") or {}).get("refund") or {}).get("entity") or {})
        if event_type in {"refund.processed", "refund.created"} and refund_entity:
            provider_payment_id = str(refund_entity.get("payment_id") or "")
            payment = db.scalar(
                select(Payment).where(Payment.provider == "razorpay", Payment.provider_payment_id == provider_payment_id)
            )
            refund_status = str(refund_entity.get("status") or "").lower()
            if payment is not None and refund_status == "processed":
                _mark_payment_refund_confirmed(
                    db,
                    payment=payment,
                    refund_provider_id=str(refund_entity.get("id") or payment.refund_provider_id or ""),
                    amount_minor=int(refund_entity.get("amount") or 0),
                    status_value=refund_status,
                    provider_event=event_type,
                )
        locked_event.processed = True
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise


def _find_user_id_by_customer(db: Session, customer_id: str | None) -> int | None:
    if not customer_id:
        return None
    user = db.scalar(select(User).where(User.stripe_customer_id == customer_id))
    return user.id if user is not None else None


def _find_user_id_by_subscription(db: Session, subscription_id: str | None) -> int | None:
    if not subscription_id:
        return None
    subscription = db.scalar(
        select(Subscription.user_id).where(Subscription.stripe_subscription_id == subscription_id).limit(1)
    )
    return int(subscription) if subscription is not None else None


def _resolve_user_id(payment: Payment | None, event_payload: dict, *, db: Session) -> int | None:
    if payment is not None:
        return payment.user_id
    metadata = event_payload.get("metadata") or {}
    raw_user_id = metadata.get("user_id") or event_payload.get("client_reference_id")
    if raw_user_id:
        return int(raw_user_id)
    return _find_user_id_by_customer(db, event_payload.get("customer"))


def _get_or_create_payment(db: Session, event_payload: dict) -> Payment | None:
    session_id = event_payload.get("id")
    if not session_id:
        return None

    payment = db.scalar(select(Payment).where(Payment.stripe_session_id == session_id))
    if payment is not None:
        return payment

    user_id = _resolve_user_id(None, event_payload, db=db)
    if user_id is None:
        return None

    metadata = event_payload.get("metadata") or {}
    payment = Payment(
        user_id=user_id,
        booking_id=int(metadata["booking_id"]) if metadata.get("booking_id") else None,
        payment_type=str(metadata.get("payment_type") or "subscription"),
        stripe_session_id=session_id,
        stripe_customer_id=event_payload.get("customer"),
        stripe_price_id=metadata.get("price_id"),
        provider_payment_id=event_payload.get("payment_intent") or event_payload.get("payment_id"),
        checkout_url=event_payload.get("url"),
        checkout_expires_at=_timestamp_to_datetime(event_payload.get("expires_at")),
        amount=int(event_payload.get("amount_total") or 0),
        currency=event_payload.get("currency") or "usd",
        status="created",
        provider="stripe",
        idempotency_key=f"stripe:{session_id}",
    )
    db.add(payment)
    db.flush()
    return payment


def _retrieve_subscription_snapshot(subscription_id: str | None) -> dict[str, object] | None:
    if not subscription_id:
        return None
    try:
        _configure_stripe()
        subscription = stripe.Subscription.retrieve(subscription_id)
    except Exception:
        return None
    return {
        "customer": subscription.get("customer"),
        "status": subscription.get("status"),
        "current_period_end": _timestamp_to_datetime(subscription.get("current_period_end")),
    }


def _sync_user_customer_id(db: Session, *, user_id: int | None, customer_id: str | None) -> None:
    if user_id is None or not customer_id:
        return
    user = db.scalar(select(User).where(User.id == user_id))
    if user is not None and user.stripe_customer_id != customer_id:
        user.stripe_customer_id = customer_id


def handle_checkout_session_completed(db: Session, event_payload: dict) -> None:
    metadata = event_payload.get("metadata") or {}
    if metadata.get("payment_type") == "booking" or metadata.get("booking_id"):
        handle_booking_checkout_completed(db=db, event_payload=event_payload)
        return

    payment = _get_or_create_payment(db=db, event_payload=event_payload)
    user_id = _resolve_user_id(payment, event_payload, db=db)
    if user_id is None:
        return

    subscription_id = event_payload.get("subscription")
    subscription_snapshot = _retrieve_subscription_snapshot(subscription_id)
    current_subscription = get_current_subscription_record(db, user_id)
    was_premium = is_premium_record(current_subscription)
    previous_payment_status = payment.status if payment is not None else None
    customer_id = (
        event_payload.get("customer")
        or (subscription_snapshot or {}).get("customer")
    )

    if payment is not None:
        payment.status = "paid"
        payment.amount = int(event_payload.get("amount_total") or payment.amount)
        payment.currency = event_payload.get("currency") or payment.currency
        payment.stripe_customer_id = customer_id or payment.stripe_customer_id
        payment.provider_payment_id = event_payload.get("payment_intent") or payment.provider_payment_id
        payment.checkout_url = event_payload.get("url") or payment.checkout_url
        payment.checkout_expires_at = _timestamp_to_datetime(event_payload.get("expires_at")) or payment.checkout_expires_at
        account = get_or_create_ledger_account(
            db,
            owner_type="user",
            owner_id=user_id,
            currency=(payment.currency or "usd").upper(),
        )
        append_ledger_entry(
            db,
            account=account,
            user_id=user_id,
            direction="credit",
            amount=payment.amount,
            entry_type="subscription_payment",
            provider="stripe",
            provider_reference=str(event_payload.get("id") or payment.stripe_session_id),
            reference_type="payment",
            reference_id=payment.id,
            idempotency_key=f"stripe:ledger:checkout:{event_payload.get('id') or payment.stripe_session_id}",
            description="Stripe subscription checkout completed",
            metadata={"stripe_event": "checkout.session.completed"},
        )

    _sync_user_customer_id(db, user_id=user_id, customer_id=customer_id)
    subscription = activate_premium_subscription(
        db,
        user_id=user_id,
        stripe_customer_id=customer_id,
        stripe_subscription_id=subscription_id,
        current_period_end=(subscription_snapshot or {}).get("current_period_end"),
    )
    if previous_payment_status != "paid":
        create_notification(
            db=db,
            user_id=user_id,
            notification_type="payment_success",
            message="Your payment was completed successfully",
            entity_id=payment.id if payment is not None else None,
            entity_type=NOTIFICATION_ENTITY_TYPE_PAYMENT if payment is not None else None,
            commit=False,
        )
    if not was_premium and is_premium_record(subscription):
        record_analytics_event(
            db,
            event_type="subscription_started",
            user_id=user_id,
            metadata={"subscription_id": subscription_id, "payment_session_id": event_payload.get("id")},
            commit=False,
        )
    record_subscription_metrics_snapshot(db, reason="checkout_session_completed", commit=False)


def handle_booking_checkout_completed(db: Session, event_payload: dict) -> None:
    from app.services.booking import confirm_booking

    payment = _get_or_create_payment(db=db, event_payload=event_payload)
    metadata = event_payload.get("metadata") or {}
    raw_booking_id = metadata.get("booking_id")
    booking_id = int(raw_booking_id) if raw_booking_id else payment.booking_id if payment is not None else None
    if booking_id is None:
        return

    payment_status = str(event_payload.get("payment_status") or "").lower()
    if payment_status != "paid":
        if payment is not None:
            payment.status = "pending"
            payment.provider_payment_id = event_payload.get("payment_intent") or payment.provider_payment_id
        booking = db.scalar(select(Booking).where(Booking.id == booking_id))
        if booking is not None and booking.status == BookingStatus.pending:
            booking.status = BookingStatus.payment_initiated
        logger.warning(
            "booking_checkout_completed_without_verified_payment",
            extra={
                "event_type": "booking_checkout_completed_without_verified_payment",
                "booking_id": booking_id,
                "payment_session_id": event_payload.get("id"),
                "payment_status": payment_status or "unknown",
            },
        )
        return

    if payment is not None:
        payment.status = "paid"
        payment.amount = int(event_payload.get("amount_total") or payment.amount)
        payment.currency = event_payload.get("currency") or payment.currency
        payment.stripe_customer_id = event_payload.get("customer") or payment.stripe_customer_id
        payment.provider_payment_id = event_payload.get("payment_intent") or payment.provider_payment_id
        account = get_or_create_ledger_account(
            db,
            owner_type="user",
            owner_id=payment.user_id,
            currency=(payment.currency or "usd").upper(),
        )
        append_ledger_entry(
            db,
            account=account,
            user_id=payment.user_id,
            direction="credit",
            amount=payment.amount,
            entry_type="booking_payment",
            provider="stripe",
            provider_reference=str(event_payload.get("id") or payment.stripe_session_id),
            reference_type="booking",
            reference_id=booking_id,
            idempotency_key=f"stripe:ledger:booking:{event_payload.get('id') or payment.stripe_session_id}",
            description="Stripe booking checkout completed",
            metadata={"stripe_event": "checkout.session.completed"},
        )
    confirm_booking(
        db,
        booking_id=booking_id,
        event_id=event_payload.get("id"),
        provider_reference=event_payload.get("payment_intent"),
    )
    record_analytics_event(
        db,
        event_type="booking_payment_completed",
        user_id=int(metadata["user_id"]) if metadata.get("user_id") else payment.user_id if payment else None,
        metadata={"booking_id": booking_id, "payment_session_id": event_payload.get("id")},
        commit=False,
    )


def handle_subscription_updated(db: Session, event_payload: dict) -> None:
    metadata = event_payload.get("metadata") or {}
    raw_user_id = metadata.get("user_id")
    user_id = int(raw_user_id) if raw_user_id else _find_user_id_by_customer(db, event_payload.get("customer"))
    user_id = user_id or _find_user_id_by_subscription(db, event_payload.get("id"))
    if user_id is None:
        return

    status_value = str(event_payload.get("status") or STATUS_ACTIVE)
    current_period_end = _timestamp_to_datetime(event_payload.get("current_period_end"))
    _sync_user_customer_id(db, user_id=user_id, customer_id=event_payload.get("customer"))
    current_subscription = get_current_subscription_record(db, user_id)
    was_premium = is_premium_record(current_subscription)
    if status_value in {"active", "trialing"}:
        subscription = activate_premium_subscription(
            db,
            user_id=user_id,
            stripe_customer_id=event_payload.get("customer"),
            stripe_subscription_id=event_payload.get("id"),
            current_period_end=current_period_end,
        )
    else:
        subscription = expire_subscription(
            db,
            user_id=user_id,
            stripe_subscription_id=event_payload.get("id"),
            status_value=STATUS_EXPIRED,
            current_period_end=current_period_end or datetime.now(timezone.utc),
        )
    if not was_premium and is_premium_record(subscription):
        record_analytics_event(
            db,
            event_type="subscription_started",
            user_id=user_id,
            metadata={"subscription_id": event_payload.get("id")},
            commit=False,
        )
    if was_premium and not is_premium_record(subscription):
        record_analytics_event(
            db,
            event_type="subscription_canceled",
            user_id=user_id,
            metadata={
                "subscription_id": event_payload.get("id"),
                "reason": f"subscription_status_{status_value}",
            },
            commit=False,
        )
    record_subscription_metrics_snapshot(db, reason="subscription_updated", commit=False)


def handle_checkout_session_expired(db: Session, event_payload: dict) -> None:
    payment = _get_or_create_payment(db=db, event_payload=event_payload)
    if payment is None:
        return
    payment.status = "expired"
    payment.checkout_expires_at = _timestamp_to_datetime(event_payload.get("expires_at")) or payment.checkout_expires_at
    if payment.payment_type == "booking" and payment.booking_id is not None:
        booking = db.scalar(select(Booking).where(Booking.id == payment.booking_id))
        if booking is not None and booking.status == BookingStatus.payment_initiated:
            booking.status = BookingStatus.failed


def handle_payment_failed(db: Session, event_payload: dict) -> None:
    payment_intent_id = event_payload.get("id")
    metadata = event_payload.get("metadata") or {}
    payment = None
    if payment_intent_id:
        payment = db.scalar(select(Payment).where(Payment.provider_payment_id == payment_intent_id))
    checkout_session_id = metadata.get("checkout_session_id")
    if payment is None and checkout_session_id:
        payment = db.scalar(select(Payment).where(Payment.stripe_session_id == str(checkout_session_id)))
    if payment is None:
        return
    payment.status = "failed"
    payment.failure_reason = str(
        ((event_payload.get("last_payment_error") or {}).get("message"))
        or event_payload.get("cancellation_reason")
        or "provider_payment_failed"
    )[:255]
    if payment.booking_id is not None:
        booking = db.scalar(select(Booking).where(Booking.id == payment.booking_id))
        if booking is not None and booking.status == BookingStatus.payment_initiated:
            booking.status = BookingStatus.failed


def _append_payment_history_for_dispute(db: Session, booking: Booking, event_payload: dict) -> None:
    from app.models.booking import OrderAction, OrderHistory

    db.add(
        OrderHistory(
            booking_id=booking.id,
            user_id=booking.user_id,
            action=OrderAction.payment_failed,
            details={
                "reason": "payment_dispute",
                "provider_event": event_payload.get("id"),
                "status": event_payload.get("status"),
            },
        )
    )


def handle_charge_dispute(db: Session, event_payload: dict) -> None:
    charge_id = event_payload.get("charge")
    payment_intent_id = event_payload.get("payment_intent")
    status_value = str(event_payload.get("status") or "open")
    payment = None
    if payment_intent_id:
        payment = db.scalar(select(Payment).where(Payment.provider_payment_id == payment_intent_id))
    if payment is None and charge_id:
        payment = db.scalar(select(Payment).where(Payment.provider_payment_id == charge_id))
    if payment is None:
        return
    payment.dispute_status = status_value
    if status_value in {"lost", "warning_closed", "needs_response", "under_review", "open"}:
        payment.status = "disputed"
    if payment.booking_id is not None:
        booking = db.scalar(select(Booking).where(Booking.id == payment.booking_id))
        if booking is not None:
            _append_payment_history_for_dispute(db, booking, event_payload)


def _append_booking_refund_recovery_history(
    db: Session,
    *,
    booking: Booking,
    reason: str,
    provider_event: str | None,
    details: dict[str, Any] | None = None,
) -> None:
    from app.models.booking import OrderAction, OrderHistory

    db.add(
        OrderHistory(
            booking_id=booking.id,
            user_id=booking.user_id,
            action=OrderAction.payment_failed,
            details={
                "reason": reason,
                "provider_event": provider_event,
                **(details or {}),
            },
        )
    )


def _mark_payment_refund_confirmed(
    db: Session,
    *,
    payment: Payment,
    refund_provider_id: str,
    amount_minor: int,
    status_value: str,
    provider_event: str | None = None,
    synchronize_booking: bool = True,
    amount_is_cumulative: bool = False,
) -> Payment:
    amount = amount_minor or payment.amount
    payment.refund_provider_id = refund_provider_id or payment.refund_provider_id
    if amount_is_cumulative:
        payment.refunded_amount = max(payment.refunded_amount, amount)
    else:
        payment.refunded_amount = min(payment.amount, payment.refunded_amount + amount)
    payment.refunded_at = datetime.now(timezone.utc)
    payment.status = "refunded" if payment.refunded_amount >= payment.amount else "partially_refunded"
    account = get_or_create_ledger_account(
        db,
        owner_type="user",
        owner_id=payment.user_id,
        currency=(payment.currency or "usd").upper(),
    )
    append_ledger_entry(
        db,
        account=account,
        user_id=payment.user_id,
        direction="debit",
        amount=amount,
        entry_type=f"{payment.payment_type}_refund",
        provider=payment.provider,
        provider_reference=payment.refund_provider_id,
        reference_type="payment",
        reference_id=payment.id,
        idempotency_key=f"{payment.provider}:ledger:refund:{payment.refund_provider_id or provider_event or payment.id}",
        description=f"{payment.provider} refund confirmed",
        metadata={"provider_event": provider_event, "raw_status": status_value},
    )
    if synchronize_booking:
        _synchronize_booking_after_refund(db, payment=payment, provider_event=provider_event)
    return payment


def _synchronize_booking_after_refund(db: Session, *, payment: Payment, provider_event: str | None = None) -> None:
    if payment.booking_id is None or payment.status != "refunded":
        return
    from app.models.booking import BookingItem, OrderAction, OrderHistory, ReservationStatus
    from app.services.booking import _refund_provider_reservations

    booking = db.scalar(
        select(Booking)
        .options(selectinload(Booking.items).selectinload(BookingItem.provider_reservation))
        .where(Booking.id == payment.booking_id)
        .with_for_update()
    )
    if booking is None or booking.status == BookingStatus.refunded:
        return
    if booking.status not in {BookingStatus.confirmed, BookingStatus.completed}:
        return
    try:
        provider_results = _refund_provider_reservations(booking, reason="payment_provider_refund")
    except Exception as exc:
        logger.exception(
            "booking_provider_refund_after_payment_refund_failed",
            extra={
                "event_type": "booking_provider_refund_after_payment_refund_failed",
                "booking_id": booking.id,
                "payment_id": payment.id,
                "provider_event": provider_event,
            },
        )
        _append_booking_refund_recovery_history(
            db,
            booking=booking,
            reason="provider_refund_failed_after_payment_refund",
            provider_event=provider_event,
            details={"error": str(exc)[:500]},
        )
        return

    old_status = booking.status
    booking.status = BookingStatus.refunded
    for item in booking.items:
        reservation = item.provider_reservation
        if reservation is not None and reservation.reservation_status in {ReservationStatus.pending, ReservationStatus.confirmed}:
            reservation.reservation_status = ReservationStatus.refunded
    db.add(
        OrderHistory(
            booking_id=booking.id,
            user_id=booking.user_id,
            action=OrderAction.refunded,
            details={
                "old_status": old_status.value,
                "reason": "payment_provider_refund",
                "payment_id": payment.id,
                "provider_event": provider_event,
                "provider_results": provider_results,
            },
        )
    )


def handle_stripe_refund_event(db: Session, event_payload: dict, event_type: str) -> None:
    payment_intent_id = event_payload.get("payment_intent")
    charge_id = event_payload.get("charge") if event_type != "charge.refunded" else event_payload.get("id")
    refund_provider_id = event_payload.get("id")
    amount = int(event_payload.get("amount") or event_payload.get("amount_refunded") or 0)
    status_value = str(event_payload.get("status") or ("succeeded" if event_type == "charge.refunded" else "")).lower()
    payment = None
    if payment_intent_id:
        payment = db.scalar(select(Payment).where(Payment.provider == "stripe", Payment.provider_payment_id == str(payment_intent_id)))
    if payment is None and charge_id:
        payment = db.scalar(select(Payment).where(Payment.provider == "stripe", Payment.provider_payment_id == str(charge_id)))
    if payment is None or status_value != "succeeded":
        return
    _mark_payment_refund_confirmed(
        db,
        payment=payment,
        refund_provider_id=str(refund_provider_id or charge_id or ""),
        amount_minor=amount,
        status_value=status_value,
        provider_event=event_type,
        amount_is_cumulative=event_type == "charge.refunded",
    )


def _resolve_refundable_provider_payment_id(payment: Payment) -> str:
    if payment.provider_payment_id:
        return payment.provider_payment_id
    if payment.provider != "stripe":
        raise RuntimeError("Provider payment reference is missing")
    _configure_stripe()
    try:
        session = call_with_retries(lambda: stripe.checkout.Session.retrieve(payment.stripe_session_id))
    except stripe.error.StripeError as exc:
        raise RuntimeError("Stripe checkout session lookup failed") from exc
    payment_intent = session.get("payment_intent")
    if not payment_intent:
        raise RuntimeError("Stripe checkout session has no refundable payment intent")
    payment.provider_payment_id = str(payment_intent)
    return payment.provider_payment_id


def execute_payment_refund(
    db: Session,
    *,
    payment: Payment,
    amount_minor: int | None = None,
    reason: str | None = None,
    synchronize_booking: bool = True,
) -> Payment:
    locked_payment = db.scalar(select(Payment).where(Payment.id == payment.id).with_for_update())
    if locked_payment is None:
        raise LookupError("Payment not found")
    if locked_payment.status not in {"paid", "disputed", "partially_refunded"}:
        raise ValueError("Only provider-confirmed payments can be refunded")
    refundable_amount = amount_minor if amount_minor is not None else locked_payment.amount - locked_payment.refunded_amount
    if refundable_amount <= 0:
        raise ValueError("No refundable balance remains")
    provider_payment_id = _resolve_refundable_provider_payment_id(locked_payment)
    gateway = get_payment_gateway(locked_payment.provider, currency=locked_payment.currency)
    refund_result = gateway.refund(
        PaymentRefundRequest(
            provider_payment_id=provider_payment_id,
            amount_minor=refundable_amount,
            currency=locked_payment.currency,
            idempotency_key=f"{locked_payment.provider}:refund:{locked_payment.id}:{locked_payment.refunded_amount}:{refundable_amount}",
            reason=reason,
            metadata={"payment_id": str(locked_payment.id), "booking_id": str(locked_payment.booking_id or "")},
        )
    )
    if not refund_result.confirmed:
        raise RuntimeError(f"{locked_payment.provider} refund is pending provider confirmation")
    return _mark_payment_refund_confirmed(
        db,
        payment=locked_payment,
        refund_provider_id=refund_result.provider_refund_id,
        amount_minor=refund_result.amount_minor,
        status_value=refund_result.status,
        provider_event="refund_api",
        synchronize_booking=synchronize_booking,
    )


def handle_invoice_payment_failed(db: Session, event_payload: dict) -> None:
    subscription_id = event_payload.get("subscription")
    user_id = _find_user_id_by_customer(db, event_payload.get("customer"))
    user_id = user_id or _find_user_id_by_subscription(db, subscription_id)
    if user_id is None:
        subscription_row = db.scalar(
            select(Payment.user_id)
            .where(Payment.stripe_customer_id == event_payload.get("customer"))
            .order_by(Payment.created_at.desc())
            .limit(1)
        )
        user_id = int(subscription_row) if subscription_row is not None else None
    if user_id is None:
        return
    current_subscription = get_current_subscription_record(db, user_id)
    was_premium = is_premium_record(current_subscription)
    expire_subscription(
        db,
        user_id=user_id,
        stripe_subscription_id=subscription_id,
        status_value=STATUS_EXPIRED,
        current_period_end=datetime.now(timezone.utc),
    )
    if was_premium:
        record_analytics_event(
            db,
            event_type="subscription_canceled",
            user_id=user_id,
            metadata={"subscription_id": subscription_id, "reason": "invoice_payment_failed"},
            commit=False,
        )
    record_subscription_metrics_snapshot(db, reason="invoice_payment_failed", commit=False)


def handle_subscription_deleted(db: Session, event_payload: dict) -> None:
    metadata = event_payload.get("metadata") or {}
    raw_user_id = metadata.get("user_id")
    user_id = int(raw_user_id) if raw_user_id else _find_user_id_by_customer(db, event_payload.get("customer"))
    user_id = user_id or _find_user_id_by_subscription(db, event_payload.get("id"))
    if user_id is None:
        return
    current_subscription = get_current_subscription_record(db, user_id)
    was_premium = is_premium_record(current_subscription)
    expire_subscription(
        db,
        user_id=user_id,
        stripe_subscription_id=event_payload.get("id"),
        status_value=STATUS_CANCELED,
        current_period_end=_timestamp_to_datetime(event_payload.get("current_period_end")) or datetime.now(timezone.utc),
    )
    if was_premium:
        record_analytics_event(
            db,
            event_type="subscription_canceled",
            user_id=user_id,
            metadata={"subscription_id": event_payload.get("id")},
            commit=False,
        )
    record_subscription_metrics_snapshot(db, reason="subscription_deleted", commit=False)


def process_webhook_event(db: Session, event: Any) -> bool:
    webhook_event = _get_or_create_webhook_event_record(db, event)
    try:
        locked_event = db.scalar(select(WebhookEvent).where(WebhookEvent.id == webhook_event.id).with_for_update())
        if locked_event is None:
            db.rollback()
            return False
        if locked_event.processed:
            db.rollback()
            return False

        event_type = locked_event.event_type
        data_object = (locked_event.payload.get("data") or {}).get("object", {})

        if event_type == "checkout.session.completed":
            handle_checkout_session_completed(db=db, event_payload=data_object)
        if event_type == "checkout.session.expired":
            handle_checkout_session_expired(db=db, event_payload=data_object)
        if event_type == "customer.subscription.updated":
            handle_subscription_updated(db=db, event_payload=data_object)
        if event_type == "customer.subscription.deleted":
            handle_subscription_deleted(db=db, event_payload=data_object)
        if event_type == "invoice.payment_failed":
            handle_invoice_payment_failed(db=db, event_payload=data_object)
        if event_type == "payment_intent.payment_failed":
            handle_payment_failed(db=db, event_payload=data_object)
        if event_type in {"charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"}:
            handle_charge_dispute(db=db, event_payload=data_object)
        if event_type in {"charge.refunded", "refund.updated", "refund.created"}:
            handle_stripe_refund_event(db=db, event_payload=data_object, event_type=event_type)

        locked_event.processed = True
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
