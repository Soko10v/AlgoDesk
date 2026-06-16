import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createChart, type IChartApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { Activity, Play, Percent, Save, Sparkles, TrendingDown, Trophy, Wand2 } from "lucide-react";
import {
  analyzeStrategy,
  authConfig,
  createStrategy,
  listStrategies,
  optimizeStrategy,
  runBacktest,
  type OptimizeResult,
} from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, Spinner, StatCard } from "../components/ui";
import { dateTime, pct, pnlTone, price, signedPct } from "../lib/formatters";
import { describeEntry } from "../lib/strategy";

export function BacktestPage() {
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: listStrategies });
  const [strategyId, setStrategyId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const equityEl = useRef<HTMLDivElement | null>(null);
  const priceEl = useRef<HTMLDivElement | null>(null);

  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => runBacktest(strategyId as number, startDate || undefined, endDate || undefined),
    onError: () => toast.error("Backtest failed", "Try another symbol or timeframe."),
  });
  const result = run.data;

  const optimize = useMutation({
    mutationFn: () => optimizeStrategy(strategyId as number, startDate || undefined, endDate || undefined),
    onError: () => toast.error("Optimization failed", "Try a shorter period."),
  });

  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: authConfig, staleTime: Infinity });
  const aiEnabled = cfg.data?.ai_enabled ?? false;
  const analyze = useMutation({
    mutationFn: () => analyzeStrategy(strategyId as number, startDate || undefined, endDate || undefined),
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("AI analysis failed", detail);
    },
  });

  const stratName = strategies.data?.find((s) => s.id === strategyId)?.name ?? "Strategy";
  const saveOptimized = useMutation({
    mutationFn: (r: OptimizeResult) => createStrategy({ name: `${stratName} (optimized)`, config_json: r.config }),
    onSuccess: (s) => {
      toast.success("Saved strategy", s.name);
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: () => toast.error("Could not save strategy"),
  });
  const saveAi = useMutation({
    mutationFn: (config: NonNullable<typeof analyze.data>["proposed_config"]) =>
      createStrategy({ name: `${stratName} (AI)`, config_json: config! }),
    onSuccess: (s) => {
      toast.success("Saved strategy", s.name);
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: () => toast.error("Could not save strategy"),
  });

  useEffect(() => {
    if (!result || !equityEl.current || !priceEl.current) return;
    const eEl = equityEl.current;
    const pEl = priceEl.current;
    const common = {
      layout: { background: { color: "transparent" }, textColor: "#94a3b8", fontFamily: "Inter, sans-serif" },
      grid: { vertLines: { color: "rgba(148,163,184,0.08)" }, horzLines: { color: "rgba(148,163,184,0.08)" } },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.1)" },
      timeScale: { borderColor: "rgba(148,163,184,0.1)", timeVisible: true },
      crosshair: { vertLine: { labelVisible: false } },
    } as const;

    // Equity (top) and price (bottom) share the same candle timestamps, so their
    // time axes line up: a jump in equity sits directly above the trade marker.
    const equityChart: IChartApi = createChart(eEl, { width: eEl.clientWidth, height: 220, ...common });
    const priceChart: IChartApi = createChart(pEl, { width: pEl.clientWidth, height: 260, ...common });

    const equitySeries = equityChart.addAreaSeries({
      lineColor: "#10b981",
      topColor: "rgba(16,185,129,0.35)",
      bottomColor: "rgba(16,185,129,0.01)",
      lineWidth: 2,
    });
    equitySeries.setData(
      result.equity_curve.map((p) => ({ time: Math.floor(p.x) as UTCTimestamp, value: p.y }))
    );

    // A clean close-price line reads far better than thousands of tiny candles
    // on a phone; trade markers sit clearly on top of it.
    const priceSeries = priceChart.addAreaSeries({
      lineColor: "#7c8aa5",
      topColor: "rgba(124,138,165,0.12)",
      bottomColor: "rgba(124,138,165,0)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    priceSeries.setData(
      result.price_series.map((p) => ({ time: Math.floor(p.x) as UTCTimestamp, value: p.c }))
    );

    // Markers without text labels (those were the visual noise): entries are quiet
    // slate dots, exits are green/red arrows so wins vs losses pop. Exact P&L per
    // trade lives in the Trades table below and on hover.
    const markers: SeriesMarker<Time>[] = [];
    for (const t of result.trades) {
      if (typeof t.time !== "number") continue;
      const time = Math.floor(t.time) as UTCTimestamp;
      const side = String(t.side ?? "");
      const buyish = side === "buy" || side === "long";
      const isExit = typeof t.pnl_pct === "number";
      if (t.leg === "hedge") {
        markers.push({ time, position: "inBar", color: "#6366f1", shape: "circle" });
      } else if (isExit) {
        const p = t.pnl_pct as number;
        markers.push({
          time,
          position: buyish ? "belowBar" : "aboveBar",
          color: p >= 0 ? "#10b981" : "#f43f5e",
          shape: buyish ? "arrowUp" : "arrowDown",
        });
      } else {
        markers.push({
          time,
          position: buyish ? "belowBar" : "aboveBar",
          color: "#64748b",
          shape: "circle",
        });
      }
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    priceSeries.setMarkers(markers);

    equityChart.timeScale().fitContent();
    priceChart.timeScale().fitContent();

    // Keep the two time axes locked together when panning/zooming either chart.
    let syncing = false;
    const link = (src: IChartApi, dst: IChartApi) =>
      src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncing || !range) return;
        syncing = true;
        dst.timeScale().setVisibleLogicalRange(range);
        syncing = false;
      });
    link(equityChart, priceChart);
    link(priceChart, equityChart);

    const onResize = () => {
      equityChart.applyOptions({ width: eEl.clientWidth });
      priceChart.applyOptions({ width: pEl.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      equityChart.remove();
      priceChart.remove();
    };
  }, [result]);

  const trades = (result?.trades ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Backtest" description="Replay a strategy on historical Bybit candles." />

      <Card className="animate-slide-up p-5">
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!strategyId}>
            <Play className="h-4 w-4" /> Run
          </Button>
          <Button
            variant="secondary"
            onClick={() => optimize.mutate()}
            loading={optimize.isPending}
            disabled={!strategyId}
            title="Sweep parameter combinations and rank the best"
          >
            <Wand2 className="h-4 w-4" /> Optimize
          </Button>
          {aiEnabled && (
            <Button
              variant="secondary"
              onClick={() => analyze.mutate()}
              loading={analyze.isPending}
              disabled={!strategyId}
              title="DeepSeek reviews the backtest and suggests an improved bot"
            >
              <Sparkles className="h-4 w-4" /> AI analysis
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Leave the dates blank to backtest the most recent candles (up to ~2000 of the
          strategy's timeframe). The exact period and candle count are shown with the results.
        </p>
      </Card>

      {analyze.isPending && (
        <Card className="mt-6 flex items-center justify-center gap-3 p-12 text-slate-400">
          <Spinner /> AI is reviewing the backtest…
        </Card>
      )}

      {analyze.data && !analyze.isPending && (
        <Card className="mt-6 p-0">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-200">
            <Sparkles className="h-4 w-4 text-brand-400" /> AI analysis
          </div>
          <div className="space-y-4 p-5">
            <div
              className={`rounded-xl border p-3 text-sm font-medium ${
                analyze.data.rating === "good"
                  ? "border-brand-500/20 bg-brand-500/[0.06] text-brand-300"
                  : analyze.data.rating === "bad"
                    ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
                    : "border-amber-500/20 bg-amber-500/[0.06] text-amber-200"
              }`}
            >
              {analyze.data.verdict || "—"}
            </div>
            {analyze.data.assessment && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{analyze.data.assessment}</p>
            )}
            {analyze.data.proposed_config && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Suggested improved version
                </div>
                {analyze.data.proposed_changes && (
                  <p className="whitespace-pre-wrap text-sm text-slate-300">{analyze.data.proposed_changes}</p>
                )}
                <Button
                  className="mt-3"
                  size="sm"
                  onClick={() => saveAi.mutate(analyze.data!.proposed_config)}
                  loading={saveAi.isPending}
                >
                  <Save className="h-3.5 w-3.5" /> Save as new strategy
                </Button>
              </div>
            )}
            <p className="text-xs text-slate-500">
              AI suggestions are based on past data and can be wrong — backtest the saved version and start in paper mode.
            </p>
          </div>
        </Card>
      )}

      {optimize.isPending && (
        <Card className="mt-6 flex items-center justify-center gap-3 p-12 text-slate-400">
          <Spinner /> Sweeping parameter combinations…
        </Card>
      )}

      {optimize.data && !optimize.isPending && (
        <Card className="mt-6 overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-5 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Wand2 className="h-4 w-4 text-brand-400" /> Optimizer — top results
            </div>
            <span className="text-xs text-slate-500">{optimize.data.tested} combos · ranked by return ÷ drawdown</span>
          </div>
          {optimize.data.results.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No combination produced enough trades in this period.</div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-ink-900/80 text-left text-xs uppercase tracking-wider text-slate-500 backdrop-blur">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">#</th>
                    <th className="px-4 py-2.5 font-medium">Entry</th>
                    <th className="px-4 py-2.5 font-medium">SL / TP / Trail</th>
                    <th className="px-4 py-2.5 text-right font-medium">Return</th>
                    <th className="px-4 py-2.5 text-right font-medium">Drawdown</th>
                    <th className="px-4 py-2.5 text-right font-medium">Win</th>
                    <th className="px-4 py-2.5 text-right font-medium">Trades</th>
                    <th className="px-4 py-2.5 text-right font-medium">Score</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {optimize.data.results.map((r, i) => (
                    <tr key={i} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
                      <td className="px-4 py-2.5 text-slate-300">{describeEntry(r.config)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                        {r.config.stop_loss.value}% / {r.config.take_profit.value || "—"}
                        {r.config.take_profit.value ? "%" : ""} / {r.config.trailing_stop?.value || "—"}
                        {r.config.trailing_stop?.value ? "%" : ""}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${pnlTone(r.total_return_pct)}`}>
                        {signedPct(r.total_return_pct)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-rose-400">{pct(r.max_drawdown_pct)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-400">{pct(r.win_rate)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-400">{r.trades}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-200">{r.score.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => saveOptimized.mutate(r)}
                          disabled={saveOptimized.isPending}
                        >
                          <Save className="h-3.5 w-3.5" /> Save
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-white/[0.06] px-5 py-2.5 text-xs text-slate-500">
            ⚠️ Ranked on past data — high scores can be overfit. Prefer many trades + low drawdown, and re-test on another period.
          </div>
        </Card>
      )}

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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-300">Equity curve</span>
              {result.candles > 0 && result.start && result.end && (
                <span className="text-xs text-slate-500">
                  {result.candles} candles · {dateTime(result.start * 1000)} → {dateTime(result.end * 1000)}
                </span>
              )}
            </div>
            <div ref={equityEl} className="w-full" />
            <div className="mb-2 mt-5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-300">Price &amp; trades</span>
              <span className="text-xs text-slate-500">
                <span className="text-slate-400">●</span> entry ·{" "}
                <span className="text-brand-400">▲</span>/<span className="text-rose-400">▼</span> exit (green = profit, red = loss) — P&amp;L per trade in the table below
              </span>
            </div>
            <div ref={priceEl} className="w-full" />
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
