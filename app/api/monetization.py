from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.growth import Boost
from app.models.monetization import BoostPurchase
from app.models.user import User
from app.services.auth import get_current_user
from app.services.monetization import (
    PLAN_PRICING,
    BOOST_CONFIG,
    REWARD_ACTIONS,
    activate_boost,
    calculate_subscription_price,
    create_razorpay_order,
    get_active_boosts,
    get_available_boosts,
    get_available_plans,
    get_boost_config,
    get_reward_balance,
    get_reward_actions,
    get_transaction_history,
    get_user_subscription_with_plan,
    process_reward_action,
    purchase_boost,
    spend_coins,
    utcnow,
    verify_razorpay_payment,
    coins_to_rs,
    rs_to_coins,
)


router = APIRouter(prefix="/monetization")


# ============== SCHEMAS ==============

class PlanResponse(BaseModel):
    plan_type: str
    name: str
    monthly_price: int
    yearly_price: int
    features: list[str]


class SubscriptionStatusResponse(BaseModel):
    subscription: dict
    plan: dict


class CreateOrderRequest(BaseModel):
    amount: int | None = Field(default=None, gt=0, description="Amount in rupees")
    boost_type: str | None = None
    receipt: str | None = None


class CreateOrderResponse(BaseModel):
    order_id: str
    amount: int
    currency: str
    checkout_url: str | None = None


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    boost_type: str | None = None


class VerifyPaymentResponse(BaseModel):
    success: bool
    message: str
    boost_id: int | None = None


class BoostPurchaseRequest(BaseModel):
    boost_type: str
    use_coins: bool = False


class BoostPurchaseResponse(BaseModel):
    purchase_id: int
    boost_type: str
    amount: int
    currency: str
    status: str


class ActiveBoostResponse(BaseModel):
    id: int
    boost_type: str
    config: dict
    expires_at: str
    remaining_minutes: int


class RewardBalanceResponse(BaseModel):
    coins: int
    lifetime_coins: int
    updated_at: str


class RewardActionRequest(BaseModel):
    action_type: str


class RewardActionResponse(BaseModel):
    success: bool
    coins_earned: int | None = None
    new_balance: int | None = None
    action: str | None = None
    error: str | None = None


class SpendCoinsRequest(BaseModel):
    amount: int = Field(gt=0)
    description: str | None = None


class TransactionResponse(BaseModel):
    id: int
    transaction_type: str
    amount: int
    balance_after: int
    description: str | None
    created_at: str


class CoinConversionRequest(BaseModel):
    coins: int | None = None
    rupees: int | None = None


class CoinConversionResponse(BaseModel):
    coins: int
    rupees: int


# ============== PLANS ==============

@router.get("/plans", response_model=list[PlanResponse])
def list_plans() -> list[PlanResponse]:
    """Get all available subscription plans"""
    return [
        PlanResponse(plan_type=plan_type, **details)
        for plan_type, details in PLAN_PRICING.items()
    ]


@router.get("/subscription/status", response_model=SubscriptionStatusResponse)
def get_subscription_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionStatusResponse:
    """Get current user's subscription status"""
    return get_user_subscription_with_plan(db, current_user.id)


@router.get("/subscription/price/{plan_type}")
def get_plan_price(
    plan_type: str,
    billing_cycle: str = "monthly",
) -> dict[str, int]:
    """Get price for a specific plan"""
    if plan_type not in PLAN_PRICING:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plan not found",
        )
    
    price = calculate_subscription_price(plan_type, billing_cycle)
    return {
        "plan_type": plan_type,
        "billing_cycle": billing_cycle,
        "price": price,
        "currency": "INR",
    }


# ============== BOOSTS ==============

@router.get("/boosts", response_model=list[dict])
def list_boosts() -> list[dict]:
    """Get all available boosts"""
    return get_available_boosts()


@router.get("/boosts/active", response_model=list[ActiveBoostResponse])
def get_user_active_boosts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ActiveBoostResponse]:
    """Get user's active boosts"""
    boosts = get_active_boosts(db, current_user.id)
    return [
        ActiveBoostResponse(
            id=b["id"],
            boost_type=b["boost_type"],
            config=b["config"],
            expires_at=b["expires_at"].isoformat(),
            remaining_minutes=b["remaining_minutes"],
        )
        for b in boosts
    ]


@router.post("/boosts/purchase", response_model=BoostPurchaseResponse)
def buy_boost(
    payload: BoostPurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BoostPurchaseResponse:
    """Purchase a boost (coins or razorpay)"""
    if payload.boost_type not in BOOST_CONFIG:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Boost type not found",
        )
    
    config = BOOST_CONFIG[payload.boost_type]
    
    if payload.use_coins:
        # Use coins
        coin_cost = rs_to_coins(config["price"])
        balance = get_reward_balance(db, current_user.id)
        
        if balance["coins"] < coin_cost:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Insufficient coins",
            )
        
        # Spend coins
        transaction = spend_coins(
            db=db,
            user_id=current_user.id,
            amount=coin_cost,
            description=f"boost_purchase_{payload.boost_type}",
            reference_type="boost",
        )
        
        if not transaction:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Failed to spend coins",
            )
        
        # Activate boost
        result = activate_boost(db, current_user.id, payload.boost_type)
        
        return BoostPurchaseResponse(
            purchase_id=result["boost_id"],
            boost_type=payload.boost_type,
            amount=config["price"],
            currency="INR",
            status="completed",
        )
    
    # Create Razorpay order
    order = create_razorpay_order(
        db=db,
        user=current_user,
        amount=config["price"],
        receipt=f"boost_{payload.boost_type}_{current_user.id}",
    )
    
    # Store purchase as pending
    purchase = purchase_boost(
        db=db,
        user=current_user,
        boost_type=payload.boost_type,
        payment_method="razorpay",
    )
    
    return BoostPurchaseResponse(
        purchase_id=purchase.id,
        boost_type=payload.boost_type,
        amount=config["price"],
        currency="INR",
        status="pending",
    )


@router.post("/boosts/create-order", response_model=CreateOrderResponse)
def create_boost_order(
    payload: CreateOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CreateOrderResponse:
    """Create Razorpay order for boost purchase"""
    boost_type = payload.boost_type or "profile"
    
    if boost_type not in BOOST_CONFIG:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Boost type not found",
        )
    
    config = BOOST_CONFIG[boost_type]
    amount = payload.amount or config["price"]
    if amount != config["price"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Boost order amount does not match the configured boost price",
        )
    
    order = create_razorpay_order(
        db=db,
        user=current_user,
        amount=amount,
        receipt=payload.receipt,
    )

    purchase = BoostPurchase(
        user_id=current_user.id,
        boost_type=boost_type,
        amount_paid=amount,
        currency=order["currency"],
        payment_method="razorpay",
        transaction_id=order["id"],
        status="pending",
        duration_minutes=config["duration_minutes"],
    )
    db.add(purchase)
    db.commit()
    
    return CreateOrderResponse(
        order_id=order["id"],
        amount=order["amount"] // 100,
        currency=order["currency"],
        checkout_url=order.get("short_url"),
    )


@router.post("/boosts/verify", response_model=VerifyPaymentResponse)
def verify_boost_payment(
    payload: VerifyPaymentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VerifyPaymentResponse:
    """Verify Razorpay payment and activate boost"""
    # Verify signature
    is_valid = verify_razorpay_payment(
        payload.razorpay_order_id,
        payload.razorpay_payment_id,
        payload.razorpay_signature,
    )
    
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payment signature",
        )
    
    boost_type = payload.boost_type or "profile"
    purchase = db.scalar(
        select(BoostPurchase)
        .where(
            BoostPurchase.user_id == current_user.id,
            BoostPurchase.boost_type == boost_type,
            BoostPurchase.transaction_id == payload.razorpay_order_id,
        )
        .order_by(BoostPurchase.created_at.desc(), BoostPurchase.id.desc())
    )
    if purchase is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending boost purchase found for this payment order",
        )
    if purchase.status == "completed":
        active_boost = db.scalar(
            select(Boost)
            .where(Boost.user_id == current_user.id, Boost.boost_type == boost_type, Boost.expires_at > utcnow())
            .order_by(Boost.expires_at.desc(), Boost.id.desc())
        )
        return VerifyPaymentResponse(
            success=True,
            message="Boost payment already verified",
            boost_id=active_boost.id if active_boost is not None else None,
        )
    if purchase.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Boost purchase is not pending verification",
        )

    purchase.status = "completed"
    result = activate_boost(db, current_user.id, boost_type)
    
    return VerifyPaymentResponse(
        success=True,
        message="Boost activated successfully",
        boost_id=result["boost_id"],
    )


@router.post("/boosts/activate/{boost_type}")
def activate_user_boost(
    boost_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Reject unaudited direct activation; boosts require coins or verified provider payment."""
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Boost activation requires a completed coin purchase or verified payment",
    )


# ============== REWARDS/COINS ==============

@router.get("/rewards/balance", response_model=RewardBalanceResponse)
def get_user_balance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RewardBalanceResponse:
    """Get user's coin balance"""
    balance = get_reward_balance(db, current_user.id)
    return RewardBalanceResponse(
        coins=balance["coins"],
        lifetime_coins=balance["lifetime_coins"],
        updated_at=balance["updated_at"].isoformat(),
    )


@router.get("/rewards/actions", response_model=list[dict])
def list_reward_actions() -> list[dict]:
    """Get all available reward actions"""
    return get_reward_actions()


@router.post("/rewards/claim", response_model=RewardActionResponse)
def claim_reward(
    payload: RewardActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RewardActionResponse:
    """Claim reward for an action"""
    result = process_reward_action(db, current_user.id, payload.action_type)
    
    if not result["success"]:
        return RewardActionResponse(
            success=False,
            error=result.get("error"),
        )
    
    return RewardActionResponse(
        success=True,
        coins_earned=result["coins_earned"],
        new_balance=result["new_balance"],
        action=result["action"],
    )


@router.post("/rewards/spend")
def spend_user_coins(
    payload: SpendCoinsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TransactionResponse:
    """Spend coins (for boosts, etc.)"""
    transaction = spend_coins(
        db=db,
        user_id=current_user.id,
        amount=payload.amount,
        description=payload.description,
    )
    
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient coins",
        )
    
    return TransactionResponse(
        id=transaction.id,
        transaction_type=transaction.transaction_type.value,
        amount=transaction.amount,
        balance_after=transaction.balance_after,
        description=transaction.description,
        created_at=transaction.created_at.isoformat(),
    )


@router.get("/rewards/transactions", response_model=list[TransactionResponse])
def get_transactions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 50,
) -> list[TransactionResponse]:
    """Get user's transaction history"""
    transactions = get_transaction_history(db, current_user.id, limit)
    return [
        TransactionResponse(
            id=t.id,
            transaction_type=t.transaction_type.value,
            amount=t.amount,
            balance_after=t.balance_after,
            description=t.description,
            created_at=t.created_at.isoformat(),
        )
        for t in transactions
    ]


@router.post("/rewards/convert", response_model=CoinConversionResponse)
def convert_coins(
    payload: CoinConversionRequest,
) -> CoinConversionResponse:
    """Convert between coins and rupees"""
    if payload.coins is not None:
        return CoinConversionResponse(
            coins=payload.coins,
            rupees=coins_to_rs(payload.coins),
        )
    elif payload.rupees is not None:
        return CoinConversionResponse(
            coins=rs_to_coins(payload.rupees),
            rupees=payload.rupees,
        )
    
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Provide either coins or rupees",
    )


# ============== FEATURE LIMITS ==============

class FeatureLimitResponse(BaseModel):
    feature: str
    limit: int
    current_usage: int
    remaining: int
    is_unlimited: bool
    upgrade_required: bool


@router.get("/limits/check")
def check_feature_limits(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, FeatureLimitResponse]:
    """Check user's feature limits based on subscription"""
    from app.services.subscriptions import is_premium_record, ensure_subscription_record
    
    subscription = ensure_subscription_record(db, current_user.id)
    is_premium = is_premium_record(subscription)
    
    # Define limits
    limits = {
        "swipes_per_day": {
            "free": 10,
            "pro": -1,  # unlimited
            "elite": -1,
        },
        "profile_boosts_per_day": {
            "free": 0,
            "pro": 1,
            "elite": 3,
        },
        "trip_boosts_per_trip": {
            "free": 0,
            "pro": 1,
            "elite": 2,
        },
        "see_likes": {
            "free": False,
            "pro": True,
            "elite": True,
        },
        "advanced_filters": {
            "free": False,
            "pro": True,
            "elite": True,
        },
    }
    
    plan = subscription.plan_type
    result = {}
    
    for feature, feature_limits in limits.items():
        limit = feature_limits.get(plan, 0)
        is_unlimited = limit == -1
        
        # For demo, current_usage would come from actual tracking
        current_usage = 0
        remaining = -1 if is_unlimited else max(0, limit - current_usage)
        
        result[feature] = FeatureLimitResponse(
            feature=feature,
            limit=limit if not is_unlimited else 999999,
            current_usage=current_usage,
            remaining=remaining,
            is_unlimited=is_unlimited,
            upgrade_required=limit == 0,
        )
    
    return result


@router.post("/limits/upgrade-prompt")
def trigger_upgrade_prompt(
    feature: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Trigger an upgrade prompt when user hits limit"""
    from app.services.subscriptions import is_premium_record, ensure_subscription_record
    
    subscription = ensure_subscription_record(db, current_user.id)
    is_premium = is_premium_record(subscription)
    
    if is_premium:
        return {"show_upgrade": False, "reason": "already_premium"}
    
    # Return upgrade prompt data
    return {
        "show_upgrade": True,
        "feature": feature,
        "message": f"Upgrade to Pro to access {feature.replace('_', ' ')}",
        "plans": [
            {"type": "pro", "price": 299},
            {"type": "elite", "price": 799},
        ],
    }
