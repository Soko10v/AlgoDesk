from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token, verify_telegram_payload
from app.models.user import User
from app.schemas.auth import AuthConfigOut, TelegramAuthIn, TokenOut
from app.schemas.user import UserOut
from app.services.users import get_or_create_user_for_auth, get_or_create_user_for_telegram

router = APIRouter()
settings = get_settings()

# ── helpers ──────────────────────────────────────────────────────────────────

def _google_callback_uri() -> str:
    """The redirect_uri we register with Google and pass in every OAuth request."""
    return f"{settings.backend_origin}/api/v1/auth/google/callback"


# ── public routes ─────────────────────────────────────────────────────────────

@router.get("/config", response_model=AuthConfigOut)
async def auth_config() -> AuthConfigOut:
    return AuthConfigOut(
        supabase_url=settings.supabase_url,
        supabase_anon_key=settings.supabase_anon_key,
        telegram_bot_username=settings.telegram_bot_username,
        google_enabled=bool(settings.google_client_id and settings.google_client_secret),
    )


@router.get("/google")
async def google_login(request: Request) -> RedirectResponse:
    """Redirect the browser to Google's OAuth consent screen."""
    if not settings.google_client_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google login is not configured")
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": _google_callback_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
    }
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}")


@router.get("/google/callback")
async def google_callback(
    code: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Google sends the browser here after the user approves (or denies) sign-in."""
    frontend = settings.frontend_origin

    if error or not code:
        reason = error or "no_code"
        return RedirectResponse(f"{frontend}/login?error={reason}")

    # 1. Exchange auth code for tokens
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": _google_callback_uri(),
                "grant_type": "authorization_code",
            },
        )

    if token_resp.status_code != 200:
        return RedirectResponse(f"{frontend}/login?error=token_exchange_failed")

    token_data = token_resp.json()
    access_token_google = token_data.get("access_token")
    if not access_token_google:
        return RedirectResponse(f"{frontend}/login?error=no_access_token")

    # 2. Fetch user info from Google
    async with httpx.AsyncClient() as client:
        info_resp = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token_google}"},
        )

    if info_resp.status_code != 200:
        return RedirectResponse(f"{frontend}/login?error=userinfo_failed")

    user_info = info_resp.json()
    google_sub = user_info.get("id") or user_info.get("sub")
    email = user_info.get("email")

    if not google_sub or not email:
        return RedirectResponse(f"{frontend}/login?error=missing_user_info")

    # 3. Find or create user in our DB
    auth_user_id = f"google:{google_sub}"
    user = await get_or_create_user_for_auth(db, auth_user_id, email)

    # 4. Issue our own JWT and send user to the frontend callback page
    jwt = create_access_token(subject=str(user.id))
    # Use a fragment (#) so the token never reaches the server and disappears
    # from the address bar as soon as the page navigates to /dashboard.
    return RedirectResponse(f"{frontend}/auth/callback#token={jwt}")


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
