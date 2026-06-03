from app.models.strategy import Strategy
from app.models.user import User
from app.services.exchange import exchange_client


async def place_live_order(user: User, strategy: Strategy, side: str, amount: float) -> float:
    if not strategy.live_enabled:
        raise ValueError("Live trading is disabled for this strategy.")
    symbol = strategy.config_json.get("symbol", "BTC/USDT")
    client = exchange_client(user.exchange, user)
    try:
        order = await client.create_order(symbol=symbol, type="market", side=side, amount=amount)
        return float(order.get("average") or order.get("price") or 0.0)
    finally:
        await client.close()
