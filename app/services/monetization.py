from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

try:
    import razorpay
except ImportError:  # pragma: no cover - optional dependency in local dev
    razorpay = None
from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.models.payments import Subscription
from app.models.user import User
from app.models.monetization import (
    BoostPurchase,
    CommissionRecord,
    RewardAction,
    RewardTransaction,
    RevenueMetrics,
    TransactionType,
    UserRewardBalance,
)
from app.services.external_retry import call_with_retries
from app.services.ledger import credit_user_wallet, debit_user_wallet, get_ledger_balance
from app.services.subscriptions import (
    PREMIUM_PLAN,
    STATUS_ACTIVE,
    ensure_subscription_record,
    is_premium_record,
)
from app.utils.config import get_settings


# ============== PLAN CONFIGURATION ==============

class PlanTier:
    FREE = "free"
    PRO = "pro"
    ELITE = "elite"


PLAN_PRICING = {
    PlanTier.FREE: {
        "name": "Free",
        "monthly_price": 0,
        "yearly_price": 0,
        "features": [
            "Basic profile",
            "10 swipes per day",
            "Basic matching",
            "Limited filters",
        ],
    },
    PlanTier.PRO: {
        "name": "Pro",
        "monthly_price": 299,
        "yearly_price": 2499,
        "features": [
            "Unlimited swipes",
            "Profile boost (1/day)",
            "See who liked you",
            "Advanced filters",
            "Priority matching",
            "No ads",
        ],
    },
    PlanTier.ELITE: {
        "name": "Elite",
        "monthly_price": 799,
        "yearly_price": 6999,
        "features": [
            "Everything in Pro",
            "Super boost (3/week)",
            "Unlimited trip boosts",
            "Exclusive events",
            "Dedicated support",
            "Premium badge",
        ],
    },
}


# ============== BOOST CONFIGURATION ==============

BOOST_CONFIG = {
    "profile": {
        "name": "Profile Boost",
        "price": 99,
        "duration_minutes": 30,
        "description": "Get 30 minutes of top visibility",
        "max_per_day": 3,
    },
    "super": {
        "name": "Super Boost",
        "price": 249,
        "duration_minutes": 60,
        "description": "Stay at top for 1 hour",
        "max_per_week": 3,
    },
    "trip": {
        "name": "Trip Boost",
        "price": 149,
        "duration_minutes": 120,
        "description": "Boost your trip visibility for 2 hours",
        "max_per_trip": 2,
    },
}


# ============== REWARD ACTION CONFIGURATION ==============

REWARD_ACTIONS = {
    "daily_login": {"coins": 10, "max_per_day": 1, "description": "Daily login bonus"},
    "complete_profile": {"coins": 50, "max_per_day": 1, "description": "Complete your profile"},
    "first_match": {"coins": 100, "max_per_day": 1, "description": "First match bonus"},
    "send_message": {"coins": 5, "max_per_day": 50, "description": "Send a message"},
    "go_on_trip": {"coins": 200, "max_per_day": 1, "description": "Go on a trip"},
    "referral_signup": {"coins": 100, "max_per_day": 10, "description": "Referral signup"},
    "referral_subscription": {"coins": 500, "max_per_day": 5, "description": "Referral subscribes"},
    "streak_7_days": {"coins": 100, "max_per_day": 1, "description": "7-day streak"},
    "streak_30_days": {"coins": 500, "max_per_day": 1, "description": "30-day streak"},
    "share_profile": {"coins": 20, "max_per_day": 5, "description": "Share profile"},
    "rate_app": {"coins": 100, "max_per_day": 1, "description": "Rate the app"},
}


# ============== COMMISSION CONFIGURATION ==============

DEFAULT_COMMISSION_RATE = Decimal("0.10")  # 10%
SERVICE_FEE_RATE = Decimal("0.05")  # 5%


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ============== RAZORPAY SERVICE ==============

def _get_razorpay_client() -> razorpay.Client:
    settings = get_settings()
    if razorpay is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Razorpay SDK is not installed")
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Razorpay is not configured")
    return razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))


# ============== SUBSCRIPTION SERVICE ==============

def get_plan_details(plan_type: str) -> dict[str, Any]:
    return PLAN_PRICING.get(plan_type, PLAN_PRICING[PlanTier.FREE])


def get_available_plans() -> list[dict[str, Any]]:
    return [
        {
            "plan_type": plan_type,
            **details,
        }
        for plan_type, details in PLAN_PRICING.items()
    ]


def get_user_subscription_with_plan(db: Session, user_id: int) -> dict[str, Any]:
    subscription = ensure_subscription_record(db, user_id)
    plan_details = get_plan_details(subscription.plan_type)
    
    return {
        "subscription": {
            "user_id": subscription.user_id,
            "plan_type": subscription.plan_type,
            "status": subscription.status,
            "current_period_end": subscription.current_period_end,
            "is_premium": is_premium_record(subscription),
        },
        "plan": plan_details,
    }


def calculate_subscription_price(plan_type: str, billing_cycle: str = "monthly") -> int:
    plan = PLAN_PRICING.get(plan_type, PLAN_PRICING[PlanTier.FREE])
    if billing_cycle == "yearly":
        return plan.get("yearly_price", 0)
    return plan.get("monthly_price", 0)


# ============== PAYMENT SERVICE ==============

def create_razorpay_order(
    db: Session,
    user: User,
    amount: int,
    currency: str = "INR",
    receipt: str | None = None,
) -> dict[str, Any]:
    """Create a Razorpay order for one-time payment (boost, etc.)"""
    client = _get_razorpay_client()
    
    order_data = {
        "amount": amount * 100,  # Razorpay expects paise
        "currency": currency,
        "receipt": receipt or f"user_{user.id}_{int(utcnow().timestamp())}",
        "notes": {
            "user_id": str(user.id),
        },
    }
    
    try:
        order = call_with_retries(lambda: client.order.create(data=order_data))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Razorpay order creation unavailable") from exc
    return order


def verify_razorpay_payment(
    razorpay_order_id: str,
    razorpay_payment_id: str,
    razorpay_signature: str,
) -> bool:
    """Verify Razorpay payment signature"""
    settings = get_settings()
    client = _get_razorpay_client()
    
    try:
        client.utility.verify_payment_signature({
            "razorpay_order_id": razorpay_order_id,
            "razorpay_payment_id": razorpay_payment_id,
            "razorpay_signature": razorpay_signature,
        })
        return True
    except Exception:
        return False


def process_razorpay_webhook(db: Session, payload: dict) -> dict[str, Any]:
    """Process Razorpay webhook events"""
    event = payload.get("event")
    payload_data = payload.get("payload", {}).get("payment", {})
    
    if event == "payment.captured":
        order_id = payload_data.get("order_id")
        # Process successful payment
        return {"status": "processed", "order_id": order_id}
    elif event == "payment.failed":
        order_id = payload_data.get("order_id")
        return {"status": "failed", "order_id": order_id}
    
    return {"status": "ignored", "event": event}


# ============== BOOST SERVICE ==============

def get_boost_config(boost_type: str) -> dict[str, Any]:
    return BOOST_CONFIG.get(boost_type, BOOST_CONFIG["profile"])


def get_available_boosts() -> list[dict[str, Any]]:
    return [
        {
            "boost_type": boost_type,
            **config,
        }
        for boost_type, config in BOOST_CONFIG.items()
    ]


def purchase_boost(
    db: Session,
    user: User,
    boost_type: str,
    payment_method: str = "razorpay",
) -> BoostPurchase:
    """Purchase a boost for the user"""
    config = get_boost_config(boost_type)
    
    boost_purchase = BoostPurchase(
        user_id=user.id,
        boost_type=boost_type,
        amount_paid=config["price"],
        currency="INR",
        payment_method=payment_method,
        status="pending",
        duration_minutes=config["duration_minutes"],
    )
    
    db.add(boost_purchase)
    db.commit()
    db.refresh(boost_purchase)
    
    return boost_purchase


def activate_boost(db: Session, user_id: int, boost_type: str) -> dict[str, Any]:
    """Activate a purchased boost"""
    from app.models.growth import Boost
    
    config = get_boost_config(boost_type)
    now = utcnow()
    expires_at = now + timedelta(minutes=config["duration_minutes"])
    
    # Check existing boost
    existing = db.scalar(
        select(Boost)
        .where(
            Boost.user_id == user_id,
            Boost.boost_type == boost_type,
            Boost.expires_at > now,
        )
    )
    
    if existing:
        # Extend existing boost
        existing.expires_at = expires_at
        existing.last_activated_at = now
        db.commit()
        db.refresh(existing)
        return {
            "boost_id": existing.id,
            "boost_type": boost_type,
            "expires_at": expires_at,
            "extended": True,
        }
    
    # Create new boost
    boost = Boost(
        user_id=user_id,
        boost_type=boost_type,
        last_activated_at=now,
        expires_at=expires_at,
    )
    db.add(boost)
    db.commit()
    db.refresh(boost)
    
    return {
        "boost_id": boost.id,
        "boost_type": boost_type,
        "expires_at": expires_at,
        "extended": False,
    }


def get_active_boosts(db: Session, user_id: int) -> list[dict[str, Any]]:
    """Get all active boosts for a user"""
    from app.models.growth import Boost
    
    now = utcnow()
    boosts = db.scalars(
        select(Boost)
        .where(
            Boost.user_id == user_id,
            Boost.expires_at > now,
        )
        .order_by(Boost.expires_at.desc())
    ).all()
    
    return [
        {
            "id": boost.id,
            "boost_type": boost.boost_type,
            "config": get_boost_config(boost.boost_type),
            "expires_at": boost.expires_at,
            "remaining_minutes": int((boost.expires_at - now).total_seconds() / 60),
        }
        for boost in boosts
    ]


def get_boost_purchase_history(db: Session, user_id: int) -> list[BoostPurchase]:
    """Get boost purchase history"""
    return db.scalars(
        select(BoostPurchase)
        .where(BoostPurchase.user_id == user_id)
        .order_by(BoostPurchase.created_at.desc())
    ).all()


# ============== REWARD/COINS SERVICE ==============

def ensure_reward_balance(db: Session, user_id: int) -> UserRewardBalance:
    """Ensure user has a reward balance record"""
    balance = db.scalar(
        select(UserRewardBalance).where(UserRewardBalance.user_id == user_id)
    )
    
    if balance is None:
        balance = UserRewardBalance(user_id=user_id, coins=0, lifetime_coins=0)
        db.add(balance)
        db.commit()
        db.refresh(balance)
    
    return balance


def get_reward_balance(db: Session, user_id: int) -> dict[str, Any]:
    """Get user's reward balance"""
    balance = int(get_ledger_balance(db, owner_type="user", owner_id=user_id))
    lifetime = int(
        db.scalar(
            select(func.coalesce(func.sum(RewardTransaction.amount), 0)).where(
                RewardTransaction.user_id == user_id,
                RewardTransaction.amount > 0,
            )
        )
        or 0
    )
    
    return {
        "coins": balance,
        "lifetime_coins": lifetime,
        "updated_at": utcnow(),
    }


def add_coins(
    db: Session,
    user_id: int,
    amount: int,
    transaction_type: TransactionType,
    description: str | None = None,
    reference_type: str | None = None,
    reference_id: int | None = None,
) -> RewardTransaction:
    """Add coins to user's balance"""
    idempotency_key = f"wallet:credit:{user_id}:{transaction_type.value if hasattr(transaction_type, 'value') else transaction_type}:{reference_type or 'none'}:{reference_id or 'none'}:{description or 'none'}:{amount}"
    credit_user_wallet(
        db,
        user_id=user_id,
        amount=amount,
        entry_type=f"reward_{transaction_type.value if hasattr(transaction_type, 'value') else transaction_type}",
        idempotency_key=idempotency_key,
        reference_type=reference_type,
        reference_id=reference_id,
        description=description,
        metadata={"source": "reward_transaction"},
    )
    new_balance = int(get_ledger_balance(db, owner_type="user", owner_id=user_id))
    
    transaction = RewardTransaction(
        user_id=user_id,
        transaction_type=transaction_type,
        amount=amount,
        balance_after=new_balance,
        description=description,
        reference_type=reference_type,
        reference_id=reference_id,
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    
    return transaction


def spend_coins(
    db: Session,
    user_id: int,
    amount: int,
    description: str | None = None,
    reference_type: str | None = None,
    reference_id: int | None = None,
) -> RewardTransaction | None:
    """Spend coins from user's balance"""
    idempotency_key = f"wallet:debit:{user_id}:{reference_type or 'none'}:{reference_id or 'none'}:{description or 'none'}:{amount}"
    ledger_entry = debit_user_wallet(
        db,
        user_id=user_id,
        amount=amount,
        entry_type="reward_spend",
        idempotency_key=idempotency_key,
        reference_type=reference_type,
        reference_id=reference_id,
        description=description,
        metadata={"source": "reward_transaction"},
    )
    if ledger_entry is None:
        return None
    new_balance = int(get_ledger_balance(db, owner_type="user", owner_id=user_id))
    
    transaction = RewardTransaction(
        user_id=user_id,
        transaction_type=TransactionType.spent,
        amount=-amount,
        balance_after=new_balance,
        description=description,
        reference_type=reference_type,
        reference_id=reference_id,
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    
    return transaction


def get_reward_actions() -> list[dict[str, Any]]:
    """Get all available reward actions"""
    return [
        {"action_type": action_type, **config}
        for action_type, config in REWARD_ACTIONS.items()
    ]


def process_reward_action(
    db: Session,
    user_id: int,
    action_type: str,
) -> dict[str, Any]:
    """Process a reward action for a user"""
    if action_type not in REWARD_ACTIONS:
        return {"success": False, "error": "Invalid action type"}
    
    config = REWARD_ACTIONS[action_type]
    
    # Check daily limit
    today_start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = db.scalar(
        select(func.count(RewardTransaction.id))
        .where(
            RewardTransaction.user_id == user_id,
            RewardTransaction.description == action_type,
            RewardTransaction.created_at >= today_start,
        )
    ) or 0
    
    if config["max_per_day"] and today_count >= config["max_per_day"]:
        return {"success": False, "error": "Daily limit reached"}
    
    # Add coins
    transaction = add_coins(
        db=db,
        user_id=user_id,
        amount=config["coins"],
        transaction_type=TransactionType.earned,
        description=action_type,
        reference_type="reward_action",
    )
    
    return {
        "success": True,
        "coins_earned": config["coins"],
        "new_balance": transaction.balance_after,
        "action": action_type,
    }


def get_transaction_history(
    db: Session,
    user_id: int,
    limit: int = 50,
) -> list[RewardTransaction]:
    """Get user's transaction history"""
    return db.scalars(
        select(RewardTransaction)
        .where(RewardTransaction.user_id == user_id)
        .order_by(RewardTransaction.created_at.desc())
        .limit(limit)
    ).all()


# ============== COMMISSION SERVICE ==============

def calculate_booking_commission(
    booking_total: Decimal,
    user_tier: str = "standard",
) -> dict[str, Decimal]:
    """Calculate commission and service fee for a booking"""
    # Tier-based commission rates
    commission_rates = {
        "standard": Decimal("0.10"),  # 10%
        "silver": Decimal("0.12"),    # 12%
        "gold": Decimal("0.15"),      # 15%
    }
    
    rate = commission_rates.get(user_tier, DEFAULT_COMMISSION_RATE)
    commission = booking_total * rate
    service_fee = booking_total * SERVICE_FEE_RATE
    total = commission + service_fee
    
    return {
        "commission_rate": rate,
        "commission_amount": commission.quantize(Decimal("0.01")),
        "service_fee": service_fee.quantize(Decimal("0.01")),
        "total_amount": total.quantize(Decimal("0.01")),
    }


def create_commission_record(
    db: Session,
    booking_id: int,
    user_id: int,
    booking_total: Decimal,
    user_tier: str = "standard",
) -> CommissionRecord:
    """Create a commission record for a booking"""
    calculation = calculate_booking_commission(booking_total, user_tier)
    
    record = CommissionRecord(
        booking_id=booking_id,
        user_id=user_id,
        commission_rate=calculation["commission_rate"],
        commission_amount=calculation["commission_amount"],
        service_fee=calculation["service_fee"],
        total_amount=calculation["total_amount"],
        status="pending",
    )
    
    db.add(record)
    db.commit()
    db.refresh(record)
    
    return record


def get_user_commissions(
    db: Session,
    user_id: int,
    status: str | None = None,
) -> list[CommissionRecord]:
    """Get user's commission records"""
    query = select(CommissionRecord).where(CommissionRecord.user_id == user_id)
    
    if status:
        query = query.where(CommissionRecord.status == status)
    
    return db.scalars(query.order_by(CommissionRecord.created_at.desc())).all()


# ============== REVENUE METRICS ==============

def record_daily_revenue(
    db: Session,
    subscription_revenue: Decimal = Decimal("0"),
    boost_revenue: Decimal = Decimal("0"),
    commission_revenue: Decimal = Decimal("0"),
) -> RevenueMetrics:
    """Record daily revenue metrics"""
    today = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Check if already exists
    existing = db.scalar(
        select(RevenueMetrics).where(RevenueMetrics.date == today)
    )
    
    if existing:
        existing.subscription_revenue += subscription_revenue
        existing.boost_revenue += boost_revenue
        existing.commission_revenue += commission_revenue
        existing.total_revenue = (
            existing.subscription_revenue
            + existing.boost_revenue
            + existing.commission_revenue
        )
        db.commit()
        db.refresh(existing)
        return existing
    
    metrics = RevenueMetrics(
        date=today,
        subscription_revenue=subscription_revenue,
        boost_revenue=boost_revenue,
        commission_revenue=commission_revenue,
        total_revenue=subscription_revenue + boost_revenue + commission_revenue,
    )
    db.add(metrics)
    db.commit()
    db.refresh(metrics)
    
    return metrics


def get_revenue_summary(
    db: Session,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
) -> dict[str, Any]:
    """Get revenue summary for a date range"""
    query = select(RevenueMetrics)
    
    if start_date:
        query = query.where(RevenueMetrics.date >= start_date)
    if end_date:
        query = query.where(RevenueMetrics.date <= end_date)
    
    metrics = db.scalars(query.order_by(RevenueMetrics.date.desc())).all()
    
    total_subscription = sum(m.subscription_revenue for m in metrics)
    total_boost = sum(m.boost_revenue for m in metrics)
    total_commission = sum(m.commission_revenue for m in metrics)
    
    return {
        "period": {
            "start": start_date,
            "end": end_date,
        },
        "total_revenue": total_subscription + total_boost + total_commission,
        "subscription_revenue": total_subscription,
        "boost_revenue": total_boost,
        "commission_revenue": total_commission,
        "daily_breakdown": [
            {
                "date": m.date,
                "subscription": float(m.subscription_revenue),
                "boost": float(m.boost_revenue),
                "commission": float(m.commission_revenue),
                "total": float(m.total_revenue),
            }
            for m in metrics
        ],
    }


# ============== CONVERSION HELPERS ==============

def coins_to_rs(coins: int) -> int:
    """Convert coins to rupees (100 coins = ₹10)"""
    return (coins * 10) // 100


def rs_to_coins(rs: int) -> int:
    """Convert rupees to coins (₹10 = 100 coins)"""
    return (rs * 100) // 10
