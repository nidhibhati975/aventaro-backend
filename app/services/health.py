from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import engine
from app.services.redis_runtime import ping_redis


def check_database_health() -> None:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise RuntimeError("Database is not reachable") from exc


def check_redis_health() -> None:
    ping_redis()


def assert_runtime_ready() -> None:
    check_database_health()
    check_redis_health()
