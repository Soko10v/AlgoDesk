import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { Anchor, ArrowDownUp, Crosshair, LogIn, LogOut, Pencil, Plus, Save, Shield, Sparkles, Target, Trash2, Umbrella, Zap } from "lucide-react";
import {
  createStrategy,
  deleteStrategy,
  getMinOrder,
  listStrategies,
  updateStrategy,
  type Direction,
  type EntryRule,
  type EntryType,
  type HedgeConfig,
  type HedgeMode,
  type Market,
  type Strategy,
  type StrategyConfig,
} from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, Field, Input, NumberField, PageHeader, Select, Toggle } from "../components/ui";
import { cn } from "../lib/cn";
import {
  ENTRY_TYPES,
  MAX_LEVERAGE,
  SYMBOLS,
  TIMEFRAMES,
  defaultConfig,
  defaultEntry,
  defaultHedge,
  describeEntry,
  describeExit,
  describeHedge,
  describeSize,
  isBidirectional,
  isFutures,
  normalizeConfig,
  positionUsdt,
  presets,
  type Preset,
} from "../lib/strategy";

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

export function StrategyBuilderPage() {
  const qc = useQueryClient();
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: listStrategies });
  const [searchParams, setSearchParams] = useSearchParams();

  const [name, setName] = useState("My Strategy");
  const [cfg, setCfg] = useState<StrategyConfig>(defaultConfig());
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

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
    const target = strategies.data.find((s) => s.id === editId);
    if (target) {
      loadStrategy(target);
      setSearchParams({}, { replace: true }); // clean up URL
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, strategies.data]);

  const setEntry = (patch: Partial<EntryRule>) =>
    setCfg((c) => ({ ...c, entry: [{ ...c.entry[0], ...patch }] }));
  const setEntryType = (type: EntryType) => setCfg((c) => ({ ...c, entry: [defaultEntry(type)] }));
  const setExit = (patch: Partial<{ op: ">" | "<"; value: number }>) =>
    setCfg((c) => ({ ...c, exit: [{ ...c.exit[0], ...patch }] }));
  const setHedge = (patch: Partial<HedgeConfig>) =>
    setCfg((c) => ({ ...c, hedge: { ...defaultHedge(), ...c.hedge, ...patch } }));
  const setMarket = (market: Market) =>
    setCfg((c) => ({ ...c, market, leverage: c.leverage ?? 3, hedge: { ...defaultHedge(), ...c.hedge } }));
  const setDirection = (direction: Direction) => setCfg((c) => ({ ...c, direction }));

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), config_json: cfg, live_enabled: liveEnabled };
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
    setLiveEnabled(false);
    setEditingId(null);
  }

  function loadStrategy(s: Strategy) {
    setName(s.name);
    setCfg(normalizeConfig(s.config_json));
    setLiveEnabled(s.live_enabled);
    setEditingId(s.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function loadPreset(p: Preset) {
    setName(p.name);
    setCfg(normalizeConfig(p.config));
    setLiveEnabled(false);
    setEditingId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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

      <Card className="mb-6 animate-slide-up p-4">
        <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Sparkles className="h-4 w-4 text-brand-400" /> Quick start — presets
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {presets().map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => loadPreset(p)}
              className="w-48 shrink-0 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-left transition hover:border-brand-500/40 hover:bg-brand-500/5"
            >
              <div className="text-sm font-medium text-slate-200">{p.name}</div>
              <div className="mt-0.5 text-xs text-slate-500">{p.blurb}</div>
            </button>
          ))}
        </div>
      </Card>

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

          <div className="space-y-4">
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

            <Block icon={LogOut} title="Exit" tone="text-sky-300">
              {isBidirectional(cfg) ? (
                <p className="text-xs leading-relaxed text-slate-400">
                  In Long &amp; Short the position exits on the opposite entry signal
                  (the bot flips long↔short), or on Stop loss / Take profit / Trailing
                  stop below. There's no separate RSI exit in this mode — it applies to
                  Long only.
                </p>
              ) : (
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

            <Block icon={Shield} title="Daily loss limit" tone="text-rose-300">
              <Field label="Percent" hint="Pause new entries after this much realized loss in a day. 0 = off.">
                <NumberField
                  min={0}
                  value={cfg.daily_loss_limit_pct ?? 0}
                  onValueChange={(v) => setCfg((c) => ({ ...c, daily_loss_limit_pct: v }))}
                />
              </Field>
            </Block>

            {isFutures(cfg) && (
              <Block icon={Umbrella} title="Hedge — squeeze protection" tone="text-indigo-300">
                <div className="flex items-center justify-between">
                  <p className="pr-3 text-xs text-slate-500">
                    Opens a short leg to offset sudden adverse moves on the futures position.
                  </p>
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
            )}

            <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <div>
                <div className="text-sm font-medium text-slate-200">Enable live trading</div>
                <div className="text-xs text-slate-500">Required before a bot can run in live mode.</div>
              </div>
              <Toggle checked={liveEnabled} onChange={setLiveEnabled} />
            </div>

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
        {strategies.data?.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {strategies.data.map((s) => (
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
  children,
}: {
  icon: typeof Shield;
  title: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${tone}`}>
        <Icon className="h-4 w-4" /> {title}
      </div>
      {children}
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
      data: { label: `Entry · ${describeEntry(cfg)}${isBidirectional(cfg) ? " · flip L/S" : ""}` },
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
