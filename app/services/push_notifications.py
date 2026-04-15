from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.notifications import PushDevice
from app.utils.config import get_settings


logger = logging.getLogger(__name__)
INVALID_TOKEN_ERRORS = {"InvalidRegistration", "NotRegistered"}


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


def _load_active_devices(db: Session, user_ids: list[int]) -> list[PushDevice]:
    if not user_ids:
        return []
    return db.scalars(
        select(PushDevice).where(
            PushDevice.user_id.in_(user_ids),
            PushDevice.is_active.is_(True),
        )
    ).all()


def send_push_notification(
    db: Session,
    *,
    user_ids: list[int],
    title: str,
    body: str,
    data: dict[str, object],
) -> None:
    settings = get_settings()
    if not settings.fcm_server_key:
        return

    devices = _load_active_devices(db, user_ids)
    if not devices:
        return

    headers = {
        "Authorization": f"key={settings.fcm_server_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=settings.fcm_request_timeout_seconds) as client:
        for device in devices:
            try:
                response = client.post(
                    "https://fcm.googleapis.com/fcm/send",
                    headers=headers,
                    json={
                        "to": device.token,
                        "priority": "high",
                        "notification": {"title": title, "body": body},
                        "data": data,
                    },
                )
                payload = response.json()
            except Exception as exc:
                logger.warning("fcm_delivery_failed", extra={"user_id": device.user_id, "device_id": device.id, "error": str(exc)})
                continue

            if response.is_success:
                results = payload.get("results") or []
                if results:
                    error = results[0].get("error")
                    if error in INVALID_TOKEN_ERRORS:
                        device.is_active = False
                        device.last_seen_at = _utcnow()
                continue

            logger.warning(
                "fcm_delivery_failed",
                extra={
                    "user_id": device.user_id,
                    "device_id": device.id,
                    "status_code": response.status_code,
                    "response": payload,
                },
            )

    db.commit()
