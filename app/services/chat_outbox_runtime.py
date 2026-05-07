from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from redis.exceptions import RedisError
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.realtime import ChatOutboxEvent, MessageDelivery
from app.services.redis_runtime import get_redis_client
from app.utils.config import get_settings


logger = logging.getLogger("aventaro.chat_outbox")
MAX_ATTEMPTS = 10
BATCH_SIZE = 50


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def publish_pending_chat_outbox_events() -> int:
    settings = get_settings()
    redis = get_redis_client()
    published = 0
    with SessionLocal() as db:
        events = db.scalars(
            select(ChatOutboxEvent)
            .where(ChatOutboxEvent.status.in_(("pending", "retry")))
            .order_by(ChatOutboxEvent.created_at.asc())
            .limit(BATCH_SIZE)
        ).all()
        for event in events:
            event.attempts += 1
            try:
                stream_id = redis.xadd(
                    settings.redis_stream_chat_events,
                    {
                        "event_id": event.event_id,
                        "event": json.dumps(event.payload, separators=(",", ":"), default=str),
                    },
                    maxlen=100_000,
                    approximate=True,
                )
            except RedisError as exc:
                event.status = "failed" if event.attempts >= MAX_ATTEMPTS else "retry"
                event.last_error = str(exc)[:1000]
                continue
            event.status = "published"
            event.redis_stream_id = stream_id
            event.published_at = _utcnow()
            event.last_error = None
            if event.message_id is not None:
                deliveries = db.scalars(select(MessageDelivery).where(MessageDelivery.message_id == event.message_id)).all()
                for delivery in deliveries:
                    delivery.redis_stream_id = stream_id
                    if delivery.status == "pending":
                        delivery.status = "streamed"
            published += 1
        db.commit()
    if published:
        logger.info("chat_outbox_published", extra={"event_type": "chat_outbox_published", "published": published})
    return published


class ChatOutboxWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(), name="aventaro-chat-outbox")

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
                await asyncio.to_thread(publish_pending_chat_outbox_events)
                await asyncio.sleep(2)
            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("chat_outbox_worker_iteration_failed")
                await asyncio.sleep(5)


chat_outbox_worker = ChatOutboxWorker()
