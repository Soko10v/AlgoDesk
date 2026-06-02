import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.redis import redis_client
from app.core.security import try_decode_token

router = APIRouter()


@router.websocket("/ws")
async def websocket_events(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token", "")
    payload = try_decode_token(token)
    if payload is None:
        await websocket.close(code=1008)
        return
    user_id = payload.get("sub")
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
