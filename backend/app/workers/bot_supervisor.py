import asyncio
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import redis_client
from app.engine.live_executor import cancel_order, place_live_order, place_stop_order
from app.engine.paper_executor import build_paper_trade, paper_fill_price
from app.engine.risk import hedge_params, is_futures, pct_value, squeeze_drop_pct
from app.engine.strategy_evaluator import evaluate_signal
from app.models.strategy import Strategy
from app.models.trade import Trade
from app.models.user import User
from app.services.exchange import exchange_client
from app.services.events import publish_user_event
from app.services.telegram_alerts import send_telegram_alert

logger = logging.getLogger(__name__)

HISTORY_LIMIT = 500
SEED_CANDLES = 200
LOOP_INTERVAL = 2.0


@dataclass
class BotState:
    mode: str
    has_position: bool = False
    entry_price: float | None = None
    # Exchange-side protective stop for the main position (live only).
    stop_order_id: str | None = None
    # Protective short leg (futures + hedge enabled).
    hedge_open: bool = False
    hedge_entry_price: float | None = None
    hedge_low: float | None = None
    # Rolling price window for squeeze detection (auto_squeeze hedge mode).
    recent_prices: list[float] = field(default_factory=list)


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

    async def _seed_history(self, config: dict[str, Any]) -> None:
        """Preload historical closes so indicators produce signals immediately."""
        symbol = config.get("symbol", "BTC/USDT")
        timeframe = config.get("timeframe", "1h")
        key = f"closes:{symbol.replace('/', '_')}"
        client = exchange_client()
        try:
            candles = await client.fetch_ohlcv(symbol=symbol, timeframe=timeframe, limit=SEED_CANDLES)
        except Exception as exc:  # noqa: BLE001 - seeding is best-effort
            logger.warning("could not seed history for %s: %s", symbol, exc)
            return
        finally:
            await client.close()
        closes = [str(c[4]) for c in candles if c and c[4] is not None]
        if not closes:
            return
        async with redis_client.pipeline(transaction=True) as pipe:
            pipe.delete(key)
            pipe.rpush(key, *closes)
            pipe.ltrim(key, -HISTORY_LIMIT, -1)
            await pipe.execute()

    async def _run_loop(self, session_factory, strategy_id: int) -> None:
        seeded = False
        while True:
            async with session_factory() as db:
                strategy = await db.get(Strategy, strategy_id)
                if not strategy:
                    break
                user = await db.get(User, strategy.user_id)
                if not user:
                    break
                if not seeded:
                    await self._seed_history(strategy.config_json)
                    seeded = True
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

        history_key = f"closes:{symbol}"
        await redis_client.rpush(history_key, current_price)
        await redis_client.ltrim(history_key, -HISTORY_LIMIT, -1)
        closes = [float(v) for v in await redis_client.lrange(history_key, 0, -1)]

        amount = float(strategy.config_json.get("position_size_pct", 10)) / 100
        signal = evaluate_signal(strategy.config_json, closes, state.has_position)

        if signal == "buy" and not state.has_position:
            await self._open_position(db, user, strategy, state, current_price, amount)
        else:
            exit_reason = self._exit_reason(strategy.config_json, state, current_price)
            if (signal == "sell" or exit_reason) and state.has_position and state.entry_price is not None:
                await self._close_position(db, user, strategy, state, current_price, amount, exit_reason or "signal")

        # The hedge leg is managed every tick so it can open mid-trade on a squeeze
        # and unwind once the main position is closed.
        await self._manage_hedge(db, user, strategy, state, current_price, amount)

    def _exit_reason(self, config: dict[str, Any], state: BotState, current_price: float) -> str | None:
        if not state.has_position or not state.entry_price:
            return None
        pnl_now = ((current_price - state.entry_price) / state.entry_price) * 100
        sl_val = pct_value(config.get("stop_loss"))
        tp_val = pct_value(config.get("take_profit"))
        if sl_val is not None and pnl_now <= -sl_val:
            return "stop_loss"
        if tp_val is not None and pnl_now >= tp_val:
            return "take_profit"
        return None

    async def _open_position(
        self, db: AsyncSession, user: User, strategy: Strategy, state: BotState, current_price: float, amount: float
    ) -> None:
        futures = is_futures(strategy.config_json)
        if state.mode == "live":
            price = await place_live_order(
                user, strategy, "buy", amount, position_side="long" if futures else None
            )
            trade = Trade(
                strategy_id=strategy.id,
                symbol=strategy.config_json.get("symbol", "BTC/USDT"),
                side="buy",
                price=price,
                amount=amount,
                pnl=None,
                leg="main",
                timestamp=datetime.now(UTC),
            )
        else:
            trade = build_paper_trade(strategy, "buy", current_price, amount)
        db.add(trade)
        state.has_position = True
        state.entry_price = trade.price
        state.recent_prices = []  # fresh window so a stale high cannot trigger a hedge
        await db.commit()

        # Place a real exchange-side stop so the position is protected even if this
        # process dies or price gaps between engine ticks. Engine-side _exit_reason
        # remains the primary close path; this is the safety net.
        if state.mode == "live":
            await self._place_protective_stop(user, strategy, state, trade.price, amount, futures)

        await publish_user_event(
            user.id,
            {
                "type": "trade_opened",
                "strategy_id": strategy.id,
                "strategy": strategy.name,
                "side": "buy",
                "price": trade.price,
                "mode": state.mode,
            },
        )
        await send_telegram_alert(user.telegram_id, f"Strategy {strategy.name}: BUY at {trade.price:.4f}")

    async def _place_protective_stop(
        self, user: User, strategy: Strategy, state: BotState, entry_price: float, amount: float, futures: bool
    ) -> None:
        sl_val = pct_value(strategy.config_json.get("stop_loss"))
        if sl_val is None or entry_price <= 0:
            return
        stop_price = entry_price * (1 - sl_val / 100)
        state.stop_order_id = await place_stop_order(
            user, strategy, "sell", amount, stop_price, position_side="long" if futures else None
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
        entry_price = state.entry_price or current_price
        futures = is_futures(strategy.config_json)
        if state.mode == "live":
            # Cancel the resting protective stop before closing manually so it is
            # not left orphaned on the exchange.
            if state.stop_order_id:
                await cancel_order(user, strategy, state.stop_order_id)
                state.stop_order_id = None
            price = await place_live_order(
                user, strategy, "sell", amount, reduce_only=futures, position_side="long" if futures else None
            )
            pnl = ((price - entry_price) / entry_price) * 100
            trade = Trade(
                strategy_id=strategy.id,
                symbol=strategy.config_json.get("symbol", "BTC/USDT"),
                side="sell",
                price=price,
                amount=amount,
                pnl=pnl,
                leg="main",
                timestamp=datetime.now(UTC),
            )
        else:
            pnl = ((current_price - entry_price) / entry_price) * 100
            trade = build_paper_trade(strategy, "sell", current_price, amount, pnl=pnl)
        db.add(trade)
        state.has_position = False
        state.entry_price = None
        await db.commit()
        await publish_user_event(
            user.id,
            {
                "type": "trade_closed",
                "strategy_id": strategy.id,
                "strategy": strategy.name,
                "side": "sell",
                "price": trade.price,
                "pnl_pct": pnl,
                "reason": reason,
                "mode": state.mode,
            },
        )
        await send_telegram_alert(
            user.telegram_id,
            f"Strategy {strategy.name}: SELL at {trade.price:.4f}, PnL {pnl:.2f}% ({reason})",
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

        if params["mode"] == "constant_partial":
            # Hold the short for as long as the main position is open.
            if state.has_position and not state.hedge_open:
                await self._open_hedge(db, user, strategy, state, current_price, hedge_amount)
            elif not state.has_position and state.hedge_open:
                await self._close_hedge(db, user, strategy, state, current_price, hedge_amount, "position_closed")
            return

        # auto_squeeze: open on a fast drop, release once price recovers.
        window = max(2, int(params["window_sec"] / LOOP_INTERVAL))
        state.recent_prices.append(current_price)
        if len(state.recent_prices) > window:
            state.recent_prices = state.recent_prices[-window:]

        if state.hedge_open:
            state.hedge_low = min(state.hedge_low or current_price, current_price)
            recovered = state.hedge_low and current_price >= state.hedge_low * (1 + params["release_pct"] / 100)
            if not state.has_position:
                await self._close_hedge(db, user, strategy, state, current_price, hedge_amount, "position_closed")
            elif recovered:
                await self._close_hedge(db, user, strategy, state, current_price, hedge_amount, "recovered")
        elif state.has_position and squeeze_drop_pct(state.recent_prices) >= params["trigger_pct"]:
            await self._open_hedge(db, user, strategy, state, current_price, hedge_amount)

    async def _open_hedge(
        self, db: AsyncSession, user: User, strategy: Strategy, state: BotState, current_price: float, amount: float
    ) -> None:
        if state.mode == "live":
            price = await place_live_order(user, strategy, "sell", amount, position_side="short")
            trade = Trade(
                strategy_id=strategy.id,
                symbol=strategy.config_json.get("symbol", "BTC/USDT"),
                side="sell",
                price=price,
                amount=amount,
                pnl=None,
                leg="hedge",
                timestamp=datetime.now(UTC),
            )
        else:
            trade = build_paper_trade(strategy, "sell", current_price, amount, leg="hedge")
        db.add(trade)
        state.hedge_open = True
        state.hedge_entry_price = trade.price
        state.hedge_low = current_price
        await db.commit()
        await publish_user_event(
            user.id,
            {
                "type": "hedge_opened",
                "strategy_id": strategy.id,
                "strategy": strategy.name,
                "price": trade.price,
                "mode": state.mode,
            },
        )
        await send_telegram_alert(user.telegram_id, f"Strategy {strategy.name}: HEDGE short at {trade.price:.4f}")

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
        entry = state.hedge_entry_price or current_price
        if state.mode == "live":
            price = await place_live_order(user, strategy, "buy", amount, reduce_only=True, position_side="short")
        else:
            price = paper_fill_price(current_price, "buy")
        # A short profits when price falls below its entry.
        pnl = ((entry - price) / entry) * 100
        trade = Trade(
            strategy_id=strategy.id,
            symbol=strategy.config_json.get("symbol", "BTC/USDT"),
            side="buy",
            price=price,
            amount=amount,
            pnl=pnl,
            leg="hedge",
            timestamp=datetime.now(UTC),
        )
        db.add(trade)
        state.hedge_open = False
        state.hedge_entry_price = None
        state.hedge_low = None
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
