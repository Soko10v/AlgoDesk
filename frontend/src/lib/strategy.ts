import type { EntryRule, EntryType, FilterType, HedgeConfig, StrategyConfig, StrategyFilter } from "../api/endpoints";

export const SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];
export const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"];
export const MAX_LEVERAGE = 10; // mirrors backend app/engine/risk.py
export const DEFAULT_POSITION_USDT = 50; // default position notional in USD

/** Effective position size in USD. Falls back to the default for legacy
 *  strategies that only stored a percent (so the dollar input has a value). */
export function positionUsdt(config: StrategyConfig): number {
  return config.position_size_usdt ?? DEFAULT_POSITION_USDT;
}

/** Human-readable position size: "$50" for USD strategies, "10%" for legacy
 *  percent strategies — shown honestly so an un-migrated strategy isn't mislabeled. */
export function describeSize(config: StrategyConfig): string {
  if (config.position_size_usdt != null) return `$${config.position_size_usdt}`;
  if (config.position_size_pct != null) return `${config.position_size_pct}%`;
  return `$${DEFAULT_POSITION_USDT}`;
}

export const ENTRY_TYPES: { id: EntryType; label: string }[] = [
  { id: "ma_cross", label: "MA cross" },
  { id: "ema_cross", label: "EMA cross" },
  { id: "rsi", label: "RSI" },
  { id: "breakout", label: "Breakout" },
  { id: "macd", label: "MACD" },
];

export function defaultEntry(type: EntryType): EntryRule {
  switch (type) {
    case "ema_cross":
      return { type, fast: 9, slow: 21 };
    case "rsi":
      return { type, period: 14, low: 30, high: 70 };
    case "breakout":
      return { type, period: 20 };
    case "macd":
      return { type, fast: 12, slow: 26, signal: 9 };
    case "ma_cross":
    default:
      return { type: "ma_cross", fast: 9, slow: 21 };
  }
}

export const FILTER_TYPES: { id: FilterType; label: string }[] = [
  { id: "trend", label: "Trend (price vs MA)" },
  { id: "rsi", label: "RSI (skip extremes)" },
  { id: "volume", label: "Volume (confirm move)" },
  { id: "atr", label: "Volatility (ATR%)" },
  { id: "adx", label: "Trend strength (ADX)" },
];

export function defaultFilter(type: FilterType): StrategyFilter {
  switch (type) {
    case "rsi":
      return { type: "rsi", period: 14, max: 70, min: 30 };
    case "volume":
      return { type: "volume", period: 20, mult: 1.5 };
    case "atr":
      return { type: "atr", period: 14, min_pct: 0.5 };
    case "adx":
      return { type: "adx", period: 14, min: 20 };
    case "trend":
    default:
      return { type: "trend", ma: "ema", period: 200 };
  }
}

/** Compact side tag for a filter: "↑" long-only, "↓" short-only, "" both. */
export function filterSideTag(f: StrategyFilter): string {
  return f.side === "long" ? " ↑" : f.side === "short" ? " ↓" : "";
}

export function describeFilter(f: StrategyFilter): string {
  const tag = filterSideTag(f);
  switch (f.type) {
    case "trend":
      // f may be an AI-generated config (unvalidated JSON from the model), so
      // `ma`/`period` aren't guaranteed to match the StrategyFilter shape.
      return `${String(f.ma ?? "MA").toUpperCase()}${f.period ?? ""} trend${tag}`;
    case "rsi":
      return `RSI${f.period}${f.max != null ? ` <${f.max}` : ""}${f.min != null ? ` >${f.min}` : ""}${tag}`;
    case "volume":
      return `Vol ×${f.mult}${tag}`;
    case "atr":
      return `ATR%${f.min_pct != null ? ` ≥${f.min_pct}` : ""}${f.max_pct != null ? ` ≤${f.max_pct}` : ""}${tag}`;
    case "adx":
      return `ADX ≥${f.min}${tag}`;
    default:
      return "";
  }
}

export function describeFilters(config: StrategyConfig): string {
  return (config.filters ?? []).map(describeFilter).join(" + ");
}

export function defaultHedge(): HedgeConfig {
  return { enabled: false, mode: "auto_squeeze", ratio: 1.0, trigger_pct: 3, window_sec: 60, release_pct: 1.5 };
}

export function normalizeConfig(config: Partial<StrategyConfig>): StrategyConfig {
  const merged = { ...defaultConfig(), ...config };
  if (!TIMEFRAMES.includes(merged.timeframe)) {
    merged.timeframe = "5m";
  }
  if (merged.market !== "futures") {
    merged.market = "spot";
  }
  merged.direction = merged.direction === "both" ? "both" : "long";
  merged.leverage = merged.leverage ?? 3;
  merged.hedge = { ...defaultHedge(), ...(merged.hedge ?? {}) };
  if (!merged.entry?.length) merged.entry = [defaultEntry("ma_cross")];
  merged.filters = Array.isArray(merged.filters) ? merged.filters : [];
  merged.trailing_stop = merged.trailing_stop ?? { type: "pct", value: 0 };
  merged.vol_target_pct = merged.vol_target_pct ?? 0;
  merged.reverse = merged.reverse ?? false;
  // Reverse needs shorting, so it only applies to futures.
  if (merged.market !== "futures") merged.reverse = false;
  return merged;
}

export function defaultConfig(): StrategyConfig {
  return {
    symbol: "BTC/USDT",
    timeframe: "1h",
    position_size_usdt: DEFAULT_POSITION_USDT,
    entry: [{ type: "ma_cross", fast: 9, slow: 21 }],
    filters: [],
    exit: [{ type: "rsi", op: ">", value: 70 }],
    stop_loss: { type: "pct", value: 2 },
    take_profit: { type: "pct", value: 5 },
    trailing_stop: { type: "pct", value: 0 },
    vol_target_pct: 0,
    reverse: false,
    market: "spot",
    direction: "long",
    leverage: 3,
    hedge: defaultHedge(),
  };
}

export function describeEntry(config: StrategyConfig): string {
  const r = config.entry?.[0];
  if (!r) return "—";
  switch (r.type) {
    case "ma_cross":
      return `MA ${r.fast}/${r.slow}`;
    case "ema_cross":
      return `EMA ${r.fast}/${r.slow}`;
    case "rsi":
      return `RSI ${r.low}/${r.high}`;
    case "breakout":
      return `Breakout ${r.period}`;
    case "macd":
      return `MACD ${r.fast}/${r.slow}/${r.signal}`;
    default:
      return "—";
  }
}

export function describeExit(config: StrategyConfig): string {
  const rule = config.exit?.[0];
  return rule?.type === "rsi" ? `RSI ${rule.op} ${rule.value}` : "—";
}

export function isFutures(config: StrategyConfig): boolean {
  return config.market === "futures";
}

export function isBidirectional(config: StrategyConfig): boolean {
  return isFutures(config) && config.direction === "both";
}

export function describeHedge(config: StrategyConfig): string {
  const h = config.hedge;
  if (!isFutures(config) || !h?.enabled) return "off";
  return h.mode === "auto_squeeze"
    ? `auto · drop ${h.trigger_pct}%`
    : `partial · ${Math.round(h.ratio * 100)}%`;
}

export function isRunning(status: string): boolean {
  return status === "paper" || status === "live";
}
