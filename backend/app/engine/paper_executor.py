from datetime import UTC, datetime

from app.models.trade import Trade
from app.models.strategy import Strategy


def paper_fill_price(price: float, side: str) -> float:
    slippage = 0.0005
    return price * (1 + slippage if side == "buy" else 1 - slippage)


def build_paper_trade(
    strategy: Strategy,
    side: str,
    price: float,
    amount: float,
    pnl: float | None = None,
    leg: str = "main",
) -> Trade:
    return Trade(
        strategy_id=strategy.id,
        symbol=strategy.config_json.get("symbol", "BTC/USDT"),
        side=side,
        price=paper_fill_price(price, side),
        amount=amount,
        pnl=pnl,
        leg=leg,
        timestamp=datetime.now(UTC),
    )
