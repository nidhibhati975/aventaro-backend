from __future__ import annotations

from sqlalchemy import select
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user, require_admin
from app.services.notifications import create_notification, list_notifications as list_notifications_service, mark_notifications_read
from app.services.push_notifications import register_push_device, unregister_push_device


router = APIRouter(prefix="/notifications")


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    message: str
    entity_id: int | None = None
    entity_type: str | None = None
    is_read: bool
    status: str
    priority: str
    deep_link: str | None = None
    created_at: object


class MarkReadRequest(BaseModel):
    notification_ids: list[int] = Field(min_length=1)


class PushDeviceRegisterRequest(BaseModel):
    token: str = Field(min_length=32, max_length=512)
    platform: str = Field(min_length=2, max_length=32)


class PushDeviceUnregisterRequest(BaseModel):
    token: str = Field(min_length=32, max_length=512)


class PushDeviceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    platform: str
    is_active: bool
    last_seen_at: object


class InternalNotificationSendRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1)
    type: str = Field(min_length=1, max_length=50)
    message: str = Field(min_length=1, max_length=255)
    entity_id: int | None = None
    entity_type: str | None = Field(default=None, max_length=50)
    deep_link: str | None = Field(default=None, max_length=512)


@router.get("", response_model=list[NotificationRead])
def list_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[NotificationRead]:
    notifications = list_notifications_service(db=db, user_id=current_user.id)
    return [NotificationRead.model_validate(item) for item in notifications]


@router.post("/mark-read")
def mark_read(
    payload: MarkReadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, int]:
    notifications = mark_notifications_read(db=db, user_id=current_user.id, notification_ids=payload.notification_ids)
    if not notifications:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notifications not found")
    return {"updated": len(notifications)}


@router.post("/devices/register", response_model=PushDeviceRead, status_code=status.HTTP_201_CREATED)
def register_device(
    payload: PushDeviceRegisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PushDeviceRead:
    device = register_push_device(
        db=db,
        user_id=current_user.id,
        token=payload.token,
        platform=payload.platform,
    )
    return PushDeviceRead.model_validate(device)


@router.delete("/devices/unregister", response_model=PushDeviceRead)
def unregister_device(
    payload: PushDeviceUnregisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PushDeviceRead:
    device = unregister_push_device(
        db=db,
        user_id=current_user.id,
        token=payload.token,
    )
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Push device not found")
    return PushDeviceRead.model_validate(device)


@router.post("/send")
def send_notification(
    payload: InternalNotificationSendRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict[str, int]:
    requested_user_ids = sorted({int(user_id) for user_id in payload.user_ids})
    existing_user_ids = set(
        db.scalars(select(User.id).where(User.id.in_(requested_user_ids))).all()
    )
    missing_user_ids = [user_id for user_id in requested_user_ids if user_id not in existing_user_ids]
    if missing_user_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Users not found: {', '.join(str(user_id) for user_id in missing_user_ids)}",
        )

    for user_id in requested_user_ids:
        create_notification(
            db=db,
            user_id=user_id,
            notification_type=payload.type,
            message=payload.message,
            entity_id=payload.entity_id,
            entity_type=payload.entity_type,
            deep_link=payload.deep_link,
            commit=False,
        )

    db.commit()
    return {"created": len(requested_user_ids)}
