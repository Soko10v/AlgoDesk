from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.security import encrypt_secret
from app.models.user import User
from app.schemas.exchange import BalanceOut, ExchangeConnectIn
from app.services.exchange import fetch_account_balance, fetch_min_order, test_user_credentials

router = APIRouter()


@router.post("/connect")
async def connect_exchange(
    payload: ExchangeConnectIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    current_user.exchange = payload.exchange
    current_user.api_key_encrypted = encrypt_secret(payload.api_key)
    current_user.api_secret_encrypted = encrypt_secret(payload.api_secret)
    await db.commit()
    return {"ok": True}


@router.post("/test")
async def test_exchange(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not current_user.api_key_encrypted or not current_user.api_secret_encrypted:
        raise HTTPException(status_code=400, detail="Exchange keys are not set")
    ok = await test_user_credentials(current_user)
    return {"ok": ok}


@router.get("/status")
async def exchange_status(current_user: User = Depends(get_current_user)) -> dict:
    return {
        "connected": bool(current_user.api_key_encrypted and current_user.api_secret_encrypted),
        "exchange": current_user.exchange,
    }


@router.get("/balance", response_model=BalanceOut)
async def exchange_balance(current_user: User = Depends(get_current_user)) -> BalanceOut:
    data = await fetch_account_balance(current_user)
    return BalanceOut(**data)


@router.get("/min-order")
async def min_order(
    symbol: str,
    futures: bool = False,
    leverage: int = 1,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Minimum order for a symbol on the user's exchange: position notional minimum
    and the minimum size (margin) the user must enter at the given leverage."""
    return await fetch_min_order(current_user.exchange, symbol, futures, leverage)


@router.delete("/disconnect")
async def disconnect_exchange(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    current_user.api_key_encrypted = None
    current_user.api_secret_encrypted = None
    await db.commit()
    return {"ok": True}
