from __future__ import annotations

import os
from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost/testdb")
os.environ.setdefault("JWT_SECRET", "test-secret-key-1234567890test-secret")
os.environ.setdefault("OPENAI_API_KEY", "sk-development-placeholder-key-not-used")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_12345678901234567890")
os.environ.setdefault("STRIPE_WEBHOOK_SECRET", "whsec_12345678901234567890")
os.environ.setdefault("STRIPE_PREMIUM_PRICE_ID", "price_1234567890")
os.environ.setdefault("STRIPE_BOOKING_SUCCESS_URL", "https://example.com/success")
os.environ.setdefault("STRIPE_BOOKING_CANCEL_URL", "https://example.com/cancel")
os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_123456")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "secretsecretsecret")
os.environ.setdefault("RAZORPAY_WEBHOOK_SECRET", "webhooksecret1234")
os.environ.setdefault("RUN_EMBEDDED_WORKERS", "false")
os.environ.setdefault("BOOKING_PROVIDER", "duffel")
os.environ.setdefault("ALLOW_PLACEHOLDER_CONFIG", "true")

from app.db.base import Base
from app.db import session as db_session
from app.main import app
from app.api import auth as auth_api
from app.api import booking as booking_api
from app.api import monetization as monetization_api
from app.api import payments as payments_api
from app.middleware import auth_context
from app.models.payments import Payment
from app.services import auth as auth_service
from app.services import mfa as mfa_service
from app.services import notifications
from app.services import payment_reconciliation_runtime
from app.services import payments as payments_service
from app.services import subscriptions as subscriptions_service
from app.services.payment_gateways import PaymentRefundResult
from app.services.providers.base import BaseProvider, DetailsResult, SearchResult, get_provider_registry
from app.services.rate_limit import rate_limiter


@compiles(JSONB, "sqlite")
def _compile_jsonb_for_sqlite(_type, compiler, **_kw):  # noqa: ANN001
    return "JSON"


class FakeDuffelProvider(BaseProvider):
    @property
    def name(self) -> str:
        return "duffel"

    @property
    def booking_mode(self) -> str:
        return "live"

    async def search(self, result_type: str, location: str | None = None, **kwargs) -> list[SearchResult]:
        return [
            SearchResult(
                provider_name="duffel",
                external_id="hotel_1",
                result_type=result_type,
                title="Hotel One",
                description="Nice stay",
                location=location or "Goa",
                price=Decimal("199.99"),
                currency="USD",
                rating=4.5,
                image_url="https://img/hotel.png",
                metadata={"price_per_night": 199.99},
                raw_response={"source": "fake"},
            )
        ]

    async def get_details(self, result_type: str, external_id: str) -> DetailsResult:
        return DetailsResult(
            provider_name="duffel",
            external_id=external_id,
            result_type=result_type,
            title="Hotel One",
            description="Nice stay",
            location="Goa",
            price=Decimal("199.99"),
            currency="USD",
            rating=4.5,
            amenities=["wifi"],
            images=["https://img/hotel.png"],
            policies={"cancel": "24h"},
            metadata={"price_per_night": 199.99},
            raw_response={"source": "fake"},
        )

    async def create_reservation(self, result_type: str, external_id: str, guest_details: dict, payment_details: dict):
        raise NotImplementedError

    async def confirm(self, reservation_id: str, **kwargs) -> dict[str, object]:
        return {
            "status": "confirmed",
            "provider_reference": f"prov_{reservation_id}",
            "confirmation_number": f"CNF-{reservation_id}",
            "provider_response": {"confirmed": True},
        }

    async def cancel_reservation(self, external_id: str, reason: str | None = None) -> dict[str, object]:
        return {"status": "cancelled", "external_id": external_id, "reason": reason}


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_connection, _connection_record):  # noqa: ANN001
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(bind=engine)
    SessionTesting = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        db = SessionTesting()
        try:
            yield db
        finally:
            db.close()

    for dep in [
        db_session.get_db,
        auth_api.get_db,
        auth_service.get_db,
        booking_api.get_db,
        payments_api.get_db,
        monetization_api.get_db,
    ]:
        app.dependency_overrides[dep] = override_get_db

    for module in [db_session, auth_context, payment_reconciliation_runtime, notifications]:
        if hasattr(module, "SessionLocal"):
            monkeypatch.setattr(module, "SessionLocal", SessionTesting)

    monkeypatch.setattr(rate_limiter, "hit", lambda **_kwargs: None)
    monkeypatch.setattr(notifications, "_dispatch_notification_side_effects", lambda _notification_ids: None)
    monkeypatch.setattr(mfa_service, "_generate_otp", lambda: "123456")
    monkeypatch.setattr(mfa_service, "_send_email_otp", lambda _destination, _code: None)
    monkeypatch.setattr(mfa_service, "_send_sms_otp", lambda _destination, _code: None)

    stripe_customers: dict[str, dict] = {}
    stripe_sessions: dict[str, dict] = {}
    stripe_subscriptions = {
        "sub_premium": {
            "id": "sub_premium",
            "customer": "cus_1",
            "status": "active",
            "current_period_end": int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp()),
        }
    }

    def customer_retrieve(customer_id: str) -> dict[str, str]:
        if customer_id not in stripe_customers:
            raise Exception("missing customer")
        return {"id": customer_id}

    def customer_create(**kwargs) -> SimpleNamespace:
        customer_id = f"cus_{len(stripe_customers) + 1}"
        stripe_customers[customer_id] = kwargs
        return SimpleNamespace(id=customer_id)

    def session_create(**kwargs) -> SimpleNamespace:
        session_id = f"cs_{len(stripe_sessions) + 1}"
        mode = kwargs.get("mode")
        currency = "usd"
        amount_total = 999
        if mode == "payment":
            line_item = (kwargs.get("line_items") or [{}])[0]
            price_data = line_item.get("price_data") or {}
            currency = price_data.get("currency", "usd")
            amount_total = int((price_data.get("unit_amount") or 999) * line_item.get("quantity", 1))
        session = {
            "id": session_id,
            "url": f"https://checkout.test/{session_id}",
            "amount_total": amount_total,
            "currency": currency,
            "expires_at": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()),
            "customer": kwargs.get("customer"),
            "metadata": kwargs.get("metadata") or {},
            "subscription": "sub_premium" if mode == "subscription" else None,
            "payment_intent": f"pi_{session_id}" if mode == "payment" else None,
            "status": "open",
            "payment_status": "unpaid",
        }
        stripe_sessions[session_id] = session
        return SimpleNamespace(**session)

    monkeypatch.setattr(payments_service.stripe.Customer, "retrieve", customer_retrieve)
    monkeypatch.setattr(payments_service.stripe.Customer, "create", customer_create)
    monkeypatch.setattr(payments_service.stripe.checkout.Session, "create", session_create)
    monkeypatch.setattr(payments_service.stripe.checkout.Session, "retrieve", lambda session_id: stripe_sessions[session_id])
    monkeypatch.setattr(payments_service.stripe.Subscription, "retrieve", lambda subscription_id: stripe_subscriptions[subscription_id])
    monkeypatch.setattr(subscriptions_service.stripe.Subscription, "delete", lambda subscription_id: stripe_subscriptions[subscription_id])
    monkeypatch.setattr(payments_service, "_configure_stripe", lambda: None)
    monkeypatch.setattr(subscriptions_service, "_configure_stripe", lambda: None)
    monkeypatch.setattr(
        payments_service,
        "get_settings",
        lambda: SimpleNamespace(
            stripe_secret_key="sk_test_12345678901234567890",
            stripe_booking_success_url="https://example.com/success",
            stripe_booking_cancel_url="https://example.com/cancel",
            stripe_premium_price_id="price_1234567890",
        ),
    )

    class FakeGateway:
        provider = "stripe"

        def refund(self, request) -> PaymentRefundResult:
            return PaymentRefundResult(
                provider=self.provider,
                provider_refund_id=f"re_{request.provider_payment_id}",
                amount_minor=request.amount_minor,
                currency=request.currency,
                status="succeeded",
                confirmed=True,
                raw={"ok": True},
            )

    monkeypatch.setattr(payments_service, "get_payment_gateway", lambda provider, currency=None: FakeGateway())

    registry = get_provider_registry()
    registry.register(FakeDuffelProvider())

    with TestClient(app) as test_client:
        test_client._stripe_sessions = stripe_sessions  # type: ignore[attr-defined]
        test_client._session_factory = SessionTesting  # type: ignore[attr-defined]
        yield test_client

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _unwrap(response):
    payload = response.json()
    return payload.get("data", payload)


def _headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}", "X-Device-Id": "device-a"}


def test_booking_webhook_confirmation_and_refund_flow(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    signup = client.post(
        "/auth/signup",
        json={"email": "booker@example.com", "password": "ValidPass123!", "name": "Booker"},
        headers={"X-Device-Id": "device-a"},
    )
    assert signup.status_code == 201, signup.text
    access_token = _unwrap(signup)["access_token"]

    reserve = client.post(
        "/booking/reserve",
        json={
            "result_type": "hotel",
            "external_id": "hotel_1",
            "guest_name": "Booker Demo",
            "guest_email": "booker@example.com",
            "check_in": "2026-06-01T00:00:00Z",
            "check_out": "2026-06-03T00:00:00Z",
        },
        headers=_headers(access_token),
    )
    assert reserve.status_code == 200, reserve.text
    reserve_payload = _unwrap(reserve)
    booking_id = reserve_payload["booking_id"]
    payment_id = reserve_payload["payment"]["payment_id"]

    premature = client.post(
        f"/booking/{booking_id}/confirm",
        json={"payment_id": payment_id},
        headers=_headers(access_token),
    )
    assert premature.status_code == 400, premature.text

    client._stripe_sessions[payment_id]["payment_status"] = "paid"  # type: ignore[attr-defined]
    booking_event = {
        "id": "evt_booking_1",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                **client._stripe_sessions[payment_id],  # type: ignore[attr-defined]
                "id": payment_id,
                "metadata": {"user_id": "1", "booking_id": str(booking_id), "payment_type": "booking"},
                "payment_intent": f"pi_{payment_id}",
            }
        },
    }
    monkeypatch.setattr(payments_api, "construct_webhook_event", lambda payload, signature: booking_event)

    first_webhook = client.post("/payments/webhook", content=b"{}", headers={"Stripe-Signature": "sig"})
    assert first_webhook.status_code == 200, first_webhook.text
    duplicate_webhook = client.post("/payments/webhook", content=b"{}", headers={"Stripe-Signature": "sig"})
    assert duplicate_webhook.status_code == 200, duplicate_webhook.text

    booking = client.get(f"/booking/{booking_id}", headers=_headers(access_token))
    assert booking.status_code == 200, booking.text
    assert _unwrap(booking)["status"] == "confirmed"

    refund = client.post(
        f"/booking/{booking_id}/refund",
        json={"reason": "user_changed_mind"},
        headers=_headers(access_token),
    )
    assert refund.status_code == 200, refund.text
    assert _unwrap(refund)["status"] == "refunded"

    with client._session_factory() as db:  # type: ignore[attr-defined]
        payment = db.scalar(select(Payment).where(Payment.booking_id == booking_id))
        assert payment is not None
        assert payment.status == "refunded"
