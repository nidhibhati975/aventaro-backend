from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import auth as auth_api
from app.db.base import Base
from app.models.payments import Subscription
from app.models.profile import Profile
from app.models.security import AuthSession, MfaChallenge, SecurityAuditLog
from app.models.user import User
from app.services import auth as auth_service
from app.services import mfa as mfa_service
from app.services.rate_limit import rate_limiter


@compiles(JSONB, "sqlite")
def _compile_jsonb_for_sqlite(_type, compiler, **_kw):  # noqa: ANN001
    return "JSON"


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_connection, _connection_record):  # noqa: ANN001
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(
        bind=engine,
        tables=[
            User.__table__,
            Profile.__table__,
            Subscription.__table__,
            AuthSession.__table__,
            MfaChallenge.__table__,
            SecurityAuditLog.__table__,
        ],
    )
    SessionTesting = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        db = SessionTesting()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(rate_limiter, "hit", lambda **_kwargs: None)
    monkeypatch.setattr(auth_api, "invalidate_discover_cache", lambda: None)
    monkeypatch.setattr(auth_api, "invalidate_match_suggestions_cache", lambda: None)
    monkeypatch.setattr(mfa_service, "_generate_otp", lambda: "123456")
    monkeypatch.setattr(mfa_service, "_send_email_otp", lambda _destination, _code: None)
    monkeypatch.setattr(mfa_service, "_send_sms_otp", lambda _destination, _code: None)

    app = FastAPI()
    app.include_router(auth_api.router)
    app.dependency_overrides[auth_api.get_db] = override_get_db
    app.dependency_overrides[auth_service.get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _signup(client: TestClient, email: str = "traveler@example.com", password: str = "ValidPass123!") -> dict:
    response = client.post(
        "/auth/signup",
        json={"email": email, "password": password, "name": "Traveler"},
        headers={"X-Device-Id": "device-a"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_lockout_revokes_sessions_and_blocks_login(client: TestClient) -> None:
    tokens = _signup(client)
    for _ in range(5):
        response = client.post("/auth/login", json={"email": "traveler@example.com", "password": "WrongPass123!"})
        assert response.status_code == 401

    locked = client.post("/auth/login", json={"email": "traveler@example.com", "password": "ValidPass123!"})
    assert locked.status_code == 423

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.status_code == 401


def test_refresh_rotation_and_session_revocation_invalidate_access_tokens(client: TestClient) -> None:
    tokens = _signup(client)
    refreshed = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200, refreshed.text
    rotated = refreshed.json()

    stale_refresh = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert stale_refresh.status_code == 401

    sessions = client.get("/auth/sessions", headers={"Authorization": f"Bearer {rotated['access_token']}"})
    assert sessions.status_code == 200, sessions.text
    session_id = sessions.json()[0]["id"]
    revoked = client.post(
        f"/auth/sessions/{session_id}/revoke",
        headers={"Authorization": f"Bearer {rotated['access_token']}"},
    )
    assert revoked.status_code == 200

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {rotated['access_token']}"})
    assert me.status_code == 401


def test_password_change_revokes_old_tokens_and_requires_new_password(client: TestClient) -> None:
    tokens = _signup(client)
    changed = client.post(
        "/auth/password/change",
        json={"current_password": "ValidPass123!", "new_password": "NewValidPass123!"},
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert changed.status_code == 200, changed.text

    old_token_me = client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert old_token_me.status_code == 401

    old_login = client.post("/auth/login", json={"email": "traveler@example.com", "password": "ValidPass123!"})
    assert old_login.status_code == 401
    new_login = client.post("/auth/login", json={"email": "traveler@example.com", "password": "NewValidPass123!"})
    assert new_login.status_code == 200, new_login.text


def test_password_reset_consumes_mfa_challenge_and_revokes_sessions(client: TestClient) -> None:
    tokens = _signup(client)
    requested = client.post("/auth/password/reset/request", json={"email": "traveler@example.com"})
    assert requested.status_code == 200, requested.text
    challenge_id = requested.json()["challenge_id"]

    confirmed = client.post(
        "/auth/password/reset/confirm",
        json={"challenge_id": challenge_id, "code": "123456", "new_password": "ResetValid123!"},
    )
    assert confirmed.status_code == 200, confirmed.text

    stale = client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert stale.status_code == 401

    old_login = client.post("/auth/login", json={"email": "traveler@example.com", "password": "ValidPass123!"})
    assert old_login.status_code == 401
    new_login = client.post("/auth/login", json={"email": "traveler@example.com", "password": "ResetValid123!"})
    assert new_login.status_code == 200, new_login.text
