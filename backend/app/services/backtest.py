from typing import Any

from app.engine.strategy_evaluator import evaluate_signal
from app.services.bybit import bybit_client


async def run_backtest(config: dict[str, Any], since_ms: int | None = None, limit: int = 500) -> dict[str, Any]:
    symbol = config.get("symbol", "BTC/USDT")
    timeframe = config.get("timeframe", "1h")
    client = bybit_client()
    try:
        candles = await client.fetch_ohlcv(symbol=symbol, timeframe=timeframe, since=since_ms, limit=limit)
    finally:
        await client.close()

    closes = [c[4] for c in candles]
    equity = 1000.0
    peak = equity
    position_price: float | None = None
    trades: list[dict[str, Any]] = []
    curve: list[dict[str, float]] = []
    wins = 0
    loss = 0

    for idx, close in enumerate(closes):
        sample = closes[: idx + 1]
        signal = evaluate_signal(config, sample, position_price is not None)
        if signal == "buy" and position_price is None:
            position_price = close
            trades.append({"side": "buy", "price": close, "index": idx})
        elif signal == "sell" and position_price is not None:
            pnl_pct = (close - position_price) / position_price
            equity *= 1 + pnl_pct
            wins += pnl_pct > 0
            loss += pnl_pct <= 0
            trades.append({"side": "sell", "price": close, "index": idx, "pnl_pct": pnl_pct * 100})
            position_price = None

        peak = max(peak, equity)
        drawdown = ((peak - equity) / peak) * 100 if peak else 0.0
        curve.append({"x": float(idx), "y": float(equity), "dd": float(drawdown)})

    total_trades = max(wins + loss, 1)
    return {
        "total_return_pct": (equity - 1000.0) / 1000.0 * 100,
        "max_drawdown_pct": max((p["dd"] for p in curve), default=0.0),
        "win_rate": wins / total_trades * 100,
        "trades": trades,
        "equity_curve": [{"x": p["x"], "y": p["y"]} for p in curve],
    }
