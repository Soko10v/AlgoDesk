from typing import Any

from app.engine.strategy_evaluator import evaluate_signal
from app.services.exchange import exchange_client

# Most exchanges cap a single fetch_ohlcv call at ~1000 candles, so longer
# backtests are stitched together from several paginated requests.
PER_REQUEST_LIMIT = 1000


async def _fetch_candles(
    client,
    symbol: str,
    timeframe: str,
    since_ms: int | None = None,
    until_ms: int | None = None,
) -> list[list[float]]:
    """Fetch OHLCV candles for [since_ms, until_ms], paginating around the
    exchange per-request cap. With no bounds, loads from earliest available."""
    tf_ms = client.parse_timeframe(timeframe) * 1000
    end = until_ms if until_ms is not None else client.milliseconds()
    cursor = since_ms if since_ms is not None else 0
    candles: list[list[float]] = []
    while True:
        batch = await client.fetch_ohlcv(
            symbol=symbol, timeframe=timeframe, since=cursor, limit=PER_REQUEST_LIMIT
        )
        if not batch:
            break
        if candles:
            batch = [c for c in batch if c[0] > candles[-1][0]]
            if not batch:
                break
        batch = [c for c in batch if c[0] <= end]
        if not batch:
            break
        candles.extend(batch)
        if candles[-1][0] >= end - tf_ms:
            break
        cursor = candles[-1][0] + tf_ms
        if len(batch) < PER_REQUEST_LIMIT:
            break
    return candles


async def run_backtest(
    config: dict[str, Any],
    since_ms: int | None = None,
    until_ms: int | None = None,
) -> dict[str, Any]:
    symbol = config.get("symbol", "BTC/USDT")
    timeframe = config.get("timeframe", "1h")
    client = exchange_client()
    try:
        candles = await _fetch_candles(client, symbol, timeframe, since_ms, until_ms)
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
