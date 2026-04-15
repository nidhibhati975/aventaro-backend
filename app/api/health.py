from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.services.health import check_database_health, check_redis_health


router = APIRouter(tags=["health"])


def _run_healthcheck(check, message: str) -> None:
    try:
        check()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=message) from exc


@router.get("/health")
def healthcheck() -> dict[str, object]:
    _run_healthcheck(check_database_health, "Database is not reachable")
    _run_healthcheck(check_redis_health, "Redis is not reachable")
    return {
        "status": "ok",
        "services": {
            "db": "ok",
            "redis": "ok",
        },
    }


@router.get("/health/db")
def healthcheck_database() -> dict[str, str]:
    _run_healthcheck(check_database_health, "Database is not reachable")
    return {"status": "ok", "database": "ok"}


@router.get("/health/redis")
def healthcheck_redis() -> dict[str, str]:
    _run_healthcheck(check_redis_health, "Redis is not reachable")
    return {"status": "ok", "redis": "ok"}
