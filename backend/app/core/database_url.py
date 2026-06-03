"""Helpers for PostgreSQL URLs (local, Docker, Supabase)."""

import ssl
from urllib.parse import urlparse

import certifi

from app.core.config import get_settings

SUPABASE_HOST_MARKERS = (".supabase.co", ".supabase.com")


def is_supabase_host(database_url: str) -> bool:
    normalized = database_url.replace("postgresql+asyncpg://", "postgresql://")
    host = (urlparse(normalized).hostname or "").lower()
    return any(marker in host for marker in SUPABASE_HOST_MARKERS)


def sqlalchemy_async_connect_args(database_url: str) -> dict:
    if is_supabase_host(database_url):
        settings = get_settings()
        if settings.database_ssl_insecure:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        else:
            ctx = ssl.create_default_context(cafile=certifi.where())
        return {"ssl": ctx}
    return {}


def alembic_sync_url(database_url: str) -> str:
    return database_url.replace("postgresql+asyncpg://", "postgresql://").replace(
        "postgresql+psycopg2://", "postgresql://"
    )


def alembic_connect_args(database_url: str) -> dict:
    if is_supabase_host(database_url):
        return {"sslmode": "require"}
    return {}
