from __future__ import annotations

import json

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


EXCLUDED_PATH_PREFIXES = ("/docs", "/redoc", "/openapi.json")
DEFAULT_SUCCESS_MESSAGE = "Request completed successfully"


class ResponseEnvelopeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        if request.scope.get("type") != "http":
            return response
        if request.url.path.startswith(EXCLUDED_PATH_PREFIXES):
            return response
        if response.status_code < 200 or response.status_code >= 400:
            return response

        if response.status_code == 204:
            return self._build_response(
                {"success": True, "data": None, "message": DEFAULT_SUCCESS_MESSAGE},
                status_code=200,
                original_response=response,
            )

        content_type = (response.media_type or response.headers.get("content-type") or "").lower()
        if "application/json" not in content_type:
            return response

        body = await self._read_response_body(response)
        if not body:
            payload = None
        else:
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                return response

        if isinstance(payload, dict) and payload.get("success") is True:
            message = payload.get("message")
            normalized_message = message.strip() if isinstance(message, str) and message.strip() else DEFAULT_SUCCESS_MESSAGE
            return self._build_response(
                {
                    "success": True,
                    "data": payload.get("data"),
                    "message": normalized_message,
                },
                status_code=response.status_code,
                original_response=response,
            )

        return self._build_response(
            {"success": True, "data": payload, "message": DEFAULT_SUCCESS_MESSAGE},
            status_code=response.status_code,
            original_response=response,
        )

    async def _read_response_body(self, response: Response) -> bytes:
        chunks: list[bytes] = []
        async for chunk in response.body_iterator:
            chunks.append(chunk)
        return b"".join(chunks)

    def _build_response(self, payload: dict[str, object], *, status_code: int, original_response: Response) -> JSONResponse:
        wrapped_response = JSONResponse(
            status_code=status_code,
            content=payload,
            background=original_response.background,
        )
        for key, value in original_response.headers.items():
            if key.lower() not in {"content-length", "content-type"}:
                wrapped_response.headers[key] = value
        return wrapped_response
