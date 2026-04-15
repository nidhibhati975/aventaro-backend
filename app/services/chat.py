from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload
from pydantic import BaseModel, Field, ValidationError

from app.models.chat import Conversation, ConversationMember, ConversationType, Message, MessageStatus
from app.models.user import User
from app.services.ai.openai_client import generate_response_sync
from app.services.ai.trip_planner import TripPlanRequest, TripPlanResponse, TravelerProfileContext, plan_trip
from app.services.notifications import create_notification
from app.services.redis_runtime import build_cache_key, get_cache
from app.utils.config import get_settings


logger = logging.getLogger("aventaro.ai")


def build_conversation_id(first_user_id: int, second_user_id: int) -> str:
    left, right = sorted((first_user_id, second_user_id))
    return f"{left}:{right}"


def get_conversation(db: Session, conversation_id: str) -> Conversation | None:
    return db.scalar(
        select(Conversation)
        .options(
            selectinload(Conversation.participant_one).selectinload(User.profile),
            selectinload(Conversation.participant_two).selectinload(User.profile),
            selectinload(Conversation.members).selectinload(ConversationMember.user).selectinload(User.profile),
        )
        .where(Conversation.id == conversation_id)
    )


def list_conversations(db: Session, user_id: int) -> list[Conversation]:
    return db.scalars(
        select(Conversation)
        .options(
            selectinload(Conversation.participant_one).selectinload(User.profile),
            selectinload(Conversation.participant_two).selectinload(User.profile),
        )
        .where(
            Conversation.conversation_type == ConversationType.direct,
            or_(Conversation.participant_one_id == user_id, Conversation.participant_two_id == user_id),
        )
        .order_by(Conversation.last_message_at.desc().nullslast(), Conversation.created_at.desc())
    ).all()


def list_messages(db: Session, conversation_id: str) -> list[Message]:
    return db.scalars(
        select(Message)
        .options(
            selectinload(Message.sender).selectinload(User.profile),
            selectinload(Message.recipient).selectinload(User.profile),
        )
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
    ).all()


def list_recent_messages(db: Session, conversation_id: str, limit: int = 8) -> list[Message]:
    messages = db.scalars(
        select(Message)
        .options(
            selectinload(Message.sender).selectinload(User.profile),
            selectinload(Message.recipient).selectinload(User.profile),
        )
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(limit)
    ).all()
    return list(reversed(messages))


def count_unread_messages(db: Session, conversation_id: str, user_id: int) -> int:
    return int(
        db.scalar(
            select(func.count(Message.id)).where(
                Message.conversation_id == conversation_id,
                Message.recipient_id == user_id,
                Message.read_at.is_(None),
            )
        )
        or 0
    )


def list_user_messages_since(db: Session, user_id: int, after_message_id: int, limit: int = 200) -> list[Message]:
    return db.scalars(
        select(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .options(
            selectinload(Message.sender).selectinload(User.profile),
            selectinload(Message.recipient).selectinload(User.profile),
        )
        .where(
            Message.id > after_message_id,
            or_(Conversation.participant_one_id == user_id, Conversation.participant_two_id == user_id),
        )
        .order_by(Message.id.asc())
        .limit(limit)
    ).all()


def _read_query_for_conversation(conversation: Conversation, user_id: int):
    filters = [
        Message.conversation_id == conversation.id,
        Message.sender_id != user_id,
        Message.read_at.is_(None),
    ]
    if conversation.conversation_type == ConversationType.direct:
        filters.append(Message.recipient_id == user_id)
    return select(Message).where(*filters)


def mark_conversation_read(
    db: Session,
    *,
    conversation: Conversation,
    user_id: int,
) -> dict[str, object] | None:
    unread_messages = db.scalars(_read_query_for_conversation(conversation, user_id)).all()
    if not unread_messages:
        return None
    read_at = datetime.now(timezone.utc)
    last_read_message_id = max(message.id for message in unread_messages)
    for message in unread_messages:
        message.read_at = read_at
        message.message_status = MessageStatus.read
    db.commit()
    return {
        "conversation_id": conversation.id,
        "user_id": user_id,
        "updated_count": len(unread_messages),
        "last_read_message_id": last_read_message_id,
        "read_at": read_at,
    }


def mark_messages_delivered_for_user(
    db: Session,
    *,
    user_id: int,
    conversation_id: str | None = None,
) -> int:
    if conversation_id is None:
        delivery_filter = Message.recipient_id == user_id
    else:
        delivery_filter = and_(
            Conversation.id == conversation_id,
            Conversation.conversation_type == ConversationType.group,
        )

    sent_messages = db.scalars(
        select(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Message.message_status == MessageStatus.sent,
            Message.read_at.is_(None),
            Message.sender_id != user_id,
            delivery_filter,
        )
    ).all()
    if not sent_messages:
        return 0
    for message in sent_messages:
        message.message_status = MessageStatus.delivered
    db.commit()
    return len(sent_messages)


def get_or_create_direct_conversation(db: Session, current_user: User, recipient: User) -> Conversation:
    left, right = sorted((current_user.id, recipient.id))
    conversation_id = build_conversation_id(left, right)
    conversation = db.scalar(select(Conversation).where(Conversation.id == conversation_id))
    if conversation is None:
        conversation = Conversation(
            id=conversation_id,
            conversation_type=ConversationType.direct,
            participant_one_id=left,
            participant_two_id=right,
        )
        db.add(conversation)
        db.flush()
    existing_member_ids = set(
        db.scalars(select(ConversationMember.user_id).where(ConversationMember.conversation_id == conversation.id)).all()
    )
    for user_id in (left, right):
        if user_id not in existing_member_ids:
            db.add(ConversationMember(conversation_id=conversation.id, user_id=user_id))
    return conversation


def create_message(db: Session, conversation: Conversation, sender: User, recipient: User, content: str) -> Message:
    message = Message(
        conversation_id=conversation.id,
        sender_id=sender.id,
        recipient_id=recipient.id,
        content=content.strip(),
        message_status=MessageStatus.sent,
    )
    db.add(message)
    create_notification(
        db=db,
        user_id=recipient.id,
        notification_type="chat_message",
        message=f"New message from {sender.profile.name or sender.email}",
        commit=False,
    )
    conversation.last_message_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)
    return message


class AIChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=800)


class AIChatRequest(BaseModel):
    conversation_id: str | None = Field(default=None, max_length=128)
    message: str = Field(min_length=1, max_length=1500)
    history: list[AIChatHistoryMessage] = Field(default_factory=list, max_length=8)
    planner_context: TripPlanRequest | None = None


class AIChatResponse(BaseModel):
    reply: str = Field(min_length=1, max_length=900)
    trip_suggestions: list[str]
    budget_tips: list[str]
    next_steps: list[str]
    trip_plan: TripPlanResponse | None = None
    follow_up_prompts: list[str] = Field(default_factory=list, max_length=6)


def _serialize_recent_messages(messages: list[Message]) -> list[dict[str, object]]:
    return [
        {
            "message_id": message.id,
            "sender_id": message.sender_id,
            "recipient_id": message.recipient_id,
            "content": message.content[:160],
            "created_at": message.created_at.isoformat(),
        }
        for message in messages
    ]


def _profile_context(user: User) -> dict[str, object]:
    profile = user.profile
    if profile is None:
        return {
            "email": user.email,
            "name": None,
            "location": None,
            "travel_style": None,
            "interests": [],
            "budget_min": None,
            "budget_max": None,
        }
    return {
        "email": user.email,
        "name": profile.name,
        "location": profile.location,
        "travel_style": profile.travel_style,
        "interests": profile.interests or [],
        "budget_min": profile.budget_min,
        "budget_max": profile.budget_max,
    }


def _derive_planner_context(current_user: User, payload: AIChatRequest) -> TripPlanRequest:
    if payload.planner_context is not None:
        return payload.planner_context

    profile = current_user.profile
    message_text = payload.message.lower()

    if any(keyword in message_text for keyword in {"luxury", "premium", "resort"}):
        mood: Literal["chill", "adventure", "party", "luxury"] = "luxury"
    elif any(keyword in message_text for keyword in {"party", "nightlife", "club"}):
        mood = "party"
    elif any(keyword in message_text for keyword in {"relax", "calm", "slow", "beach"}):
        mood = "chill"
    else:
        mood = "adventure"

    if "weekend" in message_text:
        days = 3
    elif "week" in message_text:
        days = 7
    else:
        days = 5

    budget_floor = float(profile.budget_min) if profile and profile.budget_min else 900.0
    budget_ceiling = float(profile.budget_max) if profile and profile.budget_max else max(budget_floor, 1800.0)
    budget = max(budget_ceiling, budget_floor, 600.0)

    return TripPlanRequest(
        budget=budget,
        days=days,
        destination=None,
        mood=mood,
        travel_style=profile.travel_style if profile else None,
        profile_context=TravelerProfileContext(
            name=profile.name if profile else None,
            home_base=profile.location if profile else None,
            travel_style=profile.travel_style if profile else None,
            interests=list(profile.interests or []) if profile else [],
            budget_min=float(profile.budget_min) if profile and profile.budget_min else None,
            budget_max=float(profile.budget_max) if profile and profile.budget_max else None,
        ),
    )


def _serialize_history_messages(history: list[AIChatHistoryMessage]) -> list[dict[str, object]]:
    return [{"role": item.role, "content": item.content[:240]} for item in history[-6:]]


def _fallback_concierge_reply(
    current_user: User,
    payload: AIChatRequest,
    trip_plan: TripPlanResponse,
) -> AIChatResponse:
    profile = current_user.profile
    traveler_name = (profile.name if profile and profile.name else current_user.email.split("@", maxsplit=1)[0]).strip()
    destination = trip_plan.overview.destination
    base_reply = (
        f"{traveler_name}, {destination} is the strongest fit right now because it lines up with your budget, "
        f"{trip_plan.overview.vibe.lower()}, and the way you have been traveling lately."
    )
    trip_suggestions = [
        f"{suggestion.destination}: {suggestion.reason}"
        for suggestion in trip_plan.destination_suggestions[:3]
    ]
    budget_tips = [
        f"{item.label}: {item.note}"
        for item in trip_plan.budget_breakdown[:3]
    ]
    next_steps = [
        f"Lock the stay strategy: {trip_plan.overview.stay_strategy}",
        f"Use this transport plan: {trip_plan.overview.transport_strategy}",
        "Refine the plan by changing budget, vibe, or trip duration before booking anything expensive.",
    ]
    return AIChatResponse(
        reply=base_reply,
        trip_suggestions=trip_suggestions[:3],
        budget_tips=budget_tips[:3],
        next_steps=next_steps[:3],
        trip_plan=trip_plan,
        follow_up_prompts=trip_plan.follow_up_prompts[:4],
    )


def generate_concierge_reply(
    db: Session,
    current_user: User,
    payload: AIChatRequest,
    request_context: dict[str, object] | None = None,
) -> AIChatResponse:
    settings = get_settings()
    recent_messages: list[Message] = []
    if payload.conversation_id:
        recent_messages = list_recent_messages(db=db, conversation_id=payload.conversation_id)
    planner_context = _derive_planner_context(current_user, payload)
    trip_plan = plan_trip(
        planner_context,
        request_context={**(request_context or {}), "ai_operation": "trip_plan_from_chat"},
    )
    cache_key = build_cache_key(
        "ai:chat",
        user_id=current_user.id,
        conversation_id=payload.conversation_id,
        message=payload.message.strip(),
        recent_messages=_serialize_recent_messages(recent_messages),
        history=_serialize_history_messages(payload.history),
        planner_context=planner_context.model_dump(mode="json"),
        profile=_profile_context(current_user),
    )
    cached = get_cache().get_json(cache_key)
    if cached is not None:
        logger.info(
            "ai_cache_hit",
            extra={
                "event_type": "ai_cache_hit",
                "request_id": (request_context or {}).get("request_id"),
                "user_id": current_user.id,
                "endpoint": (request_context or {}).get("endpoint"),
                "conversation_id": payload.conversation_id,
                "ai_operation": "concierge_chat",
                "model": settings.model_name,
                "cache_hit": True,
                "fallback_used": False,
            },
        )
        return AIChatResponse.model_validate(cached)

    fallback = _fallback_concierge_reply(current_user, payload, trip_plan)
    system_prompt = (
        "You are Aventaro AI, a full trip planning copilot. "
        "Return valid JSON only with this exact shape: "
        "reply, trip_suggestions, budget_tips, next_steps, follow_up_prompts, trip_plan. "
        "trip_plan must exactly match the provided planner schema. "
        "Use the existing trip plan as the base, personalize the explanation, and refine it against the user message."
    )
    prompt = json.dumps(
        {
            "task": "Answer as a travel concierge and full trip planner",
            "user_profile": _profile_context(current_user),
            "conversation_context": _serialize_recent_messages(recent_messages),
            "client_history": _serialize_history_messages(payload.history),
            "user_question": payload.message.strip(),
            "trip_plan": trip_plan.model_dump(mode="json"),
            "planner_context": planner_context.model_dump(mode="json"),
            "rules": {
                "reply_max_characters": 900,
                "suggestion_count": "2 to 4 per list",
                "keep_budget_advice_practical": True,
                "follow_up_prompt_count": "3 to 4",
            },
        },
        separators=(",", ":"),
    )
    response = generate_response_sync(
        prompt,
        system_prompt,
        0.5,
        fallback_payload=fallback.model_dump(mode="json"),
        request_context={**(request_context or {}), "conversation_id": payload.conversation_id, "ai_operation": "concierge_chat"},
    )
    try:
        parsed = AIChatResponse.model_validate_json(response.content)
    except ValidationError:
        parsed = fallback
    if parsed.trip_plan is None:
        parsed.trip_plan = trip_plan
    if not parsed.follow_up_prompts:
        parsed.follow_up_prompts = trip_plan.follow_up_prompts[:4]

    get_cache().set_json(cache_key, parsed.model_dump(mode="json"), ttl_seconds=settings.ai_cache_ttl_seconds)
    return parsed
