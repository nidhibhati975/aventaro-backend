from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

import stripe

from app.services.external_retry import call_with_retries
from app.utils.config import get_settings

try:
    import razorpay
except ImportError:  # pragma: no cover
    razorpay = None

STRIPE_API_VERSION = "2026-02-25.clover"


@dataclass(frozen=True)
class PaymentOrderRequest:
    amount_minor: int
    currency: str
    idempotency_key: str
    user_id: int
    description: str
    metadata: dict[str, str]


@dataclass(frozen=True)
class PaymentOrderResult:
    provider: str
    provider_order_id: str
    amount_minor: int
    currency: str
    status: str
    checkout_url: str | None = None
    raw: dict | None = None


@dataclass(frozen=True)
class PaymentRefundRequest:
    provider_payment_id: str
    amount_minor: int
    currency: str
    idempotency_key: str
    reason: str | None = None
    metadata: dict[str, str] | None = None


@dataclass(frozen=True)
class PaymentRefundResult:
    provider: str
    provider_refund_id: str
    amount_minor: int
    currency: str
    status: str
    confirmed: bool
    raw: dict | None = None


class PaymentGateway(Protocol):
    provider: str

    def create_order(self, request: PaymentOrderRequest) -> PaymentOrderResult:
        ...

    def refund(self, request: PaymentRefundRequest) -> PaymentRefundResult:
        ...


class StripeGateway:
    provider = "stripe"

    def create_order(self, request: PaymentOrderRequest) -> PaymentOrderResult:
        settings = get_settings()
        if not settings.stripe_secret_key:
            raise RuntimeError("Stripe is not configured")
        stripe.api_key = settings.stripe_secret_key
        stripe.api_version = STRIPE_API_VERSION
        stripe.max_network_retries = 2
        try:
            intent = call_with_retries(
                lambda: stripe.PaymentIntent.create(
                    amount=request.amount_minor,
                    currency=request.currency.lower(),
                    description=request.description,
                    metadata={"user_id": str(request.user_id), **request.metadata},
                    idempotency_key=request.idempotency_key,
                    automatic_payment_methods={"enabled": True},
                )
            )
        except stripe.error.StripeError as exc:
            raise RuntimeError("Stripe payment order creation failed") from exc
        except Exception as exc:
            raise RuntimeError("Stripe payment order creation failed") from exc
        return PaymentOrderResult(
            provider=self.provider,
            provider_order_id=intent.id,
            amount_minor=int(intent.amount),
            currency=str(intent.currency).upper(),
            status=str(intent.status),
            raw=intent.to_dict_recursive() if hasattr(intent, "to_dict_recursive") else dict(intent),
        )

    def refund(self, request: PaymentRefundRequest) -> PaymentRefundResult:
        settings = get_settings()
        if not settings.stripe_secret_key:
            raise RuntimeError("Stripe is not configured")
        stripe.api_key = settings.stripe_secret_key
        stripe.api_version = STRIPE_API_VERSION
        stripe.max_network_retries = 2
        try:
            refund = call_with_retries(
                lambda: stripe.Refund.create(
                    payment_intent=request.provider_payment_id,
                    amount=request.amount_minor,
                    reason="requested_by_customer" if request.reason else None,
                    metadata=request.metadata or {},
                    idempotency_key=request.idempotency_key,
                )
            )
        except stripe.error.StripeError as exc:
            raise RuntimeError("Stripe refund failed") from exc
        status = str(refund.get("status") or "")
        if status not in {"succeeded", "pending"}:
            raise RuntimeError(f"Stripe refund was not accepted: {status}")
        return PaymentRefundResult(
            provider=self.provider,
            provider_refund_id=str(refund["id"]),
            amount_minor=int(refund["amount"]),
            currency=str(refund["currency"]).upper(),
            status=status,
            confirmed=status == "succeeded",
            raw=refund.to_dict_recursive() if hasattr(refund, "to_dict_recursive") else dict(refund),
        )


class RazorpayGateway:
    provider = "razorpay"

    def create_order(self, request: PaymentOrderRequest) -> PaymentOrderResult:
        settings = get_settings()
        if razorpay is None:
            raise RuntimeError("Razorpay SDK is not installed")
        if not settings.razorpay_key_id or not settings.razorpay_key_secret:
            raise RuntimeError("Razorpay is not configured")
        client = razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))
        try:
            order = call_with_retries(
                lambda: client.order.create(
                    data={
                        "amount": request.amount_minor,
                        "currency": request.currency.upper(),
                        "receipt": request.idempotency_key[:40],
                        "notes": {"user_id": str(request.user_id), **request.metadata},
                    }
                )
            )
        except Exception as exc:
            raise RuntimeError("Razorpay payment order creation failed") from exc
        return PaymentOrderResult(
            provider=self.provider,
            provider_order_id=order["id"],
            amount_minor=int(order["amount"]),
            currency=str(order["currency"]).upper(),
            status=str(order["status"]),
            raw=dict(order),
        )

    def refund(self, request: PaymentRefundRequest) -> PaymentRefundResult:
        settings = get_settings()
        if razorpay is None:
            raise RuntimeError("Razorpay SDK is not installed")
        if not settings.razorpay_key_id or not settings.razorpay_key_secret:
            raise RuntimeError("Razorpay is not configured")
        client = razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))
        try:
            refund = call_with_retries(
                lambda: client.payment.refund(
                    request.provider_payment_id,
                    {
                        "amount": request.amount_minor,
                        "speed": "normal",
                        "notes": request.metadata or {},
                        "receipt": request.idempotency_key[:40],
                    },
                )
            )
        except Exception as exc:
            raise RuntimeError("Razorpay refund failed") from exc
        status = str(refund.get("status") or "")
        if status not in {"processed", "pending", "created"}:
            raise RuntimeError(f"Razorpay refund was not accepted: {status}")
        return PaymentRefundResult(
            provider=self.provider,
            provider_refund_id=str(refund["id"]),
            amount_minor=int(refund.get("amount") or request.amount_minor),
            currency=request.currency.upper(),
            status=status,
            confirmed=status == "processed",
            raw=dict(refund),
        )


def get_payment_gateway(provider: str, *, currency: str | None = None) -> PaymentGateway:
    normalized = provider.strip().lower()
    if normalized == "auto":
        normalized = "razorpay" if (currency or "").upper() == "INR" else "stripe"
    if normalized == "stripe":
        return StripeGateway()
    if normalized == "razorpay":
        return RazorpayGateway()
    raise ValueError("Unsupported payment provider")


def amount_major_to_minor(amount: Decimal, currency: str) -> int:
    zero_decimal = {"JPY", "KRW"}
    multiplier = Decimal("1") if currency.upper() in zero_decimal else Decimal("100")
    return int((amount * multiplier).quantize(Decimal("1")))
