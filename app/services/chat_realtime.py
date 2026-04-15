from __future__ import annotations

import asyncio
import json
import threading
from collections import defaultdict
from collections.abc import Iterable
from uuid import uuid4

from fastapi import WebSocket
from redis.exceptions import RedisError
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
        self._subscriber_thread: threading.Thread | None = None
        self._subscriber_stop = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None

    def start(self) -> None:
        if self._subscriber_thread and self._subscriber_thread.is_alive():
            return
        self._loop = asyncio.get_running_loop()
        self._subscriber_stop.clear()
        self._subscriber_thread = threading.Thread(target=self._run_subscriber, name="aventaro-ws-pubsub", daemon=True)
        self._subscriber_thread.start()

    def stop(self) -> None:
        self._subscriber_stop.set()
        if self._subscriber_thread and self._subscriber_thread.is_alive():
            self._subscriber_thread.join(timeout=2.0)
        self._subscriber_thread = None

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
            self._redis.publish(
                self._settings.websocket_pubsub_channel,
                json.dumps(event, separators=(",", ":"), default=str),
            )
        except RedisError:
            if event.get("target") == "room":
                room = event.get("room")
                payload = event.get("payload")
                if isinstance(room, str) and isinstance(payload, dict):
                    self._schedule_local_room_broadcast(room, payload)
                return
            user_ids = event.get("user_ids")
            payload = event.get("payload")
            if isinstance(user_ids, list) and isinstance(payload, dict):
                self._schedule_local_user_broadcast(user_ids, payload)

    def _run_subscriber(self) -> None:
        client = get_redis_client()
        pubsub = client.pubsub(ignore_subscribe_messages=True)
        try:
            pubsub.subscribe(self._settings.websocket_pubsub_channel)
            while not self._subscriber_stop.is_set():
                message = pubsub.get_message(timeout=1.0)
                if not message or message.get("type") != "message":
                    continue
                data = message.get("data")
                if not isinstance(data, str):
                    continue
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if event.get("target") == "room":
                    room = event.get("room")
                    payload = event.get("payload")
                    if isinstance(room, str) and isinstance(payload, dict):
                        self._schedule_local_room_broadcast(room, payload)
                    continue
                user_ids = event.get("user_ids")
                payload = event.get("payload")
                if isinstance(user_ids, list) and isinstance(payload, dict):
                    self._schedule_local_user_broadcast(user_ids, payload)
        finally:
            pubsub.close()

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
        except Exception:
            await self.disconnect(websocket)


chat_connection_manager = ConnectionManager()
