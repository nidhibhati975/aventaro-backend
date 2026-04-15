from __future__ import annotations

import asyncio
import logging

from app.db.session import SessionLocal
from app.services.subscriptions import expire_due_subscriptions
from app.utils.config import get_settings


logger = logging.getLogger(__name__)


def run_subscription_expiry_sweep() -> int:
    with SessionLocal() as db:
        expired_count = expire_due_subscriptions(db)
    if expired_count:
        logger.info(
            "subscription_expiry_sweep_completed",
            extra={
                "event_type": "subscription_expiry_sweep_completed",
                "expired_count": expired_count,
            },
        )
    return expired_count


class SubscriptionExpiryWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(), name="aventaro-subscription-expiry")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _run(self) -> None:
        interval_seconds = get_settings().subscription_expiry_job_interval_seconds
        try:
            while True:
                await asyncio.to_thread(run_subscription_expiry_sweep)
                await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            return


subscription_expiry_worker = SubscriptionExpiryWorker()
