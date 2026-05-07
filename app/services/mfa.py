from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from uuid import uuid4

import httpx
from fastapi import HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.security import MfaChallenge
from app.models.user import User
from app.services.external_retry import http_request_with_retries
from app.services.security import record_security_event, utcnow
from app.services.auth import ensure_aware_utc
from app.utils.config import get_settings


def _hash_otp(code: str, challenge_id: str) -> str:
    settings = get_settings()
    material = f"{challenge_id}:{code}:{settings.jwt_secret}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _normalize_channel(channel: str | None) -> str:
    normalized = (channel or "email").strip().lower()
    if normalized not in {"email", "sms"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported MFA channel")
    return normalized


def _resolve_destination(user: User, channel: str, destination: str | None = None) -> str:
    if destination and destination.strip():
        return destination.strip()
    if channel == "email":
        return user.email
    if user.phone_number:
        return user.phone_number
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phone number is required for SMS MFA")


def _send_email_otp(destination: str, code: str) -> None:
    settings = get_settings()
    if not settings.sendgrid_api_key or not settings.sendgrid_from_email:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="SendGrid is not configured")
    payload = {
        "personalizations": [{"to": [{"email": destination}]}],
        "from": {"email": settings.sendgrid_from_email},
        "subject": "Your Aventaro verification code",
        "content": [{"type": "text/plain", "value": f"Your Aventaro verification code is {code}. It expires in 5 minutes."}],
    }
    try:
        with httpx.Client(timeout=5.0) as client:
            response = http_request_with_retries(
                client,
                "POST",
                "https://api.sendgrid.com/v3/mail/send",
                headers={"Authorization": f"Bearer {settings.sendgrid_api_key}", "Content-Type": "application/json"},
                json=payload,
            )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to send verification email") from exc
    if response.status_code not in {200, 202}:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to send verification email")


def _send_sms_otp(destination: str, code: str) -> None:
    settings = get_settings()
    if not settings.msg91_auth_key or not settings.msg91_template_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="MSG91 is not configured")
    payload = {
        "template_id": settings.msg91_template_id,
        "short_url": "0",
        "recipients": [{"mobiles": destination, "otp": code}],
    }
    if settings.msg91_sender_id:
        payload["sender"] = settings.msg91_sender_id
    try:
        with httpx.Client(timeout=5.0) as client:
            response = http_request_with_retries(
                client,
                "POST",
                "https://control.msg91.com/api/v5/flow/",
                headers={"authkey": settings.msg91_auth_key, "Content-Type": "application/json"},
                json=payload,
            )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to send verification SMS") from exc
    if response.status_code >= 300:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to send verification SMS")


def create_mfa_challenge(
    db: Session,
    *,
    user: User,
    purpose: str,
    channel: str | None,
    destination: str | None = None,
    request: Request | None = None,
    commit: bool = True,
) -> MfaChallenge:
    settings = get_settings()
    resolved_channel = _normalize_channel(channel or user.mfa_channel or "email")
    resolved_destination = _resolve_destination(user, resolved_channel, destination)
    code = _generate_otp()
    challenge_id = uuid4().hex
    challenge = MfaChallenge(
        challenge_id=challenge_id,
        user_id=user.id,
        purpose=purpose,
        channel=resolved_channel,
        destination=resolved_destination,
        otp_hash=_hash_otp(code, challenge_id),
        max_attempts=settings.otp_max_attempts,
        expires_at=utcnow() + timedelta(seconds=settings.otp_ttl_seconds),
    )
    db.add(challenge)
    record_security_event(
        db,
        event_type="mfa_challenge_created",
        user_id=user.id,
        request=request,
        details={"purpose": purpose, "channel": resolved_channel},
    )
    db.flush()
    if resolved_channel == "email":
        _send_email_otp(resolved_destination, code)
    else:
        _send_sms_otp(resolved_destination, code)
    if commit:
        db.commit()
        db.refresh(challenge)
    return challenge


def verify_mfa_challenge(
    db: Session,
    *,
    challenge_id: str,
    code: str,
    purpose: str,
    request: Request | None = None,
    commit: bool = True,
) -> MfaChallenge:
    challenge = db.scalar(
        select(MfaChallenge)
        .where(MfaChallenge.challenge_id == challenge_id, MfaChallenge.purpose == purpose)
        .with_for_update()
    )
    if challenge is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MFA challenge not found")
    if challenge.consumed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="MFA challenge already used")
    if ensure_aware_utc(challenge.expires_at) <= utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="MFA challenge expired")
    if challenge.attempts >= challenge.max_attempts:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="MFA challenge attempt limit reached")

    challenge.attempts += 1
    if not secrets.compare_digest(challenge.otp_hash, _hash_otp(code.strip(), challenge.challenge_id)):
        record_security_event(
            db,
            event_type="mfa_challenge_failed",
            user_id=challenge.user_id,
            request=request,
            risk_level="medium",
            details={"purpose": purpose, "attempts": challenge.attempts},
        )
        if commit:
            db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid verification code")

    challenge.consumed_at = utcnow()
    record_security_event(
        db,
        event_type="mfa_challenge_verified",
        user_id=challenge.user_id,
        request=request,
        details={"purpose": purpose, "channel": challenge.channel},
    )
    if commit:
        db.commit()
        db.refresh(challenge)
    return challenge


def cleanup_expired_mfa_challenges(db: Session) -> int:
    result = db.execute(
        delete(MfaChallenge).where(
            MfaChallenge.expires_at <= utcnow(),
            MfaChallenge.consumed_at.is_(None),
        )
    )
    db.commit()
    return int(result.rowcount or 0)
