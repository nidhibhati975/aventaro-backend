from __future__ import annotations

import asyncio
import logging
import threading
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.booking import (
    Booking,
    BookingItem,
    BookingItemType,
    BookingStatus,
    OrderAction,
    OrderHistory,
    ProviderReservation,
    ReservationStatus,
)
from app.models.payments import Payment
from app.models.payments import WebhookEvent
from app.models.trip import Trip, TripLifecycleStatus, TripMember, TripMembershipStatus
from app.services.analytics import record_analytics_event
from app.services.notifications import create_notification
from app.services.providers.base import BaseProvider, get_provider_registry
from app.utils.config import get_settings


logger = logging.getLogger("aventaro.booking")


VALID_TRANSITIONS: dict[BookingStatus, set[BookingStatus]] = {
    BookingStatus.pending: {BookingStatus.payment_initiated, BookingStatus.cancelled, BookingStatus.failed},
    BookingStatus.payment_initiated: {BookingStatus.confirmed, BookingStatus.failed, BookingStatus.cancelled},
    BookingStatus.confirmed: {BookingStatus.completed, BookingStatus.cancelled, BookingStatus.refunded},
    BookingStatus.completed: {BookingStatus.refunded},
    BookingStatus.cancelled: set(),
    BookingStatus.refunded: set(),
    BookingStatus.failed: set(),
}


def _run_provider_async_call(async_fn, /, *args, **kwargs):
    """Run provider coroutines safely from sync code in both sync and async request contexts."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(async_fn(*args, **kwargs))

    result: dict[str, Any] = {}
    error: dict[str, BaseException] = {}

    def _runner() -> None:
        try:
            result["value"] = asyncio.run(async_fn(*args, **kwargs))
        except BaseException as exc:  # pragma: no cover
            error["value"] = exc

    thread = threading.Thread(target=_runner, name="aventaro-provider-call", daemon=True)
    thread.start()
    thread.join()
    if "value" in error:
        raise error["value"]
    return result.get("value")


def _normalize_currency(currency: str | None) -> str:
    if currency is None:
        return "USD"
    normalized = currency.strip().upper()
    if len(normalized) != 3:
        raise ValueError("currency must be a valid ISO-4217 code")
    return normalized


def _normalize_decimal(value: Any) -> Decimal:
    amount = Decimal(str(value))
    return amount.quantize(Decimal("0.01"))


def _normalize_provider_name(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if not normalized or normalized in {"auto", "default"}:
        return "duffel"
    if normalized in {"fallback", "mock"}:
        raise LookupError("Mock/fallback booking providers are disabled")
    return normalized


def get_provider(provider_name: str | None = None) -> BaseProvider:
    settings = get_settings()
    requested_name = _normalize_provider_name(provider_name or settings.booking_provider)
    registry = get_provider_registry()

    if requested_name == "duffel":
        from app.services.providers.duffel_provider import get_duffel_provider

        provider = registry.get("duffel")
        if provider is None:
            provider = get_duffel_provider()
            registry.register(provider)
        return provider

    provider = registry.get(requested_name)
    if provider is not None:
        return provider

    raise LookupError(f"Travel provider '{requested_name}' is not configured")


def get_booking_provider() -> BaseProvider:
    return get_provider()


def validate_booking_transition(old_status: BookingStatus, new_status: BookingStatus) -> bool:
    return new_status in VALID_TRANSITIONS.get(old_status, set())


def _log_audit(action: str, booking_id: int, user_id: int, details: dict[str, Any]) -> None:
    logger.info(
        "booking_audit",
        extra={
            "event_type": "booking_audit",
            "action": action,
            "booking_id": booking_id,
            "user_id": user_id,
            **details,
        },
    )


def _append_history(
    db: Session,
    *,
    booking_id: int,
    user_id: int,
    action: OrderAction,
    details: dict[str, Any] | None = None,
) -> OrderHistory:
    history = OrderHistory(
        user_id=user_id,
        booking_id=booking_id,
        action=action,
        details=details,
    )
    db.add(history)
    return history


def _hydrate_booking_query():
    return (
        select(Booking)
        .options(
            selectinload(Booking.user),
            selectinload(Booking.trip),
            selectinload(Booking.items).selectinload(BookingItem.provider_reservation),
            selectinload(Booking.order_history),
        )
    )


def fetch_booking_by_id(db: Session, booking_id: int, user_id: int) -> Booking | None:
    return db.scalar(_hydrate_booking_query().where(Booking.id == booking_id, Booking.user_id == user_id))


def _build_booking_items(items: list[dict[str, Any]]) -> tuple[list[BookingItem], Decimal]:
    if not items:
        raise ValueError("At least one booking item is required")

    booking_items: list[BookingItem] = []
    total_amount = Decimal("0.00")
    for item in items:
        item_type = BookingItemType(str(item.get("item_type")))
        provider_name = str(item.get("provider_name") or "").strip()
        if not provider_name:
            raise ValueError("provider_name is required")
        quantity = int(item.get("quantity") or 1)
        if quantity < 1:
            raise ValueError("quantity must be at least 1")
        price = _normalize_decimal(item.get("price", 0))
        if price <= 0:
            raise ValueError("price must be greater than 0")

        booking_items.append(
            BookingItem(
                item_type=item_type,
                provider_name=provider_name,
                external_id=item.get("external_id"),
                provider_metadata=item.get("metadata") or item.get("provider_metadata"),
                quantity=quantity,
                price=price,
            )
        )
        total_amount += price * quantity

    if total_amount <= 0:
        raise ValueError("Total amount must be greater than 0")
    return booking_items, total_amount


def _validate_trip_booking_context(db: Session, *, trip_id: int, user_id: int) -> Trip:
    trip = db.scalar(select(Trip).where(Trip.id == trip_id))
    if trip is None:
        raise LookupError("Trip not found")
    if trip.lifecycle_status in {TripLifecycleStatus.completed, TripLifecycleStatus.cancelled}:
        raise ValueError(f"Cannot attach a booking to a {trip.lifecycle_status.value} trip")
    if trip.owner_id == user_id:
        return trip

    membership = db.scalar(
        select(TripMember.id).where(
            TripMember.trip_id == trip_id,
            TripMember.user_id == user_id,
            TripMember.status == TripMembershipStatus.approved,
        )
    )
    if membership is None:
        raise PermissionError("You can only create bookings for trips you own or have joined")
    return trip


def create_booking(
    db: Session,
    user_id: int,
    trip_id: int | None,
    items: list[dict[str, Any]],
    currency: str | None = None,
) -> Booking:
    normalized_currency = _normalize_currency(currency)
    if trip_id is not None:
        _validate_trip_booking_context(db, trip_id=trip_id, user_id=user_id)
    booking_items, total_amount = _build_booking_items(items)

    booking = Booking(
        user_id=user_id,
        trip_id=trip_id,
        status=BookingStatus.pending,
        total_amount=total_amount,
        currency=normalized_currency,
    )
    db.add(booking)
    db.flush()

    for booking_item in booking_items:
        booking_item.booking_id = booking.id
        db.add(booking_item)

    _append_history(
        db,
        booking_id=booking.id,
        user_id=user_id,
        action=OrderAction.created,
        details={"total_amount": float(total_amount), "currency": normalized_currency},
    )
    create_notification(
        db=db,
        user_id=user_id,
        notification_type="booking_created",
        message=f"Booking #{booking.id} created for {normalized_currency} {total_amount}",
        entity_id=booking.id,
        entity_type="booking",
        commit=False,
    )
    record_analytics_event(
        db=db,
        event_type="booking_created",
        user_id=user_id,
        metadata={
            "booking_id": booking.id,
            "trip_id": trip_id,
            "total_amount": float(total_amount),
            "currency": normalized_currency,
            "item_count": len(booking_items),
        },
        commit=False,
    )
    db.commit()
    _log_audit("created", booking.id, user_id, {"total_amount": float(total_amount), "currency": normalized_currency})
    return fetch_booking_by_id(db, booking.id, user_id)


def list_user_bookings(
    db: Session,
    user_id: int,
    status: BookingStatus | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Booking]:
    query = _hydrate_booking_query().where(Booking.user_id == user_id)
    if status is not None:
        query = query.where(Booking.status == status)
    return db.scalars(query.order_by(Booking.created_at.desc()).limit(limit).offset(offset)).all()


def initiate_booking_payment(db: Session, booking_id: int, user_id: int) -> Booking:
    booking = fetch_booking_by_id(db, booking_id, user_id)
    if booking is None:
        raise LookupError("Booking not found")
    if not validate_booking_transition(booking.status, BookingStatus.payment_initiated):
        raise ValueError(f"Cannot initiate payment for booking with status: {booking.status.value}")

    old_status = booking.status
    booking.status = BookingStatus.payment_initiated
    db.flush()
    _append_history(
        db,
        booking_id=booking.id,
        user_id=user_id,
        action=OrderAction.payment_initiated,
        details={"old_status": old_status.value},
    )
    db.commit()
    _log_audit("payment_initiated", booking.id, user_id, {"old_status": old_status.value})
    return fetch_booking_by_id(db, booking.id, user_id)


def create_booking_payment(
    db: Session,
    booking_id: int,
    user_id: int,
    *,
    success_url: str | None = None,
    cancel_url: str | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    booking = fetch_booking_by_id(db, booking_id, user_id)
    if booking is None:
        raise LookupError("Booking not found")
    if booking.status not in {BookingStatus.pending, BookingStatus.payment_initiated}:
        raise ValueError(f"Cannot create payment for booking with status: {booking.status.value}")
    previous_status = booking.status

    from app.services.payments import create_booking_checkout_session

    session = create_booking_checkout_session(
        db=db,
        booking=booking,
        success_url=success_url,
        cancel_url=cancel_url,
        idempotency_key=idempotency_key,
    )
    refreshed = fetch_booking_by_id(db, booking_id, user_id)
    if (
        refreshed is not None
        and previous_status != BookingStatus.payment_initiated
        and refreshed.status == BookingStatus.payment_initiated
    ):
        _append_history(
            db,
            booking_id=refreshed.id,
            user_id=user_id,
            action=OrderAction.payment_initiated,
            details={
                "old_status": previous_status.value,
                "payment_id": session.id,
                "payment_provider": "stripe",
            },
        )
        db.commit()
        refreshed = fetch_booking_by_id(db, booking_id, user_id)
    return {
        "payment_id": session.id,
        "booking_id": refreshed.id if refreshed is not None else booking_id,
        "amount": float(session.amount_total / 100) if session.amount_total is not None else float(booking.total_amount),
        "currency": (session.currency or booking.currency).upper(),
        "status": "pending",
        "checkout_url": session.url,
        "expires_at": session.expires_at.isoformat() if session.expires_at is not None else None,
    }


def cancel_booking(db: Session, booking_id: int, user_id: int) -> Booking:
    booking = fetch_booking_by_id(db, booking_id, user_id)
    if booking is None:
        raise LookupError("Booking not found")
    if not validate_booking_transition(booking.status, BookingStatus.cancelled):
        raise ValueError(f"Cannot cancel booking with status: {booking.status.value}")

    old_status = booking.status
    if old_status in {BookingStatus.confirmed, BookingStatus.completed}:
        for item in booking.items:
            reservation = item.provider_reservation
            if reservation is None or reservation.reservation_status not in {ReservationStatus.pending, ReservationStatus.confirmed}:
                continue
            provider = get_provider(reservation.provider_name or item.provider_name)
            reference = _resolve_reservation_reference(item)
            if reference is None:
                continue
            try:
                cancellation = _run_provider_async_call(provider.cancel_reservation, reference, reason="user_cancelled")
            except NotImplementedError as exc:
                raise ValueError(f"Provider cancellation is not supported for {provider.name}") from exc
            if isinstance(cancellation, dict):
                reservation.provider_response = {
                    **(reservation.provider_response or {}),
                    "cancellation": cancellation,
                }
            reservation.reservation_status = ReservationStatus.cancelled
    booking.status = BookingStatus.cancelled
    db.flush()
    _append_history(
        db,
        booking_id=booking.id,
        user_id=user_id,
        action=OrderAction.cancelled,
        details={"old_status": old_status.value},
    )
    create_notification(
        db=db,
        user_id=user_id,
        notification_type="booking_cancelled",
        message=f"Booking #{booking.id} has been cancelled",
        entity_id=booking.id,
        entity_type="booking",
        commit=False,
    )
    db.commit()
    _log_audit("cancelled", booking.id, user_id, {"old_status": old_status.value})
    return fetch_booking_by_id(db, booking.id, user_id)


def _resolve_reservation_reference(item: BookingItem) -> str | None:
    reservation = item.provider_reservation
    if reservation is None:
        return item.external_id
    return reservation.provider_reference or reservation.confirmation_number or item.external_id


def _refund_provider_reservations(booking: Booking, *, reason: str | None = None) -> list[dict[str, Any]]:
    provider_results: list[dict[str, Any]] = []
    for item in booking.items:
        reservation = item.provider_reservation
        if reservation is None or reservation.reservation_status not in {ReservationStatus.pending, ReservationStatus.confirmed}:
            continue
        reference = _resolve_reservation_reference(item)
        if reference is None:
            continue
        provider = get_provider(reservation.provider_name or item.provider_name)
        try:
            result = _run_provider_async_call(
                provider.refund_reservation,
                reference,
                reason=reason or "user_refund_requested",
            )
        except NotImplementedError as exc:
            raise ValueError(f"Provider refund is not supported for {provider.name}") from exc
        if isinstance(result, dict):
            provider_results.append({"provider": provider.name, "reference": reference, "result": result})
            reservation.provider_response = {
                **(reservation.provider_response or {}),
                "refund": result,
            }
        reservation.reservation_status = ReservationStatus.refunded
    return provider_results


def _confirm_provider_reservations(
    db: Session,
    booking: Booking,
    *,
    event_id: str | None = None,
    payment_reference: str | None = None,
) -> None:
    for item in booking.items:
        reservation = item.provider_reservation
        if reservation is None:
            continue

        provider = get_provider(reservation.provider_name or item.provider_name)
        reservation_reference = _resolve_reservation_reference(item)
        if reservation_reference is None:
            continue

        if reservation.reservation_status == ReservationStatus.confirmed:
            continue

        try:
            confirmation = _run_provider_async_call(
                provider.confirm,
                reservation_reference,
                db=db,
                booking_id=booking.id,
                user_id=booking.user_id,
                payment_reference=payment_reference,
                event_id=event_id,
                provider_response=reservation.provider_response or {},
            )
        except NotImplementedError:
            if provider.booking_mode == "live":
                reservation.reservation_status = ReservationStatus.failed
                raise RuntimeError(f"Provider confirmation is required for {provider.name}")
            confirmation = None
        except Exception:
            reservation.reservation_status = ReservationStatus.failed
            raise

        if isinstance(confirmation, dict):
            raw_response = dict(reservation.provider_response or {})
            provider_response = confirmation.get("provider_response")
            if isinstance(provider_response, dict):
                raw_response.update(provider_response)
            raw_response.update(
                {
                    "status": confirmation.get("status", "confirmed"),
                    "booking_id": confirmation.get("booking_id", booking.id),
                    "payment_reference": payment_reference,
                    "event_id": event_id,
                }
            )
            reservation.provider_response = raw_response
            resolved_reference = confirmation.get("reservation_id") or confirmation.get("provider_reference")
            if isinstance(resolved_reference, str) and resolved_reference.strip():
                reservation.provider_reference = resolved_reference.strip()
            resolved_confirmation_number = confirmation.get("confirmation_number")
            if isinstance(resolved_confirmation_number, str) and resolved_confirmation_number.strip():
                reservation.confirmation_number = resolved_confirmation_number.strip()

        reservation.reservation_status = ReservationStatus.confirmed


def confirm_booking(
    db: Session,
    booking_id: int,
    event_id: str | None = None,
    *,
    provider_reference: str | None = None,
) -> Booking:
    booking = db.scalar(_hydrate_booking_query().where(Booking.id == booking_id))
    if booking is None:
        raise LookupError("Booking not found")

    if event_id and booking.last_event_id == event_id:
        return booking
    if booking.status in {BookingStatus.confirmed, BookingStatus.completed, BookingStatus.refunded}:
        if event_id and not booking.last_event_id:
            booking.last_event_id = event_id
            db.commit()
            return db.scalar(_hydrate_booking_query().where(Booking.id == booking_id))
        return booking

    _confirm_provider_reservations(
        db,
        booking,
        event_id=event_id,
        payment_reference=provider_reference,
    )
    if not validate_booking_transition(booking.status, BookingStatus.confirmed):
        raise ValueError(f"Cannot confirm booking with status: {booking.status.value}")

    old_status = booking.status
    booking.status = BookingStatus.confirmed
    if event_id:
        booking.last_event_id = event_id
    for item in booking.items:
        reservation = item.provider_reservation
        if reservation is not None and reservation.reservation_status == ReservationStatus.pending:
            reservation.reservation_status = ReservationStatus.confirmed
            if provider_reference and not reservation.provider_reference:
                reservation.provider_reference = provider_reference

    _append_history(
        db,
        booking_id=booking.id,
        user_id=booking.user_id,
        action=OrderAction.paid,
        details={"old_status": old_status.value, "event_id": event_id},
    )
    create_notification(
        db=db,
        user_id=booking.user_id,
        notification_type="booking_confirmed",
        message=f"Booking #{booking.id} confirmed. Your reservation is complete.",
        entity_id=booking.id,
        entity_type="booking",
        commit=False,
    )
    record_analytics_event(
        db=db,
        event_type="booking_confirmed",
        user_id=booking.user_id,
        metadata={
            "booking_id": booking.id,
            "trip_id": booking.trip_id,
            "total_amount": float(booking.total_amount),
            "old_status": old_status.value,
        },
        commit=False,
    )
    db.commit()
    _log_audit("confirmed", booking.id, booking.user_id, {"old_status": old_status.value, "event_id": event_id})
    return db.scalar(_hydrate_booking_query().where(Booking.id == booking_id))


def attach_provider_reservation(
    db: Session,
    *,
    booking_item_id: int,
    provider_name: str,
    provider_reference: str,
    confirmation_number: str | None,
    provider_response: dict[str, Any] | None,
    reservation_status: ReservationStatus = ReservationStatus.pending,
    history_user_id: int | None = None,
    history_details: dict[str, Any] | None = None,
) -> ProviderReservation:
    booking_item = db.scalar(
        select(BookingItem)
        .options(selectinload(BookingItem.provider_reservation))
        .where(BookingItem.id == booking_item_id)
    )
    if booking_item is None:
        raise LookupError("Booking item not found")

    reservation = booking_item.provider_reservation
    if reservation is None:
        reservation = ProviderReservation(
            booking_item_id=booking_item.id,
            provider_name=provider_name,
            provider_reference=provider_reference,
            confirmation_number=confirmation_number,
            provider_response=provider_response,
            reservation_status=reservation_status,
        )
        db.add(reservation)
    else:
        reservation.provider_name = provider_name
        reservation.provider_reference = provider_reference
        reservation.confirmation_number = confirmation_number
        reservation.provider_response = provider_response
        reservation.reservation_status = reservation_status

    if history_user_id is not None:
        _append_history(
            db,
            booking_id=booking_item.booking_id,
            user_id=history_user_id,
            action=OrderAction.reservation_created if reservation_status != ReservationStatus.failed else OrderAction.reservation_failed,
            details={
                "provider_name": provider_name,
                "provider_reference": provider_reference,
                "confirmation_number": confirmation_number,
                "reservation_status": reservation_status.value,
                **(history_details or {}),
            },
        )
    db.flush()
    return reservation


def process_booking_webhook(
    db: Session,
    payment_id: str,
    status: str,
    event_id: str | None = None,
) -> Booking | None:
    payment = db.scalar(select(Payment).where(Payment.stripe_session_id == payment_id))
    if payment is None or payment.booking_id is None:
        return None

    normalized_status = status.strip().lower()
    booking = db.scalar(_hydrate_booking_query().where(Booking.id == payment.booking_id))
    if booking is None:
        return None

    if event_id and booking.last_event_id == event_id:
        return booking

    if normalized_status in {"success", "completed", "confirmed", "paid"}:
        if payment.status != "paid":
            raise ValueError("Cannot confirm booking before provider-confirmed user payment")
        return confirm_booking(db, booking.id, event_id=event_id, provider_reference=payment.stripe_session_id)

    if normalized_status not in {"failed", "expired", "cancelled"}:
        return booking

    if validate_booking_transition(booking.status, BookingStatus.failed):
        old_status = booking.status
        booking.status = BookingStatus.failed
        booking.last_event_id = event_id or booking.last_event_id
        _append_history(
            db,
            booking_id=booking.id,
            user_id=booking.user_id,
            action=OrderAction.payment_failed,
            details={"old_status": old_status.value, "event_id": event_id, "status": normalized_status},
        )
        db.commit()
        _log_audit("payment_failed", booking.id, booking.user_id, {"old_status": old_status.value, "event_id": event_id})
    return db.scalar(_hydrate_booking_query().where(Booking.id == booking.id))


def process_duffel_booking_webhook(db: Session, event: dict[str, Any]) -> dict[str, Any]:
    event_id = str(event.get("id") or event.get("idempotency_key") or "").strip()
    event_type = str(event.get("type") or "unknown").strip()
    if not event_id:
        raise ValueError("Duffel webhook event id is required")

    existing = db.scalar(
        select(WebhookEvent).where(WebhookEvent.provider == "duffel", WebhookEvent.provider_event_id == event_id)
    )
    if existing is None:
        existing = WebhookEvent(
            stripe_event_id=f"duffel:{event_id}",
            provider="duffel",
            provider_event_id=event_id,
            event_type=event_type,
            payload=event,
            processed=False,
        )
        db.add(existing)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = db.scalar(
                select(WebhookEvent).where(WebhookEvent.provider == "duffel", WebhookEvent.provider_event_id == event_id)
            )
            if existing is None:
                raise

    locked_event = db.scalar(select(WebhookEvent).where(WebhookEvent.id == existing.id).with_for_update())
    if locked_event is None:
        return {"status": "ignored"}
    if locked_event.processed:
        db.rollback()
        return {"status": "duplicate", "event_id": event_id}

    data_object = ((locked_event.payload.get("data") or {}).get("object") or {}) if isinstance(locked_event.payload, dict) else {}
    provider_reference = str(data_object.get("id") or data_object.get("order_id") or "").strip()
    if provider_reference:
        reservation = db.scalar(
            select(ProviderReservation)
            .where(
                ProviderReservation.provider_name == "duffel",
                ProviderReservation.provider_reference == provider_reference,
            )
            .limit(1)
        )
        if reservation is not None:
            reservation.provider_response = {
                **(reservation.provider_response or {}),
                "last_webhook": locked_event.payload,
            }
            if event_type in {"order.created", "stays.booking.created"}:
                reservation.reservation_status = ReservationStatus.confirmed
            elif "cancel" in event_type:
                reservation.reservation_status = ReservationStatus.cancelled

    locked_event.processed = True
    db.commit()
    return {"status": "processed", "event_id": event_id, "event_type": event_type}


def confirm_booking_payment(
    db: Session,
    *,
    booking_id: int,
    user_id: int,
    payment_id: str | None = None,
    status: str = "completed",
    event_id: str | None = None,
) -> Booking:
    booking = fetch_booking_by_id(db, booking_id, user_id)
    if booking is None:
        raise LookupError("Booking not found")

    payment_query = select(Payment).where(Payment.booking_id == booking_id, Payment.user_id == user_id)
    if payment_id:
        payment_query = payment_query.where(Payment.stripe_session_id == payment_id)
    payment = db.scalar(payment_query.order_by(Payment.created_at.desc(), Payment.id.desc()))
    if payment is None:
        if booking.status in {BookingStatus.confirmed, BookingStatus.completed, BookingStatus.refunded}:
            return booking
        raise LookupError("Booking payment not found")
    if payment.status != "paid":
        raise ValueError("Booking payment has not been confirmed by the payment provider")

    confirmed = process_booking_webhook(
        db=db,
        payment_id=payment.stripe_session_id,
        status=status,
        event_id=event_id,
    )
    if confirmed is None:
        raise LookupError("Booking payment could not be confirmed")
    return ensure_booking_owner(confirmed, user_id)


def refund_booking(
    db: Session,
    booking_id: int,
    user_id: int,
    reason: str | None = None,
) -> Booking:
    booking = fetch_booking_by_id(db, booking_id, user_id)
    if booking is None:
        raise LookupError("Booking not found")
    if not validate_booking_transition(booking.status, BookingStatus.refunded):
        raise ValueError(f"Cannot refund booking with status: {booking.status.value}")

    payment = db.scalar(
        select(Payment)
        .where(Payment.booking_id == booking_id, Payment.user_id == user_id, Payment.status.in_(("paid", "disputed")))
        .order_by(Payment.created_at.desc(), Payment.id.desc())
    )
    if payment is None:
        raise ValueError("No provider-confirmed payment is available to refund")
    from app.services.payments import execute_payment_refund

    provider_results = _refund_provider_reservations(booking, reason=reason)
    try:
        execute_payment_refund(db, payment=payment, reason=reason, synchronize_booking=False)
    except Exception as exc:
        _append_history(
            db,
            booking_id=booking.id,
            user_id=user_id,
            action=OrderAction.payment_failed,
            details={
                "reason": "payment_refund_failed_after_provider_refund",
                "error": str(exc)[:500],
                "provider_results": provider_results,
            },
        )
        db.commit()
        raise
    old_status = booking.status
    booking.status = BookingStatus.refunded
    for item in booking.items:
        reservation = item.provider_reservation
        if reservation is not None and reservation.reservation_status in {ReservationStatus.pending, ReservationStatus.confirmed}:
            reservation.reservation_status = ReservationStatus.refunded
    _append_history(
        db,
        booking_id=booking.id,
        user_id=user_id,
        action=OrderAction.refunded,
        details={
            "old_status": old_status.value,
            "reason": reason,
            "refund_amount": float(booking.total_amount),
            "provider_results": provider_results,
        },
    )
    create_notification(
        db=db,
        user_id=user_id,
        notification_type="booking_refunded",
        message=f"Booking #{booking.id} has been refunded. Amount: {booking.currency} {booking.total_amount}",
        entity_id=booking.id,
        entity_type="booking",
        commit=False,
    )
    db.commit()
    _log_audit(
        "refunded",
        booking.id,
        user_id,
        {"old_status": old_status.value, "reason": reason, "refund_amount": float(booking.total_amount)},
    )
    return fetch_booking_by_id(db, booking.id, user_id)


def ensure_booking_owner(booking: Booking | None, user_id: int) -> Booking:
    if booking is None:
        raise LookupError("Booking not found")
    if booking.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not allowed to access this booking")
    return booking
