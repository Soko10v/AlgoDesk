import type { HedgeConfig, StrategyConfig } from "../api/endpoints";

export const SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];
export const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"];
export const MAX_LEVERAGE = 10; // mirrors backend app/engine/risk.py

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
  merged.leverage = merged.leverage ?? 3;
  merged.hedge = { ...defaultHedge(), ...(merged.hedge ?? {}) };
  return merged;
}

export function defaultConfig(): StrategyConfig {
  return {
    symbol: "BTC/USDT",
    timeframe: "1h",
    position_size_pct: 10,
    entry: [{ type: "ma_cross", fast: 9, slow: 21 }],
    exit: [{ type: "rsi", op: ">", value: 70 }],
    stop_loss: { type: "pct", value: 2 },
    take_profit: { type: "pct", value: 5 },
    market: "spot",
    leverage: 3,
    hedge: defaultHedge(),
  };
}

export function describeEntry(config: StrategyConfig): string {
  const rule = config.entry?.[0];
  return rule?.type === "ma_cross" ? `MA cross ${rule.fast}/${rule.slow}` : "—";
}

export function describeExit(config: StrategyConfig): string {
  const rule = config.exit?.[0];
  return rule?.type === "rsi" ? `RSI ${rule.op} ${rule.value}` : "—";
}

export function isFutures(config: StrategyConfig): boolean {
  return config.market === "futures";
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
