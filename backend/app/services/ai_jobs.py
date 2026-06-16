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

from app.services.ai_analysis import analyze_strategy_iterative
from app.services.backtest import run_backtest

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
        original = await run_backtest(config, since_ms=since_ms, until_ms=until_ms)

        def progress(n: int) -> None:
            job["attempt"] = n

        data = await analyze_strategy_iterative(
            config, original, since_ms=since_ms, until_ms=until_ms, progress_cb=progress
        )
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
