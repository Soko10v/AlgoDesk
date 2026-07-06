// "Missed profit" — the conversion engine for the free tier.
//
// Free users can backtest but not trade. Every profitable backtest is money
// they *didn't* make. We remember the last backtest per strategy (client-side —
// the backend doesn't store backtest history) and surface the aggregate on the
// dashboard: "your strategies would have earned ≈ $X — and they're switched off".
//
// Estimates are deliberately simple and honest: profit ≈ position size × return %.

import type { BacktestResult, Strategy } from "../api/endpoints";
import { positionUsdt } from "./strategy";

export type MissedEntry = {
  strategyId: number;
  name: string;
  returnPct: number; // total return of the last backtest
  investedUsd: number; // the strategy's configured position size
  profitUsd: number; // ≈ investedUsd × returnPct
  days: number; // backtest period length
  at: number; // unix ms when recorded
};

const KEY = "algodesk.lastBacktests.v1";

function read(): Record<string, MissedEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function write(map: Record<string, MissedEntry>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota/private mode — the banner just won't aggregate */
  }
}

/** Days covered by the backtest (≥ 1 so per-month projections never divide by 0). */
export function periodDays(r: BacktestResult): number {
  if (!r.start || !r.end || r.end <= r.start) return 1;
  return Math.max(1, Math.round((r.end - r.start) / 86400));
}

/** Record the latest backtest for a strategy (overwrites the previous one). */
export function recordBacktest(strategy: Strategy, r: BacktestResult) {
  const map = read();
  const investedUsd = positionUsdt(strategy.config_json);
  const profitUsd = (investedUsd * r.total_return_pct) / 100;
  map[String(strategy.id)] = {
    strategyId: strategy.id,
    name: strategy.name,
    returnPct: r.total_return_pct,
    investedUsd,
    profitUsd,
    days: periodDays(r),
    at: Date.now(),
  };
  write(map);
}

/** Positive-return entries only, freshest first — the "money left on the table" set.
 *  `validIds` drops deleted strategies, `liveIds` drops ones already running live. */
export function missedEntries(validIds?: Set<number>, liveIds?: Set<number>): MissedEntry[] {
  return Object.values(read())
    .filter(
      (e) =>
        e.profitUsd > 0 &&
        (!validIds || validIds.has(e.strategyId)) &&
        (!liveIds || !liveIds.has(e.strategyId))
    )
    .sort((a, b) => b.at - a.at);
}
