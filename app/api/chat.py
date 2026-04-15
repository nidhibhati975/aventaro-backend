from __future__ import annotations

import json
import logging

from anyio import from_thread
from fastapi import APIRouter, Depends, Header, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import SessionLocal
from app.db.session import get_db
from app.models.chat import ConversationType, Message, MessageStatus
from app.models.user import User
from app.services.auth import decode_access_token, extract_bearer_token, get_current_user
from app.services.chat import (
    count_unread_messages,
    create_message,
    get_conversation as get_conversation_service,
    get_or_create_direct_conversation,
    list_conversations as list_conversations_service,
    list_messages as list_messages_service,
    list_user_messages_since,
    mark_conversation_read,
    mark_messages_delivered_for_user,
)
from app.services.chat_realtime import chat_connection_manager
from app.services.idempotency import IdempotencyClaim, claim_idempotency, clear_idempotency_claim, store_idempotent_response
from app.services.push_notifications import send_push_notification
from app.services.rate_limit import rate_limit, rate_limiter
from app.services.trip_collaboration import build_trip_room_name, fetch_trip_for_collaboration, require_trip_member, send_group_message


router = APIRouter(prefix="/chat")
logger = logging.getLogger("aventaro.chat.ws")


class ProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str | None = None
    age: int | None = None
    bio: str | None = None
    location: str | None = None
    gender: str | None = None
    travel_style: str | None = None
    interests: list[str] | None = None
    budget_min: int | None = None
    budget_max: int | None = None


class UserSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    profile: ProfileRead | None = None


class ChatSendRequest(BaseModel):
    recipient_user_id: int = Field(gt=0)
    content: str = Field(min_length=1, max_length=2000)


class GroupChatSendRequest(BaseModel):
    trip_id: int = Field(gt=0)
    content: str = Field(min_length=1, max_length=2000)


class ChatMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: str
    content: str
    message_status: MessageStatus
    read_at: object | None = None
    created_at: object
    sender: UserSummary
    recipient: UserSummary | None = None


class GroupChatMessageRead(BaseModel):
    id: int
    conversation_id: str
    content: str
    message_status: MessageStatus
    read_at: object | None = None
    created_at: object
    sender: UserSummary


class ChatReadReceiptRead(BaseModel):
    conversation_id: str
    user_id: int
    updated_count: int
    last_read_message_id: int
    read_at: object | None = None


class ConversationRead(BaseModel):
    id: str
    conversation_type: ConversationType
    participant: UserSummary
    last_message: str | None = None
    last_message_at: object | None = None
    unread_count: int = 0


def _validate_conversation_access(conversation, current_user_id: int) -> None:
    member_ids = {member.user_id for member in conversation.members}
    if conversation.conversation_type == ConversationType.direct:
        member_ids.update(
            user_id for user_id in (conversation.participant_one_id, conversation.participant_two_id) if user_id is not None
        )
    if current_user_id not in member_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to access this conversation")


def _resolve_idempotency(scope: str, user_id: int, idempotency_key: str | None) -> IdempotencyClaim | JSONResponse | None:
    return claim_idempotency(scope=scope, user_id=user_id, request_key=idempotency_key)


def _broadcast_read_receipt(conversation, receipt: dict[str, object]) -> None:
    payload = {"type": "chat.read", "data": ChatReadReceiptRead.model_validate(receipt).model_dump(mode="json")}
    if conversation.conversation_type == ConversationType.group and conversation.trip_id is not None:
        from_thread.run(chat_connection_manager.broadcast_to_room, build_trip_room_name(conversation.trip_id), payload)
        return
    member_ids = {
        user_id
        for user_id in (conversation.participant_one_id, conversation.participant_two_id)
        if user_id is not None
    }
    if member_ids:
        from_thread.run(chat_connection_manager.broadcast_to_users, member_ids, payload)


@router.get("/conversations", response_model=list[ConversationRead])
def list_conversations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("chat_read", 120, 60)),
) -> list[ConversationRead]:
    conversations = list_conversations_service(db=db, user_id=current_user.id)

    items: list[ConversationRead] = []
    for conversation in conversations:
        participant = conversation.participant_two if conversation.participant_one_id == current_user.id else conversation.participant_one
        last_message = db.scalar(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(1)
        )
        items.append(
            ConversationRead(
                id=conversation.id,
                conversation_type=conversation.conversation_type,
                participant=UserSummary.model_validate(participant),
                last_message=last_message.content if last_message else None,
                last_message_at=last_message.created_at if last_message else None,
                unread_count=count_unread_messages(db=db, conversation_id=conversation.id, user_id=current_user.id),
            )
        )
    return items


@router.get("/{conversation_id}", response_model=list[ChatMessageRead])
def get_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("chat_read", 120, 60)),
) -> list[ChatMessageRead]:
    conversation = get_conversation_service(db=db, conversation_id=conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    _validate_conversation_access(conversation, current_user.id)

    read_receipt = mark_conversation_read(db=db, conversation=conversation, user_id=current_user.id)
    if read_receipt is not None:
        _broadcast_read_receipt(conversation, read_receipt)
    messages = list_messages_service(db=db, conversation_id=conversation_id)
    return [ChatMessageRead.model_validate(message) for message in messages]


@router.post("/send", response_model=ChatMessageRead, status_code=status.HTTP_201_CREATED)
def send_message(
    payload: ChatSendRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("chat_send", 45, 60)),
) -> ChatMessageRead:
    if payload.recipient_user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot message yourself")

    recipient = db.scalar(select(User).options(selectinload(User.profile)).where(User.id == payload.recipient_user_id))
    if recipient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")

    conversation = get_or_create_direct_conversation(db, current_user, recipient)
    message = create_message(db, conversation, current_user, recipient, payload.content)
    message = db.scalar(
        select(Message)
        .options(
            selectinload(Message.sender).selectinload(User.profile),
            selectinload(Message.recipient).selectinload(User.profile),
        )
        .where(Message.id == message.id)
    )
    message_payload = ChatMessageRead.model_validate(message).model_dump(mode="json")
    from_thread.run(
        chat_connection_manager.broadcast_to_users,
        {current_user.id, payload.recipient_user_id},
        {"type": "chat.message.created", "data": message_payload},
    )
    return ChatMessageRead.model_validate(message)


@router.post("/group/send", response_model=GroupChatMessageRead, status_code=status.HTTP_201_CREATED)
def send_group_message_endpoint(
    payload: GroupChatSendRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("chat_group_send", 60, 60)),
) -> GroupChatMessageRead | JSONResponse:
    idempotency = _resolve_idempotency("chat_group_send", current_user.id, idempotency_key)
    if isinstance(idempotency, JSONResponse):
        return idempotency
    try:
        message_payload, member_ids = send_group_message(
            db=db,
            trip_id=payload.trip_id,
            sender_id=current_user.id,
            content=payload.content,
        )
    except LookupError as exc:
        clear_idempotency_claim(idempotency if isinstance(idempotency, IdempotencyClaim) else None)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        clear_idempotency_claim(idempotency if isinstance(idempotency, IdempotencyClaim) else None)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        clear_idempotency_claim(idempotency if isinstance(idempotency, IdempotencyClaim) else None)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    response = GroupChatMessageRead.model_validate(message_payload)
    store_idempotent_response(
        idempotency if isinstance(idempotency, IdempotencyClaim) else None,
        status_code=status.HTTP_201_CREATED,
        payload=response.model_dump(mode="json"),
    )
    from_thread.run(
        chat_connection_manager.broadcast_to_room,
        build_trip_room_name(payload.trip_id),
        {"type": "chat.message", "data": response.model_dump(mode="json")},
    )
    offline_user_ids = chat_connection_manager.filter_offline_users(
        user_id for user_id in member_ids if user_id != current_user.id
    )
    send_push_notification(
        db,
        user_ids=offline_user_ids,
        title="New trip message",
        body=payload.content[:120],
        data={"type": "chat.message", "trip_id": payload.trip_id, "conversation_id": response.conversation_id, "message_id": response.id},
    )
    return response


@router.post("/{conversation_id}/read", response_model=ChatReadReceiptRead)
def mark_chat_read_endpoint(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("chat_read", 120, 60)),
) -> ChatReadReceiptRead:
    conversation = get_conversation_service(db=db, conversation_id=conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    _validate_conversation_access(conversation, current_user.id)
    receipt = mark_conversation_read(db=db, conversation=conversation, user_id=current_user.id)
    if receipt is None:
        receipt = {
            "conversation_id": conversation.id,
            "user_id": current_user.id,
            "updated_count": 0,
            "last_read_message_id": 0,
            "read_at": None,
        }
        return ChatReadReceiptRead.model_validate(receipt)
    _broadcast_read_receipt(conversation, receipt)
    return ChatReadReceiptRead.model_validate(receipt)


@router.websocket("/ws")
async def chat_websocket(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token") or extract_bearer_token(websocket.headers.get("authorization"))
    if not token:
        logger.warning("chat websocket rejected: missing token")
        await websocket.close(code=4401)
        return

    raw_after_message_id = websocket.query_params.get("after_message_id")
    try:
        after_message_id = int(raw_after_message_id) if raw_after_message_id is not None else None
        if after_message_id is not None and after_message_id < 0:
            raise ValueError
    except ValueError:
        logger.warning("chat websocket rejected: invalid after_message_id", extra={"after_message_id": raw_after_message_id})
        await websocket.close(code=4400)
        return

    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except Exception as exc:
        logger.warning("chat websocket rejected: invalid access token", exc_info=exc)
        await websocket.close(code=4401)
        return

    client_host = websocket.client.host if websocket.client else "unknown"
    try:
        rate_limiter.hit(key=f"rate_limit:chat_ws:ip:{client_host}", limit=20, window_seconds=60)
    except HTTPException as exc:
        logger.warning("chat websocket rejected: rate limited", extra={"client_host": client_host}, exc_info=exc)
        await websocket.close(code=4408)
        return

    replay_payloads: list[dict[str, object]] = []
    delivered_count = 0
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.id == user_id))
        if user is None:
            logger.warning("chat websocket rejected: user not found", extra={"user_id": user_id})
            await websocket.close(code=4401)
            return
        delivered_count = mark_messages_delivered_for_user(db=db, user_id=user_id)
        if after_message_id is not None:
            replay_messages = list_user_messages_since(db=db, user_id=user_id, after_message_id=after_message_id)
            replay_payloads = [ChatMessageRead.model_validate(message).model_dump(mode="json") for message in replay_messages]

    connected = False
    try:
        await chat_connection_manager.connect(user_id, websocket)
        connected = True
        await websocket.send_json(
            {
                "type": "chat.connected",
                "data": {
                    "user_id": user_id,
                    "replayed_count": len(replay_payloads),
                    "delivered_count": delivered_count,
                },
            }
        )
        for message_payload in replay_payloads:
            await websocket.send_json({"type": "chat.message.created", "data": message_payload})
        while True:
            payload = await websocket.receive_text()
            if payload == "ping":
                await websocket.send_json({"type": "chat.pong"})
                continue
            try:
                command = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if not isinstance(command, dict):
                continue
            action = command.get("action")
            room = command.get("room")
            if action == "ping":
                await websocket.send_json({"type": "chat.pong"})
                continue
            if action not in {"join", "leave"} or not isinstance(room, str):
                await websocket.send_json({"type": "chat.error", "data": {"message": "Invalid websocket command"}})
                continue
            if not room.startswith("trip:"):
                await websocket.send_json({"type": "chat.error", "data": {"message": "Unsupported room"}})
                continue
            try:
                trip_id = int(room.split(":", maxsplit=1)[1])
            except ValueError:
                await websocket.send_json({"type": "chat.error", "data": {"message": "Invalid room"}})
                continue
            with SessionLocal() as db:
                trip = fetch_trip_for_collaboration(db=db, trip_id=trip_id)
                if trip is None:
                    await websocket.send_json({"type": "chat.error", "data": {"message": "Trip not found"}})
                    continue
                try:
                    require_trip_member(trip, user_id)
                except PermissionError:
                    await websocket.send_json({"type": "chat.error", "data": {"message": "Trip membership required"}})
                    continue
                if action == "join":
                    mark_messages_delivered_for_user(db=db, user_id=user_id, conversation_id=room)
            if action == "join":
                await chat_connection_manager.join_room(websocket, room)
                await websocket.send_json({"type": "room.joined", "data": {"room": room}})
            else:
                await chat_connection_manager.leave_room(websocket, room)
                await websocket.send_json({"type": "room.left", "data": {"room": room}})
    except WebSocketDisconnect:
        pass
    finally:
        if connected:
            await chat_connection_manager.disconnect(websocket)
