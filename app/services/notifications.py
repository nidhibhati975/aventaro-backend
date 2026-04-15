from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.notifications import Notification


def create_notification(
    db: Session,
    user_id: int,
    notification_type: str,
    message: str,
    *,
    commit: bool = True,
) -> Notification:
    notification = Notification(user_id=user_id, type=notification_type, message=message)
    db.add(notification)
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
