import type { Strategy, StrategyConfig } from "../api/endpoints";
import { api } from "../api/client";

export type FundingOpportunity = {
  type: "funding_basis";
  symbol: string;
  exchange: string;
  spot: number;
  perp: number;
  basis_pct: number;
  funding_rate_8h: number;
  funding_apr_pct: number;
  fee_round_trip_pct: number;
  net_apr_hint_pct: number;
  days_to_breakeven: number | null;
  tradeable: boolean;
  note: string;
};

export type TriangularOpportunity = {
  type: "triangular";
  path: string;
  exchange: string;
  raw_edge_pct: number;
  net_edge_pct: number;
  fee_pct: number;
  tradeable: boolean;
  note: string;
};

export type ArbOpportunities = {
  exchange: string;
  funding_basis: FundingOpportunity[];
  triangular: TriangularOpportunity[];
  updated_at: number | null;
};

export async function getArbOpportunities() {
  const { data } = await api.get("/arbitrage/opportunities");
  return data as ArbOpportunities;
}

export async function listArbBots() {
  const { data } = await api.get("/arbitrage/bots");
  return data as Strategy[];
}

export async function deployCarry(payload: {
  symbol: string;
  position_size_usdt: number;
  funding_entry_apr?: number;
  funding_exit_apr?: number;
  basis_min_pct?: number | null;
  leverage?: number;
  name?: string;
}) {
  const { data } = await api.post("/arbitrage/carry", payload);
  return data as Strategy;
}

export async function deployPairs(payload: {
  symbol_a: string;
  symbol_b: string;
  position_size_usdt: number;
  timeframe?: string;
  lookback?: number;
  z_entry?: number;
  z_exit?: number;
  leverage?: number;
  name?: string;
}) {
  const { data } = await api.post("/arbitrage/pairs", payload);
  return data as Strategy;
}

export function isArbStrategy(config: StrategyConfig | undefined | null): boolean {
  const kind = config?.kind;
  return kind === "cash_and_carry" || kind === "pairs";
}

export function describeArb(config: StrategyConfig): string {
  if (config.kind === "cash_and_carry") {
    return `Carry · entry APR ≥ ${config.funding_entry_apr ?? 15}%`;
  }
  if (config.kind === "pairs") {
    const a = (config.symbol_a ?? config.symbol).split("/")[0];
    const b = (config.symbol_b ?? "ETH/USDT").split("/")[0];
    return `Pairs ${a}/${b} · |z| ≥ ${config.z_entry ?? 2}`;
  }
  return "—";
}
