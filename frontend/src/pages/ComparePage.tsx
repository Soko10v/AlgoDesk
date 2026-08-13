import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { GitCompare, Play, Trophy } from "lucide-react";
import { listStrategies, runBacktest, type BacktestResult, type Strategy } from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Spinner } from "../components/ui";
import { cn } from "../lib/cn";
import { pct, pnlTone, signedPct } from "../lib/formatters";
import { describeEntry, isBidirectional, isFutures } from "../lib/strategy";
import { isArbStrategy } from "../arbitrage/api";

type Row = { strategy: Strategy; result: BacktestResult; closed: number };

export function ComparePage() {
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: listStrategies });
  const [selected, setSelected] = useState<number[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const compare = useMutation({
    mutationFn: async (): Promise<Row[]> => {
      const items = (strategies.data ?? []).filter((s) => selected.includes(s.id));
      const rows = await Promise.all(
        items.map(async (s) => {
          const result = await runBacktest(s.id, startDate || undefined, endDate || undefined);
          const closed = (result.trades as Array<Record<string, unknown>>).filter(
            (t) => t.leg === "main" && typeof t.pnl_pct === "number"
          ).length;
          return { strategy: s, result, closed };
        })
      );
      return rows.sort((a, b) => b.result.total_return_pct - a.result.total_return_pct);
    },
    onError: () => toast.error("Compare failed", "Try a different period."),
  });

  const toggle = (id: number) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const items = (strategies.data ?? []).filter((s) => !isArbStrategy(s.config_json));
  const rows = compare.data ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader title="Compare" description="Backtest several strategies over the same period and rank them." />

      <Card className="animate-slide-up p-5">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">No saved strategies yet — build a few first.</p>
        ) : (
          <>
            <div className="mb-1 text-sm font-medium text-slate-300">Pick strategies to compare</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition",
                    selected.includes(s.id)
                      ? "border-brand-500/50 bg-brand-500/10"
                      : "border-white/[0.06] bg-white/[0.02] hover:border-white/20"
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-200">{s.name}</div>
                    <div className="truncate text-xs text-slate-500">
                      {s.config_json.symbol} · {describeEntry(s.config_json)}
                      {isFutures(s.config_json) ? " · futures" : ""}
                      {isBidirectional(s.config_json) ? " · L/S" : ""}
                    </div>
                  </div>
                  {selected.includes(s.id) && <Badge tone="success">✓</Badge>}
                </button>
              ))}
            </div>

            <div className="mt-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Start date">
                <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label="End date">
                <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
              <Button
                onClick={() => compare.mutate()}
                loading={compare.isPending}
                disabled={selected.length < 2}
                title={selected.length < 2 ? "Pick at least two strategies" : "Run the comparison"}
              >
                <Play className="h-4 w-4" /> Compare {selected.length || ""}
              </Button>
            </div>
          </>
        )}
      </Card>

      {compare.isPending && (
        <Card className="mt-6 flex items-center justify-center gap-3 p-12 text-slate-400">
          <Spinner /> Backtesting {selected.length} strategies…
        </Card>
      )}

      {rows.length > 0 && !compare.isPending && (
        <Card className="mt-6 overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-200">
            <GitCompare className="h-4 w-4 text-brand-400" /> Ranked by total return
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-ink-900/60 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">#</th>
                  <th className="px-5 py-3 font-medium">Strategy</th>
                  <th className="px-5 py-3 text-right font-medium">Return</th>
                  <th className="px-5 py-3 text-right font-medium">Drawdown</th>
                  <th className="px-5 py-3 text-right font-medium">Win rate</th>
                  <th className="px-5 py-3 text-right font-medium">Trades</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {rows.map((r, i) => (
                  <tr key={r.strategy.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 py-3 text-slate-500">
                      {i === 0 ? <Trophy className="h-4 w-4 text-amber-300" /> : i + 1}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-200">{r.strategy.name}</div>
                      <div className="text-xs text-slate-500">
                        {r.strategy.config_json.symbol} · {describeEntry(r.strategy.config_json)}
                      </div>
                    </td>
                    <td className={`px-5 py-3 text-right font-semibold ${pnlTone(r.result.total_return_pct)}`}>
                      {signedPct(r.result.total_return_pct)}
                    </td>
                    <td className="px-5 py-3 text-right text-rose-400">{pct(r.result.max_drawdown_pct)}</td>
                    <td className="px-5 py-3 text-right text-slate-400">{pct(r.result.win_rate)}</td>
                    <td className="px-5 py-3 text-right text-slate-400">{r.closed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!compare.isPending && rows.length === 0 && items.length > 0 && (
        <div className="mt-6">
          <EmptyState
            icon={GitCompare}
            title="Pick at least two strategies"
            description="Select strategies above and run the comparison to see them ranked side by side."
          />
        </div>
      )}
    </div>
  );
}
