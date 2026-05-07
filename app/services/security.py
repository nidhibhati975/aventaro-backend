from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.security import SecurityAuditLog


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", maxsplit=1)[0].strip()[:64]
    if request.client:
        return request.client.host[:64]
    return None


def get_user_agent(request: Request | None) -> str | None:
    if request is None:
        return None
    user_agent = request.headers.get("user-agent")
    return user_agent[:512] if user_agent else None


def record_security_event(
    db: Session,
    *,
    event_type: str,
    user_id: int | None,
    request: Request | None = None,
    risk_level: str = "low",
    details: dict[str, Any] | None = None,
    commit: bool = False,
) -> SecurityAuditLog:
    log = SecurityAuditLog(
        user_id=user_id,
        event_type=event_type,
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request),
        risk_level=risk_level,
        details=details,
    )
    db.add(log)
    if commit:
        db.commit()
        db.refresh(log)
    return log


def detect_login_anomaly(db: Session, *, user_id: int, request: Request | None) -> tuple[str, dict[str, Any]]:
    ip_address = get_client_ip(request)
    user_agent = get_user_agent(request)
    if not ip_address:
        return "low", {"reason": "missing_ip_context"}

    recent_success = db.scalar(
        select(SecurityAuditLog)
        .where(
            SecurityAuditLog.user_id == user_id,
            SecurityAuditLog.event_type == "auth_login_success",
            SecurityAuditLog.ip_address == ip_address,
        )
        .order_by(SecurityAuditLog.created_at.desc())
        .limit(1)
    )
    if recent_success is None:
        return "medium", {"reason": "new_ip_address", "ip_address": ip_address, "user_agent": user_agent}
    return "low", {"reason": "known_ip_address"}

