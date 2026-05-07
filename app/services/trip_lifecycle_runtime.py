from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import update

from app.db.session import SessionLocal
from app.models.trip import Trip, TripLifecycleStatus
from app.utils.config import get_settings


logger = logging.getLogger(__name__)


def run_trip_lifecycle_sweep() -> tuple[int, int]:
    """Update trip lifecycle statuses based on current date.
    
    Returns:
        Tuple of (planned_to_active_count, active_to_completed_count)
    """
    now = datetime.now(timezone.utc)
    
    with SessionLocal() as db:
        # planned -> active when current_date >= start_date
        planned_to_active_result = db.execute(
            update(Trip)
            .where(
                Trip.lifecycle_status == TripLifecycleStatus.planned,
                Trip.start_date.is_not(None),
                Trip.start_date <= now,
            )
            .values(lifecycle_status=TripLifecycleStatus.active)
        )
        planned_to_active_count = planned_to_active_result.rowcount
        
        # active -> completed when current_date > end_date
        active_to_completed_result = db.execute(
            update(Trip)
            .where(
                Trip.lifecycle_status == TripLifecycleStatus.active,
                Trip.end_date.is_not(None),
                Trip.end_date < now,
            )
            .values(lifecycle_status=TripLifecycleStatus.completed)
        )
        active_to_completed_count = active_to_completed_result.rowcount
        
        db.commit()
    
    if planned_to_active_count or active_to_completed_count:
        logger.info(
            "trip_lifecycle_sweep_completed",
            extra={
                "event_type": "trip_lifecycle_sweep_completed",
                "planned_to_active_count": planned_to_active_count,
                "active_to_completed_count": active_to_completed_count,
            },
        )
    
    return planned_to_active_count, active_to_completed_count


class TripLifecycleWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(), name="aventaro-trip-lifecycle")

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
        interval_seconds = get_settings().trip_lifecycle_job_interval_seconds
        while True:
            try:
                await asyncio.to_thread(run_trip_lifecycle_sweep)
                await asyncio.sleep(interval_seconds)
            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("trip_lifecycle_worker_iteration_failed")
                await asyncio.sleep(min(interval_seconds, 30))


trip_lifecycle_worker = TripLifecycleWorker()
