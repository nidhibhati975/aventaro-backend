from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from fastapi import HTTPException, status

from app.utils.config import get_settings


def _parse_signature_pairs(header_value: str) -> dict[str, str]:
    pairs: dict[str, str] = {}
    for chunk in header_value.split(","):
        key, sep, value = chunk.partition("=")
        if sep and key and value:
            pairs[key.strip()] = value.strip()
    return pairs


def verify_duffel_signature(payload: bytes, signature_header: str | None) -> None:
    settings = get_settings()
    if not settings.duffel_webhook_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Duffel webhook secret not configured")
    if not signature_header:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Duffel signature header")
    pairs = _parse_signature_pairs(signature_header)
    timestamp = pairs.get("t")
    signature = pairs.get("v1")
    if not timestamp or not signature:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Duffel signature header")
    try:
        signed_at = int(timestamp)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Duffel signature timestamp") from exc
    if abs(int(time.time()) - signed_at) > settings.webhook_signature_tolerance_seconds:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duffel webhook signature expired")

    signed_payload = timestamp.encode("utf-8") + b"." + payload
    digest = hmac.new(settings.duffel_webhook_secret.encode("utf-8"), signed_payload, hashlib.sha256).digest()
    expected_hex = digest.hex()
    expected_b64 = base64.b64encode(digest).decode("utf-8")
    if not (
        hmac.compare_digest(expected_hex, signature.lower())
        or hmac.compare_digest(expected_b64, signature)
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Duffel webhook signature")


def verify_razorpay_webhook_signature(payload: bytes, signature_header: str | None) -> None:
    settings = get_settings()
    if not settings.razorpay_webhook_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Razorpay webhook secret not configured")
    if not signature_header:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Razorpay signature header")
    expected = hmac.new(settings.razorpay_webhook_secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature_header):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Razorpay webhook signature")


def parse_json_payload(payload: bytes) -> dict[str, Any]:
    try:
        decoded = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook JSON payload") from exc
    if not isinstance(decoded, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook payload")
    return decoded
