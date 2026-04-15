from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }

        for field in (
            "request_id",
            "user_id",
            "endpoint",
            "method",
            "status_code",
            "duration_ms",
            "event_type",
            "notification_id",
            "payment_id",
            "conversation_id",
            "ai_operation",
            "model",
            "cache_hit",
            "fallback_used",
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
        ):
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


def configure_logging() -> None:
    if getattr(configure_logging, "_configured", False):
        return

    root_logger = logging.getLogger()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.INFO)

    configure_logging._configured = True
