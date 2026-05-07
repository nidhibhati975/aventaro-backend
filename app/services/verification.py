from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.verification import (
    VerificationLevel,
    VerificationRequest,
    VerificationStatus,
    VerificationType,
)
from app.models.profile import Profile
from app.services.notifications import create_notification


logger = logging.getLogger("aventaro.verification")


def create_verification_request(
    db: Session,
    user_id: int,
    verification_type: VerificationType,
    document_url: str | None = None,
) -> VerificationRequest:
    """Create a new verification request.
    
    Enforces: Only one active PENDING request per user per type.
    """
    # Check for existing pending request of same type
    existing = db.scalar(
        select(VerificationRequest)
        .where(
            VerificationRequest.user_id == user_id,
            VerificationRequest.type == verification_type,
            VerificationRequest.status == VerificationStatus.pending,
        )
    )
    if existing is not None:
        raise ValueError(f"Pending {verification_type.value} verification request already exists")

    request = VerificationRequest(
        user_id=user_id,
        type=verification_type,
        status=VerificationStatus.pending,
        document_url=document_url,
    )
    db.add(request)
    db.flush()

    # Create notification
    create_notification(
        db=db,
        user_id=user_id,
        notification_type="verification_submitted",
        message=f"Your {verification_type.value} verification request is being reviewed.",
        entity_id=request.id,
        entity_type="verification",
        commit=False,
    )

    db.commit()
    
    logger.info(
        "verification_request_created",
        extra={
            "event_type": "verification_request_created",
            "request_id": request.id,
            "user_id": user_id,
            "type": verification_type.value,
        },
    )
    
    db.refresh(request)
    return request


def get_verification_status(db: Session, user_id: int) -> dict[str, any]:
    """Get current user's verification status."""
    # Get latest verification request
    latest_request = db.scalar(
        select(VerificationRequest)
        .where(VerificationRequest.user_id == user_id)
        .order_by(VerificationRequest.created_at.desc())
    )

    # Get profile verification info
    profile = db.scalar(select(Profile).where(Profile.user_id == user_id))

    return {
        "is_verified": profile.is_verified if profile else False,
        "verification_level": profile.verification_level if profile else "none",
        "latest_request": (
            {
                "id": latest_request.id,
                "type": latest_request.type.value,
                "status": latest_request.status.value,
                "document_url": latest_request.document_url,
                "rejection_reason": latest_request.rejection_reason,
                "reviewed_by": latest_request.reviewed_by,
                "reviewed_at": latest_request.reviewed_at.isoformat() if latest_request.reviewed_at else None,
                "created_at": latest_request.created_at.isoformat(),
            }
            if latest_request
            else None
        ),
    }


def approve_verification(db: Session, request_id: int, admin_id: int) -> VerificationRequest:
    """Approve a verification request (admin action).
    
    Sets reviewed_by and reviewed_at on approval.
    Updates profile.is_verified and verification_level.
    """
    request = db.scalar(
        select(VerificationRequest)
        .options(selectinload(VerificationRequest.user).selectinload(Profile))
        .where(VerificationRequest.id == request_id)
    )
    if request is None:
        raise LookupError("Verification request not found")

    if request.status != VerificationStatus.pending:
        raise ValueError(f"Cannot approve request with status: {request.status.value}")

    request.status = VerificationStatus.approved
    request.reviewed_by = admin_id
    request.reviewed_at = datetime.now(timezone.utc)
    db.flush()

    # Update user profile
    profile = db.scalar(select(Profile).where(Profile.user_id == request.user_id))
    if profile:
        profile.is_verified = True
        # Upgrade verification level based on type
        current_level = profile.verification_level
        if request.type == VerificationType.id:
            profile.verification_level = VerificationLevel.full.value
        elif request.type == VerificationType.selfie and current_level != VerificationLevel.full.value:
            profile.verification_level = VerificationLevel.basic.value
        elif request.type == VerificationType.social and current_level == VerificationLevel.none.value:
            profile.verification_level = VerificationLevel.basic.value

    db.flush()

    # Create notification
    create_notification(
        db=db,
        user_id=request.user_id,
        notification_type="verification_approved",
        message="Your identity has been verified. You now have a verified badge.",
        entity_id=request.id,
        entity_type="verification",
        commit=False,
    )

    db.commit()
    
    logger.info(
        "verification_approved",
        extra={
            "event_type": "verification_approved",
            "request_id": request_id,
            "admin_id": admin_id,
            "user_id": request.user_id,
            "type": request.type.value,
        },
    )
    
    db.refresh(request)
    return request


def reject_verification(db: Session, request_id: int, reason: str | None = None, admin_id: int | None = None) -> VerificationRequest:
    """Reject a verification request (admin action).
    
    Sets rejection_reason, reviewed_by, and reviewed_at.
    """
    request = db.scalar(
        select(VerificationRequest)
        .options(selectinload(VerificationRequest.user))
        .where(VerificationRequest.id == request_id)
    )
    if request is None:
        raise LookupError("Verification request not found")

    if request.status != VerificationStatus.pending:
        raise ValueError(f"Cannot reject request with status: {request.status.value}")

    request.status = VerificationStatus.rejected
    request.rejection_reason = reason
    if admin_id:
        request.reviewed_by = admin_id
    request.reviewed_at = datetime.now(timezone.utc)
    db.flush()

    # Create notification
    create_notification(
        db=db,
        user_id=request.user_id,
        notification_type="verification_rejected",
        message=f"Your verification was rejected. {reason or 'Please try again.'}",
        entity_id=request.id,
        entity_type="verification",
        commit=False,
    )

    db.commit()
    
    logger.info(
        "verification_rejected",
        extra={
            "event_type": "verification_rejected",
            "request_id": request_id,
            "admin_id": admin_id,
            "user_id": request.user_id,
            "type": request.type.value,
            "reason": reason,
        },
    )
    
    db.refresh(request)
    return request


def list_pending_verifications(db: Session, limit: int = 50) -> list[VerificationRequest]:
    """List pending verification requests (admin)."""
    return db.scalars(
        select(VerificationRequest)
        .options(selectinload(VerificationRequest.user).selectinload(Profile))
        .where(VerificationRequest.status == VerificationStatus.pending)
        .order_by(VerificationRequest.created_at.asc())
        .limit(limit)
    ).all()


def list_verification_requests(
    db: Session,
    *,
    status: VerificationStatus | None = None,
    user_id: int | None = None,
    limit: int = 50,
) -> list[VerificationRequest]:
    query = (
        select(VerificationRequest)
        .options(selectinload(VerificationRequest.user).selectinload(Profile))
        .order_by(VerificationRequest.created_at.desc())
        .limit(limit)
    )
    if status is not None:
        query = query.where(VerificationRequest.status == status)
    if user_id is not None:
        query = query.where(VerificationRequest.user_id == user_id)
    return db.scalars(query).all()


def get_verification_request(db: Session, request_id: int) -> VerificationRequest | None:
    return db.scalar(
        select(VerificationRequest)
        .options(selectinload(VerificationRequest.user).selectinload(Profile))
        .where(VerificationRequest.id == request_id)
    )
