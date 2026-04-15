from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.router import api_router
from app.middleware.auth_context import AuthContextMiddleware
from app.middleware.request_context import RequestContextMiddleware
from app.middleware.response_envelope import ResponseEnvelopeMiddleware
from app.services.chat_realtime import chat_connection_manager
from app.services.health import assert_runtime_ready
from app.services.subscription_runtime import subscription_expiry_worker
from app.utils.config import get_settings
from app.utils.errors import register_exception_handlers
from app.utils.logging import configure_logging


configure_logging()
app = FastAPI(title="Aventaro API", version="1.0.0")
register_exception_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthContextMiddleware)
app.add_middleware(ResponseEnvelopeMiddleware)
app.add_middleware(RequestContextMiddleware)

app.include_router(health_router)
app.include_router(api_router)


@app.on_event("startup")
async def validate_runtime() -> None:
    get_settings()
    assert_runtime_ready()
    chat_connection_manager.start()
    subscription_expiry_worker.start()


@app.on_event("shutdown")
async def shutdown_runtime() -> None:
    chat_connection_manager.stop()
    await subscription_expiry_worker.stop()
