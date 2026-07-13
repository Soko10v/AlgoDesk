import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ccxt.base.errors import InsufficientFunds

from app.core.config import get_settings
from app.core.redis import redis_client
from app.engine.live_executor import (
    account_is_hedge,
    cancel_order,
    live_order_amount,
    place_live_order,
    place_stop_order,
)
from app.engine.paper_executor import build_paper_trade, paper_fill_price
from app.engine.risk import (
    adverse_excursion_pct,
    hedge_params,
    is_futures,
    leverage,
    round_trip_fee_pct,
    stop_loss_pct,
    take_profit_pct,
    trailing_pct,
)
from app.engine.strategy_evaluator import evaluate_signal
from app.services.indicators import atr
from app.models.strategy import Strategy
from app.models.trade import Trade
from app.models.user import User
from app.services.exchange import exchange_client, perp_symbol
from app.services.events import publish_user_event
from app.services.telegram_alerts import send_admin_alert, send_telegram_alert

logger = logging.getLogger(__name__)

# Enough history for a 200-period trend filter (+ the dropped forming candle and
# a safety margin) to evaluate live the same way it does in the backtest.
SEED_CANDLES = 350
LOOP_INTERVAL = 2.0
# Signals run on real OHLCV candles for the strategy's timeframe, not the 2s
# price ticks. Candles are cached in Redis and refreshed at most this often
# (shared across bots), which is frequent enough to spot a freshly closed candle
# while keeping exchange calls bounded.
CANDLE_REFRESH_SEC = 60.0

# Health monitoring (watchdog + position-drift detection).
HEARTBEAT_TTL = 120          # seconds a bot's heartbeat key stays valid
HEALTH_CHECK_SEC = 120.0     # how often the watchdog runs
STALL_AFTER_SEC = 90.0       # alert if a running bot hasn't ticked in this long
DRIFT_CHECK_SEC = 600.0      # how often to compare tracked vs exchange positions


def _opposite(side: str) -> str:
    return "short" if side == "long" else "long"


def _order_side(action: str) -> str:
    """Exchange order side that opens the given position side ('long'->buy)."""
    return "buy" if action == "long" else "sell"


@dataclass
class BotState:
    mode: str
    position_size_usdt: float | None = None  # per-launch USD override; None → use the strategy config's size
    # None (flat), "long" or "short". Shorts only happen on futures + direction "both".
    position_side: str | None = None
    # Base size of the open main position, so closes/hedges reuse the exact amount.
    position_amount: float | None = None
    entry_price: float | None = None
    # Best price reached since entry (high-water for long, low-water for short) — trailing stop.
    extreme_price: float | None = None
    # Exchange-side protective stop for the main position (live only).
    stop_order_id: str | None = None
    # Protective leg opposite the main position (futures + hedge enabled).
    hedge_open: bool = False
    hedge_side: str | None = None
    hedge_entry_price: float | None = None
    hedge_extreme: float | None = None  # most adverse price for the main side since the hedge opened
    # Rolling price window for squeeze detection (auto_squeeze hedge mode).
    recent_prices: list[float] = field(default_factory=list)

    @property
    def has_position(self) -> bool:
        return self.position_side is not None


class BotSupervisor:
    """Runs one async loop per active strategy. State is held in-process, so a
    single backend replica must own all bots; `recover` re-spawns them on boot."""

    def __init__(self) -> None:
        self.tasks: dict[int, asyncio.Task] = {}
        self.states: dict[int, BotState] = {}

    def is_running(self, strategy_id: int) -> bool:
        task = self.tasks.get(strategy_id)
        return task is not None and not task.done()

    async def start(
        self,
        session_factory,
        strategy_id: int,
        mode: str,
        position_size_usdt: float | None = None,
    ) -> None:
        if self.is_running(strategy_id):
            raise ValueError("Bot already running for this strategy.")
        self.states[strategy_id] = BotState(mode=mode, position_size_usdt=position_size_usdt)
        self.tasks[strategy_id] = asyncio.create_task(self._run_loop(session_factory, strategy_id))

    async def stop(self, strategy_id: int) -> None:
        task = self.tasks.get(strategy_id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self.tasks.pop(strategy_id, None)
        self.states.pop(strategy_id, None)

    async def recover(self, session_factory) -> None:
        """Restart bots that were marked running before a process restart.

        For live strategies, also reconciles any open position recorded in the DB
        against what's actually on the exchange:
        - Position still open → restores BotState so the bot resumes tracking it.
        - Position externally closed → removes the dangling open record so it stops
          showing as perpetually open."""
        async with session_factory() as db:
            pairs = (
                await db.execute(
                    select(Strategy, User)
                    .join(User, Strategy.user_id == User.id)
                    .where(Strategy.status.in_(["paper", "live"]))
                )
            ).all()

        for strategy, user in pairs:
            try:
                await self.start(session_factory, strategy.id, strategy.status)
                logger.info("Recovered bot for strategy %s (%s)", strategy.id, strategy.status)
            except ValueError:
                pass
            if strategy.status == "live":
                async with session_factory() as db:
                    await self._reconcile_live_position(db, user, strategy)

    async def _reconcile_live_position(self, db: AsyncSession, user: User, strategy: Strategy) -> None:
        """At recovery, align in-memory state and the DB open record with the
        exchange: restore BotState if the position is still open, or remove the
        dangling open record if it was closed while the bot was down."""
        state = self.states.get(strategy.id)
        if state is None:
            return
        open_trade = await self._latest_open_trade(db, strategy.id, "main")
        if open_trade is None:
            return
        position_side = "long" if open_trade.side == "buy" else "short"

        if not is_futures(strategy.config_json):
            # Spot: can't reliably verify a position; resume tracking from the DB.
            self._restore_state(state, position_side, open_trade.price, open_trade.amount)
            return

        real_pos, ok = await self._exchange_main_position(user, strategy)
        if not ok:
            # Couldn't reach the exchange — resume tracking from the DB record
            # rather than risk wrongly discarding a real position.
            self._restore_state(state, position_side, open_trade.price, open_trade.amount)
            return

        if real_pos is not None:
            entry = float(real_pos.get("entryPrice") or real_pos.get("averageEntryPrice") or 0)
            amount = abs(float(real_pos.get("contracts") or real_pos.get("size") or 0))
            self._restore_state(
                state, position_side,
                entry if entry > 0 else open_trade.price,
                amount if amount > 0 else open_trade.amount,
            )
            logger.info("Reconciled: restored %s position for strategy %s", position_side, strategy.id)
        else:
            # Position is gone from the exchange — drop the dangling open record so
            # it stops showing as open, and clear state so the bot starts flat.
            await db.delete(open_trade)
            self._clear_position(state)
            await db.commit()
            logger.info("Reconciled: removed externally-closed open record for strategy %s", strategy.id)

    # ---- position / reconciliation helpers --------------------------------

    @staticmethod
    def _restore_state(state: BotState, position_side: str, entry_price: float, amount: float) -> None:
        state.position_side = position_side
        state.entry_price = entry_price
        state.position_amount = amount
        state.extreme_price = entry_price

    @staticmethod
    def _clear_position(state: BotState) -> None:
        state.position_side = None
        state.position_amount = None
        state.entry_price = None
        state.extreme_price = None
        state.stop_order_id = None
        state.hedge_open = False
        state.hedge_side = None
        state.hedge_entry_price = None
        state.hedge_extreme = None

    async def _latest_open_trade(self, db: AsyncSession, strategy_id: int, leg: str) -> Trade | None:
        return (
            await db.execute(
                select(Trade)
                .where(Trade.strategy_id == strategy_id, Trade.pnl.is_(None), Trade.leg == leg)
                .order_by(Trade.timestamp.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def _settle_open_trade(self, db: AsyncSession, strategy_id: int, leg: str, pnl: float) -> bool:
        """One row per position: write the realized pnl onto the strategy's open
        (pnl=NULL) row for this leg, instead of inserting a separate close row.
        Returns False if there was no open row to settle."""
        row = await self._latest_open_trade(db, strategy_id, leg)
        if row is None:
            return False
        row.pnl = pnl
        return True

    async def _exchange_main_position(self, user: User, strategy: Strategy) -> tuple[dict | None, bool]:
        """Return (position, ok). ``ok`` is False when the exchange couldn't be
        reached. Futures only; spot has no position API so returns (None, True)."""
        if not is_futures(strategy.config_json):
            return None, True
        trade_symbol = perp_symbol(strategy.config_json.get("symbol", "BTC/USDT"))
        try:
            client = exchange_client(user.exchange, user, market_type="futures")
            try:
                positions = await client.fetch_positions([trade_symbol])
            finally:
                await client.close()
        except Exception as exc:  # noqa: BLE001 - treat as "couldn't verify"
            logger.warning("fetch_positions failed for strategy %s: %s", strategy.id, exc)
            return None, False
        real = next(
            (p for p in (positions or []) if abs(float(p.get("contracts") or p.get("size") or 0)) > 0),
            None,
        )
        return real, True

    async def sync_strategy(self, db: AsyncSession, user: User, strategy: Strategy) -> dict:
        """Manual reconcile from the UI. Aligns DB open records and in-memory state
        with the exchange:
        - A real position still open → keep tracking it (restore state from the
          exchange) and drop any extra/phantom open rows.
        - Otherwise remove all dangling open rows and clear state, so the strategy
          stops showing an open position it no longer has."""
        open_trades = (
            await db.execute(
                select(Trade)
                .where(Trade.strategy_id == strategy.id, Trade.pnl.is_(None))
                .order_by(Trade.timestamp.desc())
            )
        ).scalars().all()
        if not open_trades:
            return {"closed": 0, "restored": False}

        real_pos, ok = await self._exchange_main_position(user, strategy)
        state = self.states.get(strategy.id)

        if ok and real_pos is not None:
            # Protect a still-open position: keep the latest main row, restore state.
            main_open = next((t for t in open_trades if t.leg == "main"), open_trades[0])
            entry = float(real_pos.get("entryPrice") or real_pos.get("averageEntryPrice") or 0)
            amount = abs(float(real_pos.get("contracts") or real_pos.get("size") or 0))
            position_side = "long" if main_open.side == "buy" else "short"
            if state is not None:
                self._restore_state(
                    state, position_side,
                    entry if entry > 0 else main_open.price,
                    amount if amount > 0 else main_open.amount,
                )
            removed = 0
            for t in open_trades:
                if t.id != main_open.id:
                    await db.delete(t)
                    removed += 1
            await db.commit()
            return {"closed": removed, "restored": True}

        # No real position — remove every dangling open record and start flat.
        for t in open_trades:
            await db.delete(t)
        if state is not None:
            self._clear_position(state)
        await db.commit()
        return {"closed": len(open_trades), "restored": False}

    # ---- risk limits ------------------------------------------------------

    async def _warn_once(self, user: User, strategy: Strategy, key: str, message: str, ttl: int = 3600) -> None:
        """Publish a one-off warning (UI toast + Telegram) at most once per ttl."""
        rkey = f"warn:{key}:{user.id}:{strategy.id}"
        if await redis_client.get(rkey):
            return
        await redis_client.set(rkey, "1", ex=ttl)
        await publish_user_event(
            user.id,
            {"type": "bot_warning", "strategy_id": strategy.id, "strategy": strategy.name, "message": message},
        )
        await send_telegram_alert(user.telegram_id, f"{strategy.name}: {message}")

    async def _entry_blocked_by_risk(self, db: AsyncSession, user: User, strategy: Strategy) -> bool:
        """Block a new entry when a risk limit is hit: the strategy's opt-in daily
        loss limit, or the account-wide cap on simultaneous open positions."""
        # Per-strategy daily loss limit (opt-in via config; sum of today's realized %).
        limit = strategy.config_json.get("daily_loss_limit_pct")
        try:
            limit = float(limit) if limit is not None else 0.0
        except (TypeError, ValueError):
            limit = 0.0
        if limit > 0:
            since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
            today_pnl = await db.scalar(
                select(func.coalesce(func.sum(Trade.pnl), 0.0)).where(
                    Trade.strategy_id == strategy.id,
                    Trade.pnl.is_not(None),
                    Trade.timestamp >= since,
                )
            )
            if float(today_pnl or 0.0) <= -limit:
                await self._warn_once(
                    user, strategy, "daily_loss",
                    f"daily loss limit ({limit:.2f}%) reached — entries paused until tomorrow.",
                )
                return True

        # Account-wide cap on simultaneous open positions.
        cap = get_settings().max_open_positions_per_user
        if cap and cap > 0:
            open_count = await db.scalar(
                select(func.count(Trade.id)).where(
                    Trade.leg == "main",
                    Trade.pnl.is_(None),
                    Trade.strategy_id.in_(
                        select(Strategy.id).where(Strategy.user_id == user.id)
                    ),
                )
            )
            if int(open_count or 0) >= cap:
                await self._warn_once(
                    user, strategy, "max_positions",
                    f"max open positions ({cap}) reached across your strategies — not opening more for now.",
                )
                return True
        return False

    # ---- panic / manual close --------------------------------------------

    async def _flatten_exchange_position(self, user: User, strategy: Strategy, pos: dict) -> None:
        """Market-close a real futures position on the exchange (reduce-only)."""
        pos_side = pos.get("side") or ("long" if float(pos.get("contracts") or 0) > 0 else "short")
        amount = abs(float(pos.get("contracts") or pos.get("size") or 0))
        if amount <= 0:
            return
        order_side = "sell" if pos_side == "long" else "buy"
        await place_live_order(user, strategy, order_side, amount, reduce_only=True, position_side=pos_side)

    async def _delete_open_rows(self, db: AsyncSession, strategy_id: int) -> int:
        rows = (
            await db.execute(select(Trade).where(Trade.strategy_id == strategy_id, Trade.pnl.is_(None)))
        ).scalars().all()
        for row in rows:
            await db.delete(row)
        return len(rows)

    async def close_position(self, db: AsyncSession, user: User, strategy: Strategy) -> dict:
        """Flatten one strategy's live position now (market reduce-only) and clear
        its open records/state. Spot holdings are not auto-sold."""
        closed = False
        real, ok = await self._exchange_main_position(user, strategy)
        if ok and real is not None:
            try:
                await self._flatten_exchange_position(user, strategy, real)
                closed = True
            except Exception as exc:  # noqa: BLE001
                logger.warning("close_position failed for strategy %s: %s", strategy.id, exc)
        await self._delete_open_rows(db, strategy.id)
        state = self.states.get(strategy.id)
        if state is not None:
            self._clear_position(state)
        await db.commit()
        return {"closed": closed}

    async def panic_close_all(self, db: AsyncSession, user: User) -> dict:
        """Emergency stop: stop every bot the user has running and market-close all
        their live futures positions. The red button for "get me out of everything"."""
        strategies = (
            await db.execute(select(Strategy).where(Strategy.user_id == user.id))
        ).scalars().all()
        stopped = 0
        closed = 0
        for strategy in strategies:
            if self.is_running(strategy.id):
                await self.stop(strategy.id)
                stopped += 1
            if strategy.status != "stopped":
                strategy.status = "stopped"
            if is_futures(strategy.config_json):
                real, ok = await self._exchange_main_position(user, strategy)
                if ok and real is not None:
                    try:
                        await self._flatten_exchange_position(user, strategy, real)
                        closed += 1
                    except Exception as exc:  # noqa: BLE001 - best effort, keep going
                        logger.warning("panic close failed for strategy %s: %s", strategy.id, exc)
            await self._delete_open_rows(db, strategy.id)
        await db.commit()
        return {"stopped": stopped, "closed": closed}

    # ---- health monitor (watchdog + drift) -------------------------------

    async def monitor(self, session_factory) -> None:
        """Background health loop: detect stalled bot loops (via heartbeat) and
        live position drift vs the exchange, alerting over Telegram. It never
        auto-corrects — drift is surfaced so the user can Sync deliberately."""
        last_drift = 0.0
        while True:
            await asyncio.sleep(HEALTH_CHECK_SEC)
            try:
                await self._check_heartbeats()
                if time.time() - last_drift >= DRIFT_CHECK_SEC:
                    last_drift = time.time()
                    await self._check_position_drift(session_factory)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - monitor must stay alive
                logger.exception("health monitor error: %s", exc)

    async def _check_heartbeats(self) -> None:
        now = time.time()
        for sid in list(self.tasks):
            if not self.is_running(sid):
                continue
            hb = await redis_client.get(f"hb:bot:{sid}")
            stale = hb is None or (now - float(hb)) > STALL_AFTER_SEC
            warn_key = f"hb:warned:{sid}"
            if stale:
                if not await redis_client.get(warn_key):
                    await redis_client.set(warn_key, "1", ex=900)
                    await send_admin_alert(f"bot {sid} looks stalled (no heartbeat for >{STALL_AFTER_SEC:.0f}s)")
            else:
                await redis_client.delete(warn_key)

    async def _check_position_drift(self, session_factory) -> None:
        async with session_factory() as db:
            pairs = (
                await db.execute(
                    select(Strategy, User)
                    .join(User, Strategy.user_id == User.id)
                    .where(Strategy.status == "live")
                )
            ).all()
        for strategy, user in pairs:
            if not is_futures(strategy.config_json):
                continue
            state = self.states.get(strategy.id)
            tracked = bool(state and state.has_position)
            real, ok = await self._exchange_main_position(user, strategy)
            if not ok:
                continue
            on_exchange = real is not None
            if tracked and not on_exchange:
                await self._warn_once(
                    user, strategy, "drift",
                    "the bot is tracking a position the exchange no longer shows — tap Sync to reconcile.",
                )
            elif on_exchange and not tracked:
                await self._warn_once(
                    user, strategy, "drift",
                    "there's an open position on the exchange the bot isn't tracking — tap Sync to reconcile.",
                )

    async def shutdown(self) -> None:
        for strategy_id in list(self.tasks):
            await self.stop(strategy_id)

    async def _recent_candles(self, config: dict[str, Any]) -> list[list[float]]:
        """Return recent OHLCV rows ([ts,o,h,l,c,v]) for the strategy's symbol/timeframe.

        Indicators (and the volume/ATR/ADX filters) must run on real candles, so the
        bot pulls full OHLCV and caches it in Redis — refreshed at most once per
        ``CANDLE_REFRESH_SEC`` and shared across bots — instead of feeding raw 2s
        price ticks into the indicator history (which collapsed the series into
        near-identical values and made every signal whipsaw)."""
        symbol = config.get("symbol", "BTC/USDT")
        timeframe = config.get("timeframe", "1h")
        skey = symbol.replace("/", "_")
        ohlcv_key = f"ohlcv:{skey}:{timeframe}"
        stamp_key = f"ohlcv_at:{skey}:{timeframe}"

        last = await redis_client.get(stamp_key)
        if last is None or (time.time() - float(last)) >= CANDLE_REFRESH_SEC:
            client = exchange_client()
            try:
                candles = await client.fetch_ohlcv(symbol=symbol, timeframe=timeframe, limit=SEED_CANDLES)
            except Exception as exc:  # noqa: BLE001 - refresh is best-effort; keep the cache
                logger.warning("could not refresh candles for %s %s: %s", symbol, timeframe, exc)
                candles = None
            if candles:
                await redis_client.set(ohlcv_key, json.dumps(candles))
                await redis_client.set(stamp_key, time.time())
            try:
                await client.close()
            except Exception:  # noqa: BLE001
                pass

        raw = await redis_client.get(ohlcv_key)
        if not raw:
            return []
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return []

    async def _run_loop(self, session_factory, strategy_id: int) -> None:
        while True:
            async with session_factory() as db:
                strategy = await db.get(Strategy, strategy_id)
                if not strategy:
                    break
                user = await db.get(User, strategy.user_id)
                if not user:
                    break
                state = self.states.get(strategy_id)
                if state is None:
                    break
                try:
                    await self._run_once(db, user, strategy, state)
                    # Heartbeat: lets the watchdog detect a stalled loop.
                    await redis_client.set(f"hb:bot:{strategy_id}", time.time(), ex=HEARTBEAT_TTL)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 - keep the bot alive
                    logger.exception("bot loop error for strategy %s: %s", strategy_id, exc)
                    # Surface repeated failures (e.g. a close order that keeps
                    # bouncing) to the user — throttled to one alert per hour so
                    # a per-tick error can't flood Telegram.
                    if await redis_client.set(f"loop_err_alert:{strategy_id}", "1", nx=True, ex=3600):
                        await send_telegram_alert(
                            user.telegram_id,
                            f"⚠️ Бот «{strategy.name}» получает ошибку от биржи: {exc}. "
                            "Проверь позицию на дашборде.",
                        )
                        await send_admin_alert(f"bot loop error for strategy {strategy_id}: {exc}")
            await asyncio.sleep(LOOP_INTERVAL)

    async def _run_once(self, db: AsyncSession, user: User, strategy: Strategy, state: BotState) -> None:
        symbol = strategy.config_json.get("symbol", "BTC/USDT").replace("/", "_")
        current = await redis_client.get(f"price:{symbol}")
        if current is None:
            return
        current_price = float(current)

        # Signals run on real timeframe candles; the live tick only drives SL/TP,
        # trailing and fills. Evaluate on closed candles (drop the forming last
        # one) so a signal flips when a candle closes, not on intra-candle noise.
        candles = await self._recent_candles(strategy.config_json)
        rows = candles[:-1] if len(candles) > 1 else candles
        rows = [c for c in rows if c and len(c) > 4 and c[4] is not None]
        closes = [float(c[4]) for c in rows]
        if not closes:
            return

        signal = evaluate_signal(strategy.config_json, closes, state.position_side, rows)

        # Track the best price since entry for the trailing stop.
        if state.has_position and state.extreme_price is not None:
            if state.position_side == "long":
                state.extreme_price = max(state.extreme_price, current_price)
            else:
                state.extreme_price = min(state.extreme_price, current_price)

        if not state.has_position:
            if signal in ("long", "short"):
                if await self._entry_on_cooldown(strategy):
                    return
                if await self._entry_blocked_by_risk(db, user, strategy):
                    return
                size_mult = self._vol_size_mult(strategy.config_json, rows)
                amount = await self._entry_amount(user, strategy, state, current_price, size_mult)
                if amount is None:
                    await self._cooldown_and_warn(user, strategy, "size")
                    return
                try:
                    await self._open_position(db, user, strategy, state, signal, current_price, amount)
                except InsufficientFunds:
                    await self._cooldown_and_warn(user, strategy, "funds")
                    return
        else:
            # Reuse the exact size the position was opened with for closes/hedges.
            amount = state.position_amount or self._fallback_amount(strategy, state, current_price)
            # In a position: SL/TP take priority, then a signal can close or flip.
            # A flip closes now and the opposite side opens on the next tick.
            exit_reason = self._exit_reason(strategy.config_json, state, current_price)
            if exit_reason:
                await self._close_position(db, user, strategy, state, current_price, amount, exit_reason)
            elif signal == "close":
                await self._close_position(db, user, strategy, state, current_price, amount, "signal")
            elif signal in ("long", "short") and signal != state.position_side:
                await self._close_position(db, user, strategy, state, current_price, amount, "flip")

            # The hedge leg is managed while in a position so it can open on a
            # squeeze and unwind once the main position is closed.
            await self._manage_hedge(db, user, strategy, state, current_price, amount)

    def _fallback_amount(self, strategy: Strategy, state: BotState, price: float) -> float:
        """Sizing used for paper trades and as a close fallback. Live entries size
        from the real balance via _entry_amount instead.

        The USD size is treated as margin, so notional = size × leverage (spot
        leverage is 1). Order of preference: the per-launch USD override, then the
        strategy's configured USD size, then the legacy percent-of-balance."""
        if price > 0:
            lev = leverage(strategy.config_json)
            if state.position_size_usdt is not None:
                return state.position_size_usdt * lev / price
            cfg_usdt = strategy.config_json.get("position_size_usdt")
            if cfg_usdt:
                return float(cfg_usdt) * lev / price
        return float(strategy.config_json.get("position_size_pct", 10)) / 100

    def _vol_size_mult(self, config: dict[str, Any], rows: list[list[float]]) -> float:
        """Volatility-sizing multiplier (1.0 = off), matching the backtest: scale
        position size inversely to current ATR%, clamped to a sane range."""
        target = float(config.get("vol_target_pct") or 0)
        if target <= 0 or len(rows) < 20:
            return 1.0
        highs = [float(c[2]) for c in rows]
        lows = [float(c[3]) for c in rows]
        closes = [float(c[4]) for c in rows]
        a = atr(highs, lows, closes, 14)
        price = closes[-1] if closes else 0.0
        if not a or not price:
            return 1.0
        atr_pct = a / price * 100
        if atr_pct <= 0:
            return 1.0
        return max(0.25, min(3.0, target / atr_pct))

    async def _entry_amount(
        self, user: User, strategy: Strategy, state: BotState, price: float, size_mult: float = 1.0
    ) -> float | None:
        """Order size for a new entry. Paper keeps the simple config sizing; live
        sizes from the real account balance and returns None when it's below the
        exchange minimum (so the bot warns instead of spamming failed orders).
        ``size_mult`` applies volatility sizing (1.0 = off)."""
        if state.mode != "live":
            return self._fallback_amount(strategy, state, price) * size_mult
        return await live_order_amount(user, strategy, price, state.position_size_usdt, size_mult)

    async def _entry_on_cooldown(self, strategy: Strategy) -> bool:
        return bool(await redis_client.get(f"entry_cd:{strategy.id}"))

    async def _cooldown_and_warn(self, user: User, strategy: Strategy, kind: str) -> None:
        """Pause entries for this strategy and tell the user why — at most once an
        hour — so a funding/sizing problem doesn't hammer the exchange every tick."""
        await redis_client.set(f"entry_cd:{strategy.id}", "1", ex=300)
        key = f"entry_warn:{user.id}:{strategy.id}"
        if await redis_client.get(key):
            return
        await redis_client.set(key, "1", ex=3600)
        if kind == "funds":
            message = (
                f"Not enough USDT in your {user.exchange.title()} futures wallet to open "
                f"the {strategy.name} position. Top up the derivatives/unified wallet or "
                "lower the position size — entries are paused for a few minutes."
            )
        else:
            message = (
                f"Your balance is too small for the minimum order size on "
                f"{strategy.config_json.get('symbol', 'this market')}. Increase your balance "
                "or the position size — entries are paused for a few minutes."
            )
        await publish_user_event(
            user.id,
            {"type": "bot_warning", "strategy_id": strategy.id, "strategy": strategy.name, "message": message},
        )
        await send_telegram_alert(user.telegram_id, f"{strategy.name}: {message}")

    def _exit_reason(self, config: dict[str, Any], state: BotState, current_price: float) -> str | None:
        if not state.has_position or not state.entry_price:
            return None
        if state.position_side == "short":
            pnl_now = ((state.entry_price - current_price) / state.entry_price) * 100
        else:
            pnl_now = ((current_price - state.entry_price) / state.entry_price) * 100
        # Reverse swaps stop/target (the entry side is already flipped upstream).
        sl_val = stop_loss_pct(config)
        tp_val = take_profit_pct(config)
        if sl_val is not None and pnl_now <= -sl_val:
            return "stop_loss"
        if tp_val is not None and pnl_now >= tp_val:
            return "take_profit"
        trail = trailing_pct(config)
        if trail is not None and state.extreme_price:
            if state.position_side == "long" and current_price <= state.extreme_price * (1 - trail / 100):
                return "trailing_stop"
            if state.position_side == "short" and current_price >= state.extreme_price * (1 + trail / 100):
                return "trailing_stop"
        return None

    async def _open_position(
        self,
        db: AsyncSession,
        user: User,
        strategy: Strategy,
        state: BotState,
        side: str,
        current_price: float,
        amount: float,
    ) -> None:
        futures = is_futures(strategy.config_json)
        order_side = _order_side(side)
        if state.mode == "live":
            price = await place_live_order(
                user, strategy, order_side, amount, position_side=side if futures else None
            )
            trade = Trade(
                strategy_id=strategy.id,
                symbol=strategy.config_json.get("symbol", "BTC/USDT"),
                side=order_side,
                price=price,
                amount=amount,
                pnl=None,
                leg="main",
                mode=state.mode,
                timestamp=datetime.now(UTC),
            )
        else:
            trade = build_paper_trade(strategy, order_side, current_price, amount)
        db.add(trade)
        state.position_side = side
        state.position_amount = amount
        state.entry_price = trade.price
        state.extreme_price = trade.price  # seed the trailing-stop high/low-water mark
        state.recent_prices = []  # fresh window so a stale extreme cannot trigger a hedge
        await db.commit()
        # A position opened, so any prior funding/sizing pause is resolved.
        await redis_client.delete(f"entry_cd:{strategy.id}", f"entry_warn:{user.id}:{strategy.id}")

        # Real exchange-side stop so the position is protected even if this process
        # dies or price gaps between ticks. Engine-side _exit_reason stays primary.
        if state.mode == "live":
            await self._place_protective_stop(user, strategy, state, side, trade.price, amount, futures)

        await publish_user_event(
            user.id,
            {
                "type": "trade_opened",
                "strategy_id": strategy.id,
                "strategy": strategy.name,
                "side": order_side,
                "position": side,
                "price": trade.price,
                "mode": state.mode,
            },
        )
        await send_telegram_alert(
            user.telegram_id, f"Strategy {strategy.name}: {side.upper()} at {trade.price:.4f}"
        )

    async def _place_protective_stop(
        self,
        user: User,
        strategy: Strategy,
        state: BotState,
        side: str,
        entry_price: float,
        amount: float,
        futures: bool,
    ) -> None:
        sl_val = stop_loss_pct(strategy.config_json)  # swapped for reversed strategies
        if sl_val is None or entry_price <= 0:
            return
        if side == "short":
            stop_price = entry_price * (1 + sl_val / 100)
            stop_side = "buy"
        else:
            stop_price = entry_price * (1 - sl_val / 100)
            stop_side = "sell"
        state.stop_order_id = await place_stop_order(
            user, strategy, stop_side, amount, stop_price, position_side=side if futures else None
        )

    async def _close_position(
        self,
        db: AsyncSession,
        user: User,
        strategy: Strategy,
        state: BotState,
        current_price: float,
        amount: float,
        reason: str,
    ) -> None:
        side = state.position_side or "long"
        entry_price = state.entry_price or current_price
        futures = is_futures(strategy.config_json)
        order_side = "sell" if side == "long" else "buy"
        if state.mode == "live":
            if state.stop_order_id:
                await cancel_order(user, strategy, state.stop_order_id)
                state.stop_order_id = None
            price = await place_live_order(
                user, strategy, order_side, amount, reduce_only=futures, position_side=side if futures else None
            )
        else:
            price = paper_fill_price(current_price, order_side)
        pnl = ((price - entry_price) / entry_price * 100) if side == "long" else ((entry_price - price) / entry_price * 100)
        pnl -= round_trip_fee_pct(strategy.config_json)  # net of entry+exit taker fee
        # One row per position: settle the open (pnl=NULL) row instead of adding a
        # second row. Fall back to inserting a close row if none was found.
        settled = await self._settle_open_trade(db, strategy.id, "main", pnl)
        if not settled:
            db.add(Trade(
                strategy_id=strategy.id,
                symbol=strategy.config_json.get("symbol", "BTC/USDT"),
                side=order_side,
                price=price,
                amount=amount,
                pnl=pnl,
                leg="main",
                mode=state.mode,
                timestamp=datetime.now(UTC),
            ))
        state.position_side = None
        state.position_amount = None
        state.entry_price = None
        state.extreme_price = None
        await db.commit()
        await publish_user_event(
            user.id,
            {
                "type": "trade_closed",
                "strategy_id": strategy.id,
                "strategy": strategy.name,
                "side": order_side,
                "position": side,
                "price": price,
                "pnl_pct": pnl,
                "reason": reason,
                "mode": state.mode,
            },
        )
        await send_telegram_alert(
            user.telegram_id,
            f"Strategy {strategy.name}: close {side.upper()} at {price:.4f}, PnL {pnl:.2f}% ({reason})",
        )

    # ---- hedge leg -------------------------------------------------------

    async def _manage_hedge(
        self, db: AsyncSession, user: User, strategy: Strategy, state: BotState, current_price: float, amount: float
    ) -> None:
        params = hedge_params(strategy.config_json)
        if params is None:
            return
        hedge_amount = amount * params["ratio"]
        if hedge_amount <= 0:
            return

        # The hedge is always the leg opposite the main position.
        main_side = state.position_side
        want_hedge_side = _opposite(main_side) if main_side else None

        if params["mode"] == "constant_partial":
            if state.has_position and not state.hedge_open:
                await self._open_hedge(db, user, strategy, state, want_hedge_side, current_price, hedge_amount)
            elif not state.has_position and state.hedge_open:
                await self._close_hedge(db, user, strategy, state, current_price, hedge_amount, "position_closed")
            return

        # auto_squeeze: open on a fast adverse move, release once price recovers.
        window = max(2, int(params["window_sec"] / LOOP_INTERVAL))
        state.recent_prices.append(current_price)
        if len(state.recent_prices) > window:
            state.recent_prices = state.recent_prices[-window:]

        if state.hedge_open:
            if not state.has_position:
                await self._close_hedge(db, user, strategy, state, current_price, hedge_amount, "position_closed")
                return
            # Track the most adverse price for the main side, release on recovery.
            if main_side == "long":
                state.hedge_extreme = min(state.hedge_extreme or current_price, current_price)
                recovered = current_price >= state.hedge_extreme * (1 + params["release_pct"] / 100)
            else:
                state.hedge_extreme = max(state.hedge_extreme or current_price, current_price)
                recovered = current_price <= state.hedge_extreme * (1 - params["release_pct"] / 100)
            if recovered:
                await self._close_hedge(db, user, strategy, state, current_price, hedge_amount, "recovered")
        elif state.has_position and adverse_excursion_pct(state.recent_prices, main_side) >= params["trigger_pct"]:
            await self._open_hedge(db, user, strategy, state, want_hedge_side, current_price, hedge_amount)

    async def _warn_hedge_unavailable(self, user: User, strategy: Strategy) -> None:
        """Tell the user (at most once per hour) that hedging is on for the
        strategy but their exchange account is in one-way mode, so it can't run."""
        key = f"hedge_warn:{user.id}:{strategy.id}"
        if await redis_client.get(key):
            return
        await redis_client.set(key, "1", ex=3600)
        await publish_user_event(
            user.id,
            {
                "type": "bot_warning",
                "strategy_id": strategy.id,
                "strategy": strategy.name,
                "message": (
                    "Hedging is enabled for this strategy, but your "
                    f"{user.exchange.title()} futures account is in One-Way mode. "
                    "Enable Hedge Mode in your exchange settings to activate hedging — "
                    "the bot keeps running the main position meanwhile."
                ),
            },
        )
        await send_telegram_alert(
            user.telegram_id,
            f"{strategy.name}: enable Hedge Mode on {user.exchange.title()} to use hedging "
            "(running the main position only for now).",
        )

    async def _open_hedge(
        self,
        db: AsyncSession,
        user: User,
        strategy: Strategy,
        state: BotState,
        hedge_side: str,
        current_price: float,
        amount: float,
    ) -> None:
        order_side = _order_side(hedge_side)
        if state.mode == "live":
            # The protective short leg needs a hedge-mode account (long + short held
            # at once). If the user's account is one-way, skip hedging and warn them
            # to enable Hedge Mode — the main position keeps running long-only. Once
            # they switch the account, account_is_hedge() flips and hedging resumes.
            if not await account_is_hedge(user):
                await self._warn_hedge_unavailable(user, strategy)
                return
            price = await place_live_order(user, strategy, order_side, amount, position_side=hedge_side)
            trade = Trade(
                strategy_id=strategy.id,
                symbol=strategy.config_json.get("symbol", "BTC/USDT"),
                side=order_side,
                price=price,
                amount=amount,
                pnl=None,
                leg="hedge",
                mode=state.mode,
                timestamp=datetime.now(UTC),
            )
        else:
            trade = build_paper_trade(strategy, order_side, current_price, amount, leg="hedge")
        db.add(trade)
        state.hedge_open = True
        state.hedge_side = hedge_side
        state.hedge_entry_price = trade.price
        state.hedge_extreme = current_price
        await db.commit()
        await publish_user_event(
            user.id,
            {
                "type": "hedge_opened",
                "strategy_id": strategy.id,
                "strategy": strategy.name,
                "side": hedge_side,
                "price": trade.price,
                "mode": state.mode,
            },
        )
        await send_telegram_alert(
            user.telegram_id, f"Strategy {strategy.name}: HEDGE {hedge_side} at {trade.price:.4f}"
        )

    async def _close_hedge(
        self,
        db: AsyncSession,
        user: User,
        strategy: Strategy,
        state: BotState,
        current_price: float,
        amount: float,
        reason: str,
    ) -> None:
        hedge_side = state.hedge_side or "short"
        entry = state.hedge_entry_price or current_price
        order_side = "buy" if hedge_side == "short" else "sell"
        if state.mode == "live":
            price = await place_live_order(user, strategy, order_side, amount, reduce_only=True, position_side=hedge_side)
        else:
            price = paper_fill_price(current_price, order_side)
        # A short leg profits when price falls below entry; a long leg when it rises.
        pnl = ((entry - price) / entry * 100) if hedge_side == "short" else ((price - entry) / entry * 100)
        pnl -= round_trip_fee_pct(strategy.config_json)  # net of entry+exit taker fee
        # One row per position: settle the open hedge row in place (see _close_position).
        settled = await self._settle_open_trade(db, strategy.id, "hedge", pnl)
        if not settled:
            db.add(Trade(
                strategy_id=strategy.id,
                symbol=strategy.config_json.get("symbol", "BTC/USDT"),
                side=order_side,
                price=price,
                amount=amount,
                pnl=pnl,
                leg="hedge",
                mode=state.mode,
                timestamp=datetime.now(UTC),
            ))
        state.hedge_open = False
        state.hedge_side = None
        state.hedge_entry_price = None
        state.hedge_extreme = None
        await db.commit()
        await publish_user_event(
            user.id,
            {
                "type": "hedge_closed",
                "strategy_id": strategy.id,
                "strategy": strategy.name,
                "price": price,
                "pnl_pct": pnl,
                "reason": reason,
                "mode": state.mode,
            },
        )
        await send_telegram_alert(
            user.telegram_id,
            f"Strategy {strategy.name}: HEDGE close at {price:.4f}, PnL {pnl:.2f}% ({reason})",
        )


bot_supervisor = BotSupervisor()
