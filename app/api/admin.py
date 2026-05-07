from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.booking import BookingStatus
from app.models.social import ModerationCaseStatus, ReportTargetType
from app.models.user import User
from app.services.auth import get_current_user, require_admin, log_admin_action
from app.services.moderation import (
    create_moderation_case,
    get_moderation_case as get_moderation_case_service,
    list_moderation_cases,
    resolve_moderation_case,
)
from app.services.social import list_reports


router = APIRouter(prefix="/admin")


class ReportRead(BaseModel):
    id: int
    reporter_id: int
    target_type: ReportTargetType
    target_id: int
    reason: str
    created_at: object


class ModerationCaseCreate(BaseModel):
    report_id: int


class ModerationCaseRead(BaseModel):
    id: int
    report_id: int
    target_type: ReportTargetType | None = None
    target_id: int | None = None
    status: ModerationCaseStatus
    admin_action: str | None
    created_at: object


class ModerationCaseResolve(BaseModel):
    action: str = Field(min_length=1, max_length=32, pattern="^(approve|reject|ban)$")


@router.get("/reports", response_model=list[ReportRead])
def get_reports(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[ReportRead]:
    reports = list_reports(db=db, limit=limit)
    return [
        ReportRead(
            id=r.id,
            reporter_id=r.reporter_id,
            target_type=r.target_type,
            target_id=r.target_id,
            reason=r.reason,
            created_at=r.created_at,
        )
        for r in reports
    ]


@router.post("/reports/{report_id}/case", response_model=ModerationCaseRead)
def create_case_from_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ModerationCaseRead:
    try:
        case = create_moderation_case(db=db, report_id=report_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    
    log_admin_action(current_user.id, "create_case", "report", report_id)
    
    return ModerationCaseRead(
        id=case.id,
        report_id=case.report_id,
        target_type=case.report.target_type if case.report is not None else None,
        target_id=case.report.target_id if case.report is not None else None,
        status=case.status,
        admin_action=case.admin_action,
        created_at=case.created_at,
    )


@router.get("/moderation-cases", response_model=list[ModerationCaseRead])
@router.get("/moderation/cases", response_model=list[ModerationCaseRead], include_in_schema=False)
@router.get("/moderation/queue", response_model=list[ModerationCaseRead], include_in_schema=False)
def get_moderation_cases(
    status: ModerationCaseStatus | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[ModerationCaseRead]:
    cases = list_moderation_cases(db=db, status=status, limit=limit)
    return [
        ModerationCaseRead(
            id=c.id,
            report_id=c.report_id,
            target_type=c.report.target_type if c.report is not None else None,
            target_id=c.report.target_id if c.report is not None else None,
            status=c.status,
            admin_action=c.admin_action,
            created_at=c.created_at,
        )
        for c in cases
    ]


@router.get("/moderation-cases/{case_id}", response_model=ModerationCaseRead)
def get_moderation_case(
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ModerationCaseRead:
    case = get_moderation_case_service(db=db, case_id=case_id)
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    return ModerationCaseRead(
        id=case.id,
        report_id=case.report_id,
        target_type=case.report.target_type if case.report is not None else None,
        target_id=case.report.target_id if case.report is not None else None,
        status=case.status,
        admin_action=case.admin_action,
        created_at=case.created_at,
    )


@router.post("/moderation-cases/{case_id}/resolve", response_model=ModerationCaseRead)
@router.post("/moderation/{case_id}/resolve", response_model=ModerationCaseRead, include_in_schema=False)
def resolve_case(
    case_id: int,
    payload: ModerationCaseResolve,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ModerationCaseRead:
    try:
        case = resolve_moderation_case(
            db=db,
            case_id=case_id,
            admin_action=payload.action,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    
    log_admin_action(current_user.id, "resolve_case", "moderation_case", case_id, {"action": payload.action})
    
    return ModerationCaseRead(
        id=case.id,
        report_id=case.report_id,
        target_type=case.report.target_type if case.report is not None else None,
        target_id=case.report.target_id if case.report is not None else None,
        status=case.status,
        admin_action=case.admin_action,
        created_at=case.created_at,
    )


# ============== REVENUE MANAGEMENT ==============

class RevenueSummaryResponse(BaseModel):
    total_revenue: float
    subscription_revenue: float
    boost_revenue: float
    commission_revenue: float
    period: dict


class RevenueDailyResponse(BaseModel):
    date: str
    subscription: float
    boost: float
    commission: float
    total: float
    new_subscriptions: int
    cancelled_subscriptions: int
    active_subscribers: int


@router.get("/revenue/summary")
def get_revenue_summary(
    start_date: str | None = None,
    end_date: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> RevenueSummaryResponse:
    """Get revenue summary"""
    from datetime import datetime, timezone
    from app.services.monetization import get_revenue_summary as get_rev_summary
    
    start = datetime.fromisoformat(start_date) if start_date else None
    end = datetime.fromisoformat(end_date) if end_date else None
    
    summary = get_rev_summary(db, start, end)
    
    return RevenueSummaryResponse(
        total_revenue=float(summary["total_revenue"]),
        subscription_revenue=float(summary["subscription_revenue"]),
        boost_revenue=float(summary["boost_revenue"]),
        commission_revenue=float(summary["commission_revenue"]),
        period=summary["period"],
    )


@router.get("/revenue/daily", response_model=list[RevenueDailyResponse])
def get_daily_revenue(
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[RevenueDailyResponse]:
    """Get daily revenue breakdown"""
    from datetime import datetime, timezone, timedelta
    from app.services.monetization import get_revenue_summary
    
    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=days)
    
    summary = get_revenue_summary(db, start_date, end_date)
    
    return [
        RevenueDailyResponse(
            date=day["date"].isoformat() if hasattr(day["date"], "isoformat") else str(day["date"]),
            subscription=day["subscription"],
            boost=day["boost"],
            commission=day["commission"],
            total=day["total"],
            new_subscriptions=0,
            cancelled_subscriptions=0,
            active_subscribers=0,
        )
        for day in summary.get("daily_breakdown", [])
    ]


# ============== USER MANAGEMENT ==============

class UserAdminResponse(BaseModel):
    id: int
    email: str
    role: str
    name: str | None
    is_active: bool
    is_verified: bool
    is_premium: bool
    created_at: str
    last_login: str | None


class UserBanRequest(BaseModel):
    reason: str = Field(min_length=1)
    ban_duration_days: int | None = None


class UserRoleUpdateRequest(BaseModel):
    role: str = Field(pattern="^(user|moderator|admin)$")


@router.get("/users", response_model=list[UserAdminResponse])
def list_users(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    is_active: bool | None = None,
    is_premium: bool | None = None,
    role: str | None = Query(default=None, pattern="^(user|moderator|admin)$"),
    search: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[UserAdminResponse]:
    """List all users with pagination"""
    from sqlalchemy import select, func
    from app.models.payments import Subscription
    from app.services.subscriptions import is_premium_record, STATUS_ACTIVE
    
    query = select(User).options(selectinload(User.profile)).order_by(User.id.desc())
    
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    if role is not None:
        query = query.where(User.role == role)
    if search:
        pattern = f"%{search.strip().lower()}%"
        query = query.where(User.email.ilike(pattern))
    
    query = query.offset(offset).limit(limit)
    users = db.scalars(query).all()
    
    # Get subscription info
    user_ids = [u.id for u in users]
    subscriptions = db.scalars(
        select(Subscription)
        .where(Subscription.user_id.in_(user_ids))
        .where(Subscription.status == STATUS_ACTIVE)
    ).all()
    
    premium_users = {s.user_id for s in subscriptions if is_premium_record(s)}
    
    return [
        UserAdminResponse(
            id=u.id,
            email=u.email,
            role=u.role,
            name=u.profile.name if u.profile is not None else None,
            is_active=u.is_active,
            is_verified=bool(u.profile.is_verified) if u.profile is not None else False,
            is_premium=u.id in premium_users,
            created_at=u.created_at.isoformat() if u.created_at else "",
            last_login=u.last_login.isoformat() if u.last_login else None,
        )
        for u in users
    ]


@router.get("/users/{user_id}", response_model=UserAdminResponse)
def get_user_details(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> UserAdminResponse:
    """Get detailed user information"""
    from app.services.subscriptions import ensure_subscription_record, is_premium_record
    
    user = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    subscription = ensure_subscription_record(db, user_id)
    
    return UserAdminResponse(
        id=user.id,
        email=user.email,
        role=user.role,
        name=user.profile.name if user.profile is not None else None,
        is_active=user.is_active,
        is_verified=bool(user.profile.is_verified) if user.profile is not None else False,
        is_premium=is_premium_record(subscription),
        created_at=user.created_at.isoformat() if user.created_at else "",
        last_login=user.last_login.isoformat() if user.last_login else None,
    )


@router.post("/users/{user_id}/ban")
def ban_user(
    user_id: int,
    payload: UserBanRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict[str, str]:
    """Ban a user"""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    user.is_active = False
    db.commit()
    
    log_admin_action(
        current_user.id,
        "ban_user",
        "user",
        user_id,
        {"reason": payload.reason, "duration": payload.ban_duration_days},
    )
    
    return {"status": "banned", "user_id": str(user_id)}


@router.post("/users/{user_id}/unban")
def unban_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict[str, str]:
    """Unban a user"""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    user.is_active = True
    db.commit()
    
    log_admin_action(current_user.id, "unban_user", "user", user_id)
    
    return {"status": "unbanned", "user_id": str(user_id)}


@router.patch("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    payload: UserRoleUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict[str, str]:
    if user_id == current_user.id and payload.role != "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admins cannot demote themselves")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    old_role = user.role
    user.role = payload.role
    db.commit()
    log_admin_action(current_user.id, "update_user_role", "user", user_id, {"old_role": old_role, "new_role": payload.role})
    return {"status": "role_updated", "user_id": str(user_id), "role": payload.role}


# ============== BOOKINGS ==============

class BookingAdminResponse(BaseModel):
    id: int
    user_id: int
    trip_id: int | None
    status: str
    total_amount: float
    currency: str
    created_at: str


@router.get("/bookings", response_model=list[BookingAdminResponse])
def list_bookings(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status: BookingStatus | None = None,
    user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[BookingAdminResponse]:
    """List all bookings"""
    from app.models.booking import Booking
    
    query = select(Booking).order_by(Booking.created_at.desc())
    
    if status:
        query = query.where(Booking.status == status)
    if user_id is not None:
        query = query.where(Booking.user_id == user_id)
    
    query = query.offset(offset).limit(limit)
    bookings = db.scalars(query).all()
    
    return [
        BookingAdminResponse(
            id=b.id,
            user_id=b.user_id,
            trip_id=b.trip_id,
            status=b.status.value,
            total_amount=float(b.total_amount),
            currency=b.currency,
            created_at=b.created_at.isoformat() if b.created_at else "",
        )
        for b in bookings
    ]


@router.get("/bookings/{booking_id}", response_model=BookingAdminResponse)
def get_booking_details(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> BookingAdminResponse:
    """Get booking details"""
    from app.models.booking import Booking
    
    booking = db.get(Booking, booking_id)
    if not booking:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    
    return BookingAdminResponse(
        id=booking.id,
        user_id=booking.user_id,
        trip_id=booking.trip_id,
        status=booking.status.value,
        total_amount=float(booking.total_amount),
        currency=booking.currency,
        created_at=booking.created_at.isoformat() if booking.created_at else "",
    )


# ============== STATS ==============

@router.get("/stats")
def get_platform_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> dict[str, Any]:
    """Get platform-wide statistics"""
    from sqlalchemy import select, func
    from app.models.payments import Subscription
    from app.models.booking import Booking
    from app.models.growth import Referral
    from app.services.subscriptions import is_premium_record, STATUS_ACTIVE
    
    # User stats
    total_users = db.scalar(select(func.count(User.id))) or 0
    active_users = db.scalar(select(func.count(User.id)).where(User.is_active == True)) or 0
    
    # Subscription stats
    all_subs = db.scalars(select(Subscription).where(Subscription.status == STATUS_ACTIVE)).all()
    premium_users = sum(1 for s in all_subs if is_premium_record(s))
    
    # Booking stats
    total_bookings = db.scalar(select(func.count(Booking.id))) or 0
    completed_bookings = db.scalar(
        select(func.count(Booking.id)).where(Booking.status == BookingStatus.completed)
    ) or 0
    
    # Referral stats
    total_referrals = db.scalar(select(func.count(Referral.id))) or 0
    return {
        "users": {
            "total": total_users,
            "active": active_users,
            "premium": premium_users,
        },
        "bookings": {
            "total": total_bookings,
            "completed": completed_bookings,
        },
        "referrals": {
            "total": total_referrals,
        },
    }
