from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.ledger import LedgerAccount, LedgerEntry, ReconciliationRun


VIRTUAL_CREDIT_CURRENCY = "AVC"


def _decimal_amount(value: int | float | Decimal) -> Decimal:
    amount = Decimal(str(value)).quantize(Decimal("0.0001"))
    if amount <= 0:
        raise ValueError("Ledger amount must be greater than zero")
    return amount


def get_or_create_ledger_account(
    db: Session,
    *,
    owner_type: str,
    owner_id: int,
    currency: str = VIRTUAL_CREDIT_CURRENCY,
) -> LedgerAccount:
    account = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.owner_type == owner_type,
            LedgerAccount.owner_id == owner_id,
            LedgerAccount.currency == currency,
        )
    )
    if account is not None:
        return account
    account = LedgerAccount(owner_type=owner_type, owner_id=owner_id, currency=currency)
    db.add(account)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        account = db.scalar(
            select(LedgerAccount).where(
                LedgerAccount.owner_type == owner_type,
                LedgerAccount.owner_id == owner_id,
                LedgerAccount.currency == currency,
            )
        )
        if account is None:
            raise
    return account


def append_ledger_entry(
    db: Session,
    *,
    account: LedgerAccount,
    user_id: int | None,
    direction: str,
    amount: int | float | Decimal,
    entry_type: str,
    idempotency_key: str,
    provider: str | None = None,
    provider_reference: str | None = None,
    reference_type: str | None = None,
    reference_id: str | int | None = None,
    description: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> LedgerEntry:
    if direction not in {"credit", "debit"}:
        raise ValueError("Ledger direction must be credit or debit")
    existing = db.scalar(select(LedgerEntry).where(LedgerEntry.idempotency_key == idempotency_key))
    if existing is not None:
        return existing
    entry = LedgerEntry(
        account_id=account.id,
        user_id=user_id,
        direction=direction,
        amount=_decimal_amount(amount),
        currency=account.currency,
        entry_type=entry_type,
        provider=provider,
        provider_reference=provider_reference,
        reference_type=reference_type,
        reference_id=str(reference_id) if reference_id is not None else None,
        idempotency_key=idempotency_key,
        description=description,
        entry_metadata=metadata,
    )
    db.add(entry)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(LedgerEntry).where(LedgerEntry.idempotency_key == idempotency_key))
        if existing is None:
            raise
        return existing
    return entry


def get_ledger_balance(
    db: Session,
    *,
    owner_type: str,
    owner_id: int,
    currency: str = VIRTUAL_CREDIT_CURRENCY,
) -> Decimal:
    account = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.owner_type == owner_type,
            LedgerAccount.owner_id == owner_id,
            LedgerAccount.currency == currency,
        )
    )
    if account is None:
        return Decimal("0")
    credits = db.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
            LedgerEntry.account_id == account.id,
            LedgerEntry.direction == "credit",
        )
    ) or Decimal("0")
    debits = db.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
            LedgerEntry.account_id == account.id,
            LedgerEntry.direction == "debit",
        )
    ) or Decimal("0")
    return Decimal(credits) - Decimal(debits)


def credit_user_wallet(
    db: Session,
    *,
    user_id: int,
    amount: int | Decimal,
    entry_type: str,
    idempotency_key: str,
    provider: str | None = None,
    provider_reference: str | None = None,
    reference_type: str | None = None,
    reference_id: str | int | None = None,
    description: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> LedgerEntry:
    account = get_or_create_ledger_account(db, owner_type="user", owner_id=user_id)
    return append_ledger_entry(
        db,
        account=account,
        user_id=user_id,
        direction="credit",
        amount=amount,
        entry_type=entry_type,
        idempotency_key=idempotency_key,
        provider=provider,
        provider_reference=provider_reference,
        reference_type=reference_type,
        reference_id=reference_id,
        description=description,
        metadata=metadata,
    )


def debit_user_wallet(
    db: Session,
    *,
    user_id: int,
    amount: int | Decimal,
    entry_type: str,
    idempotency_key: str,
    reference_type: str | None = None,
    reference_id: str | int | None = None,
    description: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> LedgerEntry | None:
    balance = get_ledger_balance(db, owner_type="user", owner_id=user_id)
    amount_decimal = _decimal_amount(amount)
    if balance < amount_decimal:
        return None
    account = get_or_create_ledger_account(db, owner_type="user", owner_id=user_id)
    return append_ledger_entry(
        db,
        account=account,
        user_id=user_id,
        direction="debit",
        amount=amount_decimal,
        entry_type=entry_type,
        idempotency_key=idempotency_key,
        reference_type=reference_type,
        reference_id=reference_id,
        description=description,
        metadata=metadata,
    )


def start_reconciliation_run(db: Session, *, provider: str, cursor: str | None = None) -> ReconciliationRun:
    run = ReconciliationRun(provider=provider, cursor=cursor, status="running")
    db.add(run)
    db.flush()
    return run
