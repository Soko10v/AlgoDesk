from typing import Any

from app.engine.risk import hedge_params, leverage, pct_value
from app.engine.strategy_evaluator import evaluate_signal
from app.services.exchange import exchange_client

# Most exchanges cap a single fetch_ohlcv call at ~1000 candles, so longer
# backtests are stitched together from several paginated requests.
MAX_CANDLES = 2000
PER_REQUEST_LIMIT = 1000


async def _fetch_candles(
    client,
    symbol: str,
    timeframe: str,
    since_ms: int | None = None,
    until_ms: int | None = None,
    limit: int = MAX_CANDLES,
) -> list[list[float]]:
    """Fetch up to `limit` OHLCV candles in [since_ms, until_ms], paginating around
    the exchange per-request cap. With no since_ms, returns the most recent `limit` candles."""
    tf_ms = client.parse_timeframe(timeframe) * 1000
    end = until_ms if until_ms is not None else client.milliseconds()
    cursor = since_ms if since_ms is not None else end - limit * tf_ms
    candles: list[list[float]] = []
    while len(candles) < limit:
        want = min(PER_REQUEST_LIMIT, limit - len(candles))
        batch = await client.fetch_ohlcv(
            symbol=symbol, timeframe=timeframe, since=cursor, limit=want
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
        if len(batch) < want:
            break
    return candles[:limit]


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
    lev = leverage(config)
    sl_val = pct_value(config.get("stop_loss"))
    tp_val = pct_value(config.get("take_profit"))
    hedge = hedge_params(config)  # None unless this is a futures strategy with hedging on

    equity = 1000.0
    peak = equity
    position_price: float | None = None
    hedge_entry: float | None = None
    hedge_low: float | None = None
    trades: list[dict[str, Any]] = []
    curve: list[dict[str, float]] = []
    wins = 0
    loss = 0

    def realize(ret: float) -> None:
        """Compound a fractional return into equity, amplified by leverage."""
        nonlocal equity
        equity *= 1 + ret * lev

    for idx, candle in enumerate(candles):
        # candle = [ts, open, high, low, close, volume]
        open_, high, low, close = candle[1], candle[2], candle[3], candle[4]
        sample = closes[: idx + 1]

        if position_price is None:
            if evaluate_signal(config, sample, False) == "buy":
                position_price = close
                trades.append({"side": "buy", "price": close, "index": idx, "leg": "main"})
                if hedge and hedge["mode"] == "constant_partial":
                    hedge_entry = close
                    trades.append({"side": "sell", "price": close, "index": idx, "leg": "hedge"})
        else:
            # 1. Release an auto_squeeze hedge once price recovers far enough off its low.
            if hedge and hedge["mode"] == "auto_squeeze" and hedge_entry is not None:
                hedge_low = min(hedge_low if hedge_low is not None else low, low)
                release_price = hedge_low * (1 + hedge["release_pct"] / 100)
                if high >= release_price:
                    short_ret = (hedge_entry - release_price) / hedge_entry
                    realize(hedge["ratio"] * short_ret)
                    trades.append({
                        "side": "buy", "price": release_price, "index": idx,
                        "leg": "hedge", "pnl_pct": short_ret * 100, "reason": "recovered",
                    })
                    hedge_entry = hedge_low = None

            # 2. Exit the long: stop-loss (gap-aware) first, then take-profit, then signal.
            exit_price: float | None = None
            reason: str | None = None
            if sl_val is not None and low <= position_price * (1 - sl_val / 100):
                stop_price = position_price * (1 - sl_val / 100)
                # A squeeze that gaps the open below the stop fills at the open, not the stop.
                exit_price = min(stop_price, open_)
                reason = "stop_loss"
            elif tp_val is not None and high >= position_price * (1 + tp_val / 100):
                exit_price = position_price * (1 + tp_val / 100)
                reason = "take_profit"
            elif evaluate_signal(config, sample, True) == "sell":
                exit_price = close
                reason = "signal"

            if exit_price is not None:
                ret = (exit_price - position_price) / position_price
                realize(ret)
                wins += ret > 0
                loss += ret <= 0
                trades.append({
                    "side": "sell", "price": exit_price, "index": idx,
                    "leg": "main", "pnl_pct": ret * 100, "reason": reason,
                })
                position_price = None
                # Unwind any hedge alongside the main position.
                if hedge and hedge_entry is not None:
                    short_ret = (hedge_entry - exit_price) / hedge_entry
                    realize(hedge["ratio"] * short_ret)
                    trades.append({
                        "side": "buy", "price": exit_price, "index": idx,
                        "leg": "hedge", "pnl_pct": short_ret * 100, "reason": "position_closed",
                    })
                    hedge_entry = hedge_low = None
            elif hedge and hedge["mode"] == "auto_squeeze" and hedge_entry is None and high > 0:
                # Still holding: open a hedge if this candle shows a fast intrabar drop.
                if (high - low) / high * 100 >= hedge["trigger_pct"]:
                    hedge_entry = high * (1 - hedge["trigger_pct"] / 100)
                    hedge_low = low
                    trades.append({
                        "side": "sell", "price": hedge_entry, "index": idx,
                        "leg": "hedge", "reason": "squeeze",
                    })

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
