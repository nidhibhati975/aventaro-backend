from __future__ import annotations

import json

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


EXCLUDED_PATH_PREFIXES = ("/docs", "/redoc", "/openapi.json")
DEFAULT_SUCCESS_MESSAGE = "Request completed successfully"


class ResponseEnvelopeMiddleware(BaseHTTPMiddleware):
    """Middleware that wraps all successful JSON responses in a consistent envelope.
    
    Response format:
    {
        "success": true,
        "data": ...,
        "message": "...",
        "meta": {
            "page": 1,
            "limit": 20,
            "total": 100  // when pagination detected
        }
    }
    """
    
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

        # Extract pagination info from query params
        meta = self._extract_pagination_meta(request)

        if isinstance(payload, dict) and payload.get("success") is True:
            message = payload.get("message")
            normalized_message = message.strip() if isinstance(message, str) and message.strip() else DEFAULT_SUCCESS_MESSAGE
            response_data = payload.get("data")
            payload_meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else None
            response_meta = payload_meta or meta
            
            # If data is a list and we have pagination params, add meta
            if isinstance(response_data, list) and response_meta:
                payload_to_send = {
                    "success": True,
                    "data": response_data,
                    "message": normalized_message,
                    "meta": response_meta,
                }
            else:
                payload_to_send = {
                    "success": True,
                    "data": response_data,
                    "message": normalized_message,
                }
                if response_meta:
                    payload_to_send["meta"] = response_meta
            
            return self._build_response(
                payload_to_send,
                status_code=response.status_code,
                original_response=response,
            )

        if isinstance(payload, dict) and "data" in payload and isinstance(payload.get("meta"), dict):
            message = payload.get("message")
            normalized_message = message.strip() if isinstance(message, str) and message.strip() else DEFAULT_SUCCESS_MESSAGE
            return self._build_response(
                {
                    "success": True,
                    "data": payload.get("data"),
                    "message": normalized_message,
                    "meta": payload["meta"],
                },
                status_code=response.status_code,
                original_response=response,
            )

        # Wrap non-enveloped responses
        if isinstance(payload, list) and meta:
            return self._build_response(
                {
                    "success": True,
                    "data": payload,
                    "message": DEFAULT_SUCCESS_MESSAGE,
                    "meta": meta,
                },
                status_code=response.status_code,
                original_response=response,
            )

        return self._build_response(
            {"success": True, "data": payload, "message": DEFAULT_SUCCESS_MESSAGE},
            status_code=response.status_code,
            original_response=response,
        )

    def _extract_pagination_meta(self, request: Request) -> dict | None:
        """Extract pagination info from query parameters."""
        page = request.query_params.get("page")
        limit = request.query_params.get("limit")
        offset = request.query_params.get("offset")
        
        if page or limit:
            return {
                "page": int(page) if page else 1,
                "limit": int(limit) if limit else 20,
                "offset": int(offset) if offset else 0,
            }
        return None

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
