from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.booking import BookingItemType, BookingStatus, ReservationStatus
from app.models.user import User
from app.services.auth import get_current_user
from app.services.booking import (
    attach_provider_reservation,
    cancel_booking,
    confirm_booking_payment,
    create_booking,
    create_booking_payment,
    fetch_booking_by_id,
    get_booking_provider,
    list_user_bookings,
    process_duffel_booking_webhook,
    process_booking_webhook,
    refund_booking,
)
from app.services.providers.base import BaseProvider
from app.services.webhooks import parse_json_payload, verify_duffel_signature


router = APIRouter(prefix="/booking")


def _require_provider() -> BaseProvider:
    try:
        return get_booking_provider()
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


class BookingItemCreate(BaseModel):
    item_type: BookingItemType
    provider_name: str = Field(min_length=1, max_length=100)
    external_id: str | None = None
    metadata: dict[str, Any] | None = None
    quantity: int = Field(default=1, ge=1, le=50)
    price: float = Field(gt=0)


class BookingCreateRequest(BaseModel):
    trip_id: int | None = None
    items: list[BookingItemCreate] = Field(min_length=1, max_length=20)
    currency: str | None = Field(default="USD", min_length=3, max_length=3)

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        return value.upper() if value else "USD"


class BookingItemRead(BaseModel):
    id: int
    item_type: BookingItemType
    provider_name: str
    external_id: str | None
    metadata: dict[str, Any] | None
    quantity: int
    price: float


class BookingRead(BaseModel):
    id: int
    booking_id: int
    trip_id: int | None
    status: BookingStatus
    total_amount: float
    currency: str
    created_at: object
    items: list[BookingItemRead]


class BookingListRead(BaseModel):
    id: int
    booking_id: int
    trip_id: int | None
    status: BookingStatus
    total_amount: float
    currency: str
    created_at: object


class PaymentSessionRead(BaseModel):
    payment_id: str
    booking_id: int
    amount: float
    currency: str
    status: str
    checkout_url: str
    expires_at: str | None = None


class BookingWebhookRequest(BaseModel):
    payment_id: str
    status: str
    event_id: str | None = None


class PaymentCreateRequest(BaseModel):
    booking_id: int
    amount: float
    currency: str = "INR"
    provider: str = "stripe"
    method: str = "card"
    idempotency_key: str | None = None


class BookingSearchRequest(BaseModel):
    result_type: str = Field(..., pattern="^(hotel|flight|activity)$")
    location: str | None = None
    check_in: str | None = None
    check_out: str | None = None
    guests: int = Field(default=1, ge=1, le=20)
    origin: str | None = Field(default=None, min_length=3, max_length=3)
    destination: str | None = Field(default=None, min_length=3, max_length=3)


class BookingSearchResult(BaseModel):
    id: str
    name: str
    price_per_night: float
    image: str | None = None
    provider_name: str
    external_id: str
    result_type: str
    title: str
    description: str | None
    location: str
    price: float
    currency: str
    rating: float | None
    metadata: dict[str, Any] | None


class ReservationRequest(BaseModel):
    result_type: str = Field(..., pattern="^(hotel|flight|activity)$")
    external_id: str
    guest_name: str = Field(min_length=1, max_length=180)
    guest_email: str = Field(min_length=5, max_length=255)
    given_name: str | None = Field(default=None, max_length=120)
    family_name: str | None = Field(default=None, max_length=120)
    born_on: str | None = Field(default=None, max_length=20)
    gender: str | None = Field(default=None, max_length=20)
    phone_number: str | None = Field(default=None, max_length=40)
    payment_method: str = Field(default="card", min_length=3, max_length=32)
    trip_id: int | None = None
    check_in: str | None = None
    check_out: str | None = None


class RefundRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=255)


class BookingConfirmRequest(BaseModel):
    payment_id: str | None = Field(default=None, max_length=255)
    status: str = Field(default="completed", min_length=3, max_length=32)
    event_id: str | None = Field(default=None, max_length=255)


def _serialize_booking(booking: Any) -> BookingRead:
    return BookingRead(
        id=booking.id,
        booking_id=booking.id,
        trip_id=booking.trip_id,
        status=booking.status,
        total_amount=float(booking.total_amount),
        currency=booking.currency,
        created_at=booking.created_at,
        items=[
            BookingItemRead(
                id=item.id,
                item_type=item.item_type,
                provider_name=item.provider_name,
                external_id=item.external_id,
                metadata=item.provider_metadata,
                quantity=item.quantity,
                price=float(item.price),
            )
            for item in booking.items
        ],
    )


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _parse_booking_window(check_in: str | None, check_out: str | None) -> tuple[datetime | None, datetime | None]:
    try:
        parsed_check_in = _parse_datetime(check_in)
        parsed_check_out = _parse_datetime(check_out)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid check_in/check_out format") from exc

    if parsed_check_in and parsed_check_out and parsed_check_out <= parsed_check_in:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="check_out must be after check_in")
    return parsed_check_in, parsed_check_out


def _serialize_search_results(results: list[Any]) -> list[BookingSearchResult]:
    return [
        BookingSearchResult(
            id=result.external_id,
            name=result.title,
            price_per_night=float((result.metadata or {}).get("price_per_night") or result.price),
            image=result.image_url,
            provider_name=result.provider_name,
            external_id=result.external_id,
            result_type=result.result_type,
            title=result.title,
            description=result.description,
            location=result.location,
            price=float(result.price),
            currency=result.currency,
            rating=result.rating,
            metadata=result.metadata,
        )
        for result in results
    ]


def _run_provider_search(
    provider: BaseProvider,
    *,
    result_type: str,
    location: str | None,
    check_in: str | None,
    check_out: str | None,
    guests: int,
    origin: str | None = None,
    destination: str | None = None,
) -> list[BookingSearchResult]:
    parsed_check_in, parsed_check_out = _parse_booking_window(check_in, check_out)
    try:
        results = asyncio.run(
            provider.search(
                result_type=result_type,
                location=location,
                check_in=parsed_check_in,
                check_out=parsed_check_out,
                guests=guests,
                origin=origin,
                destination=destination,
            )
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _serialize_search_results(results)


def _map_reservation_status(value: str) -> ReservationStatus:
    normalized = value.strip().lower()
    if normalized == ReservationStatus.confirmed.value:
        return ReservationStatus.confirmed
    if normalized == ReservationStatus.failed.value:
        return ReservationStatus.failed
    if normalized == ReservationStatus.cancelled.value:
        return ReservationStatus.cancelled
    if normalized == ReservationStatus.refunded.value:
        return ReservationStatus.refunded
    return ReservationStatus.pending


def _extract_provider_reference(reservation: Any) -> str:
    metadata = reservation.metadata or {}
    raw_response = reservation.raw_response or {}
    for key in ("reservation_reference", "provider_reference", "reservation_id"):
        value = metadata.get(key) or raw_response.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    if reservation.confirmation_number:
        return reservation.confirmation_number
    return reservation.external_id


@router.post("/create", response_model=BookingRead, status_code=status.HTTP_201_CREATED)
def create_booking_endpoint(
    payload: BookingCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookingRead:
    try:
        booking = create_booking(
            db=db,
            user_id=current_user.id,
            trip_id=payload.trip_id,
            items=[
                {
                    "item_type": item.item_type,
                    "provider_name": item.provider_name,
                    "external_id": item.external_id,
                    "metadata": item.metadata,
                    "quantity": item.quantity,
                    "price": item.price,
                }
                for item in payload.items
            ],
            currency=payload.currency,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return _serialize_booking(booking)


@router.get("/my", response_model=list[BookingListRead])
def list_my_bookings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BookingListRead]:
    bookings = list_user_bookings(db=db, user_id=current_user.id)
    return [
        BookingListRead(
            id=booking.id,
            booking_id=booking.id,
            trip_id=booking.trip_id,
            status=booking.status,
            total_amount=float(booking.total_amount),
            currency=booking.currency,
            created_at=booking.created_at,
        )
        for booking in bookings
    ]


@router.get("/search", response_model=list[BookingSearchResult])
def search_bookings_get(
    result_type: str = Query(..., pattern="^(hotel|flight|activity)$"),
    location: str | None = None,
    check_in: str | None = None,
    check_out: str | None = None,
    guests: int = Query(default=1, ge=1, le=20),
    origin: str | None = Query(default=None, min_length=3, max_length=3),
    destination: str | None = Query(default=None, min_length=3, max_length=3),
    current_user: User = Depends(get_current_user),
) -> list[BookingSearchResult]:
    provider = _require_provider()
    return _run_provider_search(
        provider,
        result_type=result_type,
        location=location,
        check_in=check_in,
        check_out=check_out,
        guests=guests,
        origin=origin,
        destination=destination,
    )


@router.get("/{booking_id:int}", response_model=BookingRead)
def get_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookingRead:
    booking = fetch_booking_by_id(db=db, booking_id=booking_id, user_id=current_user.id)
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    return _serialize_booking(booking)


@router.post("/{booking_id:int}/cancel", response_model=BookingRead)
def cancel_booking_endpoint(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookingRead:
    try:
        booking = cancel_booking(db=db, booking_id=booking_id, user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return _serialize_booking(booking)


@router.post("/{booking_id:int}/create-payment", response_model=PaymentSessionRead)
def create_payment_endpoint(
    booking_id: int,
    success_url: str | None = None,
    cancel_url: str | None = None,
    idempotency_key: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaymentSessionRead:
    try:
        payment = create_booking_payment(
            db=db,
            booking_id=booking_id,
            user_id=current_user.id,
            success_url=success_url,
            cancel_url=cancel_url,
            idempotency_key=idempotency_key,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (ValueError, HTTPException) as exc:
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return PaymentSessionRead(**payment)


@router.post("/webhook")
async def booking_webhook(
    request: Request,
    duffel_signature: str | None = Header(default=None, alias="X-Duffel-Signature"),
    duffel_signature_alt: str | None = Header(default=None, alias="Duffel-Signature"),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    payload = await request.body()
    verify_duffel_signature(payload, duffel_signature or duffel_signature_alt)
    event = parse_json_payload(payload)
    try:
        return process_duffel_booking_webhook(db=db, event=event)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{booking_id:int}/confirm", response_model=BookingRead)
def confirm_booking_endpoint(
    booking_id: int,
    payload: BookingConfirmRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookingRead:
    payload = payload or BookingConfirmRequest()
    try:
        booking = confirm_booking_payment(
            db=db,
            booking_id=booking_id,
            user_id=current_user.id,
            payment_id=payload.payment_id,
            status=payload.status,
            event_id=payload.event_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except HTTPException:
        raise
    return _serialize_booking(booking)


@router.post("/payment/create", response_model=dict)
def payment_create_compat(
    payload: PaymentCreateRequest,
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


@router.post("/search", response_model=list[BookingSearchResult])
def search_bookings(
    payload: BookingSearchRequest,
    current_user: User = Depends(get_current_user),
) -> list[BookingSearchResult]:
    provider = _require_provider()
    return _run_provider_search(
        provider,
        result_type=payload.result_type,
        location=payload.location,
        check_in=payload.check_in,
        check_out=payload.check_out,
        guests=payload.guests,
        origin=payload.origin,
        destination=payload.destination,
    )


@router.get("/details", response_model=dict)
def get_booking_details(
    result_type: str = Query(..., pattern="^(hotel|flight|activity)$"),
    external_id: str = Query(...),
    current_user: User = Depends(get_current_user),
) -> dict:
    provider = _require_provider()
    try:
        details = asyncio.run(provider.get_details(result_type=result_type, external_id=external_id))
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {
        "id": details.external_id,
        "name": details.title,
        "price_per_night": float((details.metadata or {}).get("price_per_night") or details.price),
        "image": details.images[0] if details.images else None,
        "provider_name": details.provider_name,
        "external_id": details.external_id,
        "result_type": details.result_type,
        "title": details.title,
        "description": details.description,
        "location": details.location,
        "price": float(details.price),
        "currency": details.currency,
        "rating": details.rating,
        "amenities": details.amenities,
        "images": details.images,
        "policies": details.policies,
        "metadata": details.metadata,
    }


@router.post("/reserve", response_model=dict)
def create_reservation(
    payload: ReservationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    provider = _require_provider()
    parsed_check_in, parsed_check_out = _parse_booking_window(payload.check_in, payload.check_out)
    guest_details = {
        "name": payload.guest_name,
        "email": payload.guest_email,
        "given_name": payload.given_name or payload.guest_name.split(" ", maxsplit=1)[0],
        "family_name": payload.family_name or (payload.guest_name.split(" ", maxsplit=1)[1] if " " in payload.guest_name else payload.guest_name),
        "born_on": payload.born_on,
        "gender": payload.gender,
        "phone_number": payload.phone_number,
    }
    try:
        details = asyncio.run(provider.get_details(result_type=payload.result_type, external_id=payload.external_id))
        booking = create_booking(
            db=db,
            user_id=current_user.id,
            trip_id=payload.trip_id,
            items=[
                {
                    "item_type": payload.result_type,
                    "provider_name": details.provider_name,
                    "external_id": details.external_id,
                    "metadata": {
                        **(details.metadata or {}),
                        "raw_offer": details.raw_response,
                        "check_in": parsed_check_in.isoformat() if parsed_check_in else None,
                        "check_out": parsed_check_out.isoformat() if parsed_check_out else None,
                    },
                    "price": float(details.price),
                    "quantity": 1,
                }
            ],
            currency=details.currency,
        )
        first_item = booking.items[0]
        attach_provider_reservation(
            db=db,
            booking_item_id=first_item.id,
            provider_name=details.provider_name,
            provider_reference=details.external_id,
            confirmation_number=None,
            provider_response={
                "inventory_external_id": payload.external_id,
                "guest_details": guest_details,
                "payment_details": {"method": payload.payment_method},
                "details": details.raw_response,
                "check_in": parsed_check_in.isoformat() if parsed_check_in else None,
                "check_out": parsed_check_out.isoformat() if parsed_check_out else None,
                "booking_mode": "pay_then_confirm",
            },
            reservation_status=ReservationStatus.pending,
            history_user_id=current_user.id,
            history_details={"booking_mode": "pay_then_confirm", "inventory_external_id": payload.external_id},
        )
        db.commit()
        refreshed = fetch_booking_by_id(db=db, booking_id=booking.id, user_id=current_user.id)
        payment = create_booking_payment(db=db, booking_id=booking.id, user_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    booking_payload = _serialize_booking(refreshed).model_dump(mode="json") if refreshed is not None else None
    return {
        "reservation_id": details.external_id,
        "status": ReservationStatus.pending.value,
        "booking_id": booking_payload["booking_id"] if booking_payload is not None else None,
        "payment": payment,
        "reservation": {
            "reservation_id": details.external_id,
            "provider_name": details.provider_name,
            "external_id": details.external_id,
            "confirmation_number": None,
            "status": ReservationStatus.pending.value,
            "total_price": float(details.price),
            "currency": details.currency,
            "check_in": parsed_check_in.isoformat() if parsed_check_in else None,
            "check_out": parsed_check_out.isoformat() if parsed_check_out else None,
        },
        "booking": booking_payload,
    }
    try:
        reservation = asyncio.run(
            provider.reserve(
                result_type=payload.result_type,
                external_id=payload.external_id,
                guest_details={
                    "name": payload.guest_name,
                    "email": payload.guest_email,
                    "given_name": payload.given_name or payload.guest_name.split(" ", maxsplit=1)[0],
                    "family_name": payload.family_name or (payload.guest_name.split(" ", maxsplit=1)[1] if " " in payload.guest_name else payload.guest_name),
                    "born_on": payload.born_on,
                    "gender": payload.gender,
                    "phone_number": payload.phone_number,
                },
                payment_details={"method": payload.payment_method},
                db=db,
                user_id=current_user.id,
                trip_id=payload.trip_id,
                check_in=parsed_check_in,
                check_out=parsed_check_out,
            )
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    booking_id = (reservation.metadata or {}).get("booking_id") if reservation.metadata else None
    refreshed = None
    if booking_id is not None:
        try:
            refreshed = fetch_booking_by_id(db=db, booking_id=int(booking_id), user_id=current_user.id)
        except (TypeError, ValueError):
            refreshed = None
    if refreshed is None:
        try:
            booking = create_booking(
                db=db,
                user_id=current_user.id,
                trip_id=payload.trip_id,
                items=[
                    {
                        "item_type": payload.result_type,
                        "provider_name": reservation.provider_name,
                        "external_id": reservation.external_id,
                        "metadata": reservation.metadata,
                        "price": float(reservation.total_price),
                        "quantity": 1,
                    }
                ],
                currency=reservation.currency,
            )
        except LookupError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        first_item = booking.items[0]
        provider_reference = _extract_provider_reference(reservation)
        reservation_status = _map_reservation_status(reservation.status)
        attach_provider_reservation(
            db=db,
            booking_item_id=first_item.id,
            provider_name=reservation.provider_name,
            provider_reference=provider_reference,
            confirmation_number=reservation.confirmation_number,
            provider_response=reservation.raw_response,
            reservation_status=reservation_status,
            history_user_id=current_user.id,
            history_details={
                "booking_mode": reservation.metadata.get("booking_mode") if reservation.metadata else None,
                "inventory_external_id": payload.external_id,
            },
        )
        db.commit()
        refreshed = fetch_booking_by_id(db=db, booking_id=booking.id, user_id=current_user.id)

    reservation_id = _extract_provider_reference(reservation)
    booking_payload = _serialize_booking(refreshed).model_dump(mode="json") if refreshed is not None else None

    return {
        "reservation_id": reservation_id,
        "status": reservation.status,
        "booking_id": booking_payload["booking_id"] if booking_payload is not None else None,
        "reservation": {
            "reservation_id": reservation_id,
            "provider_name": reservation.provider_name,
            "external_id": reservation.external_id,
            "confirmation_number": reservation.confirmation_number,
            "status": reservation.status,
            "total_price": float(reservation.total_price),
            "currency": reservation.currency,
            "check_in": reservation.check_in.isoformat() if reservation.check_in else None,
            "check_out": reservation.check_out.isoformat() if reservation.check_out else None,
        },
        "booking": booking_payload,
    }


@router.get("/history", response_model=list[BookingListRead])
def get_booking_history(
    status: BookingStatus | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BookingListRead]:
    bookings = list_user_bookings(db=db, user_id=current_user.id, status=status, limit=limit, offset=offset)
    return [
        BookingListRead(
            id=booking.id,
            booking_id=booking.id,
            trip_id=booking.trip_id,
            status=booking.status,
            total_amount=float(booking.total_amount),
            currency=booking.currency,
            created_at=booking.created_at,
        )
        for booking in bookings
    ]


@router.get("/{booking_id:int}/items", response_model=list[BookingItemRead])
def get_booking_items(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BookingItemRead]:
    booking = fetch_booking_by_id(db=db, booking_id=booking_id, user_id=current_user.id)
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    return [
        BookingItemRead(
            id=item.id,
            item_type=item.item_type,
            provider_name=item.provider_name,
            external_id=item.external_id,
            metadata=item.provider_metadata,
            quantity=item.quantity,
            price=float(item.price),
        )
        for item in booking.items
    ]


@router.post("/{booking_id:int}/refund", response_model=BookingRead)
def request_booking_refund(
    booking_id: int,
    payload: RefundRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookingRead:
    try:
        booking = refund_booking(
            db=db,
            booking_id=booking_id,
            user_id=current_user.id,
            reason=payload.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _serialize_booking(booking)
