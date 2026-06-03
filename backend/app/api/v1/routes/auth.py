from fastapi import APIRouter, Depends

from app.core.config import get_settings
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.auth import AuthConfigOut
from app.schemas.user import UserOut

router = APIRouter()
settings = get_settings()


@router.get("/config", response_model=AuthConfigOut)
async def auth_config() -> AuthConfigOut:
    return AuthConfigOut(
        supabase_url=settings.supabase_url,
        supabase_anon_key=settings.supabase_anon_key,
    )


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)
