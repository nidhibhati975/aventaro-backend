from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import engine
from app.services.geo import validate_postgis_mapping
from app.services.redis_runtime import ping_redis
from app.utils.config import get_settings
from app.utils.config import _placeholder_config_allowed


def check_database_health() -> None:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise RuntimeError("Database is not reachable") from exc


def check_redis_health() -> None:
    ping_redis()


def check_external_configuration_health() -> None:
    settings = get_settings()
    try:
        import boto3  # noqa: F401
        import stripe  # noqa: F401
        import sentry_sdk  # noqa: F401
        import opentelemetry  # noqa: F401
    except ImportError as exc:
        raise RuntimeError("Required integration dependency is not installed") from exc

    if settings.razorpay_key_id or settings.razorpay_key_secret:
        try:
            import razorpay  # noqa: F401
        except ImportError as exc:
            raise RuntimeError("Razorpay SDK is not installed") from exc


def check_geospatial_health() -> None:
    try:
        with engine.connect() as connection:
            dialect = connection.dialect.name
            if dialect != "postgresql":
                raise RuntimeError("Geospatial search requires PostgreSQL/PostGIS")
            validate_postgis_mapping(connection)
    except (SQLAlchemyError, RuntimeError) as exc:
        raise RuntimeError("PostGIS geospatial mapping is not ready") from exc


def get_runtime_health() -> dict[str, object]:
    services: dict[str, str] = {}

    for service_name, check in (
        ("db", check_database_health),
        ("redis", check_redis_health),
        ("geo", check_geospatial_health),
        ("external_config", check_external_configuration_health),
    ):
        try:
            check()
            services[service_name] = "ok"
        except RuntimeError:
            services[service_name] = "error"

    overall_status = "ok" if all(status == "ok" for status in services.values()) else "error"
    return {"status": overall_status, "services": services}


def assert_runtime_ready() -> None:
    runtime_health = get_runtime_health()
    failed_services = [name for name, status in runtime_health["services"].items() if status != "ok"]
    if failed_services:
        if _placeholder_config_allowed():
            return
        raise RuntimeError(f"Runtime dependencies are not ready: {', '.join(failed_services)}")
