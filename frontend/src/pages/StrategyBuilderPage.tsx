import { useMemo, useRef, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { Activity, Anchor, ArrowDownUp, Clock, Coins, Crosshair, Filter, LogIn, LogOut, Pencil, Plus, Save, Send, Shield, SlidersHorizontal, Snowflake, Sparkles, Target, Trash2, Umbrella, Wand2, X, Zap } from "lucide-react";
import {
  authConfig,
  createStrategy,
  deleteStrategy,
  getGenerateStatus,
  getMinOrder,
  listStrategies,
  startGenerate,
  updateStrategy,
  type ChatMessage,
  type Direction,
  type EntryRule,
  type EntryType,
  type FilterSide,
  type FilterType,
  type GeneratedBot,
  type HedgeConfig,
  type HedgeMode,
  type Market,
  type Strategy,
  type StrategyConfig,
  type StrategyFilter,
} from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, Field, InfoTip, Input, NumberField, PageHeader, Select, Spinner, Toggle } from "../components/ui";
import { cn } from "../lib/cn";
import { pct, pnlTone, signedPct } from "../lib/formatters";
import { usePlan, useUpsell } from "../hooks/usePlan";
import {
  ENTRY_TYPES,
  FILTER_TYPES,
  MAX_LEVERAGE,
  SYMBOLS,
  TIMEFRAMES,
  defaultConfig,
  defaultEntry,
  defaultFilter,
  defaultHedge,
  describeEntry,
  describeExit,
  describeFilters,
  describeHedge,
  describeSize,
  isBidirectional,
  isFutures,
  normalizeConfig,
  positionUsdt,
} from "../lib/strategy";
import { isArbStrategy } from "../arbitrage/api";

const NODE_BASE = {
  color: "#e2e8f0",
  background: "#0e1626",
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 500,
  padding: "10px 12px",
  width: 188,
  textAlign: "center" as const,
};

function accentNode(border: string): React.CSSProperties {
  return { ...NODE_BASE, border: `1px solid ${border}` };
}

type BuilderTab = "setup" | "entry" | "risk" | "advanced";
const BUILDER_TABS: { id: BuilderTab; label: string; icon: typeof Shield }[] = [
  { id: "setup", label: "Setup", icon: Coins },
  { id: "entry", label: "Entry", icon: LogIn },
  { id: "risk", label: "Risk", icon: Shield },
  { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
];

export function StrategyBuilderPage() {
  const qc = useQueryClient();
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: listStrategies });
  const [searchParams, setSearchParams] = useSearchParams();

  const [name, setName] = useState("My Strategy");
  const [cfg, setCfg] = useState<StrategyConfig>(defaultConfig());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [tab, setTab] = useState<BuilderTab>("setup");

  // Minimum order size on the exchange for the chosen symbol/market. Size is
  // margin, so the minimum to enter is min_notional / leverage — warn below it.
  const minLev = isFutures(cfg) ? cfg.leverage ?? 1 : 1;
  const minOrder = useQuery({
    queryKey: ["min-order", cfg.symbol, isFutures(cfg), minLev],
    queryFn: () => getMinOrder(cfg.symbol, isFutures(cfg), minLev),
    staleTime: 60_000,
  });
  const minSize = minOrder.data?.min_size ?? 0;
  const sizeBelowMin = minSize > 0 && positionUsdt(cfg) < minSize;

  // Auto-load strategy when navigated here with ?edit=ID (e.g. from Dashboard)
  useEffect(() => {
    const editId = Number(searchParams.get("edit"));
    if (!editId || !strategies.data) return;
    const target = strategies.data.find((s) => s.id === editId && !isArbStrategy(s.config_json));
    if (target) {
      loadStrategy(target);
      setSearchParams({}, { replace: true }); // clean up URL
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, strategies.data]);

  const setEntry = (patch: Partial<EntryRule>) =>
    setCfg((c) => ({ ...c, entry: [{ ...c.entry[0], ...patch }] }));
  const setEntryType = (type: EntryType) => setCfg((c) => ({ ...c, entry: [defaultEntry(type)] }));
  const addFilter = () => setCfg((c) => ({ ...c, filters: [...(c.filters ?? []), defaultFilter("trend")] }));
  const removeFilter = (i: number) =>
    setCfg((c) => ({ ...c, filters: (c.filters ?? []).filter((_, idx) => idx !== i) }));
  const changeFilterType = (i: number, type: FilterType) =>
    setCfg((c) => ({
      ...c,
      // Keep the chosen side when swapping the filter's indicator type.
      filters: (c.filters ?? []).map((f, idx) =>
        idx === i ? ({ ...defaultFilter(type), ...(f.side ? { side: f.side } : {}) } as StrategyFilter) : f
      ),
    }));
  const patchFilter = (i: number, patch: FilterPatch) =>
    setCfg((c) => ({
      ...c,
      filters: (c.filters ?? []).map((f, idx) => (idx === i ? ({ ...f, ...patch } as StrategyFilter) : f)),
    }));
  const setExit = (patch: Partial<{ op: ">" | "<"; value: number }>) =>
    setCfg((c) => ({ ...c, exit: [{ ...c.exit[0], ...patch }] }));
  const setHedge = (patch: Partial<HedgeConfig>) =>
    setCfg((c) => ({ ...c, hedge: { ...defaultHedge(), ...c.hedge, ...patch } }));
  const setMarket = (market: Market) =>
    setCfg((c) => ({
      ...c,
      market,
      leverage: c.leverage ?? 3,
      hedge: { ...defaultHedge(), ...c.hedge },
      // Reverse needs shorting; spot can't, so drop it when leaving futures.
      reverse: market === "futures" ? c.reverse : false,
    }));
  const setDirection = (direction: Direction) => setCfg((c) => ({ ...c, direction }));

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), config_json: cfg };
      return editingId ? updateStrategy(editingId, payload) : createStrategy(payload);
    },
    onSuccess: (s) => {
      toast.success(editingId ? "Strategy updated" : "Strategy created", s.name);
      qc.invalidateQueries({ queryKey: ["strategies"] });
      setEditingId(s.id);
    },
    onError: () => toast.error("Could not save strategy", "Check the fields and try again."),
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteStrategy(id),
    onSuccess: (_d, id) => {
      toast.info("Strategy deleted");
      qc.invalidateQueries({ queryKey: ["strategies"] });
      if (id === editingId) resetForm();
    },
    onError: () => toast.error("Delete failed"),
  });

  function resetForm() {
    setName("My Strategy");
    setCfg(defaultConfig());
    setEditingId(null);
  }

  function loadStrategy(s: Strategy) {
    setName(s.name);
    setCfg(normalizeConfig(s.config_json));
    setEditingId(s.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function loadGenerated(bot: GeneratedBot) {
    setName(bot.name);
    setCfg(normalizeConfig(bot.config));
    setEditingId(null);
    setTab("setup");
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.info("Loaded into builder", "Review the blocks and save it.");
  }

  // ---- AI bot generator (chat → 3 distinct bots, each backtested) ----
  const cfgQuery = useQuery({ queryKey: ["auth-config"], queryFn: authConfig, staleTime: Infinity });
  const aiEnabled = cfgQuery.data?.ai_enabled ?? false;
  const { can, requiredPlan } = usePlan();
  const upsell = useUpsell();
  type GenItem =
    | { role: "user"; content: string }
    | { role: "assistant"; answer: string; symbol: string; timeframe: string; bots: GeneratedBot[] };
  const [genChat, setGenChat] = useState<GenItem[]>([]);
  const [genText, setGenText] = useState("");
  const [genJobId, setGenJobId] = useState<string | null>(null);
  const genBoxRef = useRef<HTMLDivElement | null>(null);

  const startGen = useMutation({
    mutationFn: (history: ChatMessage[]) => startGenerate(history),
    onSuccess: (d) => setGenJobId(d.job_id),
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("AI failed", detail);
      setGenChat((prev) => prev.slice(0, -1));
    },
  });
  const genStatus = useQuery({
    queryKey: ["gen-status", genJobId],
    queryFn: () => getGenerateStatus(genJobId as string),
    enabled: !!genJobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "done" || s === "error" ? false : 2000;
    },
  });
  useEffect(() => {
    const st = genStatus.data;
    if (!st) return;
    if (st.status === "done" && st.result) {
      const r = st.result;
      setGenChat((prev) => [
        ...prev,
        { role: "assistant", answer: r.answer, symbol: r.symbol, timeframe: r.timeframe, bots: r.bots },
      ]);
      setGenJobId(null);
    } else if (st.status === "error") {
      toast.error("AI failed", st.error || undefined);
      setGenJobId(null);
    }
  }, [genStatus.data?.status]);
  const genPending =
    startGen.isPending || (!!genJobId && genStatus.data?.status !== "done" && genStatus.data?.status !== "error");

  function sendGen() {
    const text = genText.trim();
    if (!text || genPending) return;
    if (!can("ai")) {
      upsell(requiredPlan("ai"), "AI-сборщик ботов");
      return;
    }
    const next: GenItem[] = [...genChat, { role: "user", content: text }];
    setGenChat(next);
    setGenText("");
    const history: ChatMessage[] = next.map((m) =>
      m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.answer }
    );
    startGen.mutate(history);
  }
  // Scroll only the chat box to the latest message — never the whole page.
  useEffect(() => {
    const el = genBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [genChat, genPending]);

  const { nodes, edges } = useMemo(() => buildGraph(cfg), [cfg]);
  const canSave = name.trim().length >= 2;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Strategy Builder"
        description="Compose your trading logic from blocks and preview the pipeline."
        actions={
          editingId !== null ? (
            <Button variant="ghost" onClick={resetForm}>
              <Plus className="h-4 w-4" /> New
            </Button>
          ) : undefined
        }
      />

      {aiEnabled && (
        <Card className="mb-6 animate-slide-up p-0">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-200">
            <Sparkles className="h-4 w-4 text-brand-400" /> AI bot builder
            <InfoTip text="ИИ подбирает по описанию, бэктест на прошлых данных не гарантирует будущих результатов — сохрани бота и протестируй в paper-режиме." />
            <span className="ml-auto text-xs font-normal text-slate-500">
              {can("ai") ? "describe it → get 3 backtested bots" : "🔒 на тарифе Expert"}
            </span>
          </div>
          <div className="p-5">
            <div ref={genBoxRef} className="max-h-[460px] space-y-4 overflow-y-auto">
              {genChat.length === 0 && (
                <p className="text-sm text-slate-500">
                  Опиши какого бота хочешь — например «консервативный бот на эфире для долгосрока» или
                  «агрессивный скальпер по биткоину». ИИ соберёт <b className="text-slate-300">3 разных по сути</b>{" "}
                  стратегии и сразу прогонит каждую на последних 2000 свечах. Можно дорабатывать словами.
                </p>
              )}
              {genChat.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="ml-auto max-w-[85%] rounded-2xl bg-brand-600/20 px-3 py-2 text-sm text-slate-100">
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="space-y-3">
                    {m.answer && (
                      <div className="rounded-2xl bg-white/[0.04] px-3 py-2 text-sm leading-relaxed text-slate-200">
                        {m.answer}
                        {m.symbol && (
                          <span className="text-slate-500">
                            {" "}
                            · {m.symbol} · {m.timeframe}
                          </span>
                        )}
                      </div>
                    )}
                    {m.bots.length === 0 ? (
                      <p className="text-sm text-slate-500">Не получилось собрать ботов — переформулируй запрос.</p>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-3">
                        {m.bots.map((b, bi) => (
                          <div
                            key={bi}
                            className="flex flex-col rounded-xl border border-white/[0.08] bg-white/[0.02] p-3"
                          >
                            <div className="text-sm font-semibold text-slate-100">{b.name}</div>
                            {b.approach && (
                              <div className="mt-0.5 text-xs text-violet-300">{b.approach}</div>
                            )}
                            <div className="mt-1 text-xs text-slate-500">
                              {describeEntry(b.config)}
                              {describeFilters(b.config) ? ` · ${describeFilters(b.config)}` : ""}
                            </div>
                            <div className="mt-2 flex items-baseline justify-between">
                              <span className="text-xs text-slate-500">Return</span>
                              <span className={`text-sm font-semibold ${pnlTone(b.total_return_pct)}`}>
                                {signedPct(b.total_return_pct)}
                              </span>
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              DD {pct(b.max_drawdown_pct)} · Win {pct(b.win_rate)} · {b.trades} trades
                            </div>
                            <Button className="mt-3" size="sm" variant="secondary" onClick={() => loadGenerated(b)}>
                              <Wand2 className="h-3.5 w-3.5" /> Use this bot
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              )}
              {genPending && (
                <div className="flex items-center gap-2 rounded-2xl bg-white/[0.04] px-3 py-2 text-sm text-slate-400">
                  <Spinner /> Собираю и тестирую трёх ботов…
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="input flex-1"
                placeholder="Опиши бота, которого хочешь…"
                value={genText}
                onChange={(e) => setGenText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendGen();
                  }
                }}
                disabled={genPending}
              />
              <Button onClick={sendGen} loading={genPending} disabled={!genText.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Form */}
        <Card className="animate-slide-up p-5 lg:col-span-2">
          {editingId !== null && (
            <div className="mb-4">
              <Badge tone="violet">
                <Pencil className="h-3 w-3" /> Editing #{editingId}
              </Badge>
            </div>
          )}

          {/* Tabs keep the form from becoming one endless column of inputs. */}
          <div className="mb-5 flex gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
            {BUILDER_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition",
                  tab === t.id
                    ? "bg-brand-500/15 text-brand-200 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {tab === "setup" && (
              <>
                <Field label="Strategy name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BTC momentum" />
                </Field>

                <Field label="Bot type">
                  <div className="grid grid-cols-2 gap-2">
                    {(["spot", "futures"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMarket(m)}
                        className={cn(
                          "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition",
                          cfg.market === m
                            ? "border-brand-500/60 bg-brand-500/10 text-brand-200"
                            : "border-white/[0.06] bg-white/[0.02] text-slate-400 hover:text-slate-200"
                        )}
                      >
                        {m === "futures" && <Zap className="h-3.5 w-3.5" />}
                        {m === "spot" ? "Spot" : "Futures"}
                      </button>
                    ))}
                  </div>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Symbol">
                    <Select value={cfg.symbol} onChange={(e) => setCfg((c) => ({ ...c, symbol: e.target.value }))}>
                      {SYMBOLS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Timeframe">
                    <Select value={cfg.timeframe} onChange={(e) => setCfg((c) => ({ ...c, timeframe: e.target.value }))}>
                      {TIMEFRAMES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div className={cn("grid gap-3", isFutures(cfg) ? "grid-cols-2" : "grid-cols-1")}>
                  <Field label="Position size ($)">
                    <NumberField
                      min={1}
                      value={positionUsdt(cfg)}
                      onValueChange={(v) => setCfg((c) => ({ ...c, position_size_usdt: v, position_size_pct: undefined }))}
                      className={sizeBelowMin ? "border-rose-500/60 focus:ring-rose-500/40" : ""}
                    />
                    {sizeBelowMin ? (
                      <p className="mt-1 text-xs text-rose-400">
                        Below {cfg.symbol} minimum (${minSize.toFixed(2)}{minLev > 1 ? ` at ${minLev}x` : ""}) — live orders will be rejected. Raise the size.
                      </p>
                    ) : minSize > 0 ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Min size for {cfg.symbol}: ${minSize.toFixed(2)}{minLev > 1 ? ` at ${minLev}x (position ≈ $${(minSize * minLev).toFixed(0)})` : ""}
                      </p>
                    ) : null}
                  </Field>
                  {isFutures(cfg) && (
                    <Field label={`Leverage (max ${MAX_LEVERAGE}x)`}>
                      <NumberField
                        min={1}
                        max={MAX_LEVERAGE}
                        value={cfg.leverage ?? 1}
                        onValueChange={(v) => setCfg((c) => ({ ...c, leverage: v }))}
                      />
                    </Field>
                  )}
                </div>

                {isFutures(cfg) && (
                  <Field label="Trade direction" hint="Long & Short flips on the entry signal — long on the bullish signal, short on the bearish one.">
                    <div className="grid grid-cols-2 gap-2">
                      {([["long", "Long only"], ["both", "Long & Short"]] as const).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setDirection(val)}
                          className={cn(
                            "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition",
                            (cfg.direction ?? "long") === val
                              ? "border-brand-500/60 bg-brand-500/10 text-brand-200"
                              : "border-white/[0.06] bg-white/[0.02] text-slate-400 hover:text-slate-200"
                          )}
                        >
                          {val === "both" && <ArrowDownUp className="h-3.5 w-3.5" />}
                          {label}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}
              </>
            )}

            {tab === "entry" && (
              <>
                <Block icon={LogIn} title="Entry signal" tone="text-brand-300">
                  <Field label="Indicator">
                    <Select value={cfg.entry[0].type} onChange={(e) => setEntryType(e.target.value as EntryType)}>
                      {ENTRY_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="mt-3">
                    <EntryParams rule={cfg.entry[0]} set={setEntry} />
                  </div>
                </Block>

                <Block
                  icon={Filter}
                  title="Entry filters (optional)"
                  tone="text-violet-300"
                  info={
                    <>
                      Extra conditions that must hold to open a trade. The entry signal picks the side; a filter
                      can veto it — e.g. only go long above the 200 EMA, only trade when ADX shows a real trend,
                      or require a volume spike.
                      {isBidirectional(cfg) && (
                        <>
                          {" "}In Long &amp; Short, each filter can apply to longs only, shorts only, or both — so
                          the bot can long in an uptrend and short in a downtrend instead of sitting out.
                        </>
                      )}
                    </>
                  }
                >
                  <div className="space-y-2.5">
                    {(cfg.filters ?? []).map((f, i) => (
                      <FilterRow
                        key={i}
                        filter={f}
                        allowSide={isBidirectional(cfg)}
                        onType={(t) => changeFilterType(i, t)}
                        onPatch={(p) => patchFilter(i, p)}
                        onRemove={() => removeFilter(i)}
                      />
                    ))}
                  </div>
                  <Button className="mt-3" size="sm" variant="ghost" onClick={addFilter}>
                    <Plus className="h-3.5 w-3.5" /> Add filter
                  </Button>
                </Block>
              </>
            )}

            {tab === "risk" && (
              <>
                <Block
                  icon={LogOut}
                  title="Exit signal"
                  tone="text-sky-300"
                  info={
                    isBidirectional(cfg)
                      ? "In Long & Short the position exits on the opposite entry signal (the bot flips long↔short), or on Stop loss / Take profit / Trailing stop. There's no separate RSI exit in this mode — it applies to Long only."
                      : undefined
                  }
                >
                  {isBidirectional(cfg) ? (
                    <p className="text-xs text-slate-500">Flips on the opposite signal, or exits via SL / TP / Trailing stop.</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Condition">
                          <Select value={cfg.exit[0].op} onChange={(e) => setExit({ op: e.target.value as ">" | "<" })}>
                            <option value=">">RSI above</option>
                            <option value="<">RSI below</option>
                          </Select>
                        </Field>
                        <Field label="Value">
                          <NumberField
                            min={0}
                            max={100}
                            value={cfg.exit[0].value}
                            onValueChange={(v) => setExit({ value: v })}
                          />
                        </Field>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-sm text-slate-300">
                          Exit on opposite signal{" "}
                          <InfoTip text="Close the position as soon as the entry signal turns bearish (e.g. the fast MA crosses back under the slow one) — instead of waiting for the RSI exit or the stop." />
                        </span>
                        <Toggle
                          checked={cfg.exit_on_opposite ?? false}
                          onChange={(v) => setCfg((c) => ({ ...c, exit_on_opposite: v }))}
                        />
                      </div>
                    </>
                  )}
                </Block>

                <div className="grid grid-cols-2 gap-3">
                  <Block icon={Shield} title="Stop loss" tone="text-rose-300">
                    <Field label="Percent">
                      <NumberField
                        min={0}
                        value={cfg.stop_loss.value}
                        onValueChange={(v) => setCfg((c) => ({ ...c, stop_loss: { type: "pct", value: v } }))}
                      />
                    </Field>
                  </Block>
                  <Block icon={Target} title="Take profit" tone="text-amber-300">
                    <Field label="Percent">
                      <NumberField
                        min={0}
                        value={cfg.take_profit.value}
                        onValueChange={(v) => setCfg((c) => ({ ...c, take_profit: { type: "pct", value: v } }))}
                      />
                    </Field>
                  </Block>
                </div>

                <Block icon={Anchor} title="Trailing stop" tone="text-emerald-300">
                  <Field label="Percent" hint="Locks in profit by trailing the peak. 0 = off.">
                    <NumberField
                      min={0}
                      value={cfg.trailing_stop?.value ?? 0}
                      onValueChange={(v) => setCfg((c) => ({ ...c, trailing_stop: { type: "pct", value: v } }))}
                    />
                  </Field>
                </Block>

                <Block icon={Target} title="Break-even stop" tone="text-lime-300">
                  <Field
                    label="Arm after +% (0 = off)"
                    hint="Once price moves this % in your favour, the stop tightens to the entry price — a winner can no longer turn into a loser."
                  >
                    <NumberField
                      min={0}
                      value={cfg.break_even_pct ?? 0}
                      onValueChange={(v) => setCfg((c) => ({ ...c, break_even_pct: v }))}
                    />
                  </Field>
                </Block>

                <div className="grid grid-cols-2 gap-3">
                  <Block icon={Snowflake} title="Cooldown after stop" tone="text-sky-300">
                    <Field
                      label="Bars (0 = off)"
                      hint="Pause entries for N bars after a stop-out, so the bot doesn't re-enter the same chop immediately."
                    >
                      <NumberField
                        min={0}
                        value={cfg.cooldown_bars ?? 0}
                        onValueChange={(v) => setCfg((c) => ({ ...c, cooldown_bars: Math.round(v) }))}
                      />
                    </Field>
                  </Block>
                  <Block icon={Clock} title="Time exit" tone="text-violet-300">
                    <Field
                      label="Bars (0 = off)"
                      hint="Force-close the position after N bars, win or lose — for strategies whose edge decays with time."
                    >
                      <NumberField
                        min={0}
                        value={cfg.time_exit_bars ?? 0}
                        onValueChange={(v) => setCfg((c) => ({ ...c, time_exit_bars: Math.round(v) }))}
                      />
                    </Field>
                  </Block>
                </div>

                <Block icon={Shield} title="Daily loss limit" tone="text-rose-300">
                  <Field label="Percent" hint="Pause new entries after this much realized loss in a day. 0 = off.">
                    <NumberField
                      min={0}
                      value={cfg.daily_loss_limit_pct ?? 0}
                      onValueChange={(v) => setCfg((c) => ({ ...c, daily_loss_limit_pct: v }))}
                    />
                  </Field>
                </Block>

                <Block icon={Activity} title="Volatility sizing" tone="text-cyan-300">
                  <Field
                    label="Target ATR % (0 = off)"
                    hint="Scales position size inversely to volatility — smaller in choppy/volatile periods, larger in calm ones — so risk per trade stays even. Try ~2."
                  >
                    <NumberField
                      min={0}
                      value={cfg.vol_target_pct ?? 0}
                      onValueChange={(v) => setCfg((c) => ({ ...c, vol_target_pct: v }))}
                    />
                  </Field>
                </Block>
              </>
            )}

            {tab === "advanced" && (
              <>
                {isFutures(cfg) ? (
                  <Block
                    icon={Umbrella}
                    title="Hedge — squeeze protection"
                    tone="text-indigo-300"
                    info="Opens a short leg to offset sudden adverse moves on the futures position."
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-300">Enable hedge</span>
                      <Toggle checked={cfg.hedge?.enabled ?? false} onChange={(v) => setHedge({ enabled: v })} />
                    </div>

                    {cfg.hedge?.enabled && (
                      <div className="mt-4 space-y-3">
                        <Field label="When to hedge">
                          <Select
                            value={cfg.hedge.mode}
                            onChange={(e) => setHedge({ mode: e.target.value as HedgeMode })}
                          >
                            <option value="auto_squeeze">Auto on squeeze (open on a fast drop)</option>
                            <option value="constant_partial">Constant partial (always hold a share)</option>
                          </Select>
                        </Field>

                        {cfg.hedge.mode === "auto_squeeze" ? (
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Trigger drop %" hint="Drop that opens the hedge">
                              <NumberField
                                min={0.1}
                                value={cfg.hedge.trigger_pct}
                                onValueChange={(v) => setHedge({ trigger_pct: v })}
                              />
                            </Field>
                            <Field label="Release rebound %" hint="Recovery that closes it">
                              <NumberField
                                min={0.1}
                                value={cfg.hedge.release_pct}
                                onValueChange={(v) => setHedge({ release_pct: v })}
                              />
                            </Field>
                          </div>
                        ) : (
                          <Field label="Hedge ratio (% of position)" hint="Share of the position held short at all times">
                            <NumberField
                              min={1}
                              max={100}
                              value={Math.round((cfg.hedge.ratio ?? 0) * 100)}
                              onValueChange={(v) => setHedge({ ratio: v / 100 })}
                            />
                          </Field>
                        )}
                      </div>
                    )}
                  </Block>
                ) : (
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-center text-sm text-slate-500">
                    <Umbrella className="mx-auto mb-2 h-5 w-5 text-slate-600" />
                    Hedging is a futures feature. Switch the bot type to Futures in the Setup tab to
                    enable squeeze protection.
                  </div>
                )}

                {isFutures(cfg) && (
                  <Block
                    icon={ArrowDownUp}
                    title="Reverse strategy"
                    tone="text-amber-300"
                    info="Mirror the strategy: every long becomes a short (and vice versa), and the stop-loss and take-profit swap places. Same entry, indicators and filters — useful when a strategy is consistently wrong and you'd profit doing the opposite."
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-300">Trade the mirror</span>
                      <Toggle checked={cfg.reverse ?? false} onChange={(v) => setCfg((c) => ({ ...c, reverse: v }))} />
                    </div>
                    {cfg.reverse && (
                      <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200">
                        Reversed: opens the opposite side of every signal; SL {cfg.stop_loss.value || 0}% ⇄ TP{" "}
                        {cfg.take_profit.value || 0}%.
                      </p>
                    )}
                  </Block>
                )}
              </>
            )}
          </div>

          {/* Footer: always visible regardless of the active tab. */}
          <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4">
            <Button className="w-full" onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>
              <Save className="h-4 w-4" /> {editingId ? "Update strategy" : "Save strategy"}
            </Button>
          </div>
        </Card>

        {/* Preview */}
        <div className="lg:col-span-3">
          <Card className="animate-slide-up overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3 text-sm text-slate-300">
              <Crosshair className="h-4 w-4 text-brand-400" /> Pipeline preview
            </div>
            <div className="h-[460px]">
              <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }} nodesDraggable={false}>
                <Background color="#1e293b" gap={20} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          </Card>
        </div>
      </div>

      {/* Existing strategies */}
      <div className="mt-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Saved strategies</h3>
        {strategies.data?.filter((s) => !isArbStrategy(s.config_json)).length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {strategies.data.filter((s) => !isArbStrategy(s.config_json)).map((s) => (
              <Card key={s.id} className="card-hover flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-100">{s.name}</span>
                    {isFutures(s.config_json) && (
                      <Badge tone="violet">
                        <Zap className="h-3 w-3" /> {s.config_json.leverage ?? 1}x
                      </Badge>
                    )}
                    {isBidirectional(s.config_json) && (
                      <Badge tone="success">
                        <ArrowDownUp className="h-3 w-3" /> L/S
                      </Badge>
                    )}
                    {isFutures(s.config_json) && s.config_json.hedge?.enabled && (
                      <Badge tone="info">
                        <Umbrella className="h-3 w-3" /> hedge
                      </Badge>
                    )}
                    {(s.config_json.filters?.length ?? 0) > 0 && (
                      <Badge tone="violet">
                        <Filter className="h-3 w-3" /> filter
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {s.config_json.symbol} · {describeEntry(s.config_json)} → {describeExit(s.config_json)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => loadStrategy(s)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="!px-2 text-rose-300 hover:!bg-rose-500/10"
                    onClick={() => del.mutate(s.id)}
                    disabled={del.isPending}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No strategies saved yet — build one above.</p>
        )}
      </div>
    </div>
  );
}

function Block({
  icon: Icon,
  title,
  tone,
  info,
  children,
}: {
  icon: typeof Shield;
  title: string;
  tone: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${tone}`}>
        <Icon className="h-4 w-4" /> {title}
        {info && <InfoTip text={info} className="text-slate-500" />}
      </div>
      {children}
    </div>
  );
}

type FilterPatch = {
  ma?: "ema" | "sma";
  period?: number;
  min?: number;
  max?: number;
  mult?: number;
  min_pct?: number;
  max_pct?: number;
  side?: FilterSide;
};

function filterHint(f: StrategyFilter): string {
  const where = f.side === "long" ? " (longs only)" : f.side === "short" ? " (shorts only)" : "";
  switch (f.type) {
    case "trend":
      // A loaded strategy can originate from the AI generator (unvalidated
      // JSON from the model), so `ma`/`period` aren't guaranteed to match.
      return `Only long above the ${String(f.ma ?? "MA").toUpperCase()} ${f.period ?? ""}, only short below it${where}.`;
    case "rsi":
      return `Skip longs when RSI ≥ ${f.max ?? "—"}, skip shorts when RSI ≤ ${f.min ?? "—"}${where}.`;
    case "volume":
      return `Enter only when this candle's volume ≥ ${f.mult}× the ${f.period}-bar average${where}.`;
    case "atr":
      return `Trade only when volatility (ATR%) is ≥ ${f.min_pct ?? 0}%${f.max_pct ? ` and ≤ ${f.max_pct}%` : ""} — skips dead markets${where}.`;
    case "adx":
      return `Trade only when ADX ≥ ${f.min} (a real trend, not chop)${where}.`;
    default:
      return "";
  }
}

function FilterRow({
  filter,
  allowSide,
  onType,
  onPatch,
  onRemove,
}: {
  filter: StrategyFilter;
  allowSide: boolean;
  onType: (t: FilterType) => void;
  onPatch: (p: FilterPatch) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-2">
        <Select value={filter.type} onChange={(e) => onType(e.target.value as FilterType)}>
          {FILTER_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
        <InfoTip text={filterHint(filter)} />
        {allowSide && (
          <Select
            value={filter.side ?? "both"}
            onChange={(e) => onPatch({ side: e.target.value as FilterSide })}
            title="Apply this filter to longs, shorts, or both"
          >
            <option value="both">Long + Short</option>
            <option value="long">Long only</option>
            <option value="short">Short only</option>
          </Select>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto !px-2 text-slate-400 hover:!bg-rose-500/10 hover:text-rose-300"
          onClick={onRemove}
          title="Remove filter"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-3">
        {filter.type === "trend" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="MA type">
              <Select value={filter.ma} onChange={(e) => onPatch({ ma: e.target.value as "ema" | "sma" })}>
                <option value="ema">EMA</option>
                <option value="sma">SMA</option>
              </Select>
            </Field>
            <Field label="Period">
              <NumberField min={2} max={400} value={filter.period} onValueChange={(v) => onPatch({ period: v })} />
            </Field>
          </div>
        )}
        {filter.type === "rsi" && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Period">
              <NumberField min={2} max={100} value={filter.period} onValueChange={(v) => onPatch({ period: v })} />
            </Field>
            <Field label="Max for long">
              <NumberField min={0} max={100} value={filter.max ?? 0} onValueChange={(v) => onPatch({ max: v })} />
            </Field>
            <Field label="Min for short">
              <NumberField min={0} max={100} value={filter.min ?? 0} onValueChange={(v) => onPatch({ min: v })} />
            </Field>
          </div>
        )}
        {filter.type === "volume" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Avg period">
              <NumberField min={2} max={200} value={filter.period} onValueChange={(v) => onPatch({ period: v })} />
            </Field>
            <Field label="× average">
              <NumberField min={1} value={filter.mult} onValueChange={(v) => onPatch({ mult: v })} />
            </Field>
          </div>
        )}
        {filter.type === "atr" && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Period">
              <NumberField min={2} max={100} value={filter.period} onValueChange={(v) => onPatch({ period: v })} />
            </Field>
            <Field label="Min %">
              <NumberField min={0} value={filter.min_pct ?? 0} onValueChange={(v) => onPatch({ min_pct: v })} />
            </Field>
            <Field label="Max % (0=off)">
              <NumberField min={0} value={filter.max_pct ?? 0} onValueChange={(v) => onPatch({ max_pct: v || undefined })} />
            </Field>
          </div>
        )}
        {filter.type === "adx" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Period">
              <NumberField min={2} max={100} value={filter.period} onValueChange={(v) => onPatch({ period: v })} />
            </Field>
            <Field label="Min ADX">
              <NumberField min={0} max={100} value={filter.min} onValueChange={(v) => onPatch({ min: v })} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function EntryParams({ rule, set }: { rule: EntryRule; set: (patch: Partial<EntryRule>) => void }) {
  const num = (label: string, key: keyof EntryRule, min = 1) => (
    <Field label={label}>
      <NumberField
        min={min}
        value={(rule[key] as number) ?? 0}
        onValueChange={(v) => set({ [key]: v } as Partial<EntryRule>)}
      />
    </Field>
  );
  switch (rule.type) {
    case "ma_cross":
    case "ema_cross":
      return <div className="grid grid-cols-2 gap-3">{num("Fast", "fast")}{num("Slow", "slow")}</div>;
    case "rsi":
      return (
        <div className="grid grid-cols-3 gap-3">
          {num("Period", "period")}
          {num("Oversold <", "low", 0)}
          {num("Overbought >", "high", 0)}
        </div>
      );
    case "breakout":
      return num("Lookback bars", "period");
    case "macd":
      return (
        <div className="grid grid-cols-3 gap-3">
          {num("Fast", "fast")}
          {num("Slow", "slow")}
          {num("Signal", "signal")}
        </div>
      );
    default:
      return null;
  }
}

function buildGraph(cfg: StrategyConfig): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: "source",
      position: { x: 0, y: 170 },
      data: {
        label: `${cfg.symbol} · ${cfg.timeframe} · ${describeSize(cfg)}${
          isFutures(cfg) ? ` · ${cfg.leverage ?? 1}x futures` : ""
        }${isBidirectional(cfg) ? " · long & short" : ""}`,
      },
      style: accentNode("rgba(148,163,184,0.4)"),
      sourcePosition: "right" as never,
      targetPosition: "left" as never,
    },
    {
      id: "entry",
      position: { x: 260, y: 170 },
      data: {
        label: `Entry · ${describeEntry(cfg)}${cfg.reverse ? " · ⇄ REVERSED" : ""}${
          isBidirectional(cfg) ? " · flip L/S" : ""
        }${describeFilters(cfg) ? ` · filter: ${describeFilters(cfg)}` : ""}`,
      },
      style: accentNode("rgba(16,185,129,0.6)"),
      sourcePosition: "right" as never,
      targetPosition: "left" as never,
    },
    {
      id: "exit",
      position: { x: 540, y: 40 },
      data: { label: `Exit · ${describeExit(cfg)}` },
      style: accentNode("rgba(56,189,248,0.6)"),
      targetPosition: "left" as never,
    },
    {
      id: "sl",
      position: { x: 540, y: 170 },
      data: { label: `Stop loss · ${cfg.stop_loss.value}%` },
      style: accentNode("rgba(244,63,94,0.6)"),
      targetPosition: "left" as never,
    },
    {
      id: "tp",
      position: { x: 540, y: 300 },
      data: { label: `Take profit · ${cfg.take_profit.value}%` },
      style: accentNode("rgba(245,158,11,0.6)"),
      targetPosition: "left" as never,
    },
  ];

  const edge = (id: string, source: string, target: string, color: string): Edge => ({
    id,
    source,
    target,
    animated: true,
    style: { stroke: color },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  });

  const edges: Edge[] = [
    edge("e0", "source", "entry", "#94a3b8"),
    edge("e1", "entry", "exit", "#38bdf8"),
    edge("e2", "entry", "sl", "#f43f5e"),
    edge("e3", "entry", "tp", "#f59e0b"),
  ];

  if (isFutures(cfg) && cfg.hedge?.enabled) {
    nodes.push({
      id: "hedge",
      position: { x: 540, y: 430 },
      data: { label: `Hedge · ${describeHedge(cfg)}` },
      style: accentNode("rgba(129,140,248,0.6)"),
      targetPosition: "left" as never,
    });
    edges.push(edge("e4", "entry", "hedge", "#818cf8"));
  }

  return { nodes, edges };
}
