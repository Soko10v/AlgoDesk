import { api } from "./client";

export type MaCrossRule = { type: "ma_cross"; fast: number; slow: number };
export type RsiRule = { type: "rsi"; op: ">" | "<"; value: number };
export type PctRule = { type: "pct"; value: number };

export type StrategyConfig = {
  symbol: string;
  timeframe: string;
  position_size_pct: number;
  entry: MaCrossRule[];
  exit: RsiRule[];
  stop_loss: PctRule;
  take_profit: PctRule;
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
};
export type Subscription = { plan: string; expires_at: string | null; free_mode?: boolean };

export type ExchangeId = "bybit" | "binance";
export type ExchangeStatus = { connected: boolean; exchange: ExchangeId };

export type Trade = {
  id: number;
  strategy_id: number;
  symbol: string;
  side: string;
  price: number;
  amount: number;
  pnl: number | null;
  timestamp: string;
};

export type BacktestResult = {
  total_return_pct: number;
  max_drawdown_pct: number;
  win_rate: number;
  trades: Array<Record<string, unknown>>;
  equity_curve: Array<{ x: number; y: number }>;
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
export async function startBot(id: number, mode: "paper" | "live") {
  const { data } = await api.post(`/bots/${id}/start`, { mode });
  return data as { ok: boolean };
}

export async function stopBot(id: number) {
  const { data } = await api.post(`/bots/${id}/stop`);
  return data as { ok: boolean };
}

// ---- backtest ----
export async function runBacktest(strategy_id: number, start_date?: string, end_date?: string) {
  const { data } = await api.post("/backtest", { strategy_id, start_date, end_date });
  return data as BacktestResult;
}

// ---- trades ----
export async function listTrades(strategy_id?: number) {
  const { data } = await api.get("/trades", { params: strategy_id ? { strategy_id } : {} });
  return data as Trade[];
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
