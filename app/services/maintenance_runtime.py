from __future__ import annotations

import asyncio
import logging

from app.db.session import SessionLocal
from app.services.media import MediaConfigurationError, cleanup_expired_media_uploads, ensure_s3_lifecycle_policy
from app.services.mfa import cleanup_expired_mfa_challenges
from app.utils.config import get_settings


logger = logging.getLogger("aventaro.maintenance")
_lifecycle_policy_checked = False


def run_maintenance_sweep() -> dict[str, int]:
    global _lifecycle_policy_checked
    lifecycle_configured = 0
    try:
        if not _lifecycle_policy_checked and ensure_s3_lifecycle_policy():
            lifecycle_configured = 1
            _lifecycle_policy_checked = True
    except MediaConfigurationError as exc:
        logger.warning(
            "media_lifecycle_policy_skipped",
            extra={"event_type": "media_lifecycle_policy_skipped", "error": str(exc)},
        )
    with SessionLocal() as db:
        expired_mfa = cleanup_expired_mfa_challenges(db)
    with SessionLocal() as db:
        media_result = cleanup_expired_media_uploads(db)
    result = {
        "expired_mfa": expired_mfa,
        "expired_uploads": media_result["expired"],
        "orphaned_uploads": media_result["orphaned"],
        "media_lifecycle_configured": lifecycle_configured,
    }
    if any(result.values()):
        logger.info("maintenance_sweep_completed", extra={"event_type": "maintenance_sweep_completed", **result})
    return result


class MaintenanceWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(), name="aventaro-maintenance")

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
        interval_seconds = get_settings().maintenance_job_interval_seconds
        while True:
            try:
                await asyncio.to_thread(run_maintenance_sweep)
                await asyncio.sleep(interval_seconds)
            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("maintenance_worker_iteration_failed")
                await asyncio.sleep(min(interval_seconds, 30))


maintenance_worker = MaintenanceWorker()
