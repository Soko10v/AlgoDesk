import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  Boxes,
  ChevronDown,
  Crown,
  Pencil,
  Play,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Square,
  TrendingDown,
  TrendingUp,
  Wand2,
  XCircle,
} from "lucide-react";
import {
  closePosition,
  createStrategy,
  exchangeBalance,
  exchangeStatus,
  getMinOrder,
  getSubscription,
  listDiscovered,
  listStrategies,
  listTrades,
  panicCloseAll,
  startBot,
  stopBot,
  syncPosition,
  updateStrategy,
  type DiscoveredStrategy,
  type Strategy,
  type StrategyConfig,
  type Trade,
} from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, EmptyState, Field, InfoTip, Input, NumberField, PageHeader, Spinner, StatCard } from "../components/ui";
import { describeEntry, describeExit, describeHedge, describeSize, isBidirectional, isFutures, isRunning, positionUsdt } from "../lib/strategy";
import { num, pnlTone, price, signedPct, timeAgo, usd } from "../lib/formatters";
import { usePlan, useUpsell } from "../hooks/usePlan";
import { missedEntries } from "../lib/missedProfit";
import { cn } from "../lib/cn";

export function DashboardPage() {
  const qc = useQueryClient();
  const { can, requiredPlan, trialActive, trialEndsAt } = usePlan();
  const upsell = useUpsell();
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: listStrategies });
  const exchange = useQuery({ queryKey: ["exchange-status"], queryFn: exchangeStatus });
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: getSubscription });
  const discovered = useQuery({ queryKey: ["discovered"], queryFn: listDiscovered, staleTime: 5 * 60_000 });
  const [discoveredOpen, setDiscoveredOpen] = useState(() => localStorage.getItem("algodesk_discovered_open") !== "0");
  const toggleDiscoveredOpen = () => {
    setDiscoveredOpen((v) => {
      localStorage.setItem("algodesk_discovered_open", v ? "0" : "1");
      return !v;
    });
  };
  const navigate = useNavigate();
  const strategiesRef = useRef<HTMLDivElement>(null);
  const [newStrategyId, setNewStrategyId] = useState<number | null>(null);
  const scrollToStrategies = () =>
    strategiesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const useDiscovered = useMutation({
    mutationFn: (d: DiscoveredStrategy) =>
      createStrategy({ name: `${d.title} · ${d.symbol}`, config_json: d.config_json }),
    onSuccess: (s) => {
      toast.success("Стратегия добавлена", "Она уже в списке ниже — можно протестировать или запустить.");
      qc.invalidateQueries({ queryKey: ["strategies"] });
      setNewStrategyId(s.id);
      requestAnimationFrame(scrollToStrategies);
    },
    onError: () => toast.error("Не удалось добавить стратегию", "Попробуй ещё раз."),
  });
  const balanceQuery = useQuery({
    queryKey: ["exchange-balance"],
    queryFn: exchangeBalance,
    enabled: exchange.data?.connected === true,
    staleTime: 30_000,
  });
  const availableUsdt = balanceQuery.data?.usdt ?? null;
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

  // Free-tier conversion: profitable backtests the user hasn't taken live yet.
  const missed = useMemo(() => {
    if (can("live")) return [];
    const validIds = new Set(items.map((s) => s.id));
    const liveIds = new Set(items.filter((s) => isRunning(s.status)).map((s) => s.id));
    return missedEntries(validIds, liveIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, subscription.data?.plan]);
  const missedTotal = missed.reduce((sum, e) => sum + e.profitUsd, 0);
  const missedInvested = missed.reduce((sum, e) => sum + e.investedUsd, 0);
  const missedMultiple = missedTotal / 7; // vs Pro's monthly price

  // New-signup trial: full access for 14 days, then a nudge to subscribe.
  const trialEndsAtMs = trialEndsAt ? new Date(trialEndsAt).getTime() : null;
  const trialDaysLeft = trialEndsAtMs ? Math.max(0, Math.ceil((trialEndsAtMs - Date.now()) / 86_400_000)) : 0;
  const trialJustEnded =
    !trialActive &&
    trialEndsAtMs !== null &&
    Date.now() - trialEndsAtMs < 5 * 86_400_000 &&
    subscription.data?.plan === "free";

  // Name of another LIVE bot already trading the same symbol+market, if any —
  // running two on one symbol/account merges them into one exchange position.
  const liveClashName = (s: Strategy): string | null => {
    const other = items.find(
      (o) =>
        o.id !== s.id &&
        o.status === "live" &&
        o.config_json.symbol === s.config_json.symbol &&
        isFutures(o.config_json) === isFutures(s.config_json)
    );
    return other ? other.name : null;
  };

  const start = useMutation({
    mutationFn: ({ id, mode, usdt }: { id: number; mode: "paper" | "live"; usdt?: number }) =>
      startBot(id, mode, usdt),
    onSuccess: (_d, v) => {
      toast.success("Bot started", `${v.mode} mode`);
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("Could not start bot", detail);
    },
  });

  const stop = useMutation({
    mutationFn: (id: number) => stopBot(id),
    onSuccess: () => {
      toast.info("Bot stopped");
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: () => toast.error("Could not stop bot"),
  });

  const sync = useMutation({
    mutationFn: (id: number) => syncPosition(id),
    onSuccess: (data) => {
      const msg = data.restored
        ? "Live position still open on the exchange — resumed tracking it"
        : data.closed
          ? `Cleared ${data.closed} stale open record(s)`
          : "Nothing to reconcile";
      toast.success("Position synced", msg);
      qc.invalidateQueries({ queryKey: ["trades"] });
    },
    onError: () => toast.error("Could not sync position"),
  });

  const closePos = useMutation({
    mutationFn: (id: number) => closePosition(id),
    onSuccess: (data) => {
      toast.success("Position closed", data.closed ? "Market-closed on the exchange" : "No live position to close — record cleared");
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: () => toast.error("Could not close position"),
  });

  const panic = useMutation({
    mutationFn: () => panicCloseAll(),
    onSuccess: (data) => {
      toast.success("Emergency stop done", `Stopped ${data.stopped} bot(s), closed ${data.closed} position(s)`);
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["trades"] });
    },
    onError: () => toast.error("Emergency stop failed"),
  });

  const allTrades = trades.data ?? [];
  const pending = start.isPending || stop.isPending;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="Monitor your strategies and live bot activity."
        actions={
          <>
            {running > 0 && (
              <Button
                variant="danger"
                loading={panic.isPending}
                onClick={() => {
                  if (window.confirm("Emergency stop: halt ALL running bots and market-close every live futures position. Continue?")) {
                    panic.mutate();
                  }
                }}
                title="Stop all bots and close all live positions"
              >
                <ShieldAlert className="h-4 w-4" /> Stop all
              </Button>
            )}
            <Link to="/builder">
              <Button>
                <Plus className="h-4 w-4" /> New strategy
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Boxes}
          label="Strategies"
          value={items.length}
          sub="Total configured"
          onClick={scrollToStrategies}
        />
        <StatCard
          icon={Radio}
          label="Running"
          value={running}
          sub={running ? "Bots active now" : "No active bots"}
          valueClassName={running ? "text-brand-400" : undefined}
          onClick={scrollToStrategies}
        />
        <StatCard
          icon={Plug}
          label="Exchange"
          value={exchange.data?.connected ? "Connected" : "Not linked"}
          sub={<span className="capitalize">{exchange.data?.connected ? `${exchange.data.exchange} API` : "Bybit or Binance"}</span>}
          valueClassName={exchange.data?.connected ? "text-brand-400" : "text-slate-400"}
          onClick={() => navigate("/settings")}
        />
        <StatCard
          icon={Crown}
          label="Plan"
          value={<span className="capitalize">{subscription.data?.plan ?? "free"}</span>}
          sub={
            subscription.data?.free_mode
              ? "Free during launch 🎉"
              : trialActive
                ? `Триал: ${trialDaysLeft} дн.`
                : subscription.data?.plan === "expert"
                  ? "All features unlocked"
                  : subscription.data?.plan === "pro"
                    ? "Pro features unlocked"
                    : "Upgrade for more"
          }
          valueClassName={subscription.data?.plan === "pro" ? "text-amber-300" : undefined}
          onClick={() => navigate("/subscription")}
        />
      </div>

      {trialActive && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-brand-500/30 bg-brand-500/[0.07] p-4 shadow-glow">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-300">
            <Crown className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-semibold text-slate-100">
              Пробный период: осталось {trialDaysLeft} {trialDaysLeft === 1 ? "день" : trialDaysLeft < 5 ? "дня" : "дней"}
            </div>
            <div className="text-xs text-slate-400">
              Весь функционал открыт бесплатно — включая live-торговлю и AI. Потом можно продолжить на бесплатном тарифе или оформить подписку.
            </div>
          </div>
        </div>
      )}

      {trialJustEnded && (
        <button
          type="button"
          onClick={() => navigate("/subscription")}
          className="mt-6 flex w-full items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-4 text-left shadow-glow transition hover:bg-amber-500/[0.12]"
        >
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-300">
              <Crown className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-100">Пробный период закончился</div>
              <div className="text-xs text-slate-400">
                Live-торговля и AI снова платные. Бэктесты, оптимизатор и лучшие стратегии остаются бесплатными навсегда.
              </div>
            </div>
          </div>
          <span className="hidden shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 sm:block">
            Оформить подписку
          </span>
        </button>
      )}

      {missedTotal > 0 && (
        <button
          type="button"
          onClick={() => navigate("/subscription")}
          className="mt-6 flex w-full items-center justify-between gap-3 rounded-2xl border border-brand-500/30 bg-brand-500/[0.07] p-4 text-left shadow-glow transition hover:bg-brand-500/[0.12]"
        >
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-300">
              <TrendingUp className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-100">
                С вложением {usd(missedInvested, 0)} твои стратегии заработали бы ≈{" "}
                <span className="text-lg font-bold text-brand-300">{usd(missedTotal, 0)}</span> — но они выключены.
              </div>
              <div className="text-xs text-slate-400">
                По последним бэктестам: {missed.slice(0, 3).map((e) => `${e.name} ${usd(e.profitUsd, 0)}`).join(" · ")}
                {missed.length > 3 ? ` · ещё ${missed.length - 3}` : ""}.{" "}
                {missedMultiple >= 1.5
                  ? `Это в ${missedMultiple.toFixed(1)}× больше цены Pro ($7/мес).`
                  : "Запусти их вживую — Pro $7/мес."}{" "}
                →
              </div>
            </div>
          </div>
          <span className="hidden shrink-0 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-ink-950 sm:block">
            Включить ботов
          </span>
        </button>
      )}

      {/* Auto-discovered "best strategies" board — the beginner on-ramp. */}
      {(discovered.data?.length ?? 0) > 0 && (
        <div className="mt-8">
          <div
            role="button"
            tabIndex={0}
            onClick={toggleDiscoveredOpen}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleDiscoveredOpen();
              }
            }}
            className="mb-3 flex w-full cursor-pointer items-center gap-2 text-left"
            aria-expanded={discoveredOpen}
          >
            <ChevronDown className={cn("h-4 w-4 text-slate-500 transition-transform", discoveredOpen && "rotate-180")} />
            <Sparkles className="h-4 w-4 text-brand-400" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Лучшие стратегии
            </h3>
            <InfoTip text="Сервер сам перебирает тысячи вариантов на реальных данных за последний месяц и раз в пару дней обновляет топ. Не нужно разбираться в индикаторах — выбери, протестируй и запусти. Прошлые результаты не гарантируют будущих." />
            <span className="ml-auto text-xs text-slate-500">обновляется автоматически</span>
          </div>
          {discoveredOpen && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {discovered.data!.map((d) => (
                  <Card key={d.id} className="flex flex-col p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-100">{d.title}</span>
                      <Badge tone="neutral">{d.symbol.replace("/USDT", "")} · {d.timeframe}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{d.subtitle}</div>
                    <div className="mt-3 flex items-baseline justify-between">
                      <span className="text-xs text-slate-500">За {d.period_days} дн.</span>
                      <span className={`text-lg font-bold ${pnlTone(d.total_return_pct)}`}>
                        {signedPct(d.total_return_pct)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      Просадка {d.max_drawdown_pct.toFixed(1)}% · Винрейт {d.win_rate.toFixed(0)}% · {d.trades} сделок
                    </div>
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="secondary"
                      loading={useDiscovered.isPending && useDiscovered.variables?.id === d.id}
                      onClick={() => useDiscovered.mutate(d)}
                    >
                      <Wand2 className="h-3.5 w-3.5" /> Использовать
                    </Button>
                  </Card>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Доходность посчитана на истории — это не обещание прибыли. Сначала прогони в paper-режиме.
              </p>
            </>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 scroll-mt-6" ref={strategiesRef}>
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
                  availableUsdt={availableUsdt}
                  trades={allTrades}
                  syncing={sync.isPending && sync.variables === s.id}
                  closing={closePos.isPending && closePos.variables === s.id}
                  liveClash={liveClashName(s)}
                  defaultExpanded={s.id === newStrategyId}
                  onStart={(mode, usdt) =>
                    can(mode)
                      ? start.mutate({ id: s.id, mode, usdt })
                      : upsell(requiredPlan(mode), mode === "live" ? "Live-торговля" : "Paper-режим")
                  }
                  onStop={() => stop.mutate(s.id)}
                  onEdit={() => navigate(`/builder?edit=${s.id}`)}
                  onSync={() => sync.mutate(s.id)}
                  onClose={() => closePos.mutate(s.id)}
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
  availableUsdt,
  trades,
  syncing,
  closing,
  liveClash,
  defaultExpanded,
  onStart,
  onStop,
  onEdit,
  onSync,
  onClose,
}: {
  strategy: Strategy;
  pending: boolean;
  availableUsdt: number | null;
  trades: Trade[];
  syncing: boolean;
  closing: boolean;
  liveClash: string | null;
  defaultExpanded?: boolean;
  onStart: (mode: "paper" | "live", usdt?: number) => void;
  onStop: () => void;
  onEdit: () => void;
  onSync: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const running = isRunning(strategy.status);
  const cfg = strategy.config_json;
  const futures = isFutures(cfg);
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const [liveUsdt, setLiveUsdt] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Inline-editable draft of the tunable params. Synced from props unless the
  // user has unsaved edits, so a background refetch can't wipe what they typed.
  const [draft, setDraft] = useState<StrategyConfig>(strategy.config_json);
  const [name, setName] = useState(strategy.name);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setDraft(strategy.config_json);
      setName(strategy.name);
    }
  }, [strategy, dirty]);

  const myTrades = useMemo(
    () => trades.filter((t) => t.strategy_id === strategy.id),
    [trades, strategy.id],
  );
  const openCount = myTrades.filter((t) => t.pnl === null || t.pnl === undefined).length;

  // Minimum order size for this symbol on the exchange — fetched only while the
  // live size picker is open so we can block sizes the exchange would reject.
  // Size is margin, so the minimum to enter is min_notional / leverage.
  const lev = futures ? cfg.leverage ?? 1 : 1;
  const minOrder = useQuery({
    queryKey: ["min-order", cfg.symbol, futures, lev],
    queryFn: () => getMinOrder(cfg.symbol, futures, lev),
    enabled: liveUsdt !== null,
    staleTime: 60_000,
  });
  const minSize = minOrder.data?.min_size ?? 0;

  const parsedUsdt = parseFloat(liveUsdt ?? "");
  const insufficient =
    availableUsdt !== null &&
    Number.isFinite(parsedUsdt) &&
    parsedUsdt > availableUsdt;
  const belowMin =
    minSize > 0 && Number.isFinite(parsedUsdt) && parsedUsdt > 0 && parsedUsdt < minSize;

  const confirmLive = () => {
    if (!Number.isFinite(parsedUsdt) || parsedUsdt <= 0 || insufficient || belowMin) return;
    onStart("live", parsedUsdt);
    setLiveUsdt(null);
  };

  const save = useMutation({
    mutationFn: () => updateStrategy(strategy.id, { name: name.trim() || strategy.name, config_json: draft }),
    onSuccess: () => {
      toast.success("Strategy updated", "Changes apply on the bot's next tick");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: () => toast.error("Could not save changes"),
  });

  const patch = (next: Partial<StrategyConfig>) => {
    setDraft((d) => ({ ...d, ...next }));
    setDirty(true);
  };

  return (
    <Card className="animate-slide-up overflow-hidden p-0">
      <div className="p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="block w-full text-left"
          aria-expanded={expanded}
        >
          <div className="flex flex-wrap items-center gap-2">
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-500 transition-transform", expanded && "rotate-180")} />
            <span className="font-semibold text-slate-100">{strategy.name}</span>
            {strategy.status === "live" ? (
              <Badge tone="success">Live</Badge>
            ) : strategy.status === "paper" ? (
              <Badge tone="info">Paper</Badge>
            ) : (
              <Badge tone="neutral">Stopped</Badge>
            )}
            {openCount > 0 && <Badge tone="warning">{openCount} open</Badge>}
            {liveClash !== null && <Badge tone="danger">Shares {cfg.symbol} with {liveClash}</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-6 text-xs text-slate-400">
            <span className="font-mono text-slate-300">{cfg.symbol}</span>
            <span>· {cfg.timeframe}</span>
            <span>· Size {describeSize(cfg)}</span>
            <span>· In: {describeEntry(cfg)}</span>
            <span>· Out: {describeExit(cfg)}</span>
            <span>· SL {cfg.stop_loss?.value}% / TP {cfg.take_profit?.value}%</span>
          </div>
        </button>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {liveUsdt !== null ? (
            // Inline USDT amount picker shown when Live is clicked
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <Input
                  ref={inputRef}
                  type="number"
                  min={1}
                  step={10}
                  placeholder="USDT"
                  value={liveUsdt}
                  onChange={(e) => setLiveUsdt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmLive(); if (e.key === "Escape") setLiveUsdt(null); }}
                  className={`w-28 text-sm ${insufficient ? "border-rose-500/60 focus:ring-rose-500/40" : ""}`}
                  autoFocus
                />
                {belowMin ? (
                  <p className="mt-1 text-xs text-rose-400">
                    Min for {cfg.symbol}: ${minSize.toFixed(2)}{lev > 1 ? ` at ${lev}x` : ""}
                  </p>
                ) : insufficient && availableUsdt !== null ? (
                  <p className="mt-1 text-xs text-rose-400">
                    Max available: ${availableUsdt.toFixed(2)}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    {minOrder.isLoading
                      ? "Checking minimum…"
                      : minSize > 0
                        ? `Min $${minSize.toFixed(2)}${availableUsdt !== null ? ` · avail $${availableUsdt.toFixed(2)}` : ""}`
                        : availableUsdt !== null
                          ? `Available: $${availableUsdt.toFixed(2)}`
                          : ""}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                onClick={confirmLive}
                disabled={!liveUsdt || parsedUsdt <= 0 || insufficient || belowMin || pending}
              >
                <Play className="h-3.5 w-3.5" /> Start
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLiveUsdt(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={onEdit} disabled={pending} title="Open in the visual builder">
                <Pencil className="h-3.5 w-3.5" /> Builder
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
                    onClick={() => setLiveUsdt(String(positionUsdt(cfg)))}
                    disabled={pending || liveClash !== null}
                    title={
                      liveClash !== null
                        ? `“${liveClash}” is already live on ${cfg.symbol} — stop it first (one position per symbol/account)`
                        : "Enter position size to start live trading"
                    }
                  >
                    <Play className="h-3.5 w-3.5" /> Live
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="space-y-5 border-t border-white/[0.06] bg-white/[0.02] p-4">
          {openCount > 0 && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <p className="text-sm font-medium text-slate-200">
                Position open · managed by the bot{" "}
                <InfoTip text="You don't need to do anything — the bot closes it on your exit rule, stop-loss or take-profit. The buttons below are manual overrides only, if you want to step in." />
              </p>
              <p className="mt-0.5 text-xs text-slate-500">Manual overrides:</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm("Market-close this position on the exchange right now?")) onClose();
                  }}
                  loading={closing}
                  title="Place a market order now to close the position on the exchange"
                >
                  <XCircle className="h-3.5 w-3.5" /> Close on exchange
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onSync}
                  loading={syncing}
                  title="Already closed it on the exchange yourself? Clear the stale record"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Already closed it? Sync
                </Button>
              </div>
            </div>
          )}

          {/* Inline-editable tuning */}
          <div>
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Quick settings</h4>
              {dirty && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setDirty(false)} disabled={save.isPending}>
                    Reset
                  </Button>
                  <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>
                    Save
                  </Button>
                </div>
              )}
            </div>
            <div className="mb-3">
              <Field label="Strategy name">
                <Input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Position size ($)">
                <NumberField
                  value={positionUsdt(draft)}
                  onValueChange={(v) => patch({ position_size_usdt: v, position_size_pct: undefined })}
                  min={1}
                />
              </Field>
              <Field label="Stop loss %">
                <NumberField
                  value={draft.stop_loss?.value ?? 0}
                  onValueChange={(v) => patch({ stop_loss: { type: "pct", value: v } })}
                  min={0}
                />
              </Field>
              <Field label="Take profit %">
                <NumberField
                  value={draft.take_profit?.value ?? 0}
                  onValueChange={(v) => patch({ take_profit: { type: "pct", value: v } })}
                  min={0}
                />
              </Field>
              <Field label="Trailing %">
                <NumberField
                  value={draft.trailing_stop?.value ?? 0}
                  onValueChange={(v) => patch({ trailing_stop: { type: "pct", value: v } })}
                  min={0}
                />
              </Field>
              <Field label="Daily loss limit %">
                <NumberField
                  value={draft.daily_loss_limit_pct ?? 0}
                  onValueChange={(v) => patch({ daily_loss_limit_pct: v })}
                  min={0}
                />
              </Field>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Tuning applies to the running bot on its next tick. For entry/exit logic, symbol, market
              or leverage, open the <button type="button" onClick={onEdit} className="text-brand-400 hover:underline">builder</button>.
            </p>
          </div>

          {/* Read-only config summary */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
            <Info label="Market" value={futures ? `Futures · ${cfg.leverage ?? 1}x` : "Spot"} />
            <Info label="Direction" value={isBidirectional(cfg) ? "Long & Short" : "Long only"} />
            <Info label="Timeframe" value={cfg.timeframe} />
            <Info label="Entry" value={describeEntry(cfg)} />
            <Info label="Exit" value={describeExit(cfg)} />
            {futures && <Info label="Hedge" value={describeHedge(cfg)} />}
          </div>

          {/* Trades for this strategy */}
          <div>
            <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Recent trades
            </h4>
            {myTrades.length === 0 ? (
              <p className="text-sm text-slate-500">No trades yet for this strategy.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
                <table className="w-full text-xs">
                  <thead className="bg-white/[0.03] text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Side</th>
                      <th className="px-3 py-2 text-right font-medium">Size</th>
                      <th className="px-3 py-2 text-right font-medium">Price</th>
                      <th className="px-3 py-2 text-right font-medium">PnL</th>
                      <th className="px-3 py-2 text-right font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {myTrades.slice(0, 8).map((t) => {
                      const opened = t.pnl === null || t.pnl === undefined;
                      return (
                        <tr key={t.id}>
                          <td className="whitespace-nowrap px-3 py-2">
                            <span className={t.side === "buy" ? "text-brand-300" : "text-rose-300"}>
                              {t.side.toUpperCase()}
                            </span>
                            {t.leg === "hedge" && <span className="ml-1 text-indigo-300">·H</span>}
                            {t.mode === "live" ? (
                              <span className="ml-1 text-[10px] uppercase text-emerald-400/70">live</span>
                            ) : (
                              <span className="ml-1 text-[10px] uppercase text-slate-500">paper</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-slate-300">
                            {num(t.amount, 4)}
                            <span className="text-slate-500"> · {usd(t.amount * t.price)}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-slate-300">{price(t.price)}</td>
                          <td className={`whitespace-nowrap px-3 py-2 text-right ${pnlTone(t.pnl)}`}>
                            {opened ? (
                              <span className="text-amber-300" title="Position still open — no realized P&L yet">
                                open
                              </span>
                            ) : (
                              signedPct(t.pnl)
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-slate-500">{timeAgo(t.timestamp)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-200">{value}</span>
    </div>
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
