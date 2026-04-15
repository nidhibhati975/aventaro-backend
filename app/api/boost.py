from __future__ import annotations

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.growth import create_or_refresh_boost
from app.services.rate_limit import rate_limit
from app.services.subscriptions import BOOST_PROFILE, BOOST_TRIP, require_premium


router = APIRouter(prefix="/boost")


class BoostRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    boost_type: str
    expires_at: object
    created_at: object


@router.post("/profile", response_model=BoostRead, status_code=status.HTTP_201_CREATED)
def boost_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_premium),
    _: None = Depends(rate_limit("boost_profile", 20, 86400)),
) -> BoostRead:
    boost = create_or_refresh_boost(db=db, user_id=current_user.id, boost_type=BOOST_PROFILE)
    return BoostRead.model_validate(boost)


@router.post("/trip", response_model=BoostRead, status_code=status.HTTP_201_CREATED)
def boost_trip(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_premium),
    _: None = Depends(rate_limit("boost_trip", 20, 86400)),
) -> BoostRead:
    boost = create_or_refresh_boost(db=db, user_id=current_user.id, boost_type=BOOST_TRIP)
    return BoostRead.model_validate(boost)
