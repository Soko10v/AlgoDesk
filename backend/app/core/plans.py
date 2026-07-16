"""Subscription tiers and feature entitlements (single source of truth).

Three plans — free / pro / expert. Everything is *visible* in the app so users
feel what they're missing, but the valuable actions are gated by plan:

  free   — build strategies, backtest, every optimizer/validation tool,
           and the auto-discovered "best strategies"
  pro    — + paper & live trading
  expert — + AI analysis & bot builder

AI (analysis + bot builder) is Expert-only: it's the headline feature of the
top tier, and its output is uneven enough that keeping it behind the paywall
protects newcomers from acting on a bad AI suggestion.
"""

from datetime import UTC, datetime, timedelta

PLAN_FREE = "free"
PLAN_PRO = "pro"
PLAN_EXPERT = "expert"

PLAN_RANK = {PLAN_FREE: 0, PLAN_PRO: 1, PLAN_EXPERT: 2}

# New signups get full (expert-level) access for this many days from account
# creation, no card required — then they land on their real (free) plan and
# the normal paywall/upsell prompts take over.
TRIAL_DAYS = 14


def trial_ends_at(created_at: datetime) -> datetime:
    return created_at + timedelta(days=TRIAL_DAYS)


def trial_active(created_at: datetime) -> bool:
    return datetime.now(UTC) < trial_ends_at(created_at)

# Monthly price in USDT per paid plan.
PLAN_PRICES = {PLAN_PRO: 7.0, PLAN_EXPERT: 15.0}

# Feature key -> minimum plan that unlocks it.
# Free is deliberately generous: build, backtest and every analysis/optimization
# tool. The paywall only bites where money is made — turning a bot on
# (paper/live) — plus AI.
FEATURE_MIN_PLAN = {
    "backtest": PLAN_FREE,
    "optimize_entry": PLAN_FREE,
    "monte_carlo": PLAN_FREE,
    "sensitivity": PLAN_FREE,
    "walkforward": PLAN_FREE,
    "optimize_exits": PLAN_FREE,
    "optimize_filters": PLAN_FREE,
    # Pro — turn your bots on
    "paper": PLAN_PRO,
    "live": PLAN_PRO,
    # Expert — AI (+ unlimited bots & Telegram alerts)
    "ai": PLAN_EXPERT,
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
