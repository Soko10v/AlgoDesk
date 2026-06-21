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

// Entry filters layer extra conditions on top of the entry signal (it picks the
// side; a filter can veto it). Trend = trade with the MA; RSI = skip extremes.
// `side` gates which direction the filter applies to (default "both"), so a
// long/short bot can require different conditions for longs vs shorts.
export type FilterSide = "long" | "short" | "both";
export type TrendFilter = { type: "trend"; ma: "ema" | "sma"; period: number; side?: FilterSide };
export type RsiFilter = { type: "rsi"; period: number; min?: number; max?: number; side?: FilterSide };
export type VolumeFilter = { type: "volume"; period: number; mult: number; side?: FilterSide };
export type AtrFilter = { type: "atr"; period: number; min_pct?: number; max_pct?: number; side?: FilterSide };
export type AdxFilter = { type: "adx"; period: number; min: number; side?: FilterSide };
export type StrategyFilter = TrendFilter | RsiFilter | VolumeFilter | AtrFilter | AdxFilter;
export type FilterType = StrategyFilter["type"];

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
  filters?: StrategyFilter[]; // optional extra entry conditions (trend / rsi)
  exit: RsiRule[];
  stop_loss: PctRule;
  take_profit: PctRule;
  trailing_stop?: PctRule; // 0 = off; trails the high/low-water mark
  vol_target_pct?: number; // 0 = off; scale position size inversely to ATR volatility
  reverse?: boolean; // mirror the strategy: long↔short and stop-loss↔take-profit (futures only)
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
export type PlanId = "free" | "pro" | "expert";
export type FeatureKey =
  | "backtest"
  | "optimize_entry"
  | "paper"
  | "live"
  | "sensitivity"
  | "optimize_exits"
  | "walkforward"
  | "monte_carlo"
  | "ai"
  | "optimize_filters";
export type Subscription = {
  plan: PlanId;
  expires_at: string | null;
  free_mode?: boolean;
  paid_in_usdt?: number;
  entitlements?: Partial<Record<FeatureKey, boolean>>;
  prices?: Partial<Record<"pro" | "expert", number>>;
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

export type BacktestMetrics = {
  sharpe: number;
  sortino: number;
  calmar: number;
  profit_factor: number;
  expectancy_pct: number;
  exposure_pct: number;
  ann_return_pct: number;
};
export type MonteCarlo = {
  simulations: number;
  median_return_pct: number;
  p5_return_pct: number;
  p95_return_pct: number;
  prob_profit_pct: number;
  median_maxdd_pct: number;
  p95_maxdd_pct: number;
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
  metrics?: BacktestMetrics | null;
  monte_carlo?: MonteCarlo | null;
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
// Which group the optimizer tunes (one at a time, holding the rest fixed).
export type OptimizeGroup = "entry" | "exits" | "long_filters" | "short_filters";
export type OptimizeResponse = { results: OptimizeResult[]; tested: number; candles: number; group: OptimizeGroup };

export async function optimizeStrategy(
  strategy_id: number,
  group: OptimizeGroup,
  start_date?: string,
  end_date?: string
) {
  const { data } = await api.post("/backtest/optimize", { strategy_id, group, start_date, end_date });
  return data as OptimizeResponse;
}

export type WalkForwardFold = {
  n: number;
  return_pct: number;
  drawdown_pct: number;
  trades: number;
  start?: number | null;
  end?: number | null;
};
export type WalkForwardResult = {
  verdict: "robust" | "mixed" | "fragile" | "insufficient";
  message: string;
  folds: WalkForwardFold[];
  avg_return_pct: number;
  combined_return_pct: number;
  profitable_folds: number;
  total_folds: number;
  candles: number;
};

export async function walkForward(strategy_id: number, start_date?: string, end_date?: string) {
  const { data } = await api.post("/backtest/walkforward", { strategy_id, start_date, end_date });
  return data as WalkForwardResult;
}

export type SensitivityResult = {
  x_label: string;
  y_label: string;
  x_values: number[];
  y_values: number[];
  grid: number[][]; // rows by y, cols by x — return % per cell
  cur_x: number;
  cur_y: number;
  verdict: "robust" | "mixed" | "fragile";
  message: string;
};
export async function sensitivity(strategy_id: number, start_date?: string, end_date?: string) {
  const { data } = await api.post("/backtest/sensitivity", { strategy_id, start_date, end_date });
  return data as SensitivityResult;
}

export type DataCoverage = {
  symbol: string;
  timeframe: string;
  count: number;
  first: number | null; // unix seconds
  last: number | null;
};
export async function getDataStatus() {
  const { data } = await api.get("/backtest/data-status");
  return data as DataCoverage[];
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

export type GeneratedBot = {
  name: string;
  approach: string;
  config: StrategyConfig;
  total_return_pct: number;
  max_drawdown_pct: number;
  win_rate: number;
  trades: number;
};
export type GenerateResult = { answer: string; symbol: string; timeframe: string; bots: GeneratedBot[] };
export type GenerateStatus = { status: "running" | "done" | "error"; result: GenerateResult | null; error: string | null };

// Designs three distinct bots from a description (background job; poll the status).
export async function startGenerate(messages: ChatMessage[]) {
  const { data } = await api.post("/backtest/generate", { messages });
  return data as { job_id: string };
}

export async function getGenerateStatus(job_id: string) {
  const { data } = await api.get(`/backtest/generate/${job_id}`);
  return data as GenerateStatus;
}

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AskResult = {
  answer: string;
  proposed_changes: string;
  proposed_config: StrategyConfig | null;
  original_return_pct: number;
  original_drawdown_pct: number;
  proposed_return_pct: number | null;
  proposed_drawdown_pct: number | null;
  proposed_win_rate: number | null;
  proposed_trades: number | null;
};

// Constrained free-form chat about a strategy. base_config carries the working
// config being refined so follow-up requests build on the previous answer.
export async function askAi(
  strategy_id: number,
  messages: ChatMessage[],
  base_config?: StrategyConfig | null,
  start_date?: string,
  end_date?: string
) {
  const { data } = await api.post("/backtest/ask", {
    strategy_id,
    messages,
    base_config: base_config ?? undefined,
    start_date,
    end_date,
  });
  return data as AskResult;
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

export async function checkout(plan: "pro" | "expert") {
  const { data } = await api.post("/payments/checkout", { plan });
  return data as { invoice_id: string; pay_url: string };
}
