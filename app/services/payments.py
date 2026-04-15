from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
from typing import Any

import stripe
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.payments import Payment, Subscription, WebhookEvent
from app.models.user import User
from app.services.analytics import record_analytics_event, record_subscription_metrics_snapshot
from app.services.notifications import create_notification
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


@dataclass(frozen=True)
class CheckoutSessionResult:
    id: str
    url: str
    amount_total: int | None
    currency: str | None
    customer_id: str | None
    expires_at: datetime | None
    price_id: str


def _configure_stripe() -> None:
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Stripe is not configured")
    stripe.api_key = settings.stripe_secret_key


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

    customer = stripe.Customer.create(
        email=user.email,
        metadata={"user_id": str(user.id)},
    )
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
        session = stripe.checkout.Session.create(
            mode="subscription",
            success_url=success_url,
            cancel_url=cancel_url,
            customer=customer_id,
            line_items=[{"price": price, "quantity": 1}],
            client_reference_id=str(locked_user.id),
            metadata={"user_id": str(locked_user.id), "price_id": price},
            subscription_data={"metadata": {"user_id": str(locked_user.id), "price_id": price}},
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
        stripe_session_id=session_id,
        stripe_customer_id=event_payload.get("customer"),
        stripe_price_id=metadata.get("price_id"),
        checkout_url=event_payload.get("url"),
        checkout_expires_at=_timestamp_to_datetime(event_payload.get("expires_at")),
        amount=int(event_payload.get("amount_total") or 0),
        currency=event_payload.get("currency") or "usd",
        status="created",
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
        payment.checkout_url = event_payload.get("url") or payment.checkout_url
        payment.checkout_expires_at = _timestamp_to_datetime(event_payload.get("expires_at")) or payment.checkout_expires_at

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

        locked_event.processed = True
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
