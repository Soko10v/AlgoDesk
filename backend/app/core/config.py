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
    # Cryptomus (kept, dormant) — merchant uuid + payment API key.
    cryptomus_merchant: str = ""
    cryptomus_api_key: str = ""
    # Plisio (primary crypto gateway, no-KYC) — single API key (also verifies
    # webhooks by re-fetching the operation).
    plisio_api_key: str = ""
    # Lava.top (secondary: cards / СБП / crypto subscriptions). API key for creating
    # invoices; webhook Basic-auth login/password to verify incoming notifications.
    lava_api_key: str = ""
    lava_webhook_login: str = "algodesk"
    lava_webhook_password: str = ""
    # Lava.top product "offer" UUIDs per plan (from your Lava dashboard).
    lava_offer_pro: str = ""
    lava_offer_expert: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    # Master paywall switch. TRUE (default) = launch promo: everyone gets full
    # (expert) access for free and the tiers are dormant — safe to deploy without
    # breaking access. To GO LIVE with the free/pro/expert paywall set FREE_MODE=false
    # in infra/.env (after CRYPTOBOT_TOKEN and ADMIN_EMAILS are set). The tier system,
    # gating and pricing page are all built and activate the moment this is false.
    free_mode: bool = True
    # Comma-separated emails that always get full (expert) access — the owner/support.
    admin_emails: str = ""
    frontend_origin: str = "http://localhost:5173"
    backend_origin: str = "http://localhost:8000"
    # Public site URL used to build payment callback/return links (no trailing slash).
    public_base_url: str = "https://algodesk.pro"
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
