import json

from app.core.redis import redis_client


async def publish_user_event(user_id: int, payload: dict) -> None:
    await redis_client.publish(f"user:{user_id}:events", json.dumps(payload))
