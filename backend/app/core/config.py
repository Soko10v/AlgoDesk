from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Supabase (production): postgresql+asyncpg://postgres.[ref]:...@....supabase.com:5432/postgres
    database_url: str = "postgresql+asyncpg://algodesk:algodesk@localhost:5432/algodesk"
    # Set false when schema is managed in Supabase (SQL or one-off alembic upgrade)
    run_db_migrations: bool = True
    redis_url: str = "redis://localhost:6379/0"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    # Set true on VPS networks that MITM TLS (e.g. some CN cloud hosts)
    database_ssl_insecure: bool = False
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    secret_key: str = "change_me"
    fernet_key: str = ""
    cryptobot_token: str = ""
    cryptobot_webhook_secret: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    # Temporary launch promo: when true every user gets full (pro) access for free
    # and the upgrade/paywall UI is hidden. Set FREE_MODE=false to re-enable billing.
    free_mode: bool = True
    frontend_origin: str = "http://localhost:5173"
    backend_origin: str = "http://localhost:8000"
    access_token_expire_minutes: int = 60 * 24 * 7
    dev_auth: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
