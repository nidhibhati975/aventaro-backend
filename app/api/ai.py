from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.ai.budget_engine import BudgetOptimizeRequest, BudgetOptimizeResponse
from app.services.ai.trip_planner import TripPlanRequest, TripPlanResponse
from app.services.ai_pipeline import enqueue_ai_job, wait_for_ai_job
from app.services.auth import get_current_user
from app.services.chat import AIChatRequest, AIChatResponse, get_conversation
from app.services.profile import ProfileGenerateRequest, ProfileGenerateResponse
from app.services.rate_limit import rate_limit
from app.services.subscriptions import enforce_ai_usage_limit, record_ai_usage
from app.utils.config import get_settings


router = APIRouter(prefix="/ai")


class AIJobStatusResponse(BaseModel):
    job_id: str
    status: str
    response: dict | None = None
    error: str | None = None


def _request_context(request: Request, current_user: User, ai_operation: str) -> dict[str, object]:
    return {
        "request_id": getattr(request.state, "request_id", None),
        "user_id": current_user.id,
        "endpoint": request.url.path,
        "ai_operation": ai_operation,
    }


async def _enqueue_and_wait(
    *,
    operation: str,
    user_id: int,
    payload: dict,
    response_type,
) -> object:
    job_id = enqueue_ai_job(user_id=user_id, operation=operation, request_payload=payload)
    job = await wait_for_ai_job(job_id, user_id, get_settings().ai_job_poll_timeout_seconds)
    if job is None:
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content=AIJobStatusResponse(job_id=job_id, status="queued").model_dump(mode="json"),
        )
    if job.status in {"failed", "dead_letter"}:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=job.error or "AI job failed")
    if job.status != "completed" or job.response_payload is None:
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content=AIJobStatusResponse(job_id=job_id, status=job.status).model_dump(mode="json"),
        )
    return response_type.model_validate(job.response_payload)


@router.get("/jobs/{job_id}", response_model=AIJobStatusResponse)
async def get_ai_job_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
) -> AIJobStatusResponse:
    from app.services.ai_pipeline import get_ai_job

    job = get_ai_job(job_id, current_user.id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI job not found")
    return AIJobStatusResponse(
        job_id=job.job_id,
        status=job.status,
        response=job.response_payload,
        error=job.error,
    )


@router.post("/trip/plan", response_model=TripPlanResponse | AIJobStatusResponse)
async def create_trip_plan(
    payload: TripPlanRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("ai_trip_plan", 20, 3600)),
) -> TripPlanResponse | JSONResponse:
    enforce_ai_usage_limit(db, current_user.id)
    record_ai_usage(db, user_id=current_user.id, ai_operation="trip_plan")
    return await _enqueue_and_wait(
        operation="trip_plan",
        user_id=current_user.id,
        payload=payload.model_dump(mode="json"),
        response_type=TripPlanResponse,
    )


@router.post("/budget/optimize", response_model=BudgetOptimizeResponse | AIJobStatusResponse)
async def create_budget_optimization(
    payload: BudgetOptimizeRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("ai_budget_optimize", 20, 3600)),
) -> BudgetOptimizeResponse | JSONResponse:
    enforce_ai_usage_limit(db, current_user.id)
    record_ai_usage(db, user_id=current_user.id, ai_operation="budget_optimize")
    return await _enqueue_and_wait(
        operation="budget_optimize",
        user_id=current_user.id,
        payload=payload.model_dump(mode="json"),
        response_type=BudgetOptimizeResponse,
    )


@router.post("/chat", response_model=AIChatResponse | AIJobStatusResponse)
async def chat_with_concierge(
    payload: AIChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("ai_chat", 30, 3600)),
) -> AIChatResponse | JSONResponse:
    enforce_ai_usage_limit(db, current_user.id)
    if payload.conversation_id is not None:
        conversation = get_conversation(db=db, conversation_id=payload.conversation_id)
        if conversation is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
        if current_user.id not in {conversation.participant_one_id, conversation.participant_two_id}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to access this conversation")

    record_ai_usage(db, user_id=current_user.id, ai_operation="concierge_chat")
    return await _enqueue_and_wait(
        operation="concierge_chat",
        user_id=current_user.id,
        payload=payload.model_dump(mode="json"),
        response_type=AIChatResponse,
    )


@router.post("/profile/generate", response_model=ProfileGenerateResponse | AIJobStatusResponse)
async def generate_profile(
    payload: ProfileGenerateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("ai_profile_generate", 10, 3600)),
) -> ProfileGenerateResponse | JSONResponse:
    enforce_ai_usage_limit(db, current_user.id)
    record_ai_usage(db, user_id=current_user.id, ai_operation="profile_generate")
    return await _enqueue_and_wait(
        operation="profile_generate",
        user_id=current_user.id,
        payload=payload.model_dump(mode="json"),
        response_type=ProfileGenerateResponse,
    )
