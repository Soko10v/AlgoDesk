"""Helpers for PostgreSQL URLs (local, Docker, Supabase)."""

from urllib.parse import urlparse

SUPABASE_HOST_MARKERS = (".supabase.co", ".supabase.com")


def is_supabase_host(database_url: str) -> bool:
    normalized = database_url.replace("postgresql+asyncpg://", "postgresql://")
    host = (urlparse(normalized).hostname or "").lower()
    return any(marker in host for marker in SUPABASE_HOST_MARKERS)


def sqlalchemy_async_connect_args(database_url: str) -> dict:
    if is_supabase_host(database_url):
        return {"ssl": True}
    return {}


def alembic_sync_url(database_url: str) -> str:
    return database_url.replace("postgresql+asyncpg://", "postgresql://").replace(
        "postgresql+psycopg2://", "postgresql://"
    )


def alembic_connect_args(database_url: str) -> dict:
    if is_supabase_host(database_url):
        return {"sslmode": "require"}
    return {}
