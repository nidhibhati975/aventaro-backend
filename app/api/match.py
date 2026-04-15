from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.match import MatchStatus
from app.models.user import User
from app.services.auth import get_current_user
from app.services.redis_runtime import get_cache, invalidate_match_suggestions_cache
from app.services.match import (
    create_match_request as create_match_request_service,
    list_matches as list_matches_service,
    list_received_matches as list_received_matches_service,
    list_suggestion_candidates,
    list_sent_matches as list_sent_matches_service,
    update_match_status,
)
from app.services.subscriptions import enforce_match_request_limit


router = APIRouter()


class ProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str | None = None
    age: int | None = None
    bio: str | None = None
    location: str | None = None
    gender: str | None = None
    travel_style: str | None = None
    interests: list[str] | None = None
    budget_min: int | None = None
    budget_max: int | None = None


class SuggestedUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    profile: ProfileRead | None = None


class MatchSuggestionRequest(BaseModel):
    limit: int = Field(default=10, ge=1, le=50)


class MatchCreateRequest(BaseModel):
    target_user_id: int = Field(gt=0)


class MatchRead(BaseModel):
    id: int
    status: MatchStatus
    direction: str
    user: SuggestedUserRead
    compatibility_score: int | None = None
    compatibility_reason: str | None = None


def _build_match_read(match, current_user_id: int) -> MatchRead:
    if match.sender_id == current_user_id:
        direction = "outgoing"
        other_user = match.receiver
    else:
        direction = "incoming"
        other_user = match.sender
    return MatchRead(
        id=match.id,
        status=match.status,
        direction=direction,
        user=SuggestedUserRead.model_validate(other_user),
        compatibility_score=match.compatibility_score,
        compatibility_reason=match.compatibility_reason,
    )


@router.post("/match", response_model=list[SuggestedUserRead])
def get_suggestions(
    payload: MatchSuggestionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SuggestedUserRead]:
    cache_key = f"match:suggestions:user:{current_user.id}:limit:{payload.limit}"
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        return cached

    users = list_suggestion_candidates(db=db, current_user_id=current_user.id, limit=payload.limit)
    response_payload = [SuggestedUserRead.model_validate(user).model_dump(mode="json") for user in users]
    get_cache().set_json(cache_key, response_payload, ttl_seconds=30)
    return response_payload


@router.post("/matches", response_model=MatchRead, status_code=status.HTTP_201_CREATED)
def send_match_request(
    payload: MatchCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatchRead:
    enforce_match_request_limit(db, current_user.id)
    try:
        match_request = create_match_request_service(
            db=db,
            current_user=current_user,
            target_user_id=payload.target_user_id,
            request_context={
                "request_id": getattr(request.state, "request_id", None),
                "user_id": current_user.id,
                "endpoint": request.url.path,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    invalidate_match_suggestions_cache(current_user.id)
    invalidate_match_suggestions_cache(payload.target_user_id)
    return _build_match_read(match_request, current_user.id)


@router.get("/matches", response_model=list[MatchRead])
def list_matches(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MatchRead]:
    requests = list_matches_service(db=db, current_user_id=current_user.id)
    return [_build_match_read(request, current_user.id) for request in requests]


@router.post("/matches/{match_id}/accept", response_model=MatchRead)
def accept_match_request(
    match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatchRead:
    try:
        match_request = update_match_status(db=db, match_id=match_id, current_user_id=current_user.id, new_status=MatchStatus.accepted)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    invalidate_match_suggestions_cache(current_user.id)
    invalidate_match_suggestions_cache(match_request.sender_id)
    return _build_match_read(match_request, current_user.id)


@router.post("/matches/{match_id}/reject", response_model=MatchRead)
def reject_match_request(
    match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatchRead:
    try:
        match_request = update_match_status(db=db, match_id=match_id, current_user_id=current_user.id, new_status=MatchStatus.rejected)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    invalidate_match_suggestions_cache(current_user.id)
    invalidate_match_suggestions_cache(match_request.sender_id)
    return _build_match_read(match_request, current_user.id)


@router.post("/match/request", response_model=MatchRead, status_code=status.HTTP_201_CREATED)
def create_match_request(
    payload: MatchCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatchRead:
    return send_match_request(payload=payload, request=request, db=db, current_user=current_user)


@router.get("/match/received", response_model=list[MatchRead])
def list_received_matches(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MatchRead]:
    requests = list_received_matches_service(db=db, current_user_id=current_user.id)
    return [_build_match_read(request, current_user.id) for request in requests]


@router.get("/match/sent", response_model=list[MatchRead])
def list_sent_matches(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MatchRead]:
    requests = list_sent_matches_service(db=db, current_user_id=current_user.id)
    return [_build_match_read(request, current_user.id) for request in requests]


@router.post("/match/{match_id}/accept", response_model=MatchRead)
def accept_match(
    match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatchRead:
    return accept_match_request(match_id=match_id, db=db, current_user=current_user)


@router.post("/match/{match_id}/reject", response_model=MatchRead)
def reject_match(
    match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatchRead:
    return reject_match_request(match_id=match_id, db=db, current_user=current_user)
