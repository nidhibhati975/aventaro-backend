from __future__ import annotations

import asyncio
import logging
import signal

from app.services.ai_pipeline import ai_worker
from app.services.chat_outbox_runtime import chat_outbox_worker
from app.services.maintenance_runtime import maintenance_worker
from app.services.payment_reconciliation_runtime import payment_reconciliation_worker
from app.services.subscription_runtime import subscription_expiry_worker
from app.services.trip_lifecycle_runtime import trip_lifecycle_worker
from app.utils.logging import configure_logging


logger = logging.getLogger("aventaro.worker")


async def run_worker() -> None:
    configure_logging()
    stop_event = asyncio.Event()

    def request_stop() -> None:
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
        if sig is None:
            continue
        try:
            loop.add_signal_handler(sig, request_stop)
        except NotImplementedError:
            signal.signal(sig, lambda *_args: request_stop())

    workers = (
        ("chat_outbox_worker", chat_outbox_worker),
        ("ai_worker", ai_worker),
        ("payment_reconciliation_worker", payment_reconciliation_worker),
        ("maintenance_worker", maintenance_worker),
        ("subscription_expiry_worker", subscription_expiry_worker),
        ("trip_lifecycle_worker", trip_lifecycle_worker),
    )
    for name, worker in workers:
        worker.start()
        logger.info("worker_started name=%s", name, extra={"event_type": "worker_started", "component": name})

    await stop_event.wait()

    for name, worker in reversed(workers):
        await worker.stop()
        logger.info("worker_stopped name=%s", name, extra={"event_type": "worker_stopped", "component": name})


def main() -> None:
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
