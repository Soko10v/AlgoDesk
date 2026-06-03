from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token, verify_telegram_payload
from app.models.user import User
from app.schemas.auth import AuthConfigOut, TelegramAuthIn, TokenOut
from app.schemas.user import UserOut
from app.services.users import get_or_create_user_for_telegram

router = APIRouter()
settings = get_settings()


@router.get("/config", response_model=AuthConfigOut)
async def auth_config() -> AuthConfigOut:
    return AuthConfigOut(
        supabase_url=settings.supabase_url,
        supabase_anon_key=settings.supabase_anon_key,
        telegram_bot_username=settings.telegram_bot_username,
    )


@router.post("/telegram", response_model=TokenOut)
async def telegram_login(payload: TelegramAuthIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    payload_dict = payload.model_dump(mode="json", exclude_none=True)
    if not verify_telegram_payload({k: str(v) for k, v in payload_dict.items()}):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Telegram signature")
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Telegram login is not configured")
    user = await get_or_create_user_for_telegram(db, payload.id, payload.username)
    return TokenOut(access_token=create_access_token(subject=str(user.id)))


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)
