import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.db import SessionLocal
from app.core.redis import redis_client
from app.core.security import try_decode_token
from app.services.supabase_auth import fetch_supabase_user
from app.services.users import get_or_create_user_for_auth

router = APIRouter()


async def _resolve_user_id(token: str) -> int | None:
    """Resolve the internal integer user id from the connection token.

    Mirrors the REST auth in ``get_current_user``: a Supabase access token is
    validated against Supabase and mapped to the local user, while a legacy /
    Telegram internal JWT carries the integer id directly in ``sub``. Events are
    published to ``user:{user.id}:events`` (integer), so the channel must use the
    same id — not the Supabase UUID.
    """
    if not token:
        return None
    supabase_user = await fetch_supabase_user(token)
    if supabase_user is not None:
        async with SessionLocal() as db:
            user = await get_or_create_user_for_auth(
                db, str(supabase_user["id"]), supabase_user.get("email")
            )
            return user.id
    payload = try_decode_token(token)
    if payload is not None:
        try:
            return int(payload.get("sub"))
        except (TypeError, ValueError):
            return None
    return None


@router.websocket("/ws")
async def websocket_events(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token", "")
    user_id = await _resolve_user_id(token)
    if user_id is None:
        await websocket.close(code=1008)
        return
    channel = f"user:{user_id}:events"
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(channel)
    await websocket.accept()
    try:
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("data"):
                data = message["data"]
                if isinstance(data, str):
                    await websocket.send_text(data)
                else:
                    await websocket.send_text(json.dumps(data))
            await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
