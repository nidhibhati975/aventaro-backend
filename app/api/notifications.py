from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.notifications import PushDevice
from app.models.user import User
from app.services.auth import get_current_user
from app.services.notifications import list_notifications as list_notifications_service
from app.services.notifications import mark_notifications_read
from app.services.push_notifications import register_push_device


router = APIRouter(prefix="/notifications")


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    message: str
    is_read: bool
    created_at: object


class MarkReadRequest(BaseModel):
    notification_ids: list[int] = Field(min_length=1)


class PushDeviceRegisterRequest(BaseModel):
    token: str = Field(min_length=32, max_length=512)
    platform: str = Field(min_length=2, max_length=32)


class PushDeviceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    platform: str
    is_active: bool
    last_seen_at: object


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
