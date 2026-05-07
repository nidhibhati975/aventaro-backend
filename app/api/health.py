from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

from app.services.health import check_database_health, check_redis_health, get_runtime_health


router = APIRouter(tags=["health"])


def _run_healthcheck(check, message: str) -> None:
    try:
        check()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=message) from exc


@router.get("/health")
def healthcheck() -> JSONResponse:
    runtime_health = get_runtime_health()
    status_code = status.HTTP_200_OK if runtime_health["status"] == "ok" else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=status_code, content=runtime_health)


@router.get("/health/live")
def liveness_check() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
def readiness_check() -> JSONResponse:
    runtime_health = get_runtime_health()
    status_code = status.HTTP_200_OK if runtime_health["status"] == "ok" else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=status_code, content=runtime_health)


@router.get("/health/db")
def healthcheck_database() -> dict[str, str]:
    _run_healthcheck(check_database_health, "Database is not reachable")
    return {"status": "ok", "database": "ok"}


@router.get("/health/redis")
def healthcheck_redis() -> dict[str, str]:
    _run_healthcheck(check_redis_health, "Redis is not reachable")
    return {"status": "ok", "redis": "ok"}
