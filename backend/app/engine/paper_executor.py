from datetime import UTC, datetime

from app.engine.risk import SLIPPAGE_PER_SIDE
from app.models.trade import Trade
from app.models.strategy import Strategy


def paper_fill_price(price: float, side: str) -> float:
    """Market-order fill with the shared slippage assumption (see risk.py), so
    paper results line up with what the backtest charges."""
    return price * (1 + SLIPPAGE_PER_SIDE if side == "buy" else 1 - SLIPPAGE_PER_SIDE)


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
        mode="paper",
        timestamp=datetime.now(UTC),
    )
