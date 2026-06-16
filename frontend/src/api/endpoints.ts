import { api } from "./client";

export type EntryType = "ma_cross" | "ema_cross" | "rsi" | "breakout" | "macd";
// Loose shape so the builder can edit any block type without union narrowing.
export type EntryRule = {
  type: EntryType;
  fast?: number;
  slow?: number;
  signal?: number;
  period?: number;
  low?: number;
  high?: number;
};
export type MaCrossRule = { type: "ma_cross"; fast: number; slow: number };
export type RsiRule = { type: "rsi"; op: ">" | "<"; value: number };
export type PctRule = { type: "pct"; value: number };

export type Market = "spot" | "futures";
export type Direction = "long" | "both";
export type HedgeMode = "auto_squeeze" | "constant_partial";
export type HedgeConfig = {
  enabled: boolean;
  mode: HedgeMode;
  ratio: number;
  trigger_pct: number;
  window_sec: number;
  release_pct: number;
};

export type StrategyConfig = {
  symbol: string;
  timeframe: string;
  position_size_usdt?: number; // position notional in USD (preferred)
  position_size_pct?: number; // legacy: percent of balance (strategies saved before USD)
  daily_loss_limit_pct?: number; // pause new entries after this much realized loss today (0 = off)
  entry: EntryRule[];
  exit: RsiRule[];
  stop_loss: PctRule;
  take_profit: PctRule;
  trailing_stop?: PctRule; // 0 = off; trails the high/low-water mark
  // Futures-only fields; spot strategies omit them and the backend defaults market to "spot".
  market?: Market;
  direction?: Direction; // "long" (default) or "both" — futures can trade both ways
  leverage?: number;
  hedge?: HedgeConfig;
};

export type Strategy = {
  id: number;
  user_id: number;
  name: string;
  config_json: StrategyConfig;
  status: string;
  live_enabled: boolean;
  created_at: string;
};

export type CurrentUser = { id: number; email: string | null; username: string | null; created_at: string };
export type AuthConfig = {
  supabase_url: string;
  supabase_anon_key: string;
  telegram_bot_username: string;
  google_enabled?: boolean;
  ai_enabled?: boolean;
};
export type Subscription = {
  plan: string;
  expires_at: string | null;
  free_mode?: boolean;
  paid_in_usdt?: number;
};

export type ExchangeId = "bybit" | "binance";
export type ExchangeStatus = { connected: boolean; exchange: ExchangeId };
export type BalanceItem = { asset: string; free: number; used: number; total: number };
export type ExchangeBalance = {
  connected: boolean;
  exchange: ExchangeId;
  usdt: number;
  balances: BalanceItem[];
  error?: string | null;
};

export type TradeStats = {
  total_trades: number;
  closed_trades: number;
  wins: number;
  win_rate: number;
  avg_pnl: number;
  total_pnl: number;
  best_pnl: number;
  worst_pnl: number;
  hedge_trades: number;
};

export type Trade = {
  id: number;
  strategy_id: number;
  symbol: string;
  side: string;
  price: number;
  amount: number;
  pnl: number | null;
  leg?: string; // "main" | "hedge"
  mode: string; // "paper" | "live"
  timestamp: string;
};

export type BacktestResult = {
  total_return_pct: number;
  max_drawdown_pct: number;
  win_rate: number;
  trades: Array<Record<string, unknown>>;
  equity_curve: Array<{ x: number; y: number }>; // x = unix seconds
  price_series: Array<{ x: number; o: number; h: number; l: number; c: number }>; // x = unix seconds
  candles: number;
  start: number | null; // unix seconds of first candle
  end: number | null; // unix seconds of last candle
};

export async function me() {
  const { data } = await api.get("/auth/me");
  return data as CurrentUser;
}

export async function authConfig() {
  const { data } = await api.get("/auth/config");
  return data as AuthConfig;
}

export async function authTelegram(payload: Record<string, unknown>) {
  const { data } = await api.post("/auth/telegram", payload);
  return data as { access_token: string };
}

// ---- strategies ----
export async function listStrategies() {
  const { data } = await api.get("/strategies");
  return data as Strategy[];
}

export async function createStrategy(payload: { name: string; config_json: StrategyConfig; live_enabled?: boolean }) {
  const { data } = await api.post("/strategies", payload);
  return data as Strategy;
}

export async function updateStrategy(id: number, payload: Partial<Strategy>) {
  const { data } = await api.put(`/strategies/${id}`, payload);
  return data as Strategy;
}

export async function deleteStrategy(id: number) {
  const { data } = await api.delete(`/strategies/${id}`);
  return data as { ok: boolean };
}

// ---- bots ----
export async function startBot(id: number, mode: "paper" | "live", position_size_usdt?: number) {
  const body: Record<string, unknown> = { mode };
  if (mode === "live" && position_size_usdt !== undefined) body.position_size_usdt = position_size_usdt;
  const { data } = await api.post(`/bots/${id}/start`, body);
  return data as { ok: boolean };
}

export async function stopBot(id: number) {
  const { data } = await api.post(`/bots/${id}/stop`);
  return data as { ok: boolean };
}

export async function syncPosition(id: number) {
  const { data } = await api.post(`/bots/${id}/sync-position`);
  return data as { closed: number; restored: boolean };
}

export async function closePosition(id: number) {
  const { data } = await api.post(`/bots/${id}/close-position`);
  return data as { closed: boolean };
}

export async function panicCloseAll() {
  const { data } = await api.post("/bots/panic");
  return data as { stopped: number; closed: number };
}

// ---- backtest ----
export async function runBacktest(strategy_id: number, start_date?: string, end_date?: string) {
  const { data } = await api.post("/backtest", { strategy_id, start_date, end_date });
  return data as BacktestResult;
}

export type OptimizeResult = {
  config: StrategyConfig;
  total_return_pct: number;
  max_drawdown_pct: number;
  win_rate: number;
  trades: number;
  score: number;
};
export type OptimizeResponse = { results: OptimizeResult[]; tested: number; candles: number };

export async function optimizeStrategy(strategy_id: number, start_date?: string, end_date?: string) {
  const { data } = await api.post("/backtest/optimize", { strategy_id, start_date, end_date });
  return data as OptimizeResponse;
}

export type AttemptInfo = {
  n: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  win_rate: number;
  trades: number;
  proposed_changes: string;
  config: StrategyConfig | null;
};

export type AiAnalysis = {
  verdict: string;
  rating: "good" | "mixed" | "bad";
  assessment: string;
  proposed_changes: string;
  proposed_config: StrategyConfig | null;
  improved: boolean;
  attempts: AttemptInfo[];
  best_n: number | null;
  original_return_pct: number;
  original_drawdown_pct: number;
  best_return_pct: number | null;
  best_drawdown_pct: number | null;
};

export type AnalyzeStatus = {
  status: "running" | "done" | "error";
  attempt: number;
  result: AiAnalysis | null;
  error: string | null;
};

// Starts the iterative AI analysis as a background job; poll getAnalyzeStatus.
export async function startAnalyze(strategy_id: number, start_date?: string, end_date?: string) {
  const { data } = await api.post("/backtest/analyze", { strategy_id, start_date, end_date });
  return data as { job_id: string };
}

export async function getAnalyzeStatus(job_id: string) {
  const { data } = await api.get(`/backtest/analyze/${job_id}`);
  return data as AnalyzeStatus;
}

// ---- trades ----
export async function listTrades(strategy_id?: number, mode?: "paper" | "live") {
  const params: Record<string, unknown> = {};
  if (strategy_id) params.strategy_id = strategy_id;
  if (mode) params.mode = mode;
  const { data } = await api.get("/trades", { params });
  return data as Trade[];
}

export async function getTradeStats(mode?: "paper" | "live") {
  const { data } = await api.get("/trades/stats", { params: mode ? { mode } : {} });
  return data as TradeStats;
}

export async function resetTrades(strategy_id?: number) {
  const { data } = await api.delete("/trades", { params: strategy_id ? { strategy_id } : {} });
  return data as { deleted: number };
}

// ---- exchange ----
export async function connectExchange(exchange: ExchangeId, api_key: string, api_secret: string) {
  const { data } = await api.post("/exchange/connect", { exchange, api_key, api_secret });
  return data as { ok: boolean };
}

export async function exchangeStatus() {
  const { data } = await api.get("/exchange/status");
  return data as ExchangeStatus;
}

export async function exchangeBalance() {
  const { data } = await api.get("/exchange/balance");
  return data as ExchangeBalance;
}

export type MinOrder = {
  symbol: string;
  market: string;
  leverage: number;
  min_amount: number;
  price: number;
  min_notional: number; // minimum position value the exchange accepts
  min_size: number; // minimum size (margin) the user must enter = min_notional / leverage
  error?: string | null;
};

export async function getMinOrder(symbol: string, futures: boolean, leverage = 1) {
  const { data } = await api.get("/exchange/min-order", { params: { symbol, futures, leverage } });
  return data as MinOrder;
}

export async function testExchange() {
  const { data } = await api.post("/exchange/test");
  return data as { ok: boolean };
}

export async function disconnectExchange() {
  const { data } = await api.delete("/exchange/disconnect");
  return data as { ok: boolean };
}

// ---- payments ----
export async function getSubscription() {
  const { data } = await api.get("/payments/subscription");
  return data as Subscription;
}

export async function checkout(plan: "pro") {
  const { data } = await api.post("/payments/checkout", { plan });
  return data as { invoice_id: string; pay_url: string };
}
