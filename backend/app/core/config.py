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
    # Risk safety net: a user can't hold more than this many open positions at once
    # across all their strategies (0 disables the cap).
    max_open_positions_per_user: int = 8
    # Observability/ops (optional; empty disables). admin_telegram_id receives
    # engine-health alerts (recovery failure, stalled bots).
    sentry_dsn: str = ""
    admin_telegram_id: int = 0
    # AI strategy analysis via DeepSeek (OpenAI-compatible). Empty key disables it.
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-chat"
    deepseek_base_url: str = "https://api.deepseek.com"
    # Local OHLCV cache (SQLite) so backtests/optimize/walk-forward read history
    # instantly without hammering the exchange, and can span years. Path should sit
    # on a persistent Docker volume in prod. Empty path disables the cache.
    candles_db_path: str = "/data/candles.db"
    candles_years_back: int = 5

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
