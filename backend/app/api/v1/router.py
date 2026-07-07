from fastapi import APIRouter

from app.api.v1.routes import analytics, auth, backtest, bots, discovered, exchange, payments, strategies, trades, ws

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
api_router.include_router(exchange.router, prefix="/exchange", tags=["exchange"])
api_router.include_router(strategies.router, prefix="/strategies", tags=["strategies"])
api_router.include_router(bots.router, prefix="/bots", tags=["bots"])
api_router.include_router(backtest.router, prefix="/backtest", tags=["backtest"])
api_router.include_router(trades.router, prefix="/trades", tags=["trades"])
api_router.include_router(payments.router, prefix="/payments", tags=["payments"])
api_router.include_router(discovered.router, prefix="/discovery", tags=["discovery"])
api_router.include_router(ws.router, prefix="", tags=["ws"])
