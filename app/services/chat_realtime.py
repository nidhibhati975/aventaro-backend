from __future__ import annotations

import asyncio
import json
import threading
import time
from collections import defaultdict
from collections.abc import Iterable
from uuid import uuid4

from fastapi import WebSocket
from redis.exceptions import RedisError, ResponseError
from starlette.websockets import WebSocketState

from app.services.redis_runtime import get_redis_client
from app.utils.config import get_settings


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[int, dict[str, WebSocket]] = defaultdict(dict)
        self._socket_index: dict[WebSocket, tuple[int, str]] = {}
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self._socket_rooms: dict[WebSocket, set[str]] = defaultdict(set)
        self._heartbeat_tasks: dict[WebSocket, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()
        self._redis = get_redis_client()
        self._settings = get_settings()
        self._consumer_thread: threading.Thread | None = None
        self._consumer_stop = threading.Event()
        self._consumer_name = f"api-{uuid4().hex}"
        self._loop: asyncio.AbstractEventLoop | None = None

    def start(self) -> None:
        if self._consumer_thread and self._consumer_thread.is_alive():
            return
        self._loop = asyncio.get_running_loop()
        self._consumer_stop.clear()
        self._ensure_stream_group()
        self._consumer_thread = threading.Thread(target=self._run_stream_consumer, name="aventaro-ws-streams", daemon=True)
        self._consumer_thread.start()

    def stop(self) -> None:
        self._consumer_stop.set()
        if self._consumer_thread and self._consumer_thread.is_alive():
            self._consumer_thread.join(timeout=2.0)
        self._consumer_thread = None

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        connection_id = str(uuid4())
        async with self._lock:
            self._connections[user_id][connection_id] = websocket
            self._socket_index[websocket] = (user_id, connection_id)
            self._heartbeat_tasks[websocket] = asyncio.create_task(self._presence_heartbeat(user_id, connection_id))
        self._mark_presence(user_id, connection_id)

    async def disconnect(self, websocket: WebSocket) -> None:
        connection: tuple[int, str] | None = None
        task: asyncio.Task[None] | None = None
        async with self._lock:
            connection = self._socket_index.pop(websocket, None)
            task = self._heartbeat_tasks.pop(websocket, None)
            rooms = self._socket_rooms.pop(websocket, set())
            for room in rooms:
                sockets = self._rooms.get(room)
                if not sockets:
                    continue
                sockets.discard(websocket)
                if not sockets:
                    self._rooms.pop(room, None)
            if connection is not None:
                user_id, connection_id = connection
                sockets = self._connections.get(user_id)
                if sockets:
                    sockets.pop(connection_id, None)
                    if not sockets:
                        self._connections.pop(user_id, None)
        if task is not None:
            task.cancel()
        if connection is not None:
            self._clear_presence(*connection)

    async def join_room(self, websocket: WebSocket, room: str) -> None:
        async with self._lock:
            if websocket not in self._socket_index:
                raise RuntimeError("Socket is not connected")
            self._rooms[room].add(websocket)
            self._socket_rooms[websocket].add(room)

    async def leave_room(self, websocket: WebSocket, room: str) -> None:
        async with self._lock:
            sockets = self._rooms.get(room)
            if sockets:
                sockets.discard(websocket)
                if not sockets:
                    self._rooms.pop(room, None)
            socket_rooms = self._socket_rooms.get(websocket)
            if socket_rooms:
                socket_rooms.discard(room)
                if not socket_rooms:
                    self._socket_rooms.pop(websocket, None)

    async def broadcast_to_users(self, user_ids: Iterable[int], payload: dict) -> None:
        self._publish({"target": "users", "user_ids": sorted({int(user_id) for user_id in user_ids}), "payload": payload})

    async def broadcast_to_room(self, room: str, payload: dict) -> None:
        self._publish({"target": "room", "room": room, "payload": payload})

    def publish_to_users(self, user_ids: Iterable[int], payload: dict) -> None:
        self._publish({"target": "users", "user_ids": sorted({int(user_id) for user_id in user_ids}), "payload": payload})

    def publish_to_room(self, room: str, payload: dict) -> None:
        self._publish({"target": "room", "room": room, "payload": payload})

    def filter_offline_users(self, user_ids: Iterable[int]) -> list[int]:
        offline_users: list[int] = []
        for user_id in {int(item) for item in user_ids}:
            if not self.is_user_online(user_id):
                offline_users.append(user_id)
        return offline_users

    def is_user_online(self, user_id: int) -> bool:
        try:
            return bool(self._redis.scard(self._presence_key(user_id)))
        except RedisError:
            return False

    async def _presence_heartbeat(self, user_id: int, connection_id: str) -> None:
        try:
            while True:
                await asyncio.sleep(self._settings.websocket_presence_heartbeat_seconds)
                self._mark_presence(user_id, connection_id)
        except asyncio.CancelledError:
            return

    def _presence_key(self, user_id: int) -> str:
        return f"ws:presence:user:{user_id}"

    def _mark_presence(self, user_id: int, connection_id: str) -> None:
        try:
            pipeline = self._redis.pipeline()
            pipeline.sadd(self._presence_key(user_id), connection_id)
            pipeline.expire(self._presence_key(user_id), self._settings.websocket_presence_ttl_seconds)
            pipeline.execute()
        except RedisError:
            return

    def _clear_presence(self, user_id: int, connection_id: str) -> None:
        key = self._presence_key(user_id)
        try:
            pipeline = self._redis.pipeline()
            pipeline.srem(key, connection_id)
            pipeline.scard(key)
            result = pipeline.execute()
            if result and int(result[-1] or 0) == 0:
                self._redis.delete(key)
        except RedisError:
            return

    def _publish(self, event: dict[str, object]) -> None:
        try:
            self._redis.xadd(
                self._settings.redis_stream_chat_events,
                {
                    "event_id": str(event.get("event_id") or uuid4().hex),
                    "event": json.dumps(event, separators=(",", ":"), default=str),
                },
                maxlen=100_000,
                approximate=True,
            )
        except RedisError:
            # Durable message writes are handled by DB outbox rows before this
            # publish path is called. The stream failure is surfaced through logs
            # and retried by the outbox publisher instead of falling back to
            # process-local delivery.
            return

    def _ensure_stream_group(self) -> None:
        client = get_redis_client()
        try:
            client.xgroup_create(
                name=self._settings.redis_stream_chat_events,
                groupname=self._settings.redis_stream_chat_group,
                id="0",
                mkstream=True,
            )
        except ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise

    def _run_stream_consumer(self) -> None:
        client = get_redis_client()
        last_claim_check = 0.0
        while not self._consumer_stop.is_set():
            try:
                now = time.monotonic()
                if now - last_claim_check > 15:
                    self._claim_stale_stream_messages(client)
                    last_claim_check = now
                response = client.xreadgroup(
                    groupname=self._settings.redis_stream_chat_group,
                    consumername=self._consumer_name,
                    streams={self._settings.redis_stream_chat_events: ">"},
                    count=20,
                    block=1000,
                )
            except RedisError:
                time.sleep(1.0)
                continue
            for _stream_name, messages in response:
                for stream_id, fields in messages:
                    if self._handle_stream_event(fields):
                        try:
                            client.xack(
                                self._settings.redis_stream_chat_events,
                                self._settings.redis_stream_chat_group,
                                stream_id,
                            )
                        except RedisError:
                            continue

    def _claim_stale_stream_messages(self, client) -> None:
        try:
            result = client.xautoclaim(
                self._settings.redis_stream_chat_events,
                self._settings.redis_stream_chat_group,
                self._consumer_name,
                min_idle_time=30_000,
                start_id="0-0",
                count=20,
            )
        except RedisError:
            return
        claimed_messages = result[1] if isinstance(result, (list, tuple)) and len(result) > 1 else []
        for stream_id, fields in claimed_messages:
            if self._handle_stream_event(fields):
                try:
                    client.xack(
                        self._settings.redis_stream_chat_events,
                        self._settings.redis_stream_chat_group,
                        stream_id,
                    )
                except RedisError:
                    continue

    def _handle_stream_event(self, fields: dict[str, str]) -> bool:
        data = fields.get("event")
        if not isinstance(data, str):
            return True
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            return True
        if event.get("target") == "room":
            room = event.get("room")
            payload = event.get("payload")
            if isinstance(room, str) and isinstance(payload, dict):
                self._schedule_local_room_broadcast(room, payload)
            return True
        user_ids = event.get("user_ids")
        payload = event.get("payload")
        if isinstance(user_ids, list) and isinstance(payload, dict):
            self._schedule_local_user_broadcast(user_ids, payload)
        return True

    def _schedule_local_room_broadcast(self, room: str, payload: dict[str, object]) -> None:
        if self._loop is None:
            return
        self._loop.call_soon_threadsafe(
            lambda room=room, payload=payload: asyncio.create_task(self._broadcast_local_room(room, payload))
        )

    def _schedule_local_user_broadcast(self, user_ids: list[int], payload: dict[str, object]) -> None:
        if self._loop is None:
            return
        normalized_user_ids = [int(item) for item in user_ids]
        self._loop.call_soon_threadsafe(
            lambda user_ids=normalized_user_ids, payload=payload: asyncio.create_task(self._broadcast_local_users(user_ids, payload))
        )

    async def _broadcast_local_users(self, user_ids: Iterable[int], payload: dict[str, object]) -> None:
        tasks = []
        async with self._lock:
            targets = {
                websocket
                for user_id in user_ids
                for websocket in self._connections.get(user_id, {}).values()
            }

        for websocket in targets:
            tasks.append(self._send(websocket, payload))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _broadcast_local_room(self, room: str, payload: dict[str, object]) -> None:
        tasks = []
        async with self._lock:
            targets = set(self._rooms.get(room, set()))

        for websocket in targets:
            tasks.append(self._send(websocket, payload))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _send(self, websocket: WebSocket, payload: dict[str, object]) -> None:
        if websocket.application_state != WebSocketState.CONNECTED:
            await self.disconnect(websocket)
            return
        try:
            await websocket.send_json(payload)
            connection = self._socket_index.get(websocket)
            data = payload.get("data") if isinstance(payload, dict) else None
            message_id = data.get("id") if isinstance(data, dict) else None
            if (
                connection is not None
                and payload.get("type") in {"chat.message.created", "chat.message"}
                and message_id is not None
            ):
                from app.db.session import SessionLocal
                from app.services.chat import acknowledge_message_delivery

                with SessionLocal() as db:
                    acknowledge_message_delivery(db, user_id=connection[0], message_id=int(message_id), status="delivered")
        except Exception:
            await self.disconnect(websocket)


chat_connection_manager = ConnectionManager()
