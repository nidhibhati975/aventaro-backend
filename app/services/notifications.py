from __future__ import annotations

import logging
import threading

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.notifications import Notification


# Notification entity type constants
NOTIFICATION_ENTITY_TYPE_MATCH = "match"
NOTIFICATION_ENTITY_TYPE_TRIP = "trip"
NOTIFICATION_ENTITY_TYPE_USER = "user"
NOTIFICATION_ENTITY_TYPE_POST = "post"
NOTIFICATION_ENTITY_TYPE_BOOKING = "booking"
NOTIFICATION_ENTITY_TYPE_VERIFICATION = "verification"
NOTIFICATION_ENTITY_TYPE_PAYMENT = "payment"
NOTIFICATION_ENTITY_TYPE_MESSAGE = "message"


logger = logging.getLogger("aventaro.notifications")
_PENDING_NOTIFICATION_IDS_KEY = "pending_notification_ids"


def _build_deep_link(entity_type: str | None, entity_id: int | None) -> str | None:
    if entity_id is None or not entity_type:
        return None
    normalized = entity_type.strip().lower()
    if normalized == NOTIFICATION_ENTITY_TYPE_MATCH:
        return f"aventaro://matches/{entity_id}"
    if normalized == NOTIFICATION_ENTITY_TYPE_TRIP:
        return f"aventaro://trips/{entity_id}"
    if normalized == NOTIFICATION_ENTITY_TYPE_USER:
        return f"aventaro://users/{entity_id}"
    if normalized == NOTIFICATION_ENTITY_TYPE_POST:
        return f"aventaro://posts/{entity_id}"
    if normalized == NOTIFICATION_ENTITY_TYPE_BOOKING:
        return f"aventaro://bookings/{entity_id}"
    if normalized == NOTIFICATION_ENTITY_TYPE_VERIFICATION:
        return f"aventaro://verification/{entity_id}"
    if normalized == NOTIFICATION_ENTITY_TYPE_PAYMENT:
        return f"aventaro://payments/{entity_id}"
    if normalized == NOTIFICATION_ENTITY_TYPE_MESSAGE:
        return f"aventaro://messages/{entity_id}"
    return None


def _enum_value(value: object) -> object:
    return getattr(value, "value", value)


def _notification_event_payload(notification: Notification) -> dict[str, object]:
    return {
        "id": notification.id,
        "type": notification.type,
        "message": notification.message,
        "entity_id": notification.entity_id,
        "entity_type": notification.entity_type,
        "is_read": notification.is_read,
        "status": _enum_value(notification.status),
        "priority": _enum_value(notification.priority),
        "deep_link": notification.deep_link,
        "created_at": notification.created_at.isoformat(),
    }


def _publish_notification_created(notification: Notification) -> None:
    try:
        from app.services.chat_realtime import chat_connection_manager

        chat_connection_manager.publish_to_users(
            [notification.user_id],
            {
                "type": "notification.created",
                "data": _notification_event_payload(notification),
            },
        )
    except Exception:
        logger.exception("notification_realtime_publish_failed", extra={"notification_id": notification.id})


def _queue_notification_dispatch(db: Session, notification: Notification) -> None:
    pending_ids = db.info.setdefault(_PENDING_NOTIFICATION_IDS_KEY, set())
    pending_ids.add(notification.id)


def _dispatch_notification_side_effects(notification_ids: list[int]) -> None:
    from app.services.push_notifications import send_notification_record_push

    with SessionLocal() as db:
        notifications = db.scalars(
            select(Notification)
            .where(Notification.id.in_(notification_ids))
            .order_by(Notification.id.asc())
        ).all()
        for notification in notifications:
            _publish_notification_created(notification)
            try:
                send_notification_record_push(db, notification)
            except Exception:
                logger.exception(
                    "notification_push_dispatch_failed",
                    extra={"notification_id": notification.id, "user_id": notification.user_id},
                )


@event.listens_for(Session, "after_commit")
def _after_notification_commit(session: Session) -> None:
    notification_ids = sorted(int(item) for item in session.info.pop(_PENDING_NOTIFICATION_IDS_KEY, set()))
    if not notification_ids:
        return

    dispatch_thread = threading.Thread(
        target=_dispatch_notification_side_effects,
        args=(notification_ids,),
        name="aventaro-notification-dispatch",
        daemon=True,
    )
    dispatch_thread.start()


@event.listens_for(Session, "after_rollback")
def _after_notification_rollback(session: Session) -> None:
    session.info.pop(_PENDING_NOTIFICATION_IDS_KEY, None)


def create_notification(
    db: Session,
    user_id: int,
    notification_type: str,
    message: str,
    entity_id: int | None = None,
    entity_type: str | None = None,
    deep_link: str | None = None,
    commit: bool = True,
) -> Notification:
    notification = Notification(
        user_id=user_id,
        type=notification_type,
        message=message,
        entity_id=entity_id,
        entity_type=entity_type,
        deep_link=deep_link or _build_deep_link(entity_type, entity_id),
    )
    db.add(notification)
    db.flush()
    _queue_notification_dispatch(db, notification)
    if commit:
        db.commit()
        db.refresh(notification)
    return notification


def list_notifications(db: Session, user_id: int) -> list[Notification]:
    return db.scalars(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
    ).all()


def mark_notifications_read(db: Session, user_id: int, notification_ids: list[int]) -> list[Notification]:
    notifications = db.scalars(
        select(Notification)
        .where(Notification.user_id == user_id, Notification.id.in_(notification_ids))
    ).all()
    if not notifications:
        return []
    for notification in notifications:
        notification.is_read = True
    db.commit()
    return notifications
