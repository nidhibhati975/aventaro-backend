from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import stripe
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.ledger import ReconciliationRun
from app.models.payments import Payment
from app.services.external_retry import call_with_retries
from app.services.ledger import append_ledger_entry, get_or_create_ledger_account
from app.utils.config import get_settings

try:
    import razorpay
except ImportError:  # pragma: no cover
    razorpay = None


logger = logging.getLogger("aventaro.payment_reconciliation")
STRIPE_API_VERSION = "2026-02-25.clover"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def reconcile_pending_payments(batch_size: int = 50) -> int:
    settings = get_settings()
    reconciled = 0
    with SessionLocal() as db:
        run = ReconciliationRun(provider="all", status="running")
        db.add(run)
        db.flush()
        cutoff = _utcnow() - timedelta(minutes=5)
        payments = db.scalars(
            select(Payment)
            .where(Payment.status.in_(("created", "pending")), Payment.created_at < cutoff)
            .order_by(Payment.created_at.asc())
            .limit(batch_size)
        ).all()
        try:
            for payment in payments:
                try:
                    if payment.provider == "stripe" and settings.stripe_secret_key:
                        stripe.api_key = settings.stripe_secret_key
                        stripe.api_version = STRIPE_API_VERSION
                        stripe.max_network_retries = 2
                        session = call_with_retries(lambda: stripe.checkout.Session.retrieve(payment.stripe_session_id))
                        status = str(session.get("payment_status") or session.get("status") or "")
                        if status == "paid":
                            payment.status = "paid"
                            payment.provider_payment_id = str(session.get("payment_intent") or payment.provider_payment_id or "")
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
                                entry_type=f"{payment.payment_type}_payment_reconciled",
                                provider="stripe",
                                provider_reference=payment.stripe_session_id,
                                reference_type="payment",
                                reference_id=payment.id,
                                idempotency_key=f"stripe:reconcile:{payment.stripe_session_id}",
                                description="Stripe payment reconciled as paid",
                                metadata={"source": "reconciliation"},
                            )
                            if payment.booking_id is not None:
                                from app.services.booking import confirm_booking

                                confirm_booking(
                                    db,
                                    booking_id=payment.booking_id,
                                    event_id=f"reconcile:{payment.stripe_session_id}",
                                    provider_reference=payment.provider_payment_id or payment.stripe_session_id,
                                )
                        elif status in {"expired", "canceled", "cancelled"}:
                            payment.status = "expired"
                            if payment.booking_id is not None:
                                from app.models.booking import Booking, BookingStatus

                                booking = db.get(Booking, payment.booking_id)
                                if booking is not None and booking.status == BookingStatus.payment_initiated:
                                    booking.status = BookingStatus.failed
                        reconciled += 1
                    elif payment.provider == "razorpay" and razorpay is not None and settings.razorpay_key_id and settings.razorpay_key_secret:
                        client = razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))
                        order = call_with_retries(lambda: client.order.fetch(payment.stripe_session_id))
                        if order.get("status") == "paid":
                            payment.status = "paid"
                            account = get_or_create_ledger_account(
                                db,
                                owner_type="user",
                                owner_id=payment.user_id,
                                currency=(payment.currency or "inr").upper(),
                            )
                            append_ledger_entry(
                                db,
                                account=account,
                                user_id=payment.user_id,
                                direction="credit",
                                amount=payment.amount,
                                entry_type=f"{payment.payment_type}_payment_reconciled",
                                provider="razorpay",
                                provider_reference=payment.stripe_session_id,
                                reference_type="payment",
                                reference_id=payment.id,
                                idempotency_key=f"razorpay:reconcile:{payment.stripe_session_id}",
                                description="Razorpay payment reconciled as paid",
                                metadata={"source": "reconciliation"},
                            )
                            if payment.booking_id is not None:
                                from app.services.booking import confirm_booking

                                confirm_booking(
                                    db,
                                    booking_id=payment.booking_id,
                                    event_id=f"reconcile:{payment.stripe_session_id}",
                                    provider_reference=payment.provider_payment_id or payment.stripe_session_id,
                                )
                        reconciled += 1
                except Exception as exc:
                    logger.warning(
                        "payment_reconciliation_payment_failed",
                        extra={"payment_id": payment.id, "provider": payment.provider, "error": str(exc)},
                    )
                    continue
            run.status = "completed"
            run.finished_at = _utcnow()
            run.summary = {"checked": len(payments), "reconciled": reconciled}
            db.commit()
        except Exception as exc:
            db.rollback()
            run = ReconciliationRun(provider="all", status="failed", finished_at=_utcnow(), error=str(exc)[:2000])
            db.add(run)
            db.commit()
            logger.exception("payment_reconciliation_failed", exc_info=exc)
    return reconciled


class PaymentReconciliationWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(), name="aventaro-payment-reconciliation")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.to_thread(reconcile_pending_payments)
                await asyncio.sleep(300)
            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("payment_reconciliation_worker_iteration_failed")
                await asyncio.sleep(30)


payment_reconciliation_worker = PaymentReconciliationWorker()
