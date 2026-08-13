"""Public-market arbitrage opportunity scanner.

Builds a snapshot of cash-and-carry (spot vs perp funding/basis) and a few
triangular paths so the UI can show them without placing orders. Cross-exchange
execution and live triangular bots are intentionally out of scope.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.engine.risk import FUTURES_TAKER_FEE, SPOT_TAKER_FEE
from app.services.exchange import exchange_client, perp_symbol

logger = logging.getLogger(__name__)

# Liquid majors — enough for a useful board without hammering rate limits.
SCAN_SYMBOLS = (
    "BTC/USDT",
    "ETH/USDT",
    "SOL/USDT",
    "BNB/USDT",
    "XRP/USDT",
    "DOGE/USDT",
    "ADA/USDT",
    "AVAX/USDT",
    "LINK/USDT",
    "DOT/USDT",
)

# Educational triangles only (USDT quote). Never auto-traded.
TRIANGLES: tuple[tuple[str, str, str], ...] = (
    ("USDT", "BTC", "ETH"),
    ("USDT", "BTC", "SOL"),
    ("USDT", "ETH", "SOL"),
)

# Round-trip taker cost for opening both carry legs (spot buy + perp short).
CARRY_OPEN_FEE = SPOT_TAKER_FEE + FUTURES_TAKER_FEE
# Closing both legs again.
CARRY_CLOSE_FEE = SPOT_TAKER_FEE + FUTURES_TAKER_FEE
CARRY_ROUND_TRIP_FEE = CARRY_OPEN_FEE + CARRY_CLOSE_FEE

# Three taker hops for a triangular cycle.
TRI_FEE = SPOT_TAKER_FEE * 3


def funding_apr_pct(rate_8h: float) -> float:
    """Annualise an 8h funding rate as a percent (rate is a fraction)."""
    return float(rate_8h) * 3.0 * 365.0 * 100.0


def basis_pct(spot: float, perp: float) -> float:
    if spot <= 0:
        return 0.0
    return (perp - spot) / spot * 100.0


async def _safe_ticker(client, symbol: str) -> dict[str, Any] | None:
    try:
        return await client.fetch_ticker(symbol)
    except Exception as exc:  # noqa: BLE001
        logger.debug("ticker failed for %s: %s", symbol, exc)
        return None


async def _safe_funding(client, symbol: str) -> float | None:
    """Return the next/current funding rate as a fraction, or None."""
    try:
        if hasattr(client, "fetch_funding_rate"):
            data = await client.fetch_funding_rate(symbol)
            rate = data.get("fundingRate")
            if rate is not None:
                return float(rate)
    except Exception as exc:  # noqa: BLE001
        logger.debug("funding rate failed for %s: %s", symbol, exc)
    try:
        # Fallback: some exchanges expose funding on the ticker.
        ticker = await client.fetch_ticker(symbol)
        info = ticker.get("info") or {}
        for key in ("fundingRate", "funding_rate", "lastFundingRate"):
            if info.get(key) is not None:
                return float(info[key])
    except Exception:  # noqa: BLE001
        pass
    return None


async def scan_funding_basis(exchange: str = "bybit") -> list[dict[str, Any]]:
    """Spot vs linear-perp basis + funding for each scan symbol."""
    spot_client = exchange_client(exchange, market_type="spot")
    fut_client = exchange_client(exchange, market_type="futures")
    rows: list[dict[str, Any]] = []
    try:
        for symbol in SCAN_SYMBOLS:
            perp = perp_symbol(symbol)
            spot_t, perp_t, rate = await asyncio.gather(
                _safe_ticker(spot_client, symbol),
                _safe_ticker(fut_client, perp),
                _safe_funding(fut_client, perp),
            )
            if not spot_t or not perp_t:
                continue
            spot = float(spot_t.get("last") or spot_t.get("close") or 0)
            mark = float(perp_t.get("last") or perp_t.get("close") or 0)
            if spot <= 0 or mark <= 0:
                continue
            rate_8h = float(rate) if rate is not None else 0.0
            apr = funding_apr_pct(rate_8h)
            basis = basis_pct(spot, mark)
            # Net APR after one open+close round of fees, annualised crudely:
            # fees are one-shot; show them separately and as "days to break even".
            fee_pct = CARRY_ROUND_TRIP_FEE * 100.0
            days_to_be = (fee_pct / (apr / 365.0)) if apr > 0.01 else None
            # Carry collects funding when rate > 0 (longs pay shorts) while
            # holding spot long + perp short. Negative funding is a cost.
            rows.append(
                {
                    "type": "funding_basis",
                    "symbol": symbol,
                    "exchange": exchange,
                    "spot": round(spot, 6),
                    "perp": round(mark, 6),
                    "basis_pct": round(basis, 4),
                    "funding_rate_8h": rate_8h,
                    "funding_apr_pct": round(apr, 2),
                    "fee_round_trip_pct": round(fee_pct, 4),
                    "net_apr_hint_pct": round(apr - fee_pct * (365 / 14), 2) if apr else round(-fee_pct, 2),
                    "days_to_breakeven": round(days_to_be, 1) if days_to_be is not None else None,
                    "tradeable": True,  # cash-and-carry bots can deploy this
                    "note": (
                        "Positive funding APR favours spot-long + perp-short. "
                        "Fees are paid once per open/close; funding accrues every 8h."
                    ),
                }
            )
    finally:
        await asyncio.gather(spot_client.close(), fut_client.close(), return_exceptions=True)

    rows.sort(key=lambda r: r["funding_apr_pct"], reverse=True)
    return rows


def _pair_symbol(base: str, quote: str) -> str:
    return f"{base}/{quote}"


async def scan_triangular(exchange: str = "bybit") -> list[dict[str, Any]]:
    """Educational triangular edges. Always marked non-tradeable."""
    client = exchange_client(exchange, market_type="spot")
    rows: list[dict[str, Any]] = []
    try:
        # Collect unique pairs across triangles.
        needed: set[str] = set()
        for a, b, c in TRIANGLES:
            needed.update(
                {
                    _pair_symbol(b, a),
                    _pair_symbol(c, a),
                    _pair_symbol(c, b),
                    _pair_symbol(b, c),
                }
            )
        tickers: dict[str, dict[str, Any]] = {}
        for sym in needed:
            t = await _safe_ticker(client, sym)
            if t:
                tickers[sym] = t

        for quote, mid, alt in TRIANGLES:
            # Path: quote -> mid -> alt -> quote  (buy mid with quote, buy alt with mid, sell alt for quote)
            p_mq = _pair_symbol(mid, quote)  # BTC/USDT
            p_aq = _pair_symbol(alt, quote)  # ETH/USDT
            p_am = _pair_symbol(alt, mid)  # ETH/BTC
            t_mq, t_aq, t_am = tickers.get(p_mq), tickers.get(p_aq), tickers.get(p_am)
            if not (t_mq and t_aq and t_am):
                continue
            # Use ask to buy, bid to sell when available; fall back to last.
            ask_mq = float(t_mq.get("ask") or t_mq.get("last") or 0)
            ask_am = float(t_am.get("ask") or t_am.get("last") or 0)
            bid_aq = float(t_aq.get("bid") or t_aq.get("last") or 0)
            if ask_mq <= 0 or ask_am <= 0 or bid_aq <= 0:
                continue
            # Start with 1 quote unit.
            mid_amt = 1.0 / ask_mq
            alt_amt = mid_amt / ask_am
            end_quote = alt_amt * bid_aq
            raw_edge = (end_quote - 1.0) * 100.0
            net_edge = ((end_quote * (1 - SPOT_TAKER_FEE) ** 3) - 1.0) * 100.0
            rows.append(
                {
                    "type": "triangular",
                    "path": f"{quote}→{mid}→{alt}→{quote}",
                    "exchange": exchange,
                    "raw_edge_pct": round(raw_edge, 4),
                    "net_edge_pct": round(net_edge, 4),
                    "fee_pct": round(TRI_FEE * 100.0, 4),
                    "tradeable": False,
                    "note": (
                        "Shown for education only. Three taker fees (~0.3%) usually wipe "
                        "the edge on CEX; AlgoDesk does not auto-trade triangles."
                    ),
                }
            )
    finally:
        await client.close()

    rows.sort(key=lambda r: r["net_edge_pct"], reverse=True)
    return rows


async def scan_all(exchange: str = "bybit") -> dict[str, Any]:
    funding, triangular = await asyncio.gather(
        scan_funding_basis(exchange),
        scan_triangular(exchange),
    )
    return {
        "exchange": exchange,
        "funding_basis": funding,
        "triangular": triangular,
        "updated_at": None,  # filled by the worker
    }
