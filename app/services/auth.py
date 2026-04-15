from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.user import User
from app.utils.config import get_settings


password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


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


def create_access_token(user: User, expires_delta: timedelta | None = None) -> str:
    settings = get_settings()
    expire_at = datetime.now(timezone.utc) + (expires_delta or timedelta(hours=24))
    payload = {"sub": str(user.id), "email": user.email, "type": "access", "exp": expire_at}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user: User, expires_delta: timedelta | None = None) -> str:
    settings = get_settings()
    expire_at = datetime.now(timezone.utc) + (expires_delta or timedelta(days=30))
    payload = {"sub": str(user.id), "email": user.email, "type": "refresh", "exp": expire_at}
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

    user = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == int(user_id)))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    request.state.user_id = user.id
    return user
