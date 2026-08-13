import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollText, Trash2 } from "lucide-react";
import { listStrategies, listTrades, resetTrades } from "../api/endpoints";
import { isArbStrategy } from "../arbitrage/api";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, Spinner, StatCard } from "../components/ui";
import { dateTime, num, pct, pnlTone, price, signedPct } from "../lib/formatters";

type ModeFilter = "all" | "paper" | "live";

export function TradesPage() {
  const qc = useQueryClient();
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: listStrategies });
  const [strategyId, setStrategyId] = useState<number | null>(null);
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const directional = (strategies.data ?? []).filter((s) => !isArbStrategy(s.config_json));
  const arbIds = new Set((strategies.data ?? []).filter((s) => isArbStrategy(s.config_json)).map((s) => s.id));

  const trades = useQuery({
    queryKey: ["trades", strategyId, modeFilter],
    queryFn: () =>
      listTrades(
        strategyId ?? undefined,
        modeFilter === "all" ? undefined : modeFilter,
      ),
  });

  const clearMutation = useMutation({
    mutationFn: () => resetTrades(strategyId ?? undefined),
    onSuccess: () => {
      setConfirmClear(false);
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["tradeStats"] });
    },
  });

  const rows = (trades.data ?? []).filter((t) => strategyId != null || !arbIds.has(t.strategy_id));
  const summary = useMemo(() => {
    const closed = rows.filter((t) => t.pnl !== null && t.pnl !== undefined);
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
    const avg = closed.length ? closed.reduce((a, t) => a + (t.pnl ?? 0), 0) / closed.length : 0;
    return {
      total: rows.length,
      winRate: closed.length ? (wins / closed.length) * 100 : 0,
      avg,
      closed: closed.length,
    };
  }, [rows]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Trade Log"
        description="Every order placed by your bots, paper and live."
        actions={
          rows.length > 0 && (
            confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">
                  Delete {strategyId ? "strategy" : "all"} trades?
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  loading={clearMutation.isPending}
                  onClick={() => clearMutation.mutate()}
                >
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                Clear history
              </Button>
            )
          )
        }
      />

      <Card className="animate-slide-up p-5">
        <div className="flex flex-wrap gap-3">
          <Field label="Filter by strategy">
            <Select value={strategyId ?? ""} onChange={(e) => setStrategyId(Number(e.target.value) || null)}>
              <option value="">All strategies</option>
              {directional.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Mode">
            <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
              {(["all", "paper", "live"] as ModeFilter[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setModeFilter(m)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                    modeFilter === m
                      ? m === "live"
                        ? "bg-brand-500/20 text-brand-300"
                        : m === "paper"
                          ? "bg-sky-500/20 text-sky-300"
                          : "bg-white/[0.08] text-slate-200"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Orders" value={summary.total} />
        <StatCard label="Closed" value={summary.closed} />
        <StatCard label="Win rate" value={pct(summary.winRate)} />
        <StatCard
          label="Avg PnL"
          value={signedPct(summary.avg)}
          valueClassName={pnlTone(summary.avg)}
        />
      </div>

      <Card className="mt-6 overflow-hidden p-0">
        {trades.isLoading ? (
          <div className="flex items-center justify-center gap-3 p-12 text-slate-400">
            <Spinner /> Loading trades…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No trades yet"
            description="Once a bot opens or closes a position, it will show up here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-ink-900/60 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-5 py-3 font-medium">Symbol</th>
                  <th className="px-5 py-3 font-medium">Side</th>
                  <th className="px-5 py-3 text-right font-medium">Price</th>
                  <th className="px-5 py-3 text-right font-medium">Size</th>
                  <th className="px-5 py-3 text-right font-medium">PnL %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {rows.map((t) => (
                  <tr key={t.id} className="transition hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-400">{dateTime(t.timestamp)}</td>
                    <td className="px-5 py-3 font-mono text-slate-200">{t.symbol}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={t.side === "buy" ? "success" : "info"}>{t.side.toUpperCase()}</Badge>
                        {t.leg === "hedge" && <Badge tone="violet">HEDGE</Badge>}
                        <Badge tone={t.mode === "live" ? "success" : "info"}>
                          {t.mode === "live" ? "LIVE" : "PAPER"}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-slate-300">{price(t.price)}</td>
                    <td className="px-5 py-3 text-right text-slate-400">{num(t.amount, 4)}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${pnlTone(t.pnl)}`}>
                      {t.pnl === null || t.pnl === undefined ? "—" : signedPct(t.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
