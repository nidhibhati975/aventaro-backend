from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.services.auth import decode_access_token, extract_bearer_token


PROTECTED_PREFIXES = (
    "/users",
    "/profile",
    "/discover",
    "/ai",
    "/match",
    "/matches",
    "/posts",
    "/reels",
    "/stories",
    "/hashtags",
    "/collections",
    "/report",
    "/block",
    "/trip",
    "/expenses",
    "/chat",
    "/notifications",
    "/payments",
    "/support",
)

PUBLIC_PREFIXES = (
    "/auth",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/health",
    "/payments/webhook",
)

PUBLIC_PATHS = {
    "/chat/ws",
}


class AuthContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        upgrade_header = request.headers.get("upgrade", "")
        if (
            path in PUBLIC_PATHS
            or upgrade_header.lower() == "websocket"
            or path.startswith(PUBLIC_PREFIXES)
            or not path.startswith(PROTECTED_PREFIXES)
        ):
            return await call_next(request)

        token = extract_bearer_token(request.headers.get("authorization"))
        if not token:
            return self._error_response(request, status.HTTP_401_UNAUTHORIZED, "Authentication required")

        try:
            payload = decode_access_token(token)
        except HTTPException:
            return self._error_response(request, status.HTTP_401_UNAUTHORIZED, "Invalid authentication token")

        request.state.auth_payload = payload
        request.state.user_id = int(payload["sub"])
        return await call_next(request)

    @staticmethod
    def _error_response(request: Request, status_code: int, message: str) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None) or str(uuid4())
        response = JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "data": None,
                "message": message,
                "error": {
                    "code": "unauthorized",
                    "message": message,
                    "status": status_code,
                    "request_id": request_id,
                },
                "request_id": request_id,
            },
        )
        response.headers["X-Request-ID"] = request_id
        return response
