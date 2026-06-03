from typing import Any

import httpx

from app.core.config import get_settings

settings = get_settings()


async def fetch_supabase_user(access_token: str) -> dict[str, Any] | None:
    if not settings.supabase_url or not settings.supabase_anon_key:
        return None
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "apikey": settings.supabase_anon_key,
            },
        )
    if response.status_code != 200:
        return None
    data = response.json()
    user_id = data.get("id")
    if not user_id:
        return None
    return data
