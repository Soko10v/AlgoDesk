import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createChart, type IChartApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { Activity, MessageSquare, Play, Percent, Save, Send, ShieldCheck, Sparkles, TrendingDown, Trophy, Wand2 } from "lucide-react";
import {
  askAi,
  authConfig,
  createStrategy,
  getAnalyzeStatus,
  getDataStatus,
  listStrategies,
  optimizeStrategy,
  runBacktest,
  startAnalyze,
  walkForward,
  type ChatMessage,
  type OptimizeResult,
  type StrategyConfig,
} from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, Spinner, StatCard } from "../components/ui";
import { dateTime, pct, pnlTone, price, signedPct } from "../lib/formatters";
import { describeEntry, describeFilters } from "../lib/strategy";

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

  const walkfwd = useMutation({
    mutationFn: () => walkForward(strategyId as number, startDate || undefined, endDate || undefined),
    onError: () => toast.error("Walk-forward failed", "Try a longer period."),
  });

  // How much history the local cache holds for the selected strategy's symbol/tf.
  const dataStatus = useQuery({ queryKey: ["data-status"], queryFn: getDataStatus, refetchInterval: 60_000 });
  const selStrategy = strategies.data?.find((s) => s.id === strategyId);
  const coverage = dataStatus.data?.find(
    (c) => selStrategy && c.symbol === selStrategy.config_json.symbol && c.timeframe === selStrategy.config_json.timeframe
  );

  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: authConfig, staleTime: Infinity });
  const aiEnabled = cfg.data?.ai_enabled ?? false;

  // AI analysis runs as a background job (several backtests + DeepSeek calls), so
  // we start it, then poll for live attempt progress and the final result.
  const [aiJobId, setAiJobId] = useState<string | null>(null);
  const startAi = useMutation({
    mutationFn: () => startAnalyze(strategyId as number, startDate || undefined, endDate || undefined),
    onSuccess: (d) => setAiJobId(d.job_id),
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("AI analysis failed", detail);
    },
  });
  const aiStatus = useQuery({
    queryKey: ["ai-status", aiJobId],
    queryFn: () => getAnalyzeStatus(aiJobId as string),
    enabled: !!aiJobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "done" || s === "error" ? false : 2000;
    },
  });

  useEffect(() => {
    if (aiStatus.data?.status === "error") {
      toast.error("AI analysis failed", aiStatus.data.error || undefined);
      setAiJobId(null);
    }
  }, [aiStatus.data?.status, aiStatus.data?.error]);

  const aiPending =
    startAi.isPending || (!!aiJobId && aiStatus.data?.status !== "done" && aiStatus.data?.status !== "error");
  const aiData = aiStatus.data?.status === "done" ? aiStatus.data.result : null;
  const aiAttempt = aiStatus.data?.attempt ?? 1;

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
    mutationFn: (v: { config: StrategyConfig; n: number }) =>
      createStrategy({ name: `${stratName} (AI #${v.n})`, config_json: v.config }),
    onSuccess: (s) => {
      toast.success("Saved strategy", s.name);
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: () => toast.error("Could not save strategy"),
  });

  // ---- Ask AI (constrained chat about the selected strategy) ----
  type ChatItem = {
    role: "user" | "assistant";
    content: string;
    proposed_config?: StrategyConfig | null;
    proposed_changes?: string;
    original_return_pct?: number;
    proposed_return_pct?: number | null;
    proposed_drawdown_pct?: number | null;
    proposed_win_rate?: number | null;
    proposed_trades?: number | null;
  };
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [askText, setAskText] = useState("");
  // The config the chat is iterating on; follow-up requests build on the last proposal.
  const [workingConfig, setWorkingConfig] = useState<StrategyConfig | null>(null);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);

  // Reset the conversation when the user picks a different strategy.
  useEffect(() => {
    setChat([]);
    setWorkingConfig(null);
    setAskText("");
  }, [strategyId]);

  const ask = useMutation({
    mutationFn: (history: ChatMessage[]) =>
      askAi(strategyId as number, history, workingConfig, startDate || undefined, endDate || undefined),
    onSuccess: (res) => {
      setChat((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.answer || "—",
          proposed_config: res.proposed_config,
          proposed_changes: res.proposed_changes,
          original_return_pct: res.original_return_pct,
          proposed_return_pct: res.proposed_return_pct,
          proposed_drawdown_pct: res.proposed_drawdown_pct,
          proposed_win_rate: res.proposed_win_rate,
          proposed_trades: res.proposed_trades,
        },
      ]);
      if (res.proposed_config) setWorkingConfig(res.proposed_config);
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("AI failed", detail);
      setChat((prev) => prev.slice(0, -1)); // drop the unanswered user bubble
    },
  });

  const saveChat = useMutation({
    mutationFn: (config: StrategyConfig) => createStrategy({ name: `${stratName} (AI)`, config_json: config }),
    onSuccess: (s) => {
      toast.success("Saved strategy", s.name);
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: () => toast.error("Could not save strategy"),
  });

  function sendAsk() {
    const text = askText.trim();
    if (!text || !strategyId || ask.isPending) return;
    const next: ChatItem[] = [...chat, { role: "user", content: text }];
    setChat(next);
    setAskText("");
    ask.mutate(next.map((m) => ({ role: m.role, content: m.content })));
  }

  // Keep the chat scrolled to the latest message — but only the chat box itself,
  // never the whole page (scrollIntoView would yank the window to the bottom).
  useEffect(() => {
    const el = chatBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, ask.isPending]);

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
          <Button
            variant="secondary"
            onClick={() => walkfwd.mutate()}
            loading={walkfwd.isPending}
            disabled={!strategyId}
            title="Optimise on past windows, validate on the next unseen ones — checks for overfitting"
          >
            <ShieldCheck className="h-4 w-4" /> Walk-forward
          </Button>
          {aiEnabled && (
            <Button
              variant="secondary"
              onClick={() => startAi.mutate()}
              loading={aiPending}
              disabled={!strategyId}
              title="DeepSeek reviews the backtest and suggests an improved bot"
            >
              <Sparkles className="h-4 w-4" /> AI analysis
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Leave the dates blank to backtest the most recent candles. Pick a date range to test over
          years of cached history — the exact period and candle count are shown with the results.
        </p>
        {selStrategy && (
          <p className="mt-1 text-xs text-slate-500">
            {coverage && coverage.count > 0 ? (
              <>
                <span className="text-slate-400">Cached history</span> for {coverage.symbol} {coverage.timeframe}:{" "}
                {coverage.count.toLocaleString()} candles
                {coverage.first ? ` · ${dateTime(coverage.first * 1000)} → ${dateTime((coverage.last ?? 0) * 1000)}` : ""}
              </>
            ) : (
              <>Downloading history for {selStrategy.config_json.symbol} {selStrategy.config_json.timeframe}… (uses live data until ready)</>
            )}
          </p>
        )}
      </Card>

      {walkfwd.isPending && (
        <Card className="mt-6 flex items-center justify-center gap-3 p-12 text-slate-400">
          <Spinner /> Walk-forward: optimising windows and validating out-of-sample…
        </Card>
      )}

      {walkfwd.data && !walkfwd.isPending && (
        <Card className="mt-6 p-0">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-200">
            <ShieldCheck className="h-4 w-4 text-brand-400" /> Walk-forward (out-of-sample)
          </div>
          <div className="space-y-4 p-5">
            <div
              className={`rounded-xl border p-3 text-sm font-medium ${
                walkfwd.data.verdict === "robust"
                  ? "border-brand-500/20 bg-brand-500/[0.06] text-brand-300"
                  : walkfwd.data.verdict === "overfit"
                    ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
                    : "border-amber-500/20 bg-amber-500/[0.06] text-amber-200"
              }`}
            >
              {walkfwd.data.message}
            </div>

            {walkfwd.data.folds.length > 0 && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard
                    icon={Wand2}
                    label="Avg in-sample"
                    value={signedPct(walkfwd.data.avg_in_return_pct)}
                    valueClassName={pnlTone(walkfwd.data.avg_in_return_pct)}
                  />
                  <StatCard
                    icon={ShieldCheck}
                    label="Out-of-sample (real)"
                    value={signedPct(walkfwd.data.combined_out_return_pct)}
                    valueClassName={pnlTone(walkfwd.data.combined_out_return_pct)}
                  />
                  <StatCard
                    icon={Trophy}
                    label="Profitable windows"
                    value={`${walkfwd.data.profitable_folds}/${walkfwd.data.total_folds}`}
                  />
                </div>

                <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Picked on training</th>
                        <th className="px-3 py-2 text-right font-medium">In-sample</th>
                        <th className="px-3 py-2 text-right font-medium">Out-of-sample</th>
                        <th className="px-3 py-2 text-right font-medium">Drawdown</th>
                        <th className="px-3 py-2 text-right font-medium">Trades</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {walkfwd.data.folds.map((f) => (
                        <tr key={f.n} className="hover:bg-white/[0.02]">
                          <td className="px-3 py-2 text-slate-500">{f.n}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-400">{f.summary}</td>
                          <td className={`px-3 py-2 text-right ${pnlTone(f.in_return_pct)}`}>
                            {signedPct(f.in_return_pct)}
                          </td>
                          <td className={`px-3 py-2 text-right font-semibold ${pnlTone(f.out_return_pct)}`}>
                            {signedPct(f.out_return_pct)}
                          </td>
                          <td className="px-3 py-2 text-right text-rose-400">{pct(f.out_drawdown_pct)}</td>
                          <td className="px-3 py-2 text-right text-slate-400">{f.out_trades}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <p className="text-xs text-slate-500">
              Каждое окно: параметры подбираются на «обучении», затем проверяются на следующем, невиданном
              отрезке. «Out-of-sample (real)» — реалистичный результат; большой разрыв с in-sample = переподгонка.
            </p>
          </div>
        </Card>
      )}

      {aiEnabled && (
        <Card className="mt-6 p-0">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-200">
            <MessageSquare className="h-4 w-4 text-brand-400" /> Ask AI
            <span className="ml-auto text-xs font-normal text-slate-500">about this strategy</span>
          </div>
          <div className="p-5">
            <div ref={chatBoxRef} className="max-h-[420px] space-y-3 overflow-y-auto">
              {chat.length === 0 && (
                <p className="text-sm text-slate-500">
                  Задай вопрос или попроси словами что-то изменить — например «сделай стоп уже и торгуй
                  реже» или «почему так много стоп-лоссов?». ИИ ответит и, если нужно, пришлёт изменённую
                  стратегию.
                </p>
              )}
              {chat.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="ml-auto max-w-[85%] rounded-2xl bg-brand-600/20 px-3 py-2 text-sm text-slate-100">
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="mr-auto max-w-[92%] space-y-2">
                    <div className="rounded-2xl bg-white/[0.04] px-3 py-2 text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">
                      {m.content}
                    </div>
                    {m.proposed_config && (
                      <div className="rounded-xl border border-brand-500/20 bg-brand-500/[0.04] p-3">
                        <div className="text-xs font-semibold text-brand-300">
                          Обновлённая стратегия · доходность{" "}
                          <span className={pnlTone(m.proposed_return_pct ?? 0)}>
                            {signedPct(m.proposed_return_pct ?? 0)}
                          </span>{" "}
                          <span className="text-slate-500">
                            (было {signedPct(m.original_return_pct ?? 0)})
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          Просадка {pct(m.proposed_drawdown_pct ?? 0)} · Винрейт {pct(m.proposed_win_rate ?? 0)} ·{" "}
                          {m.proposed_trades ?? 0} сделок
                        </div>
                        {m.proposed_changes && (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{m.proposed_changes}</p>
                        )}
                        <Button
                          className="mt-3"
                          size="sm"
                          onClick={() => saveChat.mutate(m.proposed_config!)}
                          loading={saveChat.isPending}
                        >
                          <Save className="h-3.5 w-3.5" /> Save as new strategy
                        </Button>
                      </div>
                    )}
                  </div>
                )
              )}
              {ask.isPending && (
                <div className="mr-auto flex items-center gap-2 rounded-2xl bg-white/[0.04] px-3 py-2 text-sm text-slate-400">
                  <Spinner /> Думаю…
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="input flex-1"
                placeholder={strategyId ? "Спроси или попроси изменить…" : "Сначала выбери стратегию"}
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendAsk();
                  }
                }}
                disabled={!strategyId || ask.isPending}
              />
              <Button onClick={sendAsk} loading={ask.isPending} disabled={!strategyId || !askText.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              ИИ работает только с этой стратегией. Изменения проверяются и сразу бэктестятся на том же
              периоде — но прошлые результаты не гарантируют будущих. Сохрани и протестируй в paper-режиме.
            </p>
          </div>
        </Card>
      )}

      {aiPending && (
        <Card className="mt-6 flex items-center justify-center gap-3 p-12 text-slate-400">
          <Spinner /> AI trying strategy {aiAttempt}…
        </Card>
      )}

      {aiData && !aiPending && (
        <Card className="mt-6 p-0">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-200">
            <Sparkles className="h-4 w-4 text-brand-400" /> AI analysis
          </div>
          <div className="space-y-4 p-5">
            {/* Verdict */}
            <div
              className={`rounded-xl border p-3 text-sm font-medium ${
                aiData.rating === "good"
                  ? "border-brand-500/20 bg-brand-500/[0.06] text-brand-300"
                  : aiData.rating === "bad"
                    ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
                    : "border-amber-500/20 bg-amber-500/[0.06] text-amber-200"
              }`}
            >
              {aiData.verdict || "—"}
            </div>

            {/* Assessment */}
            {aiData.assessment && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{aiData.assessment}</p>
            )}

            {/* Summary line */}
            {aiData.attempts.length > 0 && (
              <div
                className={`rounded-xl border p-3 text-sm ${
                  aiData.improved
                    ? "border-brand-500/20 bg-brand-500/[0.04] text-brand-300"
                    : "border-slate-700/50 bg-slate-800/30 text-slate-400"
                }`}
              >
                {aiData.improved
                  ? `Version #${aiData.best_n} is the strongest — ${signedPct(aiData.best_return_pct ?? 0)} vs ${signedPct(
                      aiData.original_return_pct
                    )} for the original. Save any version below to backtest or run it.`
                  : `None of the 3 versions beat the original (${signedPct(
                      aiData.original_return_pct
                    )}) on this period. You can still save any to test on another window.`}
              </div>
            )}

            {/* Per-version cards — metrics, what changed, and a Save button each.
               Full-width so the Save action is always visible on a phone (a wide
               table pushed it off-screen). */}
            {aiData.attempts.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  AI versions · original {signedPct(aiData.original_return_pct)} / drawdown{" "}
                  {pct(aiData.original_drawdown_pct)}
                </div>
                {aiData.attempts.map((a) => {
                  const isWinner = aiData!.improved && a.n === aiData!.best_n;
                  return (
                    <div
                      key={a.n}
                      className={`rounded-xl border p-3 ${
                        isWinner
                          ? "border-brand-500/30 bg-brand-500/[0.05]"
                          : "border-white/[0.08] bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-200">
                          {isWinner ? "✓ " : ""}Version #{a.n}
                          {isWinner && <span className="ml-1.5 text-xs font-normal text-brand-400">recommended</span>}
                        </div>
                        <span className={`text-sm font-semibold ${pnlTone(a.total_return_pct)}`}>
                          {signedPct(a.total_return_pct)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Drawdown {pct(a.max_drawdown_pct)} · Win {pct(a.win_rate)} · {a.trades} trades
                      </div>
                      {a.proposed_changes && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{a.proposed_changes}</p>
                      )}
                      {a.config && (
                        <Button
                          className="mt-3 w-full sm:w-auto"
                          size="sm"
                          variant={isWinner ? "primary" : "secondary"}
                          onClick={() => saveAi.mutate({ config: a.config!, n: a.n })}
                          disabled={saveAi.isPending}
                        >
                          <Save className="h-3.5 w-3.5" /> Save version #{a.n}
                        </Button>
                      )}
                    </div>
                  );
                })}
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
                      <td className="px-4 py-2.5 text-slate-300">
                        {describeEntry(r.config)}
                        {describeFilters(r.config) && (
                          <span className="ml-1 text-xs text-violet-300">+ {describeFilters(r.config)}</span>
                        )}
                      </td>
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
