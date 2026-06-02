import type { StrategyConfig } from "../api/endpoints";

export const SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];
export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

export function defaultConfig(): StrategyConfig {
  return {
    symbol: "BTC/USDT",
    timeframe: "1h",
    position_size_pct: 10,
    entry: [{ type: "ma_cross", fast: 9, slow: 21 }],
    exit: [{ type: "rsi", op: ">", value: 70 }],
    stop_loss: { type: "pct", value: 2 },
    take_profit: { type: "pct", value: 5 },
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

export function isRunning(status: string): boolean {
  return status === "paper" || status === "live";
}
