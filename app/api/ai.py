from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.ai.budget_engine import (
    BudgetOptimizeRequest,
    BudgetOptimizeResponse,
    optimize_budget,
)
from app.services.ai.trip_planner import TripPlanRequest, TripPlanResponse, plan_trip
from app.services.auth import get_current_user
from app.services.chat import AIChatRequest, AIChatResponse, generate_concierge_reply, get_conversation
from app.services.profile import ProfileGenerateRequest, ProfileGenerateResponse, generate_profile_content
from app.services.rate_limit import rate_limit
from app.services.subscriptions import enforce_ai_usage_limit, record_ai_usage


router = APIRouter(prefix="/ai")


def _request_context(request: Request, current_user: User, ai_operation: str) -> dict[str, object]:
    return {
        "request_id": getattr(request.state, "request_id", None),
        "user_id": current_user.id,
        "endpoint": request.url.path,
        "ai_operation": ai_operation,
    }


@router.post("/trip/plan", response_model=TripPlanResponse)
def create_trip_plan(
    payload: TripPlanRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("ai_trip_plan", 20, 3600)),
) -> TripPlanResponse:
    enforce_ai_usage_limit(db, current_user.id)
    response = plan_trip(payload, request_context=_request_context(request, current_user, "trip_plan"))
    record_ai_usage(db, user_id=current_user.id, ai_operation="trip_plan")
    return response


@router.post("/budget/optimize", response_model=BudgetOptimizeResponse)
def create_budget_optimization(
    payload: BudgetOptimizeRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("ai_budget_optimize", 20, 3600)),
) -> BudgetOptimizeResponse:
    enforce_ai_usage_limit(db, current_user.id)
    response = optimize_budget(payload, request_context=_request_context(request, current_user, "budget_optimize"))
    record_ai_usage(db, user_id=current_user.id, ai_operation="budget_optimize")
    return response


@router.post("/chat", response_model=AIChatResponse)
def chat_with_concierge(
    payload: AIChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("ai_chat", 30, 3600)),
) -> AIChatResponse:
    enforce_ai_usage_limit(db, current_user.id)
    if payload.conversation_id is not None:
        conversation = get_conversation(db=db, conversation_id=payload.conversation_id)
        if conversation is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
        if current_user.id not in {conversation.participant_one_id, conversation.participant_two_id}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to access this conversation")

    response = generate_concierge_reply(
        db=db,
        current_user=current_user,
        payload=payload,
        request_context=_request_context(request, current_user, "concierge_chat"),
    )
    record_ai_usage(db, user_id=current_user.id, ai_operation="concierge_chat")
    return response


@router.post("/profile/generate", response_model=ProfileGenerateResponse)
def generate_profile(
    payload: ProfileGenerateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("ai_profile_generate", 10, 3600)),
) -> ProfileGenerateResponse:
    enforce_ai_usage_limit(db, current_user.id)
    response = generate_profile_content(
        current_user=current_user,
        payload=payload,
        request_context=_request_context(request, current_user, "profile_generate"),
    )
    record_ai_usage(db, user_id=current_user.id, ai_operation="profile_generate")
    return response
