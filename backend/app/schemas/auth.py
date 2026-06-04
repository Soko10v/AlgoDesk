from pydantic import BaseModel, Field


class AuthConfigOut(BaseModel):
    supabase_url: str
    supabase_anon_key: str
    telegram_bot_username: str = ""
    google_enabled: bool = False


class TelegramAuthIn(BaseModel):
    id: int
    first_name: str | None = None
    username: str | None = None
    photo_url: str | None = None
    auth_date: str
    hash: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
