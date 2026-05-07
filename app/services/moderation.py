from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.social import ModerationCase, ModerationCaseStatus, Report, ReportTargetType
from app.models.user import User


VALID_MODERATION_ACTIONS = {"approve", "reject", "ban"}


def create_moderation_case(db: Session, report_id: int) -> ModerationCase:
    """Create a moderation case from a report."""
    report = db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise LookupError("Report not found")

    # Check if case already exists
    existing = db.scalar(
        select(ModerationCase).where(ModerationCase.report_id == report_id)
    )
    if existing is not None:
        raise ValueError("Moderation case already exists for this report")

    case = ModerationCase(
        report_id=report_id,
        status=ModerationCaseStatus.open,
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


def resolve_moderation_case(
    db: Session,
    case_id: int,
    admin_action: str,
) -> ModerationCase:
    """Resolve a moderation case with admin action."""
    case = db.scalar(
        select(ModerationCase)
        .options(selectinload(ModerationCase.report))
        .where(ModerationCase.id == case_id)
    )
    if case is None:
        raise LookupError("Moderation case not found")

    if case.status == ModerationCaseStatus.resolved:
        raise ValueError("Case is already resolved")
    normalized_action = admin_action.strip().lower()
    if normalized_action not in VALID_MODERATION_ACTIONS:
        raise ValueError("Moderation action must be one of: approve, reject, ban")
    if normalized_action == "ban":
        if case.report is None or case.report.target_type != ReportTargetType.user:
            raise ValueError("Ban action is only supported for user reports")
        user = db.scalar(select(User).where(User.id == case.report.target_id))
        if user is None:
            raise LookupError("Reported user not found")
        user.is_active = False

    case.status = ModerationCaseStatus.resolved
    case.admin_action = normalized_action
    db.commit()
    db.refresh(case)
    return case


def list_moderation_cases(
    db: Session,
    status: ModerationCaseStatus | None = None,
    limit: int = 50,
) -> list[ModerationCase]:
    """List moderation cases with optional status filter."""
    query = select(ModerationCase).options(
        selectinload(ModerationCase.report)
    )
    
    if status is not None:
        query = query.where(ModerationCase.status == status)
    
    return db.scalars(
        query.order_by(ModerationCase.created_at.desc()).limit(limit)
    ).all()


def get_moderation_case(db: Session, case_id: int) -> ModerationCase | None:
    """Get a specific moderation case."""
    return db.scalar(
        select(ModerationCase)
        .options(selectinload(ModerationCase.report))
        .where(ModerationCase.id == case_id)
    )
