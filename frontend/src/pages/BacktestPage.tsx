import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { Activity, Play, Percent, TrendingDown, Trophy } from "lucide-react";
import { listStrategies, runBacktest } from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, Spinner, StatCard } from "../components/ui";
import { pct, pnlTone, price, signedPct } from "../lib/formatters";

export function BacktestPage() {
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: listStrategies });
  const [strategyId, setStrategyId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const chartEl = useRef<HTMLDivElement | null>(null);

  const run = useMutation({
    mutationFn: () => runBacktest(strategyId as number, startDate || undefined, endDate || undefined),
    onError: () => toast.error("Backtest failed", "Try another symbol or timeframe."),
  });
  const result = run.data;

  useEffect(() => {
    if (!result || !chartEl.current) return;
    const el = chartEl.current;
    const chart: IChartApi = createChart(el, {
      width: el.clientWidth,
      height: 300,
      layout: { background: { color: "transparent" }, textColor: "#94a3b8", fontFamily: "Inter, sans-serif" },
      grid: { vertLines: { color: "rgba(148,163,184,0.08)" }, horzLines: { color: "rgba(148,163,184,0.08)" } },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.1)" },
      timeScale: { borderColor: "rgba(148,163,184,0.1)" },
      crosshair: { vertLine: { labelVisible: false } },
    });
    const series = chart.addAreaSeries({
      lineColor: "#10b981",
      topColor: "rgba(16,185,129,0.35)",
      bottomColor: "rgba(16,185,129,0.01)",
      lineWidth: 2,
    });
    const base = Math.floor(Date.now() / 1000) - result.equity_curve.length * 3600;
    series.setData(
      result.equity_curve.map((p, i) => ({ time: (base + i * 3600) as UTCTimestamp, value: p.y }))
    );
    chart.timeScale().fitContent();

    const onResize = () => chart.applyOptions({ width: el.clientWidth });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
    };
  }, [result]);

  const trades = (result?.trades ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Backtest" description="Replay a strategy on historical Bybit candles." />

      <Card className="animate-slide-up p-5">
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Strategy">
            <Select value={strategyId ?? ""} onChange={(e) => setStrategyId(Number(e.target.value) || null)}>
              <option value="">Select strategy…</option>
              {strategies.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.config_json.symbol})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date">
            <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End date">
            <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!strategyId}>
            <Play className="h-4 w-4" /> Run backtest
          </Button>
        </div>
      </Card>

      {run.isPending && (
        <Card className="mt-6 flex items-center justify-center gap-3 p-12 text-slate-400">
          <Spinner /> Crunching historical data…
        </Card>
      )}

      {!run.isPending && !result && (
        <div className="mt-6">
          <EmptyState
            icon={Activity}
            title="No results yet"
            description="Pick a strategy and run a backtest to see returns, drawdown and the equity curve."
          />
        </div>
      )}

      {result && !run.isPending && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              icon={Percent}
              label="Total return"
              value={signedPct(result.total_return_pct)}
              valueClassName={pnlTone(result.total_return_pct)}
            />
            <StatCard
              icon={TrendingDown}
              label="Max drawdown"
              value={pct(result.max_drawdown_pct)}
              valueClassName="text-rose-400"
            />
            <StatCard icon={Trophy} label="Win rate" value={pct(result.win_rate)} />
            <StatCard icon={Activity} label="Trades" value={trades.length} />
          </div>

          <Card className="p-5">
            <div className="mb-3 text-sm font-semibold text-slate-300">Equity curve</div>
            <div ref={chartEl} className="w-full" />
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-300">
              Trades ({trades.length})
            </div>
            {trades.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No trades were generated for this period.</div>
            ) : (
              <div className="max-h-[360px] overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-ink-900/80 text-left text-xs uppercase tracking-wider text-slate-500 backdrop-blur">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">#</th>
                      <th className="px-5 py-2.5 font-medium">Side</th>
                      <th className="px-5 py-2.5 font-medium">Price</th>
                      <th className="px-5 py-2.5 text-right font-medium">PnL %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {trades.map((t, i) => {
                      const side = String(t.side ?? "");
                      const pnlVal = typeof t.pnl_pct === "number" ? (t.pnl_pct as number) : null;
                      return (
                        <tr key={i} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-2.5 text-slate-500">{String(t.index ?? i)}</td>
                          <td className="px-5 py-2.5">
                            <Badge tone={side === "buy" ? "success" : "info"}>{side.toUpperCase()}</Badge>
                          </td>
                          <td className="px-5 py-2.5 font-mono text-slate-300">{price(Number(t.price))}</td>
                          <td className={`px-5 py-2.5 text-right font-semibold ${pnlTone(pnlVal)}`}>
                            {pnlVal === null ? "—" : signedPct(pnlVal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
