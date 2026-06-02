import zlib

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token, verify_telegram_payload
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.auth import AuthConfigOut, DevLoginIn, TelegramAuthIn, TokenOut
from app.schemas.user import UserOut

router = APIRouter()
settings = get_settings()


async def _get_or_create_user(db: AsyncSession, telegram_id: int, username: str | None) -> User:
    user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
    if user is None:
        user = User(telegram_id=telegram_id, username=username)
        db.add(user)
        await db.flush()
        db.add(Subscription(user_id=user.id, plan="free", paid_in_usdt=0.0))
    else:
        user.username = username
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/telegram", response_model=TokenOut)
async def telegram_login(payload: TelegramAuthIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    payload_dict = payload.model_dump(mode="json", exclude_none=True)
    if not verify_telegram_payload({k: str(v) for k, v in payload_dict.items()}):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Telegram signature")
    user = await _get_or_create_user(db, payload.id, payload.username)
    return TokenOut(access_token=create_access_token(subject=str(user.id)))


@router.get("/config", response_model=AuthConfigOut)
async def auth_config() -> AuthConfigOut:
    return AuthConfigOut(telegram_bot_username=settings.telegram_bot_username, dev_auth=settings.dev_auth)


@router.post("/dev-login", response_model=TokenOut)
async def dev_login(payload: DevLoginIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    if not settings.dev_auth:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Dev login is disabled")
    username = payload.username.strip() or "dev"
    telegram_id = 900_000_000 + (zlib.crc32(username.encode("utf-8")) % 1_000_000_000)
    user = await _get_or_create_user(db, telegram_id, username)
    return TokenOut(access_token=create_access_token(subject=str(user.id)))


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)
