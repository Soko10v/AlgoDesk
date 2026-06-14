import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  Boxes,
  Crown,
  Pencil,
  Play,
  Plug,
  Plus,
  Radio,
  Square,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  exchangeStatus,
  getSubscription,
  listStrategies,
  listTrades,
  startBot,
  stopBot,
  type Strategy,
  type Trade,
} from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, StatCard } from "../components/ui";
import { describeEntry, describeExit, isRunning } from "../lib/strategy";
import { pnlTone, price, signedPct, timeAgo } from "../lib/formatters";

export function DashboardPage() {
  const qc = useQueryClient();
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: listStrategies });
  const exchange = useQuery({ queryKey: ["exchange-status"], queryFn: exchangeStatus });
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: getSubscription });
  // Drives the live feed. useWsEvents invalidates ["trades"] on every bot event,
  // so this refetches and the feed updates in near real time — while still being
  // backfilled with history so the panel is never empty on load.
  const trades = useQuery({
    queryKey: ["trades", null],
    queryFn: () => listTrades(),
    refetchInterval: 15000,
  });

  const items = strategies.data ?? [];
  const running = items.filter((s) => isRunning(s.status)).length;
  const nameById = useMemo(() => new Map(items.map((s) => [s.id, s.name])), [items]);

  const start = useMutation({
    mutationFn: ({ id, mode }: { id: number; mode: "paper" | "live" }) => startBot(id, mode),
    onSuccess: (_d, v) => {
      toast.success("Bot started", `${v.mode} mode`);
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: () => toast.error("Could not start bot"),
  });

  const stop = useMutation({
    mutationFn: (id: number) => stopBot(id),
    onSuccess: () => {
      toast.info("Bot stopped");
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: () => toast.error("Could not stop bot"),
  });

  const pending = start.isPending || stop.isPending;
  const navigate = useNavigate();

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="Monitor your strategies and live bot activity."
        actions={
          <Link to="/builder">
            <Button>
              <Plus className="h-4 w-4" /> New strategy
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Boxes} label="Strategies" value={items.length} sub="Total configured" />
        <StatCard
          icon={Radio}
          label="Running"
          value={running}
          sub={running ? "Bots active now" : "No active bots"}
          valueClassName={running ? "text-brand-400" : undefined}
        />
        <StatCard
          icon={Plug}
          label="Exchange"
          value={exchange.data?.connected ? "Connected" : "Not linked"}
          sub={<span className="capitalize">{exchange.data?.connected ? `${exchange.data.exchange} API` : "Bybit or Binance"}</span>}
          valueClassName={exchange.data?.connected ? "text-brand-400" : "text-slate-400"}
        />
        <StatCard
          icon={Crown}
          label="Plan"
          value={<span className="capitalize">{subscription.data?.plan ?? "free"}</span>}
          sub={
            subscription.data?.free_mode
              ? "Free during launch 🎉"
              : subscription.data?.plan === "pro"
                ? "Pro features unlocked"
                : "Upgrade for more"
          }
          valueClassName={subscription.data?.plan === "pro" ? "text-amber-300" : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Your strategies</h3>
          {items.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No strategies yet"
              description="Create your first strategy in the visual builder, then backtest and deploy it."
              action={
                <Link to="/builder">
                  <Button>
                    <Plus className="h-4 w-4" /> Open builder
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {items.map((s) => (
                <StrategyRow
                  key={s.id}
                  strategy={s}
                  pending={pending}
                  onStart={(mode) => start.mutate({ id: s.id, mode })}
                  onStop={() => stop.mutate(s.id)}
                  onEdit={() => navigate(`/builder?edit=${s.id}`)}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Live activity</h3>
          <ActivityFeed trades={trades.data ?? []} nameById={nameById} loading={trades.isLoading} />
        </div>
      </div>
    </div>
  );
}

function StrategyRow({
  strategy,
  pending,
  onStart,
  onStop,
  onEdit,
}: {
  strategy: Strategy;
  pending: boolean;
  onStart: (mode: "paper" | "live") => void;
  onStop: () => void;
  onEdit: () => void;
}) {
  const running = isRunning(strategy.status);
  const cfg = strategy.config_json;

  return (
    <Card className="card-hover animate-slide-up p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-slate-100">{strategy.name}</span>
            {strategy.status === "live" ? (
              <Badge tone="success">Live</Badge>
            ) : strategy.status === "paper" ? (
              <Badge tone="info">Paper</Badge>
            ) : (
              <Badge tone="neutral">Stopped</Badge>
            )}
            {strategy.live_enabled && <Badge tone="violet">Live enabled</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span className="font-mono text-slate-300">{cfg.symbol}</span>
            <span>· {cfg.timeframe}</span>
            <span>· Size {cfg.position_size_pct}%</span>
            <span>· In: {describeEntry(cfg)}</span>
            <span>· Out: {describeExit(cfg)}</span>
            <span>· SL {cfg.stop_loss?.value}% / TP {cfg.take_profit?.value}%</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onEdit} disabled={pending} title="Edit strategy">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          {running ? (
            <Button size="sm" variant="danger" onClick={onStop} disabled={pending}>
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => onStart("paper")} disabled={pending}>
                <Play className="h-3.5 w-3.5" /> Paper
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onStart("live")}
                disabled={pending || !strategy.live_enabled}
                title={strategy.live_enabled ? "Start live trading" : "Enable live in the builder first"}
              >
                <Play className="h-3.5 w-3.5" /> Live
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function ActivityFeed({
  trades,
  nameById,
  loading,
}: {
  trades: Trade[];
  nameById: Map<number, string>;
  loading: boolean;
}) {
  const rows = trades.slice(0, 10);

  if (loading && rows.length === 0) {
    return (
      <Card className="flex h-full min-h-[200px] items-center justify-center gap-2 p-6 text-slate-500">
        <Spinner /> <span className="text-sm">Loading activity…</span>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center">
        <Activity className="h-6 w-6 text-slate-600" />
        <p className="text-sm text-slate-500">Bot events will appear here in real time.</p>
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-white/[0.05] p-0">
      {rows.map((t) => {
        // An open position is stored with pnl=null; a close carries the realized %.
        const opened = t.pnl === null || t.pnl === undefined;
        const Icon = opened ? TrendingUp : TrendingDown;
        return (
          <div key={t.id} className="flex items-center gap-3 p-3.5">
            <div
              className={
                opened
                  ? "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500/15 text-brand-300"
                  : "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-500/15 text-sky-300"
              }
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-200">
                {opened ? "Opened" : "Closed"} · {nameById.get(t.strategy_id) ?? t.symbol}
                {t.leg === "hedge" && <span className="ml-1 text-xs text-indigo-300">(hedge)</span>}
              </div>
              <div className="text-xs text-slate-500">
                {t.side.toUpperCase()} @ {price(t.price)} · {timeAgo(t.timestamp)}
              </div>
            </div>
            {!opened && (
              <span className={`text-sm font-semibold ${pnlTone(t.pnl)}`}>{signedPct(t.pnl)}</span>
            )}
          </div>
        );
      })}
    </Card>
  );
}
