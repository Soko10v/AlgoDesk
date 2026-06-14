import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import redis_client
from app.engine.live_executor import cancel_order, place_live_order, place_stop_order
from app.engine.paper_executor import build_paper_trade, paper_fill_price
from app.engine.risk import adverse_excursion_pct, hedge_params, is_futures, pct_value, trailing_pct
from app.engine.strategy_evaluator import evaluate_signal
from app.models.strategy import Strategy
from app.models.trade import Trade
from app.models.user import User
from app.services.exchange import exchange_client
from app.services.events import publish_user_event
from app.services.telegram_alerts import send_telegram_alert

logger = logging.getLogger(__name__)

SEED_CANDLES = 200
LOOP_INTERVAL = 2.0
# Signals run on real OHLCV candles for the strategy's timeframe, not the 2s
# price ticks. Candles are cached in Redis and refreshed at most this often
# (shared across bots), which is frequent enough to spot a freshly closed candle
# while keeping exchange calls bounded.
CANDLE_REFRESH_SEC = 60.0


def _opposite(side: str) -> str:
    return "short" if side == "long" else "long"


def _order_side(action: str) -> str:
    """Exchange order side that opens the given position side ('long'->buy)."""
    return "buy" if action == "long" else "sell"


@dataclass
class BotState:
    mode: str
    # None (flat), "long" or "short". Shorts only happen on futures + direction "both".
    position_side: str | None = None
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

    async def start(self, session_factory, strategy_id: int, mode: str) -> None:
        if self.is_running(strategy_id):
            raise ValueError("Bot already running for this strategy.")
        self.states[strategy_id] = BotState(mode=mode)
        self.tasks[strategy_id] = asyncio.create_task(self._run_loop(session_factory, strategy_id))

    async def stop(self, strategy_id: int) -> None:
        task = self.tasks.get(strategy_id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self.tasks.pop(strategy_id, None)
        self.states.pop(strategy_id, None)

    async def recover(self, session_factory) -> None:
        """Restart bots that were marked running before a process restart."""
        async with session_factory() as db:
            rows = (
                await db.execute(select(Strategy).where(Strategy.status.in_(["paper", "live"])))
            ).scalars().all()
        for strategy in rows:
            try:
                await self.start(session_factory, strategy.id, strategy.status)
                logger.info("Recovered bot for strategy %s (%s)", strategy.id, strategy.status)
            except ValueError:
                pass

    async def shutdown(self) -> None:
        for strategy_id in list(self.tasks):
            await self.stop(strategy_id)

    async def _candle_closes(self, config: dict[str, Any]) -> list[float]:
        """Return recent OHLCV closes for the strategy's symbol/timeframe.

        Indicators must run on real candles, so the bot pulls OHLCV and caches it
        in Redis — refreshed at most once per ``CANDLE_REFRESH_SEC`` and shared
        across bots — instead of feeding raw 2s price ticks into the indicator
        history (which collapsed the series into near-identical values and made
        every signal whipsaw)."""
        symbol = config.get("symbol", "BTC/USDT")
        timeframe = config.get("timeframe", "1h")
        skey = symbol.replace("/", "_")
        closes_key = f"closes:{skey}:{timeframe}"
        stamp_key = f"closes_at:{skey}:{timeframe}"

        last = await redis_client.get(stamp_key)
        if last is None or (time.time() - float(last)) >= CANDLE_REFRESH_SEC:
            client = exchange_client()
            try:
                candles = await client.fetch_ohlcv(symbol=symbol, timeframe=timeframe, limit=SEED_CANDLES)
            except Exception as exc:  # noqa: BLE001 - refresh is best-effort; keep the cache
                logger.warning("could not refresh candles for %s %s: %s", symbol, timeframe, exc)
                candles = None
            finally:
                await client.close()
            closes = [str(c[4]) for c in (candles or []) if c and c[4] is not None]
            if closes:
                async with redis_client.pipeline(transaction=True) as pipe:
                    pipe.delete(closes_key)
                    pipe.rpush(closes_key, *closes)
                    pipe.set(stamp_key, time.time())
                    await pipe.execute()

        return [float(v) for v in await redis_client.lrange(closes_key, 0, -1)]

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
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 - keep the bot alive
                    logger.exception("bot loop error for strategy %s: %s", strategy_id, exc)
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
        candles = await self._candle_closes(strategy.config_json)
        closes = candles[:-1] if len(candles) > 1 else candles
        if not closes:
            return

        amount = float(strategy.config_json.get("position_size_pct", 10)) / 100
        signal = evaluate_signal(strategy.config_json, closes, state.position_side)

        # Track the best price since entry for the trailing stop.
        if state.has_position and state.extreme_price is not None:
            if state.position_side == "long":
                state.extreme_price = max(state.extreme_price, current_price)
            else:
                state.extreme_price = min(state.extreme_price, current_price)

        if not state.has_position:
            if signal in ("long", "short"):
                await self._open_position(db, user, strategy, state, signal, current_price, amount)
        else:
            # In a position: SL/TP take priority, then a signal can close or flip.
            # A flip closes now and the opposite side opens on the next tick.
            exit_reason = self._exit_reason(strategy.config_json, state, current_price)
            if exit_reason:
                await self._close_position(db, user, strategy, state, current_price, amount, exit_reason)
            elif signal == "close":
                await self._close_position(db, user, strategy, state, current_price, amount, "signal")
            elif signal in ("long", "short") and signal != state.position_side:
                await self._close_position(db, user, strategy, state, current_price, amount, "flip")

        # The hedge leg is managed every tick so it can open mid-trade on a squeeze
        # and unwind once the main position is closed.
        await self._manage_hedge(db, user, strategy, state, current_price, amount)

    def _exit_reason(self, config: dict[str, Any], state: BotState, current_price: float) -> str | None:
        if not state.has_position or not state.entry_price:
            return None
        if state.position_side == "short":
            pnl_now = ((state.entry_price - current_price) / state.entry_price) * 100
        else:
            pnl_now = ((current_price - state.entry_price) / state.entry_price) * 100
        sl_val = pct_value(config.get("stop_loss"))
        tp_val = pct_value(config.get("take_profit"))
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
                timestamp=datetime.now(UTC),
            )
        else:
            trade = build_paper_trade(strategy, order_side, current_price, amount)
        db.add(trade)
        state.position_side = side
        state.entry_price = trade.price
        state.extreme_price = trade.price  # seed the trailing-stop high/low-water mark
        state.recent_prices = []  # fresh window so a stale extreme cannot trigger a hedge
        await db.commit()

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
        sl_val = pct_value(strategy.config_json.get("stop_loss"))
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
        trade = Trade(
            strategy_id=strategy.id,
            symbol=strategy.config_json.get("symbol", "BTC/USDT"),
            side=order_side,
            price=price,
            amount=amount,
            pnl=pnl,
            leg="main",
            timestamp=datetime.now(UTC),
        )
        db.add(trade)
        state.position_side = None
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
                "price": trade.price,
                "pnl_pct": pnl,
                "reason": reason,
                "mode": state.mode,
            },
        )
        await send_telegram_alert(
            user.telegram_id,
            f"Strategy {strategy.name}: close {side.upper()} at {trade.price:.4f}, PnL {pnl:.2f}% ({reason})",
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
            price = await place_live_order(user, strategy, order_side, amount, position_side=hedge_side)
            trade = Trade(
                strategy_id=strategy.id,
                symbol=strategy.config_json.get("symbol", "BTC/USDT"),
                side=order_side,
                price=price,
                amount=amount,
                pnl=None,
                leg="hedge",
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
        trade = Trade(
            strategy_id=strategy.id,
            symbol=strategy.config_json.get("symbol", "BTC/USDT"),
            side=order_side,
            price=price,
            amount=amount,
            pnl=pnl,
            leg="hedge",
            timestamp=datetime.now(UTC),
        )
        db.add(trade)
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
