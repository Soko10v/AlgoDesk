from pydantic import BaseModel, Field


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


class DevLoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class AuthConfigOut(BaseModel):
    telegram_bot_username: str
    dev_auth: bool
