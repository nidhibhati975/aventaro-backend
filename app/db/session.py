from collections.abc import Generator
import logging

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.utils.config import get_settings


settings = get_settings()
logger = logging.getLogger("aventaro.db")


def _build_engine(database_url: str):
    return create_engine(database_url, pool_pre_ping=True)


def _probe_engine(engine) -> None:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))


def _resolve_database_url() -> str:
    fallback_url = settings.database_url_fallback if settings.database_fallback_enabled else None
    if not fallback_url:
        return settings.database_url

    candidate_urls: list[tuple[str, str]] = []
    if fallback_url and settings.database_prefer_fallback:
        candidate_urls.append(("fallback", fallback_url))
    candidate_urls.append(("primary", settings.database_url))
    if fallback_url and not settings.database_prefer_fallback:
        candidate_urls.append(("fallback", fallback_url))

    last_error: Exception | None = None
    for label, database_url in candidate_urls:
        if not database_url:
            continue
        engine = _build_engine(database_url)
        try:
            _probe_engine(engine)
            if label == "fallback":
                logger.warning(
                    "database_fallback_selected",
                    extra={"event_type": "database_fallback_selected", "database_target": label},
                )
            engine.dispose()
            return database_url
        except SQLAlchemyError as exc:
            engine.dispose()
            last_error = exc
            logger.warning(
                "database_connection_probe_failed",
                extra={
                    "event_type": "database_connection_probe_failed",
                    "database_target": label,
                    "error": str(exc),
                },
            )
            continue

    if last_error is not None:
        raise last_error
    return settings.database_url


engine = _build_engine(_resolve_database_url())
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, class_=Session, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
