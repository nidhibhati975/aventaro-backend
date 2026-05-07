import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.router import api_router
from app.middleware.auth_context import AuthContextMiddleware
from app.middleware.request_context import RequestContextMiddleware
from app.middleware.response_envelope import ResponseEnvelopeMiddleware
from app.services.chat_realtime import chat_connection_manager
from app.services.chat_outbox_runtime import chat_outbox_worker
from app.services.ai_pipeline import ai_worker
from app.services.health import assert_runtime_ready
from app.services.maintenance_runtime import maintenance_worker
from app.services.payment_reconciliation_runtime import payment_reconciliation_worker
from app.services.observability import configure_observability
from app.services.subscription_runtime import subscription_expiry_worker
from app.services.trip_lifecycle_runtime import trip_lifecycle_worker
from app.utils.config import get_settings
from app.utils.config import _placeholder_config_allowed
from app.utils.errors import register_exception_handlers
from app.utils.logging import configure_logging


configure_logging()
logger = logging.getLogger("aventaro.startup")
app = FastAPI(title="Aventaro API", version="1.0.0")
register_exception_handlers(app)
settings = get_settings()
configure_observability(app, settings)

default_dev_origins = [
    "http://localhost:3000",
    "http://localhost:8081",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8081",
]
cors_origins = list(settings.cors_allowed_origins or default_dev_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "Stripe-Signature",
            "X-Razorpay-Signature",
            "X-Duffel-Signature",
            "Duffel-Signature",
            "X-Device-Id",
        ],
)
app.add_middleware(AuthContextMiddleware)
app.add_middleware(ResponseEnvelopeMiddleware)
app.add_middleware(RequestContextMiddleware)

app.include_router(health_router)
app.include_router(api_router)


def _start_runtime_component(name: str, starter) -> None:
    try:
        starter()
    except Exception:
        if not _placeholder_config_allowed():
            raise
        logger.warning(
            "runtime_component_start_skipped name=%s",
            name,
            extra={"event_type": "runtime_component_start_skipped", "component": name},
            exc_info=True,
        )


def _read_port() -> int:
    raw_port = (os.getenv("PORT", "8000") or "8000").strip()
    try:
        return int(raw_port)
    except ValueError as exc:
        raise RuntimeError("PORT must be an integer") from exc


@app.on_event("startup")
async def validate_runtime() -> None:
    port = _read_port()
    logger.info(
        "application_starting env=%s port=%s",
        settings.app_env,
        port,
        extra={"event_type": "application_starting"},
    )
    get_settings()
    assert_runtime_ready()
    _start_runtime_component("chat_connection_manager", chat_connection_manager.start)
    if settings.run_embedded_workers:
        _start_runtime_component("chat_outbox_worker", chat_outbox_worker.start)
        _start_runtime_component("ai_worker", ai_worker.start)
        _start_runtime_component("payment_reconciliation_worker", payment_reconciliation_worker.start)
        _start_runtime_component("maintenance_worker", maintenance_worker.start)
        _start_runtime_component("subscription_expiry_worker", subscription_expiry_worker.start)
        _start_runtime_component("trip_lifecycle_worker", trip_lifecycle_worker.start)
    logger.info(
        "application_started env=%s port=%s",
        settings.app_env,
        port,
        extra={"event_type": "application_started"},
    )


@app.on_event("shutdown")
async def shutdown_runtime() -> None:
    logger.info(
        "application_stopping env=%s",
        settings.app_env,
        extra={"event_type": "application_stopping"},
    )
    chat_connection_manager.stop()
    if settings.run_embedded_workers:
        await chat_outbox_worker.stop()
        await ai_worker.stop()
        await payment_reconciliation_worker.stop()
        await maintenance_worker.stop()
        await subscription_expiry_worker.stop()
        await trip_lifecycle_worker.stop()
    logger.info(
        "application_stopped env=%s",
        settings.app_env,
        extra={"event_type": "application_stopped"},
    )


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=_read_port())


if __name__ == "__main__":
    main()
