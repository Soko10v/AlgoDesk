import type { EntryRule, EntryType, HedgeConfig, StrategyConfig } from "../api/endpoints";

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
  merged.trailing_stop = merged.trailing_stop ?? { type: "pct", value: 0 };
  return merged;
}

export function defaultConfig(): StrategyConfig {
  return {
    symbol: "BTC/USDT",
    timeframe: "1h",
    position_size_usdt: DEFAULT_POSITION_USDT,
    entry: [{ type: "ma_cross", fast: 9, slow: 21 }],
    exit: [{ type: "rsi", op: ">", value: 70 }],
    stop_loss: { type: "pct", value: 2 },
    take_profit: { type: "pct", value: 5 },
    trailing_stop: { type: "pct", value: 0 },
    market: "spot",
    direction: "long",
    leverage: 3,
    hedge: defaultHedge(),
  };
}

export type Preset = { id: string; name: string; blurb: string; config: StrategyConfig };

/** Curated starting points so users don't build from scratch. Each uses the new
 *  blocks + trailing so they're decent baselines to backtest and tune. */
export function presets(): Preset[] {
  const base = defaultConfig();
  const off = { type: "pct" as const, value: 0 };
  const pct = (value: number) => ({ type: "pct" as const, value });
  return [
    {
      id: "trend",
      name: "Trend Rider",
      blurb: "EMA trend · both directions · trailing exit",
      config: { ...base, timeframe: "1h", market: "futures", direction: "both", leverage: 3,
        entry: [defaultEntry("ema_cross")], stop_loss: pct(3), take_profit: off, trailing_stop: pct(4) },
    },
    {
      id: "scalp",
      name: "Scalper",
      blurb: "Fast MA + RSI exit · tight risk · spot",
      config: { ...base, timeframe: "5m", entry: [defaultEntry("ma_cross")],
        exit: [{ type: "rsi", op: ">", value: 70 }], stop_loss: pct(1), take_profit: pct(1.5), trailing_stop: off },
    },
    {
      id: "breakout",
      name: "Breakout Hunter",
      blurb: "Donchian breakout · both ways · trailing",
      config: { ...base, timeframe: "1h", market: "futures", direction: "both", leverage: 3,
        entry: [defaultEntry("breakout")], stop_loss: pct(3), take_profit: off, trailing_stop: pct(5) },
    },
    {
      id: "meanrev",
      name: "Mean Reversion",
      blurb: "Buy oversold RSI · take profit · spot",
      config: { ...base, timeframe: "15m", entry: [defaultEntry("rsi")],
        stop_loss: pct(2), take_profit: pct(3), trailing_stop: off },
    },
    {
      id: "macd",
      name: "MACD Momentum",
      blurb: "MACD cross · both ways · trailing",
      config: { ...base, timeframe: "4h", market: "futures", direction: "both", leverage: 3,
        entry: [defaultEntry("macd")], stop_loss: pct(3), take_profit: off, trailing_stop: pct(4) },
    },
  ];
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
