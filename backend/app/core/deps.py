from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.plans import FEATURE_MIN_PLAN, allows, effective_plan
from app.core.security import decode_access_token
from app.models.subscription import Subscription
from app.models.user import User
from app.services.supabase_auth import fetch_supabase_user
from app.services.users import get_or_create_user_for_auth

bearer_scheme = HTTPBearer(auto_error=False)
settings = get_settings()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    token = credentials.credentials
    supabase_user = await fetch_supabase_user(token)
    if supabase_user is not None:
        auth_user_id = str(supabase_user["id"])
        email = supabase_user.get("email")
        return await get_or_create_user_for_auth(db, auth_user_id, email)

    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        user = await db.get(User, int(user_id))
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return user
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc


async def current_plan(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> str:
    """The plan in force for this user (expert for everyone while FREE_MODE is on)."""
    if settings.free_mode:
        return effective_plan(None, None, free_mode=True)
    if is_admin_user(user):
        return effective_plan(None, None, free_mode=True)
    sub = (
        await db.execute(select(Subscription).where(Subscription.user_id == user.id))
    ).scalar_one_or_none()
    plan = sub.plan if sub else None
    expires = sub.expires_at if sub else None
    return effective_plan(plan, expires, free_mode=False)


def is_admin_user(user: User) -> bool:
    admins = {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}
    return bool(user.email and user.email.lower() in admins)


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Dependency that 403s unless the caller's email is in ADMIN_EMAILS."""
    if not is_admin_user(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


def require_feature(feature: str):
    """Dependency that 402s with an upgrade hint unless the user's plan unlocks ``feature``."""

    async def _guard(plan: str = Depends(current_plan)) -> str:
        if not allows(plan, feature):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "error": "upgrade_required",
                    "feature": feature,
                    "required_plan": FEATURE_MIN_PLAN.get(feature, "expert"),
                    "plan": plan,
                },
            )
        return plan

    return _guard
