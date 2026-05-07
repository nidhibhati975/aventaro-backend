from __future__ import annotations

import base64
import json
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_DOWN

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.chat import Conversation, ConversationMember, ConversationType, Message, MessageStatus
from app.models.realtime import MessageDelivery
from app.models.trip import (
    Expense,
    ExpenseSplit,
    ExpenseSplitStatus,
    ExpenseSplitType,
    Trip,
    TripActivity,
    TripItineraryDay,
    TripItineraryItem,
    TripMember,
    TripMembershipStatus,
    TripPlace,
    TripPoll,
    TripVote,
    TripLifecycleStatus,
)
from app.models.user import User
from app.services.chat import mark_conversation_read


MONEY_STEP = Decimal("0.01")
DEFAULT_PAGE_LIMIT = 20
MAX_PAGE_LIMIT = 100


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def build_trip_conversation_id(trip_id: int) -> str:
    return f"trip:{trip_id}"


def build_trip_room_name(trip_id: int) -> str:
    return f"trip:{trip_id}"


def _normalize_page_limit(limit: int) -> int:
    return max(1, min(limit, MAX_PAGE_LIMIT))


def _encode_cursor(created_at: datetime, row_id: int) -> str:
    payload = json.dumps(
        {"created_at": created_at.isoformat(), "id": row_id},
        separators=(",", ":"),
    )
    return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("utf-8")


def _decode_cursor(cursor: str | None) -> tuple[datetime, int] | None:
    if cursor is None:
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode("utf-8")).decode("utf-8"))
        created_at = datetime.fromisoformat(payload["created_at"])
        row_id = int(payload["id"])
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        return created_at, row_id
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Invalid cursor") from exc


def _serialize_profile(user: User) -> dict[str, object] | None:
    profile = user.profile
    if profile is None:
        return None
    return {
        "name": profile.name,
        "age": profile.age,
        "bio": profile.bio,
        "location": profile.location,
        "gender": profile.gender,
        "travel_style": profile.travel_style,
        "interests": profile.interests,
        "budget_min": profile.budget_min,
        "budget_max": profile.budget_max,
    }


def _serialize_user(user: User) -> dict[str, object]:
    return {
        "id": user.id,
        "email": user.email,
        "profile": _serialize_profile(user),
    }


def _trip_query():
    return select(Trip).options(
        selectinload(Trip.owner).selectinload(User.profile),
        selectinload(Trip.members).selectinload(TripMember.user).selectinload(User.profile),
        selectinload(Trip.group_conversation)
        .selectinload(Conversation.members)
        .selectinload(ConversationMember.user)
        .selectinload(User.profile),
    )


def fetch_trip_for_collaboration(db: Session, trip_id: int) -> Trip | None:
    return db.scalar(_trip_query().where(Trip.id == trip_id))


def get_trip_workspace(db: Session, *, trip_id: int, current_user_id: int) -> Trip:
    trip = db.scalar(
        select(Trip)
        .options(
            selectinload(Trip.members),
            selectinload(Trip.itinerary_days).selectinload(TripItineraryDay.places),
            selectinload(Trip.itinerary_days).selectinload(TripItineraryDay.polls).selectinload(TripPoll.votes),
            selectinload(Trip.places),
            selectinload(Trip.polls).selectinload(TripPoll.votes),
        )
        .where(Trip.id == trip_id)
    )
    if trip is None:
        raise LookupError("Trip not found")

    if trip.owner_id != current_user_id:
        require_trip_member(trip, current_user_id)

    return trip


def _approved_members(trip: Trip) -> list[TripMember]:
    return [member for member in trip.members if member.status == TripMembershipStatus.approved]


def require_trip_member(trip: Trip, user_id: int) -> TripMember:
    member = next(
        (
            item
            for item in trip.members
            if item.user_id == user_id and item.status == TripMembershipStatus.approved
        ),
        None,
    )
    if member is None:
        raise PermissionError("Only approved trip members can access this resource")
    return member


def ensure_trip_collaboration_mutable(trip: Trip) -> None:
    if trip.lifecycle_status == TripLifecycleStatus.cancelled:
        raise RuntimeError("Cannot modify a cancelled trip")
    if trip.lifecycle_status == TripLifecycleStatus.completed:
        raise RuntimeError("Cannot modify a completed trip")


def _normalize_datetime_to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _trip_date_bounds(trip: Trip) -> tuple[date | None, date | None]:
    start_date = trip.start_date.date() if trip.start_date is not None else None
    end_date = trip.end_date.date() if trip.end_date is not None else None
    return start_date, end_date


def _validate_trip_day_date(trip: Trip, day_date: date) -> None:
    trip_start_date, trip_end_date = _trip_date_bounds(trip)
    if trip_start_date is not None and day_date < trip_start_date:
        raise ValueError("Itinerary day cannot be before the trip start date")
    if trip_end_date is not None and day_date > trip_end_date:
        raise ValueError("Itinerary day cannot be after the trip end date")


def _validate_trip_datetime_window(
    trip: Trip,
    *,
    starts_at: datetime | None,
    ends_at: datetime | None,
    starts_field_name: str = "starts_at",
    ends_field_name: str = "ends_at",
) -> tuple[datetime | None, datetime | None]:
    normalized_start = _normalize_datetime_to_utc(starts_at)
    normalized_end = _normalize_datetime_to_utc(ends_at)
    if normalized_start is not None and normalized_end is not None and normalized_end < normalized_start:
        raise ValueError(f"{ends_field_name} must be after {starts_field_name}")
    if trip.start_date is not None:
        if normalized_start is not None and normalized_start < trip.start_date:
            raise ValueError(f"{starts_field_name} cannot be before the trip start date")
        if normalized_end is not None and normalized_end < trip.start_date:
            raise ValueError(f"{ends_field_name} cannot be before the trip start date")
    if trip.end_date is not None:
        if normalized_start is not None and normalized_start > trip.end_date:
            raise ValueError(f"{starts_field_name} cannot be after the trip end date")
        if normalized_end is not None and normalized_end > trip.end_date:
            raise ValueError(f"{ends_field_name} cannot be after the trip end date")
    return normalized_start, normalized_end


def _validate_poll_close_time(trip: Trip, closes_at: datetime | None) -> datetime | None:
    normalized_close = _normalize_datetime_to_utc(closes_at)
    if normalized_close is None:
        return None
    if normalized_close <= _utcnow():
        raise ValueError("Poll close time must be in the future")
    if trip.start_date is not None and normalized_close < trip.start_date:
        raise ValueError("Poll close time cannot be before the trip start date")
    if trip.end_date is not None and normalized_close > trip.end_date:
        raise ValueError("Poll close time cannot be after the trip end date")
    return normalized_close


def log_trip_activity(
    db: Session,
    *,
    trip_id: int,
    user_id: int | None,
    activity_type: str,
    metadata: dict[str, object] | None = None,
    commit: bool = False,
) -> TripActivity:
    activity = TripActivity(
        trip_id=trip_id,
        user_id=user_id,
        activity_type=activity_type,
        activity_metadata=metadata,
    )
    db.add(activity)
    if commit:
        db.commit()
        db.refresh(activity)
    return activity


def ensure_trip_group_conversation(db: Session, trip: Trip) -> Conversation:
    conversation = trip.group_conversation
    if conversation is None:
        conversation = db.scalar(
            select(Conversation)
            .options(selectinload(Conversation.members))
            .where(Conversation.trip_id == trip.id)
        )
    if conversation is None:
        conversation = Conversation(
            id=build_trip_conversation_id(trip.id),
            conversation_type=ConversationType.group,
            trip_id=trip.id,
        )
        db.add(conversation)
        db.flush()
        trip.group_conversation = conversation

    approved_user_ids = set(
        db.scalars(
            select(TripMember.user_id).where(
                TripMember.trip_id == trip.id,
                TripMember.status == TripMembershipStatus.approved,
            )
        ).all()
    )
    existing_members = {member.user_id: member for member in conversation.members}
    for user_id in approved_user_ids:
        if user_id not in existing_members:
            db.add(ConversationMember(conversation_id=conversation.id, user_id=user_id))
    for user_id, member in list(existing_members.items()):
        if user_id not in approved_user_ids:
            db.delete(member)
    db.flush()
    return conversation


def _serialize_group_message(message: Message) -> dict[str, object]:
    return {
        "id": message.id,
        "conversation_id": message.conversation_id,
        "content": message.content,
        "message_status": message.message_status,
        "read_at": message.read_at,
        "created_at": message.created_at,
        "sender": _serialize_user(message.sender),
    }


def _paginate_messages(
    db: Session,
    *,
    conversation_id: str,
    limit: int,
    cursor: str | None,
) -> tuple[list[Message], str | None]:
    normalized_limit = _normalize_page_limit(limit)
    cursor_value = _decode_cursor(cursor)
    query = (
        select(Message)
        .options(selectinload(Message.sender).selectinload(User.profile))
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(normalized_limit + 1)
    )
    if cursor_value is not None:
        created_at, row_id = cursor_value
        query = query.where(
            or_(
                Message.created_at < created_at,
                and_(Message.created_at == created_at, Message.id < row_id),
            )
        )
    messages = db.scalars(query).all()
    next_cursor = None
    if len(messages) > normalized_limit:
        messages = messages[:normalized_limit]
        last_message = messages[-1]
        next_cursor = _encode_cursor(last_message.created_at, last_message.id)
    return messages, next_cursor


def get_trip_chat(
    db: Session,
    *,
    trip_id: int,
    current_user_id: int,
    limit: int = DEFAULT_PAGE_LIMIT,
    cursor: str | None = None,
) -> dict[str, object]:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    conversation = ensure_trip_group_conversation(db, trip)
    db.commit()
    read_receipt = mark_conversation_read(db=db, conversation=conversation, user_id=current_user_id)
    messages, next_cursor = _paginate_messages(
        db=db,
        conversation_id=conversation.id,
        limit=limit,
        cursor=cursor,
    )
    approved_members = _approved_members(trip)
    return {
        "conversation_id": conversation.id,
        "trip_id": trip.id,
        "members": [_serialize_user(member.user) for member in approved_members],
        "messages": [_serialize_group_message(message) for message in messages],
        "next_cursor": next_cursor,
        "read_receipt": read_receipt,
    }


def send_group_message(
    db: Session,
    *,
    trip_id: int,
    sender_id: int,
    content: str,
) -> tuple[dict[str, object], list[int]]:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, sender_id)
    conversation = ensure_trip_group_conversation(db, trip)
    normalized_content = content.strip()
    if not normalized_content:
        raise ValueError("Message content cannot be blank")
    message = Message(
        conversation_id=conversation.id,
        sender_id=sender_id,
        recipient_id=None,
        content=normalized_content,
        message_status=MessageStatus.sent,
    )
    db.add(message)
    db.flush()
    approved_member_ids = [member.user_id for member in _approved_members(trip)]
    for member_id in approved_member_ids:
        if member_id != sender_id:
            db.add(MessageDelivery(message_id=message.id, user_id=member_id, status="pending"))
    conversation.last_message_at = _utcnow()
    log_trip_activity(
        db,
        trip_id=trip.id,
        user_id=sender_id,
        activity_type="message",
        metadata={"conversation_id": conversation.id, "message_id": message.id},
        commit=False,
    )
    db.commit()
    message = db.scalar(
        select(Message)
        .options(selectinload(Message.sender).selectinload(User.profile))
        .where(Message.id == message.id)
    )
    return _serialize_group_message(message), approved_member_ids


def _to_money(amount: float | Decimal | str) -> Decimal:
    return Decimal(str(amount)).quantize(MONEY_STEP)


def _normalize_split_rows(
    *,
    trip: Trip,
    paid_by_user_id: int,
    raw_splits: list[dict[str, object]] | None,
) -> list[tuple[int, dict[str, object]]]:
    normalized: list[tuple[int, dict[str, object]]] = []
    approved_user_ids = {member.user_id for member in _approved_members(trip)}
    seen_user_ids: set[int] = set()
    for item in raw_splits or []:
        user_id = int(item["user_id"])
        if user_id == paid_by_user_id:
            raise ValueError("Payer cannot be included in owing splits")
        if user_id not in approved_user_ids:
            raise ValueError("Split users must be approved trip members")
        if user_id in seen_user_ids:
            raise ValueError("Duplicate split user is not allowed")
        seen_user_ids.add(user_id)
        normalized.append((user_id, item))
    return normalized


def _split_equal(amount: Decimal, member_ids: list[int]) -> dict[int, Decimal]:
    if not member_ids:
        return {}
    count = len(member_ids)
    base_share = (amount / count).quantize(MONEY_STEP, rounding=ROUND_DOWN)
    remainder = amount - (base_share * count)
    extra_cents = int((remainder / MONEY_STEP).to_integral_value())
    splits: dict[int, Decimal] = {}
    for index, user_id in enumerate(member_ids):
        splits[user_id] = base_share + (MONEY_STEP if index < extra_cents else Decimal("0.00"))
    return splits


def _split_percentage(amount: Decimal, rows: list[tuple[int, dict[str, object]]]) -> dict[int, Decimal]:
    if not rows:
        raise ValueError("Percentage splits are required for percentage split type")
    percentage_total = sum(_to_money(item["percentage"]) for _, item in rows)
    if percentage_total != Decimal("100.00"):
        raise ValueError("Percentage splits must total exactly 100")
    splits: dict[int, Decimal] = {}
    allocated = Decimal("0.00")
    for index, (user_id, item) in enumerate(rows):
        percentage = _to_money(item["percentage"])
        if percentage <= 0:
            raise ValueError("Percentage split values must be positive")
        if index == len(rows) - 1:
            split_amount = (amount - allocated).quantize(MONEY_STEP)
        else:
            split_amount = ((amount * percentage) / Decimal("100")).quantize(MONEY_STEP, rounding=ROUND_DOWN)
            allocated += split_amount
        splits[user_id] = split_amount
    if sum(splits.values()).quantize(MONEY_STEP) != amount:
        raise ValueError("Percentage split amounts must total the full expense amount")
    return splits


def _split_custom(amount: Decimal, rows: list[tuple[int, dict[str, object]]]) -> dict[int, Decimal]:
    if not rows:
        raise ValueError("Custom splits are required for custom split type")
    splits: dict[int, Decimal] = {}
    total = Decimal("0.00")
    for user_id, item in rows:
        split_amount = _to_money(item["amount"])
        if split_amount <= 0:
            raise ValueError("Custom split amounts must be positive")
        splits[user_id] = split_amount
        total += split_amount
    if total.quantize(MONEY_STEP) != amount:
        raise ValueError("Custom split amounts must total the full expense amount")
    return splits


def _build_expense_splits(
    *,
    trip: Trip,
    paid_by_user_id: int,
    amount: Decimal,
    split_type: ExpenseSplitType,
    raw_splits: list[dict[str, object]] | None,
) -> dict[int, Decimal]:
    if split_type == ExpenseSplitType.equal:
        member_ids = sorted(member.user_id for member in _approved_members(trip) if member.user_id != paid_by_user_id)
        return _split_equal(amount, member_ids)

    normalized_rows = _normalize_split_rows(trip=trip, paid_by_user_id=paid_by_user_id, raw_splits=raw_splits)
    if split_type == ExpenseSplitType.percentage:
        return _split_percentage(amount, normalized_rows)
    if split_type == ExpenseSplitType.custom:
        return _split_custom(amount, normalized_rows)
    raise ValueError("Unsupported split type")


def _serialize_expense(expense: Expense) -> dict[str, object]:
    return {
        "id": expense.id,
        "trip_id": expense.trip_id,
        "paid_by": _serialize_user(expense.payer),
        "amount": float(expense.amount),
        "description": expense.description,
        "split_type": expense.split_type,
        "created_at": expense.created_at,
        "splits": [
            {
                "id": split.id,
                "user": _serialize_user(split.user),
                "amount": float(split.amount),
                "status": split.status,
            }
            for split in sorted(expense.splits, key=lambda item: item.user_id)
        ],
    }


def create_trip_expense(
    db: Session,
    *,
    trip_id: int,
    paid_by_user_id: int,
    amount: float,
    description: str,
    split_type: ExpenseSplitType = ExpenseSplitType.equal,
    splits: list[dict[str, object]] | None = None,
) -> tuple[dict[str, object], list[int]]:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, paid_by_user_id)
    normalized_description = description.strip()
    if not normalized_description:
        raise ValueError("Description cannot be blank")
    amount_decimal = _to_money(amount)
    if amount_decimal <= 0:
        raise ValueError("Expense amount must be positive")

    split_amounts = _build_expense_splits(
        trip=trip,
        paid_by_user_id=paid_by_user_id,
        amount=amount_decimal,
        split_type=split_type,
        raw_splits=splits,
    )

    expense = Expense(
        trip_id=trip.id,
        paid_by=paid_by_user_id,
        amount=amount_decimal,
        description=normalized_description,
        split_type=split_type,
    )
    db.add(expense)
    db.flush()

    for user_id, split_amount in split_amounts.items():
        db.add(
            ExpenseSplit(
                expense_id=expense.id,
                user_id=user_id,
                amount=split_amount,
                status=ExpenseSplitStatus.owed,
            )
        )

    log_trip_activity(
        db,
        trip_id=trip.id,
        user_id=paid_by_user_id,
        activity_type="expense",
        metadata={
            "expense_id": expense.id,
            "amount": float(amount_decimal),
            "description": normalized_description,
            "split_type": split_type.value,
        },
        commit=False,
    )
    db.commit()
    expense = db.scalar(
        select(Expense)
        .options(
            selectinload(Expense.payer).selectinload(User.profile),
            selectinload(Expense.splits).selectinload(ExpenseSplit.user).selectinload(User.profile),
        )
        .where(Expense.id == expense.id)
    )
    return _serialize_expense(expense), [member.user_id for member in _approved_members(trip)]


def list_trip_expenses(db: Session, *, trip_id: int, current_user_id: int) -> list[dict[str, object]]:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    expenses = db.scalars(
        select(Expense)
        .options(
            selectinload(Expense.payer).selectinload(User.profile),
            selectinload(Expense.splits).selectinload(ExpenseSplit.user).selectinload(User.profile),
        )
        .where(Expense.trip_id == trip_id)
        .order_by(Expense.created_at.desc(), Expense.id.desc())
    ).all()
    return [_serialize_expense(expense) for expense in expenses]


def settle_expense(
    db: Session,
    *,
    expense_id: int,
    current_user_id: int,
) -> tuple[dict[str, object], int, list[int]]:
    split = db.scalar(
        select(ExpenseSplit)
        .options(
            selectinload(ExpenseSplit.user).selectinload(User.profile),
            selectinload(ExpenseSplit.expense).selectinload(Expense.payer).selectinload(User.profile),
        )
        .where(ExpenseSplit.expense_id == expense_id, ExpenseSplit.user_id == current_user_id)
        .with_for_update()
    )
    if split is None:
        raise LookupError("Expense split not found for this user")
    trip = fetch_trip_for_collaboration(db=db, trip_id=split.expense.trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    if split.status == ExpenseSplitStatus.settled:
        raise RuntimeError("Expense already settled")

    split.status = ExpenseSplitStatus.settled
    log_trip_activity(
        db,
        trip_id=trip.id,
        user_id=current_user_id,
        activity_type="expense_settled",
        metadata={"expense_id": split.expense_id, "split_id": split.id, "amount": float(split.amount)},
        commit=False,
    )
    approved_member_ids = [member.user_id for member in _approved_members(trip)]
    db.commit()
    return (
        {
            "id": split.id,
            "expense_id": split.expense_id,
            "trip_id": trip.id,
            "amount": float(split.amount),
            "status": split.status,
            "user": _serialize_user(split.user),
        },
        trip.id,
        approved_member_ids,
    )


def calculate_trip_balances(db: Session, *, trip_id: int, current_user_id: int) -> dict[str, object]:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    expenses = db.scalars(
        select(Expense)
        .options(selectinload(Expense.payer).selectinload(User.profile), selectinload(Expense.splits))
        .where(Expense.trip_id == trip_id)
    ).all()

    member_map = {member.user_id: member.user for member in _approved_members(trip)}
    totals_paid: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))
    totals_owed: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))
    credits: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))
    net: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))

    for expense in expenses:
        totals_paid[expense.paid_by] += Decimal(expense.amount)
        for split in expense.splits:
            if split.status != ExpenseSplitStatus.owed:
                continue
            split_amount = Decimal(split.amount)
            totals_owed[split.user_id] += split_amount
            credits[expense.paid_by] += split_amount
            net[split.user_id] -= split_amount
            net[expense.paid_by] += split_amount

    debtors = [(user_id, -balance) for user_id, balance in net.items() if balance < 0]
    creditors = [(user_id, balance) for user_id, balance in net.items() if balance > 0]
    debtors.sort(key=lambda item: item[0])
    creditors.sort(key=lambda item: item[0])

    settlements: list[dict[str, object]] = []
    debtor_index = 0
    creditor_index = 0
    while debtor_index < len(debtors) and creditor_index < len(creditors):
        debtor_id, debt_amount = debtors[debtor_index]
        creditor_id, credit_amount = creditors[creditor_index]
        payment_amount = min(debt_amount, credit_amount).quantize(MONEY_STEP)
        if payment_amount > 0:
            settlements.append(
                {
                    "from_user": _serialize_user(member_map[debtor_id]),
                    "to_user": _serialize_user(member_map[creditor_id]),
                    "amount": float(payment_amount),
                }
            )
        remaining_debt = (debt_amount - payment_amount).quantize(MONEY_STEP)
        remaining_credit = (credit_amount - payment_amount).quantize(MONEY_STEP)
        debtors[debtor_index] = (debtor_id, remaining_debt)
        creditors[creditor_index] = (creditor_id, remaining_credit)
        if remaining_debt <= 0:
            debtor_index += 1
        if remaining_credit <= 0:
            creditor_index += 1

    member_balances = []
    for user_id, user in sorted(member_map.items(), key=lambda item: item[0]):
        member_balances.append(
            {
                "user": _serialize_user(user),
                "total_paid": float(totals_paid[user_id].quantize(MONEY_STEP)),
                "total_owed": float(totals_owed[user_id].quantize(MONEY_STEP)),
                "outstanding_credit": float(credits[user_id].quantize(MONEY_STEP)),
                "net_balance": float(net[user_id].quantize(MONEY_STEP)),
            }
        )

    return {
        "trip_id": trip.id,
        "members": member_balances,
        "settlements": settlements,
    }


def list_trip_itinerary(
    db: Session,
    *,
    trip_id: int,
    current_user_id: int,
) -> list[TripItineraryItem]:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    return db.scalars(
        select(TripItineraryItem)
        .where(TripItineraryItem.trip_id == trip_id)
        .order_by(TripItineraryItem.order_index, TripItineraryItem.created_at)
    ).all()


def create_trip_itinerary_item(
    db: Session,
    *,
    trip_id: int,
    current_user_id: int,
    title: str,
    description: str | None = None,
    item_date: date | None = None,
    order_index: int = 0,
) -> TripItineraryItem:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    ensure_trip_collaboration_mutable(trip)
    item = TripItineraryItem(
        trip_id=trip_id,
        title=title,
        description=description,
        item_date=item_date,
        order_index=order_index,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def update_trip_itinerary_item(
    db: Session,
    *,
    trip_id: int,
    item_id: int,
    current_user_id: int,
    title: str | None = None,
    description: str | None = None,
    item_date: date | None = None,
    order_index: int | None = None,
) -> TripItineraryItem:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    ensure_trip_collaboration_mutable(trip)
    item = db.scalar(
        select(TripItineraryItem)
        .where(TripItineraryItem.id == item_id, TripItineraryItem.trip_id == trip_id)
    )
    if item is None:
        raise LookupError("Itinerary item not found")
    if title is not None:
        item.title = title
    if description is not None:
        item.description = description
    if item_date is not None:
        item.item_date = item_date
    if order_index is not None:
        item.order_index = order_index
    db.commit()
    db.refresh(item)
    return item


def delete_trip_itinerary_item(
    db: Session,
    *,
    trip_id: int,
    item_id: int,
    current_user_id: int,
) -> None:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    ensure_trip_collaboration_mutable(trip)
    item = db.scalar(
        select(TripItineraryItem)
        .where(TripItineraryItem.id == item_id, TripItineraryItem.trip_id == trip_id)
    )
    if item is None:
        raise LookupError("Itinerary item not found")
    db.delete(item)
    db.commit()


def create_trip_itinerary_day(
    db: Session,
    *,
    trip_id: int,
    current_user_id: int,
    day_date: date,
    title: str | None = None,
    notes: str | None = None,
) -> TripItineraryDay:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    ensure_trip_collaboration_mutable(trip)
    _validate_trip_day_date(trip, day_date)
    existing = db.scalar(
        select(TripItineraryDay).where(TripItineraryDay.trip_id == trip_id, TripItineraryDay.day_date == day_date)
    )
    if existing is not None:
        raise ValueError("An itinerary day already exists for that date")
    day = TripItineraryDay(
        trip_id=trip_id,
        created_by_user_id=current_user_id,
        day_date=day_date,
        title=title.strip() if title else None,
        notes=notes.strip() if notes else None,
    )
    db.add(day)
    log_trip_activity(
        db,
        trip_id=trip_id,
        user_id=current_user_id,
        activity_type="itinerary_day_created",
        metadata={"day_date": day_date.isoformat(), "title": day.title},
        commit=False,
    )
    db.commit()
    db.refresh(day)
    return day


def create_trip_place(
    db: Session,
    *,
    trip_id: int,
    current_user_id: int,
    name: str,
    address: str | None = None,
    notes: str | None = None,
    day_id: int | None = None,
    external_place_id: str | None = None,
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
    order_index: int = 0,
) -> TripPlace:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    ensure_trip_collaboration_mutable(trip)
    normalized_starts_at, normalized_ends_at = _validate_trip_datetime_window(
        trip,
        starts_at=starts_at,
        ends_at=ends_at,
    )
    day = None
    if day_id is not None:
        day = db.scalar(select(TripItineraryDay).where(TripItineraryDay.id == day_id, TripItineraryDay.trip_id == trip_id))
        if day is None:
            raise LookupError("Itinerary day not found")
    place = TripPlace(
        trip_id=trip_id,
        day_id=day.id if day is not None else None,
        created_by_user_id=current_user_id,
        name=name.strip(),
        address=address.strip() if address else None,
        notes=notes.strip() if notes else None,
        external_place_id=external_place_id,
        starts_at=normalized_starts_at,
        ends_at=normalized_ends_at,
        order_index=order_index,
    )
    db.add(place)
    log_trip_activity(
        db,
        trip_id=trip_id,
        user_id=current_user_id,
        activity_type="trip_place_created",
        metadata={"name": place.name, "day_id": place.day_id},
        commit=False,
    )
    db.commit()
    db.refresh(place)
    return place


def update_trip_place(
    db: Session,
    *,
    trip_id: int,
    place_id: int,
    current_user_id: int,
    name: str | None = None,
    address: str | None = None,
    notes: str | None = None,
    day_id: int | None = None,
    external_place_id: str | None = None,
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
    order_index: int | None = None,
) -> TripPlace:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    ensure_trip_collaboration_mutable(trip)
    place = db.scalar(select(TripPlace).where(TripPlace.id == place_id, TripPlace.trip_id == trip_id))
    if place is None:
        raise LookupError("Trip place not found")
    if day_id is not None:
        if day_id == 0:
            place.day_id = None
        else:
            day = db.scalar(select(TripItineraryDay).where(TripItineraryDay.id == day_id, TripItineraryDay.trip_id == trip_id))
            if day is None:
                raise LookupError("Itinerary day not found")
            place.day_id = day.id
    if name is not None:
        place.name = name.strip()
    if address is not None:
        place.address = address.strip() or None
    if notes is not None:
        place.notes = notes.strip() or None
    if external_place_id is not None:
        place.external_place_id = external_place_id
    next_starts_at = _normalize_datetime_to_utc(starts_at) if starts_at is not None else place.starts_at
    next_ends_at = _normalize_datetime_to_utc(ends_at) if ends_at is not None else place.ends_at
    validated_starts_at, validated_ends_at = _validate_trip_datetime_window(
        trip,
        starts_at=next_starts_at,
        ends_at=next_ends_at,
    )
    if starts_at is not None:
        place.starts_at = validated_starts_at
    if ends_at is not None:
        place.ends_at = validated_ends_at
    if order_index is not None:
        place.order_index = order_index
    log_trip_activity(
        db,
        trip_id=trip_id,
        user_id=current_user_id,
        activity_type="trip_place_updated",
        metadata={"place_id": place.id, "name": place.name},
        commit=False,
    )
    db.commit()
    db.refresh(place)
    return place


def delete_trip_place(
    db: Session,
    *,
    trip_id: int,
    place_id: int,
    current_user_id: int,
) -> None:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    ensure_trip_collaboration_mutable(trip)
    place = db.scalar(select(TripPlace).where(TripPlace.id == place_id, TripPlace.trip_id == trip_id))
    if place is None:
        raise LookupError("Trip place not found")
    log_trip_activity(
        db,
        trip_id=trip_id,
        user_id=current_user_id,
        activity_type="trip_place_deleted",
        metadata={"place_id": place.id, "name": place.name},
        commit=False,
    )
    db.delete(place)
    db.commit()


def create_trip_poll(
    db: Session,
    *,
    trip_id: int,
    current_user_id: int,
    question: str,
    options: list[str],
    day_id: int | None = None,
    closes_at: datetime | None = None,
) -> TripPoll:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    ensure_trip_collaboration_mutable(trip)
    normalized_options = [option.strip() for option in options if option and option.strip()]
    if len(normalized_options) < 2:
        raise ValueError("A poll requires at least two options")
    if len(set(value.lower() for value in normalized_options)) != len(normalized_options):
        raise ValueError("Poll options must be unique")
    if day_id is not None:
        day = db.scalar(select(TripItineraryDay).where(TripItineraryDay.id == day_id, TripItineraryDay.trip_id == trip_id))
        if day is None:
            raise LookupError("Itinerary day not found")
    normalized_closes_at = _validate_poll_close_time(trip, closes_at)
    poll = TripPoll(
        trip_id=trip_id,
        day_id=day_id,
        created_by_user_id=current_user_id,
        question=question.strip(),
        options=normalized_options,
        closes_at=normalized_closes_at,
    )
    db.add(poll)
    log_trip_activity(
        db,
        trip_id=trip_id,
        user_id=current_user_id,
        activity_type="trip_poll_created",
        metadata={"question": poll.question, "option_count": len(normalized_options)},
        commit=False,
    )
    db.commit()
    db.refresh(poll)
    return poll


def cast_trip_vote(
    db: Session,
    *,
    trip_id: int,
    poll_id: int,
    current_user_id: int,
    option_index: int,
) -> TripPoll:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)
    ensure_trip_collaboration_mutable(trip)
    poll = db.scalar(
        select(TripPoll)
        .options(selectinload(TripPoll.votes))
        .where(TripPoll.id == poll_id, TripPoll.trip_id == trip_id)
    )
    if poll is None:
        raise LookupError("Trip poll not found")
    if poll.closes_at is not None and poll.closes_at <= _utcnow():
        raise ValueError("Poll is closed")
    if option_index < 0 or option_index >= len(poll.options):
        raise ValueError("Invalid poll option")

    vote = db.scalar(select(TripVote).where(TripVote.poll_id == poll_id, TripVote.user_id == current_user_id))
    if vote is None:
        vote = TripVote(
            trip_id=trip_id,
            poll_id=poll_id,
            user_id=current_user_id,
            option_index=option_index,
        )
        db.add(vote)
    else:
        vote.option_index = option_index
    log_trip_activity(
        db,
        trip_id=trip_id,
        user_id=current_user_id,
        activity_type="trip_poll_voted",
        metadata={"poll_id": poll_id, "option_index": option_index},
        commit=False,
    )
    db.commit()
    return db.scalar(
        select(TripPoll)
        .options(selectinload(TripPoll.votes))
        .where(TripPoll.id == poll_id)
    )


def list_trip_activities(
    db: Session,
    *,
    trip_id: int,
    current_user_id: int,
    limit: int = DEFAULT_PAGE_LIMIT,
    cursor: str | None = None,
) -> dict[str, object]:
    trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
    if trip is None:
        raise LookupError("Trip not found")
    require_trip_member(trip, current_user_id)

    normalized_limit = _normalize_page_limit(limit)
    cursor_value = _decode_cursor(cursor)
    query = (
        select(TripActivity)
        .options(selectinload(TripActivity.user).selectinload(User.profile))
        .where(TripActivity.trip_id == trip_id)
        .order_by(TripActivity.created_at.desc(), TripActivity.id.desc())
        .limit(normalized_limit + 1)
    )
    if cursor_value is not None:
        created_at, row_id = cursor_value
        query = query.where(
            or_(
                TripActivity.created_at < created_at,
                and_(TripActivity.created_at == created_at, TripActivity.id < row_id),
            )
        )
    activities = db.scalars(query).all()
    next_cursor = None
    if len(activities) > normalized_limit:
        activities = activities[:normalized_limit]
        last_activity = activities[-1]
        next_cursor = _encode_cursor(last_activity.created_at, last_activity.id)

    return {
        "items": [
            {
                "id": activity.id,
                "trip_id": activity.trip_id,
                "user": _serialize_user(activity.user) if activity.user is not None else None,
                "type": activity.activity_type,
                "metadata": activity.activity_metadata,
                "created_at": activity.created_at,
            }
            for activity in activities
        ],
        "next_cursor": next_cursor,
    }
