"""Notification dispatch job.

Handles batched notification delivery with retry logic.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.models.notifications import Notification, NotificationStatus
from app.services.push_notifications import send_notification_record_push


logger = logging.getLogger("aventaro.notification_jobs")

# Retry configuration
MAX_RETRIES = 3
RETRY_DELAYS = [60, 300, 900]  # 1min, 5min, 15min


def dispatch_notification(
    db_session_factory: Any,
    notification_id: int,
    retry_count: int = 0,
) -> dict[str, Any]:
    """Dispatch a single notification.
    
    Args:
        db_session_factory: Callable that returns a DB session
        notification_id: Notification ID to dispatch
        retry_count: Current retry attempt
    
    Returns:
        Dict with results
    """
    with db_session_factory() as db:
        notification = db.get(Notification, notification_id)
        if not notification:
            return {"status": "not_found", "notification_id": notification_id}

        result = send_notification_record_push(db, notification)
        status_value = "sent" if result.get("success_count", 0) > 0 else "failed"

        logger.info(
            "notification_dispatched",
            extra={
                "event_type": "notification_dispatch",
                "notification_id": notification_id,
                "user_id": notification.user_id,
                "status": status_value,
            },
        )

        return {
            "notification_id": notification_id,
            "status": status_value,
            "result": result,
        }


def dispatch_batched_notifications(
    db_session_factory: Any,
    batch_size: int = 50,
) -> dict[str, Any]:
    """Dispatch pending notifications in batches.
    
    Args:
        db_session_factory: Callable that returns a DB session
        batch_size: Number of notifications to process
    
    Returns:
        Dict with results
    """
    with db_session_factory() as db:
        pending = db.scalars(
            select(Notification)
            .where(Notification.status == NotificationStatus.pending)
            .order_by(Notification.priority.desc(), Notification.created_at)
            .limit(batch_size)
        ).all()
        
        sent_count = 0
        failed_count = 0

        for notification in pending:
            try:
                result = send_notification_record_push(db, notification)
                if result.get("success_count", 0) > 0:
                    sent_count += 1
                else:
                    failed_count += 1
            except Exception as e:
                logger.error(
                    "notification_dispatch_failed",
                    extra={
                        "event_type": "notification_dispatch_failed",
                        "notification_id": notification.id,
                        "error": str(e),
                    },
                )
                failed_count += 1

        logger.info(
            "notification_batch_completed",
            extra={
                "event_type": "notification_batch",
                "sent": sent_count,
                "failed": failed_count,
            },
        )
        
        return {
            "sent": sent_count,
            "failed": failed_count,
            "status": "completed",
        }


def retry_failed_notifications(
    db_session_factory: Any,
    max_age_hours: int = 24,
) -> dict[str, Any]:
    """Retry failed notifications that haven't exceeded max retries.
    
    Args:
        db_session_factory: Callable that returns a DB session
        max_age_hours: Only retry notifications younger than this
    
    Returns:
        Dict with results
    """
    with db_session_factory() as db:
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
        
        failed = db.scalars(
            select(Notification)
            .where(
                Notification.status == NotificationStatus.failed,
                Notification.created_at >= cutoff,
                Notification.retry_count < MAX_RETRIES,
            )
            .limit(100)
        ).all()
        
        retried_count = 0
        for notification in failed:
            notification.status = NotificationStatus.pending
            notification.retry_count += 1
            retried_count += 1
        
        db.commit()
        
        logger.info(
            "notification_retry_completed",
            extra={
                "event_type": "notification_retry",
                "retried": retried_count,
            },
        )
        
        return {
            "retried": retried_count,
            "status": "completed",
        }
