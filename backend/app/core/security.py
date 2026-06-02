from datetime import UTC, datetime, timedelta
from hashlib import sha256
import hmac
from typing import Any

from cryptography.fernet import Fernet
from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()
ALGORITHM = "HS256"


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(UTC) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])


def verify_telegram_payload(payload: dict[str, str]) -> bool:
    check_hash = payload.get("hash", "")
    data = {k: v for k, v in payload.items() if k != "hash" and v is not None}
    data_check_string = "\n".join(f"{k}={data[k]}" for k in sorted(data.keys()))
    secret_key = sha256(settings.telegram_bot_token.encode("utf-8")).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), "sha256").hexdigest()
    return hmac.compare_digest(computed_hash, check_hash)


def get_fernet() -> Fernet:
    return Fernet(settings.fernet_key.encode("utf-8"))


def encrypt_secret(value: str) -> str:
    return get_fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str) -> str:
    return get_fernet().decrypt(value.encode("utf-8")).decode("utf-8")


def try_decode_token(token: str) -> dict[str, Any] | None:
    try:
        return decode_access_token(token)
    except JWTError:
        return None
