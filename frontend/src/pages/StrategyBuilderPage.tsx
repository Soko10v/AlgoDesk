import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { Crosshair, LogIn, LogOut, Pencil, Plus, Save, Shield, Target, Trash2 } from "lucide-react";
import {
  createStrategy,
  deleteStrategy,
  listStrategies,
  updateStrategy,
  type Strategy,
  type StrategyConfig,
} from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Toggle } from "../components/ui";
import { SYMBOLS, TIMEFRAMES, defaultConfig, describeEntry, describeExit } from "../lib/strategy";

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

  const setEntry = (patch: Partial<{ fast: number; slow: number }>) =>
    setCfg((c) => ({ ...c, entry: [{ ...c.entry[0], ...patch }] }));
  const setExit = (patch: Partial<{ op: ">" | "<"; value: number }>) =>
    setCfg((c) => ({ ...c, exit: [{ ...c.exit[0], ...patch }] }));

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
    setCfg({ ...defaultConfig(), ...s.config_json });
    setLiveEnabled(s.live_enabled);
    setEditingId(s.id);
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

            <Field label="Position size (% of balance)">
              <Input
                type="number"
                min={1}
                max={100}
                value={cfg.position_size_pct}
                onChange={(e) => setCfg((c) => ({ ...c, position_size_pct: Number(e.target.value) }))}
              />
            </Field>

            <Block icon={LogIn} title="Entry — MA cross" tone="text-brand-300">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fast MA">
                  <Input
                    type="number"
                    min={1}
                    value={cfg.entry[0].fast}
                    onChange={(e) => setEntry({ fast: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Slow MA">
                  <Input
                    type="number"
                    min={1}
                    value={cfg.entry[0].slow}
                    onChange={(e) => setEntry({ slow: Number(e.target.value) })}
                  />
                </Field>
              </div>
            </Block>

            <Block icon={LogOut} title="Exit — RSI" tone="text-sky-300">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Condition">
                  <Select value={cfg.exit[0].op} onChange={(e) => setExit({ op: e.target.value as ">" | "<" })}>
                    <option value=">">RSI above</option>
                    <option value="<">RSI below</option>
                  </Select>
                </Field>
                <Field label="Value">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={cfg.exit[0].value}
                    onChange={(e) => setExit({ value: Number(e.target.value) })}
                  />
                </Field>
              </div>
            </Block>

            <div className="grid grid-cols-2 gap-3">
              <Block icon={Shield} title="Stop loss" tone="text-rose-300">
                <Field label="Percent">
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cfg.stop_loss.value}
                    onChange={(e) => setCfg((c) => ({ ...c, stop_loss: { type: "pct", value: Number(e.target.value) } }))}
                  />
                </Field>
              </Block>
              <Block icon={Target} title="Take profit" tone="text-amber-300">
                <Field label="Percent">
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cfg.take_profit.value}
                    onChange={(e) =>
                      setCfg((c) => ({ ...c, take_profit: { type: "pct", value: Number(e.target.value) } }))
                    }
                  />
                </Field>
              </Block>
            </div>

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
                  <div className="truncate font-medium text-slate-100">{s.name}</div>
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

function buildGraph(cfg: StrategyConfig): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: "source",
      position: { x: 0, y: 170 },
      data: { label: `${cfg.symbol} · ${cfg.timeframe} · ${cfg.position_size_pct}%` },
      style: accentNode("rgba(148,163,184,0.4)"),
      sourcePosition: "right" as never,
      targetPosition: "left" as never,
    },
    {
      id: "entry",
      position: { x: 260, y: 170 },
      data: { label: `Entry · ${describeEntry(cfg)}` },
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

  return { nodes, edges };
}
