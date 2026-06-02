from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://algodesk:algodesk@localhost:5432/algodesk"
    redis_url: str = "redis://localhost:6379/0"
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    secret_key: str = "change_me"
    fernet_key: str = ""
    cryptobot_token: str = ""
    cryptobot_webhook_secret: str = ""
    frontend_origin: str = "http://localhost:5173"
    backend_origin: str = "http://localhost:8000"
    access_token_expire_minutes: int = 60 * 24 * 7
    dev_auth: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
