from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import SessionLocal
from app.models.ai import AIJob, AIUsageLog
from app.models.user import User
from app.services.ai.budget_engine import BudgetOptimizeRequest, optimize_budget
from app.services.ai.trip_planner import TripPlanRequest, plan_trip
from app.services.chat import AIChatRequest, generate_concierge_reply
from app.services.profile import ProfileGenerateRequest, generate_profile_content
from app.services.redis_runtime import build_cache_key, get_cache
from app.utils.config import get_settings


logger = logging.getLogger("aventaro.ai_pipeline")
BATCH_SIZE = 10


class AIJobQueuedResponse(BaseModel):
    job_id: str
    status: str


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def enqueue_ai_job(
    *,
    user_id: int,
    operation: str,
    request_payload: dict,
) -> str:
    cache_key = build_cache_key(f"ai-job:{operation}", user_id=user_id, payload=request_payload)
    cached = get_cache().get_json(cache_key)
    with SessionLocal() as db:
        existing = db.scalar(
            select(AIJob).where(AIJob.user_id == user_id, AIJob.operation == operation, AIJob.cache_key == cache_key)
        )
        if existing is not None and existing.status in {"queued", "running", "completed"}:
            return existing.job_id
        job = AIJob(
            job_id=uuid4().hex,
            user_id=user_id,
            operation=operation,
            status="completed" if cached is not None else "queued",
            request_payload=request_payload,
            response_payload=cached,
            cache_key=cache_key,
            max_attempts=get_settings().ai_job_max_attempts,
            next_run_at=_utcnow() if cached is None else None,
            completed_at=_utcnow() if cached is not None else None,
        )
        db.add(job)
        db.commit()
        return job.job_id


def get_ai_job(job_id: str, user_id: int) -> AIJob | None:
    with SessionLocal() as db:
        return db.scalar(select(AIJob).where(AIJob.job_id == job_id, AIJob.user_id == user_id))


def _record_usage(
    db,
    *,
    job: AIJob,
    cache_hit: bool,
    fallback_used: bool = False,
    usage: dict | None = None,
) -> None:
    usage = usage or {}
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or prompt_tokens + completion_tokens)
    db.add(
        AIUsageLog(
            user_id=job.user_id,
            job_id=job.job_id,
            operation=job.operation,
            model=str(usage.get("model") or get_settings().model_name),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cache_hit=cache_hit,
            fallback_used=fallback_used or bool(usage.get("fallback_used")),
            usage_metadata={"worker": "ai_pipeline", "attempts": job.attempts},
        )
    )


def _execute_ai_job(db, job: AIJob) -> tuple[dict, dict]:
    usage_collector: dict[str, object] = {
        "model": get_settings().model_name,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "fallback_used": False,
    }
    context = {
        "user_id": job.user_id,
        "ai_operation": job.operation,
        "job_id": job.job_id,
        "endpoint": "worker",
        "usage_collector": usage_collector,
    }
    if job.operation == "trip_plan":
        response = plan_trip(TripPlanRequest.model_validate(job.request_payload), request_context=context)
    elif job.operation == "budget_optimize":
        response = optimize_budget(BudgetOptimizeRequest.model_validate(job.request_payload), request_context=context)
    elif job.operation == "profile_generate":
        user = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == job.user_id))
        if user is None:
            raise LookupError("User not found")
        response = generate_profile_content(
            current_user=user,
            payload=ProfileGenerateRequest.model_validate(job.request_payload),
            request_context=context,
        )
    elif job.operation == "concierge_chat":
        user = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == job.user_id))
        if user is None:
            raise LookupError("User not found")
        response = generate_concierge_reply(
            db=db,
            current_user=user,
            payload=AIChatRequest.model_validate(job.request_payload),
            request_context=context,
        )
    else:
        raise ValueError("Unsupported AI operation")
    return response.model_dump(mode="json"), usage_collector


def process_pending_ai_jobs() -> int:
    processed = 0
    settings = get_settings()
    with SessionLocal() as db:
        stale_cutoff = _utcnow() - timedelta(minutes=10)
        stale_jobs = db.scalars(
            select(AIJob)
            .where(AIJob.status == "running", AIJob.locked_at.is_not(None), AIJob.locked_at < stale_cutoff)
            .limit(BATCH_SIZE)
            .with_for_update(skip_locked=True)
        ).all()
        for stale_job in stale_jobs:
            stale_job.status = "retry" if stale_job.attempts < stale_job.max_attempts else "dead_letter"
            stale_job.next_run_at = _utcnow() + timedelta(seconds=settings.ai_job_retry_base_seconds)
            if stale_job.status == "dead_letter":
                stale_job.dead_lettered_at = _utcnow()
                stale_job.completed_at = _utcnow()
                stale_job.error = stale_job.error or "Worker lost job lock"
        if stale_jobs:
            db.commit()
        jobs = db.scalars(
            select(AIJob)
            .where(
                AIJob.status.in_(("queued", "retry")),
                (AIJob.next_run_at.is_(None)) | (AIJob.next_run_at <= _utcnow()),
            )
            .order_by(AIJob.created_at.asc())
            .limit(BATCH_SIZE)
            .with_for_update(skip_locked=True)
        ).all()
        for job in jobs:
            cached = get_cache().get_json(job.cache_key or "")
            if cached is not None:
                job.status = "completed"
                job.response_payload = cached
                job.completed_at = _utcnow()
                _record_usage(db, job=job, cache_hit=True)
                processed += 1
                continue
            job.status = "running"
            job.attempts += 1
            job.started_at = _utcnow()
            job.locked_at = _utcnow()
            db.commit()
            try:
                response_payload, usage = _execute_ai_job(db, job)
                job.status = "completed"
                job.response_payload = response_payload
                job.completed_at = _utcnow()
                job.locked_at = None
                job.next_run_at = None
                get_cache().set_json(job.cache_key or build_cache_key("ai-job", job_id=job.job_id), response_payload, settings.ai_job_ttl_seconds)
                _record_usage(db, job=job, cache_hit=False, usage=usage)
                processed += 1
            except Exception as exc:
                job.error = str(exc)[:2000]
                job.locked_at = None
                if job.attempts >= job.max_attempts:
                    job.status = "dead_letter"
                    job.dead_lettered_at = _utcnow()
                    job.completed_at = _utcnow()
                    _record_usage(db, job=job, cache_hit=False, fallback_used=True)
                else:
                    job.status = "retry"
                    delay = settings.ai_job_retry_base_seconds * (2 ** max(job.attempts - 1, 0))
                    job.next_run_at = _utcnow() + timedelta(seconds=delay)
                logger.exception("ai_job_failed", extra={"job_id": job.job_id, "operation": job.operation}, exc_info=exc)
            finally:
                db.commit()
    return processed


async def wait_for_ai_job(job_id: str, user_id: int, timeout_seconds: float) -> AIJob | None:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while asyncio.get_running_loop().time() < deadline:
        job = get_ai_job(job_id, user_id)
        if job is not None and job.status in {"completed", "failed", "dead_letter"}:
            return job
        await asyncio.sleep(0.25)
    return get_ai_job(job_id, user_id)


class AIWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(), name="aventaro-ai-worker")

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
        while True:
            try:
                await asyncio.to_thread(process_pending_ai_jobs)
                await asyncio.sleep(0.5)
            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("ai_worker_iteration_failed")
                await asyncio.sleep(5)


ai_worker = AIWorker()
