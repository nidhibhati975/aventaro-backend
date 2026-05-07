from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.models.verification import VerificationStatus, VerificationType
from app.services.auth import get_current_user, require_admin, log_admin_action
from app.services.verification import (
    approve_verification,
    create_verification_request,
    get_verification_request,
    get_verification_status,
    list_verification_requests,
    list_pending_verifications,
    reject_verification,
)


router = APIRouter(prefix="/verification")


class VerificationRequestCreate(BaseModel):
    type: VerificationType
    document_url: str | None = Field(default=None, max_length=512)


class VerificationRequestRead(BaseModel):
    id: int
    type: VerificationType
    status: VerificationStatus
    document_url: str | None
    rejection_reason: str | None = None
    reviewed_by: int | None = None
    reviewed_at: object | None = None
    created_at: object


class VerificationStatusRead(BaseModel):
    is_verified: bool
    verification_level: str
    latest_request: VerificationRequestRead | None


class VerificationApproveRequest(BaseModel):
    action: str = Field(default="approve", max_length=100)


class VerificationRejectRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=255)


@router.post("/request", response_model=VerificationRequestRead, status_code=status.HTTP_201_CREATED)
@router.post("/submit", response_model=VerificationRequestRead, status_code=status.HTTP_201_CREATED)
def create_verification(
    payload: VerificationRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VerificationRequestRead:
    try:
        request = create_verification_request(
            db=db,
            user_id=current_user.id,
            verification_type=payload.type,
            document_url=payload.document_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return VerificationRequestRead(
        id=request.id,
        type=request.type,
        status=request.status,
        document_url=request.document_url,
        rejection_reason=request.rejection_reason,
        reviewed_by=request.reviewed_by,
        reviewed_at=request.reviewed_at,
        created_at=request.created_at,
    )


@router.get("/status", response_model=VerificationStatusRead)
def get_verification(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VerificationStatusRead:
    status_data = get_verification_status(db=db, user_id=current_user.id)
    return VerificationStatusRead(**status_data)


# Admin endpoints
@router.get("/admin/pending", response_model=list[VerificationRequestRead])
def list_pending(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[VerificationRequestRead]:
    requests = list_pending_verifications(db=db, limit=limit)
    return [
        VerificationRequestRead(
            id=r.id,
            type=r.type,
            status=r.status,
            document_url=r.document_url,
            rejection_reason=r.rejection_reason,
            reviewed_by=r.reviewed_by,
            reviewed_at=r.reviewed_at,
            created_at=r.created_at,
        )
        for r in requests
    ]


@router.get("/admin/requests", response_model=list[VerificationRequestRead])
def list_requests(
    status: VerificationStatus | None = None,
    user_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[VerificationRequestRead]:
    requests = list_verification_requests(db=db, status=status, user_id=user_id, limit=limit)
    return [
        VerificationRequestRead(
            id=request.id,
            type=request.type,
            status=request.status,
            document_url=request.document_url,
            rejection_reason=request.rejection_reason,
            reviewed_by=request.reviewed_by,
            reviewed_at=request.reviewed_at,
            created_at=request.created_at,
        )
        for request in requests
    ]


@router.get("/admin/{request_id}", response_model=VerificationRequestRead)
def get_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> VerificationRequestRead:
    request = get_verification_request(db=db, request_id=request_id)
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Verification request not found")
    return VerificationRequestRead(
        id=request.id,
        type=request.type,
        status=request.status,
        document_url=request.document_url,
        rejection_reason=request.rejection_reason,
        reviewed_by=request.reviewed_by,
        reviewed_at=request.reviewed_at,
        created_at=request.created_at,
    )


@router.post("/admin/{request_id}/approve", response_model=VerificationRequestRead)
def approve_verification_endpoint(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> VerificationRequestRead:
    try:
        request = approve_verification(db=db, request_id=request_id, admin_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    
    log_admin_action(current_user.id, "approve_verification", "verification_request", request_id)
    
    return VerificationRequestRead(
        id=request.id,
        type=request.type,
        status=request.status,
        document_url=request.document_url,
        rejection_reason=request.rejection_reason,
        reviewed_by=request.reviewed_by,
        reviewed_at=request.reviewed_at,
        created_at=request.created_at,
    )


@router.post("/admin/{request_id}/reject", response_model=VerificationRequestRead)
def reject_verification_endpoint(
    request_id: int,
    payload: VerificationRejectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> VerificationRequestRead:
    try:
        request = reject_verification(db=db, request_id=request_id, reason=payload.reason, admin_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    
    log_admin_action(current_user.id, "reject_verification", "verification_request", request_id, {"reason": payload.reason})
    
    return VerificationRequestRead(
        id=request.id,
        type=request.type,
        status=request.status,
        document_url=request.document_url,
        rejection_reason=request.rejection_reason,
        reviewed_by=request.reviewed_by,
        reviewed_at=request.reviewed_at,
        created_at=request.created_at,
    )
