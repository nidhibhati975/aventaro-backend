from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.notifications import Notification, NotificationStatus, PushDevice
from app.utils.config import get_settings


logger = logging.getLogger(__name__)
INVALID_TOKEN_ERRORS = {"InvalidRegistration", "MismatchSenderId", "NotRegistered"}

# Retry configuration
PUSH_RETRY_MAX_ATTEMPTS = 3
PUSH_RETRY_DELAY_BASE = 1.0  # seconds
PUSH_RETRY_BACKOFF_MULTIPLIER = 2.0


def _retry_on_failure(max_attempts: int = PUSH_RETRY_MAX_ATTEMPTS):
    """Decorator to retry a function on failure with exponential backoff."""
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exception = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as exc:
                    last_exception = exc
                    if attempt < max_attempts:
                        delay = PUSH_RETRY_DELAY_BASE * (PUSH_RETRY_BACKOFF_MULTIPLIER ** (attempt - 1))
                        logger.warning(
                            "push_retry",
                            extra={
                                "attempt": attempt,
                                "max_attempts": max_attempts,
                                "delay_seconds": delay,
                                "error": str(exc),
                            },
                        )
                        time.sleep(delay)
            # All retries exhausted
            logger.error(
                "push_retry_exhausted",
                extra={"attempts": max_attempts, "error": str(last_exception)},
            )
            raise last_exception
        return wrapper
    return decorator


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def register_push_device(db: Session, *, user_id: int, token: str, platform: str) -> PushDevice:
    normalized_token = token.strip()
    normalized_platform = platform.strip().lower()
    device = db.scalar(select(PushDevice).where(PushDevice.token == normalized_token))
    if device is None:
        device = PushDevice(
            user_id=user_id,
            token=normalized_token,
            platform=normalized_platform,
            is_active=True,
            last_seen_at=_utcnow(),
        )
        db.add(device)
    else:
        device.user_id = user_id
        device.platform = normalized_platform
        device.is_active = True
        device.last_seen_at = _utcnow()
    db.commit()
    db.refresh(device)
    return device


def unregister_push_device(db: Session, *, user_id: int, token: str) -> PushDevice | None:
    normalized_token = token.strip()
    device = db.scalar(
        select(PushDevice).where(
            PushDevice.user_id == user_id,
            PushDevice.token == normalized_token,
            PushDevice.is_active.is_(True),
        )
    )
    if device is None:
        return None

    device.is_active = False
    device.last_seen_at = _utcnow()
    db.commit()
    db.refresh(device)
    return device


def _load_active_devices(db: Session, user_ids: list[int]) -> list[PushDevice]:
    if not user_ids:
        return []
    return db.scalars(
        select(PushDevice).where(
            PushDevice.user_id.in_(user_ids),
            PushDevice.is_active.is_(True),
        )
    ).all()


def build_push_title(notification_type: str | None) -> str:
    normalized = (notification_type or "").strip().lower()
    if normalized in {"chat", "chat_message", "message"}:
        return "New message"
    if normalized in {"match", "match_accept", "match_request"}:
        return "Match update"
    if normalized in {"trip", "trip_approval", "trip_invite", "trip_join", "trip_reminder", "trip_update"}:
        return "Trip update"
    if normalized in {"booking"}:
        return "Booking update"
    if normalized in {"payment", "payment_success"}:
        return "Payment update"
    if normalized in {"profile", "new_follower", "social"}:
        return "Profile update"
    if normalized in {"verification"}:
        return "Verification update"
    return "Aventaro"


def _stringify_fcm_value(value: object | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def normalize_push_data(data: dict[str, object] | None) -> dict[str, str]:
    if not data:
        return {}
    return {
        str(key): _stringify_fcm_value(value)
        for key, value in data.items()
        if value is not None
    }


def _send_single_push(
    client: httpx.Client,
    headers: dict[str, str],
    device: PushDevice,
    title: str,
    body: str,
    data: dict[str, object],
) -> tuple[bool, str | None]:
    """Send push to a single device. Returns (success, error_message)."""
    try:
        response = client.post(
            "https://fcm.googleapis.com/fcm/send",
            headers=headers,
            json={
                "to": device.token,
                "priority": "high",
                "notification": {"title": title, "body": body},
                "data": normalize_push_data(data),
                "content_available": True,
                "mutable_content": True,
            },
        )
        payload = response.json()
    except Exception as exc:
        return False, str(exc)

    if response.is_success:
        results = payload.get("results") or []
        if results:
            error = results[0].get("error")
            if error in INVALID_TOKEN_ERRORS:
                return False, f"invalid_token:{error}"
            return True, None
    return False, f"http_error:{response.status_code}"


@_retry_on_failure(max_attempts=PUSH_RETRY_MAX_ATTEMPTS)
def send_push_notification(
    db: Session,
    *,
    user_ids: list[int],
    title: str,
    body: str,
    data: dict[str, object],
) -> dict[str, Any]:
    """Send push notification to users with retry logic.
    
    Returns:
        Dict with success_count, failure_count, and errors list
    """
    settings = get_settings()
    if not settings.fcm_server_key:
        return {"success_count": 0, "failure_count": 0, "errors": ["FCM not configured"]}

    devices = _load_active_devices(db, user_ids)
    if not devices:
        return {"success_count": 0, "failure_count": 0, "errors": ["No active devices"]}

    headers = {
        "Authorization": f"key={settings.fcm_server_key}",
        "Content-Type": "application/json",
    }

    success_count = 0
    failure_count = 0
    errors: list[str] = []

    with httpx.Client(timeout=settings.fcm_request_timeout_seconds) as client:
        for device in devices:
            success, error = _send_single_push(client, headers, device, title, body, data)
            if success:
                success_count += 1
            else:
                failure_count += 1
                if error and error.startswith("invalid_token:"):
                    device.is_active = False
                    device.last_seen_at = _utcnow()
                    errors.append(f"device_{device.id}: invalid_token")
                else:
                    errors.append(f"device_{device.id}: {error}")
                    logger.warning(
                        "fcm_delivery_failed",
                        extra={"user_id": device.user_id, "device_id": device.id, "error": error},
                    )

    db.commit()
    return {"success_count": success_count, "failure_count": failure_count, "errors": errors}


def send_notification_record_push(
    db: Session,
    notification: Notification,
    *,
    data: dict[str, object] | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    payload = {
        "notification_id": notification.id,
        "type": notification.type,
        "entity_id": notification.entity_id,
        "entity_type": notification.entity_type,
        "deep_link": notification.deep_link,
    }
    if data:
        payload.update(data)

    result = send_push_notification(
        db,
        user_ids=[notification.user_id],
        title=title or build_push_title(notification.type),
        body=notification.message,
        data=payload,
    )

    notification.status = (
        NotificationStatus.sent
        if result.get("success_count", 0) > 0
        else NotificationStatus.failed
    )
    notification.sent_at = _utcnow() if notification.status == NotificationStatus.sent else None
    db.commit()
    db.refresh(notification)
    return result


# Background job functions for async processing

def _send_push_notification_job(
    user_ids: list[int],
    title: str,
    body: str,
    data: dict[str, object],
) -> dict[str, Any]:
    """Background job to send push notifications asynchronously.
    
    This runs asynchronously to avoid blocking API responses.
    """
    from app.db.session import SessionLocal
    
    db = SessionLocal()
    try:
        return send_push_notification(
            db=db,
            user_ids=user_ids,
            title=title,
            body=body,
            data=data,
        )
    finally:
        db.close()


def enqueue_push_notification(
    user_ids: list[int],
    title: str,
    body: str,
    data: dict[str, object],
    priority: str = "default",
) -> str:
    """Enqueue a background job to send push notifications.
    
    Returns:
        Job ID
    """
    from app.services.jobs import enqueue_job, JobPriority
    
    job_priority = JobPriority(priority) if priority in [p.value for p in JobPriority] else JobPriority.DEFAULT
    return enqueue_job(
        _send_push_notification_job,
        user_ids,
        title,
        body,
        data,
        priority=job_priority,
    )
