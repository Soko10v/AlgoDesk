"""In-memory background jobs for the iterative AI analysis.

The iterative analysis runs several backtests and DeepSeek calls and can take a
couple of minutes — far longer than a reverse proxy will hold a single request
open. So the route kicks off a job here and returns immediately; the frontend
polls for progress and the final result.

The backend runs a single uvicorn worker, so a module-level dict is a fine job
store. Jobs are pruned after a short TTL to bound memory.
"""

import asyncio
import logging
import time
import uuid
from typing import Any

from app.services.ai_analysis import analyze_strategy_iterative, generate_strategies
from app.services.backtest import load_candles, simulate_backtest

logger = logging.getLogger(__name__)

# job_id -> {status, attempt, result, error, user_id, created}
_JOBS: dict[str, dict[str, Any]] = {}
_JOB_TTL = 600.0  # seconds


def _prune() -> None:
    now = time.time()
    for k in [k for k, v in _JOBS.items() if now - v["created"] > _JOB_TTL]:
        _JOBS.pop(k, None)


def get_job(job_id: str) -> dict[str, Any] | None:
    return _JOBS.get(job_id)


async def _run(job_id: str, config: dict[str, Any], since_ms: int | None, until_ms: int | None) -> None:
    job = _JOBS[job_id]
    try:
        # Fetch candles once; the original and all three proposals are simulated on
        # the same data (fair comparison, and no repeated fetches to get throttled).
        candles = await load_candles(config, since_ms, until_ms)
        if not candles:
            raise RuntimeError("No market data returned by the exchange — try again")
        original = simulate_backtest(config, candles)

        def progress(n: int) -> None:
            job["attempt"] = n

        data = await analyze_strategy_iterative(config, original, candles, progress_cb=progress)
        job["result"] = data
        job["status"] = "done"
    except Exception as exc:  # noqa: BLE001 - record any failure for the poller
        logger.warning("AI analysis job %s failed: %s", job_id, exc)
        job["error"] = str(exc) or "AI analysis failed"
        job["status"] = "error"


def start_job(user_id: int, config: dict[str, Any], since_ms: int | None, until_ms: int | None) -> str:
    _prune()
    job_id = uuid.uuid4().hex
    _JOBS[job_id] = {
        "status": "running",
        "attempt": 1,
        "result": None,
        "error": None,
        "user_id": user_id,
        "created": time.time(),
    }
    # Hold a reference so the task isn't garbage-collected mid-run (asyncio caveat).
    _JOBS[job_id]["_task"] = asyncio.create_task(_run(job_id, config, since_ms, until_ms))
    return job_id


async def _run_generate(job_id: str, history: list[dict[str, str]]) -> None:
    job = _JOBS[job_id]
    try:
        gen = await generate_strategies(history)
        bots = gen.get("bots") or []
        out_bots: list[dict[str, Any]] = []
        if bots:
            # All three share one symbol/timeframe, so fetch candles once and reuse.
            candles = await load_candles({"symbol": gen["symbol"], "timeframe": gen["timeframe"]})
            for b in bots:
                res = simulate_backtest(b["config"], candles, include_series=False) if candles else {}
                out_bots.append({
                    "name": b["name"],
                    "approach": b["approach"],
                    "config": b["config"],
                    "total_return_pct": round(float(res.get("total_return_pct", 0.0)), 2),
                    "max_drawdown_pct": round(float(res.get("max_drawdown_pct", 0.0)), 2),
                    "win_rate": round(float(res.get("win_rate", 0.0)), 2),
                    "trades": len([t for t in res.get("trades", []) if isinstance(t.get("pnl_pct"), (int, float))]),
                })
        job["result"] = {
            "answer": gen.get("answer") or "",
            "symbol": gen.get("symbol") or "",
            "timeframe": gen.get("timeframe") or "",
            "bots": out_bots,
        }
        job["status"] = "done"
    except Exception as exc:  # noqa: BLE001 - record any failure for the poller
        logger.warning("AI generate job %s failed: %s", job_id, exc)
        job["error"] = str(exc) or "AI generation failed"
        job["status"] = "error"


def start_generate_job(user_id: int, history: list[dict[str, str]]) -> str:
    _prune()
    job_id = uuid.uuid4().hex
    _JOBS[job_id] = {"status": "running", "result": None, "error": None, "user_id": user_id, "created": time.time()}
    _JOBS[job_id]["_task"] = asyncio.create_task(_run_generate(job_id, history))
    return job_id
