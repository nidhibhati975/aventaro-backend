from __future__ import annotations

import logging

from fastapi import FastAPI
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from app.utils.config import Settings


def configure_observability(app: FastAPI, settings: Settings) -> None:
    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.app_env,
            integrations=[
                FastApiIntegration(transaction_style="endpoint"),
                SqlalchemyIntegration(),
                LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
            ],
            traces_sample_rate=settings.trace_sample_rate if settings.is_production else 0.0,
            send_default_pii=False,
        )
        logging.getLogger("aventaro.observability").info(
            "sentry_initialized",
            extra={"event_type": "sentry_initialized", "environment": settings.app_env},
        )

    if settings.otel_exporter_otlp_endpoint:
        try:
            from opentelemetry import trace
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
            from opentelemetry.sdk.resources import Resource
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor

            provider = TracerProvider(resource=Resource.create({"service.name": settings.otel_service_name}))
            processor = BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint))
            provider.add_span_processor(processor)
            trace.set_tracer_provider(provider)
            FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
        except Exception:
            logging.getLogger("aventaro.observability").warning(
                "otel_initialization_skipped",
                extra={"event_type": "otel_initialization_skipped"},
                exc_info=True,
            )


def capture_backend_exception(exc: BaseException) -> None:
    sentry_sdk.capture_exception(exc)
