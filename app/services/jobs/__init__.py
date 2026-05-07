"""Background job system for Aventaro.

Uses Redis + RQ for async job processing.
Jobs should be enqueued from API endpoints rather than processing synchronously.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from enum import Enum
from typing import Any, Callable

from redis import Redis
from rq import Queue
from rq.job import Job

try:
    from rq import Retry
except ImportError:  # pragma: no cover - compatibility with older RQ packaging
    from rq.retry import Retry

from app.utils.config import get_settings


logger = logging.getLogger("aventaro.jobs")

# Default retry configuration
DEFAULT_MAX_RETRIES = 3
DEFAULT_RETRY_INTERVAL = 60  # seconds


class JobPriority(str, Enum):
    """Job priority levels."""
    HIGH = "high"
    DEFAULT = "default"
    LOW = "low"


def get_job_queue(priority: JobPriority = JobPriority.DEFAULT) -> Queue:
    """Get Redis RQ queue for job processing."""
    settings = get_settings()
    redis_conn = Redis.from_url(settings.redis_url, decode_responses=True)
    return Queue(priority.value, connection=redis_conn)


def enqueue_job(
    job_func: Callable,
    *args: Any,
    priority: JobPriority = JobPriority.DEFAULT,
    max_retries: int = DEFAULT_MAX_RETRIES,
    retry_interval: int = DEFAULT_RETRY_INTERVAL,
    **kwargs: Any,
) -> str:
    """Enqueue a job for background processing with retry support.
    
    Args:
        job_func: The function to execute
        *args: Positional arguments for the job
        priority: Job priority (high, default, low)
        max_retries: Maximum number of retry attempts on failure
        retry_interval: Seconds between retry attempts
        **kwargs: Keyword arguments for the job
    
    Returns:
        Job ID
    """
    queue = get_job_queue(priority)
    
    # Configure retry strategy
    retry = Retry(max_retries, interval=retry_interval) if max_retries > 0 else None
    
    job = queue.enqueue(job_func, *args, retry=retry, **kwargs)
    logger.info(
        "job_enqueued",
        extra={
            "event_type": "job_enqueued",
            "job_id": job.id,
            "job_func": job_func.__name__,
            "priority": priority.value,
            "max_retries": max_retries,
        },
    )
    return job.id


def enqueue_job_with_delay(
    job_func: Callable,
    delay_seconds: int,
    *args: Any,
    priority: JobPriority = JobPriority.DEFAULT,
    max_retries: int = DEFAULT_MAX_RETRIES,
    retry_interval: int = DEFAULT_RETRY_INTERVAL,
    **kwargs: Any,
) -> str:
    """Enqueue a job to run after a delay with retry support.
    
    Args:
        job_func: The function to execute
        delay_seconds: Seconds to wait before executing
        *args: Positional arguments for the job
        priority: Job priority
        max_retries: Maximum number of retry attempts on failure
        retry_interval: Seconds between retry attempts
        **kwargs: Keyword arguments for the job
    
    Returns:
        Job ID
    """
    queue = get_job_queue(priority)
    
    # Configure retry strategy
    retry = Retry(max_retries, interval=retry_interval) if max_retries > 0 else None
    
    job = queue.enqueue_in(timedelta(seconds=delay_seconds), job_func, *args, retry=retry, **kwargs)
    logger.info(
        "job_enqueued_delayed",
        extra={
            "event_type": "job_enqueued_delayed",
            "job_id": job.id,
            "job_func": job_func.__name__,
            "delay_seconds": delay_seconds,
            "priority": priority.value,
            "max_retries": max_retries,
        },
    )
    return job.id
