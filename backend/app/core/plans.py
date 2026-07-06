"""Subscription tiers and feature entitlements (single source of truth).

Three plans — free / pro / expert. Everything is *visible* in the app so users
feel what they're missing, but the valuable actions are gated by plan:

  free   — build strategies, backtest, the standard (entry) optimizer,
           walk-forward, Monte-Carlo, and the auto-discovered "best strategies"
  pro    — + paper & live trading, the sensitivity map, optimizing SL/TP
  expert — + AI analysis & bot builder, optimizing per-side filters (everything)

AI (analysis + bot builder) is Expert-only: it's the headline feature of the
top tier, and its output is uneven enough that keeping it behind the paywall
protects newcomers from acting on a bad AI suggestion.
"""

from datetime import UTC, datetime

PLAN_FREE = "free"
PLAN_PRO = "pro"
PLAN_EXPERT = "expert"

PLAN_RANK = {PLAN_FREE: 0, PLAN_PRO: 1, PLAN_EXPERT: 2}

# Monthly price in USDT per paid plan.
PLAN_PRICES = {PLAN_PRO: 25.0, PLAN_EXPERT: 40.0}

# Feature key -> minimum plan that unlocks it.
# Free is deliberately generous: build, backtest and every analysis tool (so the
# user sees green numbers and gets hooked). The paywall only bites where money is
# made — turning a bot on (paper/live) — plus a couple of advanced tuning tools.
FEATURE_MIN_PLAN = {
    "backtest": PLAN_FREE,
    "optimize_entry": PLAN_FREE,
    "walkforward": PLAN_FREE,
    "monte_carlo": PLAN_FREE,
    # Pro — turn your bots on
    "paper": PLAN_PRO,
    "live": PLAN_PRO,
    # Expert — advanced tuning/validation + AI (+ unlimited bots & Telegram alerts)
    "ai": PLAN_EXPERT,
    "sensitivity": PLAN_EXPERT,
    "optimize_exits": PLAN_EXPERT,
    "optimize_filters": PLAN_EXPERT,
}


def plan_rank(plan: str) -> int:
    return PLAN_RANK.get(plan, 0)


def normalize_plan(plan: str | None) -> str:
    return plan if plan in PLAN_RANK else PLAN_FREE


def allows(plan: str, feature: str) -> bool:
    """True if ``plan`` unlocks ``feature`` (unknown features default to expert-only)."""
    return plan_rank(plan) >= plan_rank(FEATURE_MIN_PLAN.get(feature, PLAN_EXPERT))


def entitlements(plan: str) -> dict[str, bool]:
    """Per-feature unlock map for the given plan (for the client to gate the UI)."""
    return {feature: allows(plan, feature) for feature in FEATURE_MIN_PLAN}


def is_active(plan: str | None, expires_at: datetime | None) -> bool:
    """A paid plan is active only while not expired."""
    if normalize_plan(plan) == PLAN_FREE:
        return False
    if expires_at is None:
        return True
    return expires_at > datetime.now(UTC)


def effective_plan(plan: str | None, expires_at: datetime | None, free_mode: bool) -> str:
    """The plan actually in force: expert for everyone during the free-mode promo,
    otherwise the paid plan if still active, else free."""
    if free_mode:
        return PLAN_EXPERT
    return normalize_plan(plan) if is_active(plan, expires_at) else PLAN_FREE
