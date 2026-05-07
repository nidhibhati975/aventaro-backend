from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.security import AuthSession
from app.models.user import User
from app.services.security import get_client_ip, get_user_agent, record_security_event
from app.utils.config import get_settings


password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def ensure_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def extract_bearer_token(authorization_header: str | None) -> str | None:
    if not authorization_header:
        return None
    scheme, _, value = authorization_header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return password_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return password_context.hash(password)


def create_access_token(
    user: User,
    expires_delta: timedelta | None = None,
    *,
    session_id: int | None = None,
) -> str:
    settings = get_settings()
    expire_at = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.auth_access_token_minutes))
    payload = {"sub": str(user.id), "email": user.email, "type": "access", "exp": expire_at}
    if session_id is not None:
        payload["sid"] = str(session_id)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(
    user: User,
    expires_delta: timedelta | None = None,
    *,
    token_jti: str | None = None,
    device_id: str | None = None,
) -> str:
    settings = get_settings()
    expire_at = datetime.now(timezone.utc) + (expires_delta or timedelta(days=settings.auth_refresh_token_days))
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "type": "refresh",
        "exp": expire_at,
        "jti": token_jti or uuid4().hex,
        "rot": uuid4().hex,
    }
    if device_id:
        payload["device_id"] = device_id
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, str]:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token") from exc


def decode_access_token(token: str) -> dict[str, str]:
    payload = decode_token(token)
    if payload.get("type") not in {None, "access"}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token")
    return payload


def decode_refresh_token(token: str) -> dict[str, str]:
    payload = decode_token(token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    return payload


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_token_pair(
    db: Session,
    *,
    user: User,
    request: Request | None = None,
    device_id: str | None = None,
    revoke_existing_device_session: bool = True,
) -> tuple[str, str, AuthSession]:
    settings = get_settings()
    resolved_device_id = (device_id or uuid4().hex).strip()[:128]
    now = datetime.now(timezone.utc)
    if revoke_existing_device_session:
        existing_sessions = db.scalars(
            select(AuthSession)
            .where(
                AuthSession.user_id == user.id,
                AuthSession.device_id == resolved_device_id,
                AuthSession.revoked_at.is_(None),
            )
            .with_for_update()
        ).all()
        for session in existing_sessions:
            session.revoked_at = now
            session.revoked_reason = "rotated_device_login"

    refresh_jti = uuid4().hex
    refresh_token = create_refresh_token(user, token_jti=refresh_jti, device_id=resolved_device_id)
    session = AuthSession(
        user_id=user.id,
        device_id=resolved_device_id,
        refresh_token_jti=refresh_jti,
        refresh_token_hash=hash_token(refresh_token),
        user_agent=get_user_agent(request),
        ip_address=get_client_ip(request),
        expires_at=now + timedelta(days=settings.auth_refresh_token_days),
        last_used_at=now,
    )
    db.add(session)
    db.flush()
    access_token = create_access_token(user, session_id=session.id)
    return access_token, refresh_token, session


def rotate_refresh_session(
    db: Session,
    *,
    refresh_token: str,
    request: Request | None = None,
) -> tuple[User, str, str, AuthSession]:
    token_payload = decode_refresh_token(refresh_token)
    user_id = token_payload.get("sub")
    token_jti = token_payload.get("jti")
    if user_id is None or token_jti is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    session = db.scalar(
        select(AuthSession)
        .where(AuthSession.refresh_token_jti == token_jti)
        .with_for_update()
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh session not found")
    if session.user_id != int(user_id):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token subject mismatch")
    if session.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh session has been revoked")
    if ensure_aware_utc(session.expires_at) <= datetime.now(timezone.utc):
        session.revoked_at = datetime.now(timezone.utc)
        session.revoked_reason = "expired"
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh session expired")
    if not secrets_compare(session.refresh_token_hash, hash_token(refresh_token)):
        session.revoked_at = datetime.now(timezone.utc)
        session.revoked_reason = "refresh_token_reuse_detected"
        record_security_event(
            db,
            event_type="refresh_token_reuse_detected",
            user_id=session.user_id,
            request=request,
            risk_level="critical",
            details={"device_id": session.device_id},
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == session.user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is disabled")

    new_refresh_token = create_refresh_token(user, token_jti=session.refresh_token_jti, device_id=session.device_id)
    session.refresh_token_hash = hash_token(new_refresh_token)
    session.last_used_at = datetime.now(timezone.utc)
    session.user_agent = get_user_agent(request)
    session.ip_address = get_client_ip(request)
    access_token = create_access_token(user, session_id=session.id)
    return user, access_token, new_refresh_token, session


def revoke_user_sessions(
    db: Session,
    *,
    user_id: int,
    reason: str,
    except_session_id: int | None = None,
) -> int:
    now = datetime.now(timezone.utc)
    query = select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)).with_for_update()
    sessions = db.scalars(query).all()
    revoked = 0
    for session in sessions:
        if except_session_id is not None and session.id == except_session_id:
            continue
        session.revoked_at = now
        session.revoked_reason = reason
        revoked += 1
    return revoked


def assert_access_session_valid(db: Session, payload: dict[str, str]) -> AuthSession:
    user_id = payload.get("sub")
    session_id = payload.get("sid")
    if user_id is None or session_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session-bound access token required")
    try:
        parsed_user_id = int(user_id)
        parsed_session_id = int(session_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication session") from exc
    session = db.scalar(
        select(AuthSession).where(AuthSession.id == parsed_session_id, AuthSession.user_id == parsed_user_id)
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication session not found")
    now = datetime.now(timezone.utc)
    if session.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication session has been revoked")
    if ensure_aware_utc(session.expires_at) <= now:
        session.revoked_at = now
        session.revoked_reason = "expired"
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication session expired")
    return session


def secrets_compare(left: str, right: str) -> bool:
    import secrets

    return secrets.compare_digest(left, right)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = getattr(request.state, "auth_payload", None)
    if payload is None:
        if credentials is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
        payload = decode_access_token(credentials.credentials)

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token")

    assert_access_session_valid(db, payload)
    user = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == int(user_id)))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is disabled")
    request.state.user_id = user.id
    return user


import logging

logger = logging.getLogger("aventaro.auth")


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Dependency that enforces admin role.
    
    Replaces email-based admin check with proper RBAC.
    """
    if current_user.role != "admin":
        logger.warning(
            "admin_access_denied",
            extra={
                "event_type": "admin_access_denied",
                "user_id": current_user.id,
                "user_role": current_user.role,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    
    logger.info(
        "admin_access_granted",
        extra={
            "event_type": "admin_access_granted",
            "user_id": current_user.id,
        },
    )
    return current_user


def log_admin_action(admin_id: int, action: str, target_type: str, target_id: int, details: dict | None = None) -> None:
    """Log admin actions for audit trail."""
    logger.info(
        "admin_action",
        extra={
            "event_type": "admin_action",
            "admin_id": admin_id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            **(details or {}),
        },
    )
