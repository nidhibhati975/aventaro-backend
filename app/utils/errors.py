from __future__ import annotations

import logging
from http import HTTPStatus

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


logger = logging.getLogger(__name__)


def _derive_error_code(status_code: int, extras: dict[str, object] | None = None) -> str:
    if extras:
        explicit_code = extras.get("error") or extras.get("code")
        if isinstance(explicit_code, str) and explicit_code.strip():
            return explicit_code.strip()
    try:
        return HTTPStatus(status_code).name.lower()
    except ValueError:
        return "request_failed"


def _extract_details(extras: dict[str, object] | None = None) -> dict[str, object] | None:
    if not extras:
        return None

    details = {
        key: value
        for key, value in extras.items()
        if key not in {"error", "code", "message", "request_id", "requestId", "status"}
    }
    return details or None


def _build_error_response(request: Request, status_code: int, message: str, extras: dict[str, object] | None = None) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    error_code = _derive_error_code(status_code, extras)
    details = _extract_details(extras)
    payload: dict[str, object] = {
        "success": False,
        "data": None,
        "message": message,
        "error": {
            "code": error_code,
            "message": message,
            "status": status_code,
            "request_id": request_id,
        },
        "request_id": request_id,
    }
    if details:
        payload["details"] = details
    return JSONResponse(status_code=status_code, content=payload)


def _summarize_validation_error(exc: RequestValidationError) -> str:
    field_errors: list[str] = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", ()) if part != "body")
        if location:
            field_errors.append(f"{location}: {error.get('msg', 'invalid value')}")
        else:
            field_errors.append(error.get("msg", "invalid value"))
    if not field_errors:
        return "Request validation failed"
    return "Request validation failed: " + "; ".join(field_errors)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict):
            detail = dict(exc.detail)
            message = str(detail.get("error") or "Request failed")
            response = _build_error_response(request, exc.status_code, message, extras=detail)
        else:
            message = exc.detail if isinstance(exc.detail, str) else "Request failed"
            response = _build_error_response(request, exc.status_code, message)
        if exc.headers:
            for key, value in exc.headers.items():
                response.headers[key] = value
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return _build_error_response(request, status.HTTP_422_UNPROCESSABLE_ENTITY, _summarize_validation_error(exc))

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "Unhandled server exception",
            exc_info=exc,
            extra={
                "request_id": getattr(request.state, "request_id", None),
                "user_id": getattr(request.state, "user_id", None),
                "endpoint": request.url.path,
                "method": request.method,
            },
        )
        return _build_error_response(request, status.HTTP_500_INTERNAL_SERVER_ERROR, "Internal server error")
