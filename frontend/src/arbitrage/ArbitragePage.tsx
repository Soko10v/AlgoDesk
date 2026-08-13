import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  Play,
  Scale,
  Square,
  Waves,
} from "lucide-react";
import { closePosition, startBot, stopBot, type Strategy } from "../api/endpoints";
import {
  deployCarry,
  deployPairs,
  describeArb,
  getArbOpportunities,
  listArbBots,
  type FundingOpportunity,
} from "./api";
import { toast } from "../store/toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  NumberField,
  PageHeader,
  Select,
  Spinner,
} from "../components/ui";
import { usePlan, useUpsell } from "../hooks/usePlan";
import { cn } from "../lib/cn";
import { useT } from "../lib/i18n";
import { isRunning, SYMBOLS } from "../lib/strategy";
import { num, pct, signedPct, usd } from "../lib/formatters";

type Tab = "scanner" | "bots" | "pairs";

export function ArbitragePage() {
  const t = useT();
  const qc = useQueryClient();
  const { can, requiredPlan } = usePlan();
  const upsell = useUpsell();
  const [tab, setTab] = useState<Tab>("scanner");

  const opp = useQuery({
    queryKey: ["arb-opportunities"],
    queryFn: getArbOpportunities,
    refetchInterval: 45_000,
  });
  const bots = useQuery({ queryKey: ["arb-bots"], queryFn: listArbBots });

  const updated =
    opp.data?.updated_at != null
      ? new Date(opp.data.updated_at * 1000).toLocaleTimeString()
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("arb.title")}
        description={t("arb.subtitle")}
        actions={
          updated ? (
            <span className="text-xs text-slate-500">{t("arb.updated", { time: updated })}</span>
          ) : null
        }
      />

      <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-100/90">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
        <p>{t("arb.disclaimer")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["scanner", t("arb.tabScanner"), Scale],
            ["bots", t("arb.tabBots"), Waves],
            ["pairs", t("arb.tabPairs"), ArrowLeftRight],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition",
              tab === id
                ? "bg-white/[0.08] text-white"
                : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "scanner" && (
        <ScannerPanel
          loading={opp.isLoading}
          funding={opp.data?.funding_basis ?? []}
          triangular={opp.data?.triangular ?? []}
          canTrade={can("paper")}
          onUpsell={() => upsell(requiredPlan("paper"), t("arb.carryTitle"))}
          onDeployed={() => {
            qc.invalidateQueries({ queryKey: ["arb-bots"] });
            setTab("bots");
          }}
        />
      )}
      {tab === "bots" && (
        <BotsPanel
          bots={(bots.data ?? []).filter((s) => s.config_json.kind === "cash_and_carry")}
          loading={bots.isLoading}
          canPaper={can("paper")}
          canLive={can("live")}
          onUpsell={(f) => upsell(requiredPlan(f), t("arb.carryTitle"))}
        />
      )}
      {tab === "pairs" && (
        <PairsPanel
          bots={(bots.data ?? []).filter((s) => s.config_json.kind === "pairs")}
          loading={bots.isLoading}
          canPaper={can("paper")}
          canLive={can("live")}
          onUpsell={(f) => upsell(requiredPlan(f), t("arb.pairsTitle"))}
          onDeployed={() => qc.invalidateQueries({ queryKey: ["arb-bots"] })}
        />
      )}
    </div>
  );
}

function ScannerPanel({
  loading,
  funding,
  triangular,
  canTrade,
  onUpsell,
  onDeployed,
}: {
  loading: boolean;
  funding: FundingOpportunity[];
  triangular: Array<{
    path: string;
    raw_edge_pct: number;
    net_edge_pct: number;
    fee_pct: number;
  }>;
  canTrade: boolean;
  onUpsell: () => void;
  onDeployed: () => void;
}) {
  const t = useT();
  const [deploySym, setDeploySym] = useState<string | null>(null);
  const [size, setSize] = useState(50);
  const [entryApr, setEntryApr] = useState(15);
  const [exitApr, setExitApr] = useState(5);

  const deploy = useMutation({
    mutationFn: () =>
      deployCarry({
        symbol: deploySym!,
        position_size_usdt: size,
        funding_entry_apr: entryApr,
        funding_exit_apr: exitApr,
      }),
    onSuccess: () => {
      toast.success(t("arb.deployed"), t("arb.deployedCarryHint"));
      setDeploySym(null);
      onDeployed();
    },
    onError: () => toast.error(t("arb.deployFailed")),
  });

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/[0.06] px-5 py-4">
          <h2 className="text-sm font-semibold text-white">{t("arb.fundingHeading")}</h2>
          <p className="mt-1 text-xs text-slate-500">{t("arb.fundingHint")}</p>
        </div>
        {funding.length === 0 ? (
          <div className="p-6">
            <EmptyState title={t("arb.emptyScanner")} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-white/[0.02] text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("arb.colSymbol")}</th>
                  <th className="px-4 py-3 font-medium">{t("arb.colSpot")}</th>
                  <th className="px-4 py-3 font-medium">{t("arb.colPerp")}</th>
                  <th className="px-4 py-3 font-medium">{t("arb.colBasis")}</th>
                  <th className="px-4 py-3 font-medium">{t("arb.colApr")}</th>
                  <th className="px-4 py-3 font-medium">{t("arb.colFees")}</th>
                  <th className="px-4 py-3 font-medium">{t("arb.colBe")}</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {funding.map((row) => (
                  <tr key={row.symbol} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium text-white">{row.symbol}</td>
                    <td className="px-4 py-3 text-slate-300">{usd(row.spot)}</td>
                    <td className="px-4 py-3 text-slate-300">{usd(row.perp)}</td>
                    <td className={cn("px-4 py-3", row.basis_pct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {signedPct(row.basis_pct)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 font-medium",
                        row.funding_apr_pct >= 15 ? "text-emerald-400" : "text-slate-200"
                      )}
                    >
                      {signedPct(row.funding_apr_pct)}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{pct(row.fee_round_trip_pct)}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {row.days_to_breakeven != null ? `${num(row.days_to_breakeven, 1)}d` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          if (!canTrade) {
                            onUpsell();
                            return;
                          }
                          setDeploySym(row.symbol);
                          setEntryApr(Math.max(5, Math.round(row.funding_apr_pct * 0.6)));
                        }}
                      >
                        {t("arb.deployCarry")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {deploySym && (
        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">
              {t("arb.deployModalTitle", { symbol: deploySym })}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setDeploySym(null)}>
              {t("common.cancel")}
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("arb.sizeUsdt")}>
              <NumberField value={size} onValueChange={setSize} min={5} />
            </Field>
            <Field label={t("arb.entryApr")} hint={t("arb.entryAprTip")}>
              <NumberField value={entryApr} onValueChange={setEntryApr} min={0} />
            </Field>
            <Field label={t("arb.exitApr")} hint={t("arb.exitAprTip")}>
              <NumberField value={exitApr} onValueChange={setExitApr} min={-10} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">{t("arb.hedgeModeNote")}</p>
          <Button variant="primary" loading={deploy.isPending} onClick={() => deploy.mutate()}>
            {t("arb.createBot")}
          </Button>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">{t("arb.triHeading")}</h2>
            <Badge tone="neutral">{t("arb.viewOnly")}</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t("arb.triHint")}</p>
        </div>
        {triangular.length === 0 ? (
          <div className="p-6">
            <EmptyState title={t("arb.emptyTri")} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-white/[0.02] text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("arb.colPath")}</th>
                  <th className="px-4 py-3 font-medium">{t("arb.colRaw")}</th>
                  <th className="px-4 py-3 font-medium">{t("arb.colNet")}</th>
                  <th className="px-4 py-3 font-medium">{t("arb.colFees")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {triangular.map((row) => (
                  <tr key={row.path}>
                    <td className="px-4 py-3 font-medium text-white">{row.path}</td>
                    <td className="px-4 py-3 text-slate-300">{signedPct(row.raw_edge_pct)}</td>
                    <td
                      className={cn(
                        "px-4 py-3 font-medium",
                        row.net_edge_pct > 0 ? "text-emerald-400" : "text-rose-400"
                      )}
                    >
                      {signedPct(row.net_edge_pct)}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{pct(row.fee_pct)}</td>
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

function BotControls({
  bot,
  canPaper,
  canLive,
  onUpsell,
}: {
  bot: Strategy;
  canPaper: boolean;
  canLive: boolean;
  onUpsell: (f: "paper" | "live") => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const running = isRunning(bot.status);

  const start = useMutation({
    mutationFn: (mode: "paper" | "live") => startBot(bot.id, mode),
    onSuccess: (_d, mode) => {
      toast.success(t("arb.botStarted"), mode);
      qc.invalidateQueries({ queryKey: ["arb-bots"] });
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(t("arb.botStartFailed"), typeof detail === "string" ? detail : undefined);
    },
  });
  const stop = useMutation({
    mutationFn: () => stopBot(bot.id),
    onSuccess: () => {
      toast.info(t("arb.botStopped"));
      qc.invalidateQueries({ queryKey: ["arb-bots"] });
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
  });
  const close = useMutation({
    mutationFn: () => closePosition(bot.id),
    onSuccess: () => {
      toast.success(t("arb.positionClosed"));
      qc.invalidateQueries({ queryKey: ["arb-bots"] });
      qc.invalidateQueries({ queryKey: ["trades"] });
    },
  });

  if (running) {
    return (
      <div className="flex flex-wrap gap-2">
        <Badge tone={bot.status === "live" ? "danger" : "info"}>{bot.status}</Badge>
        <Button variant="secondary" size="sm" onClick={() => stop.mutate()} loading={stop.isPending}>
          <Square className="mr-1 h-3.5 w-3.5" />
          {t("arb.stop")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => close.mutate()} loading={close.isPending}>
          {t("arb.closeLegs")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => (canPaper ? start.mutate("paper") : onUpsell("paper"))}
        loading={start.isPending}
      >
        <Play className="mr-1 h-3.5 w-3.5" />
        Paper
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={() => (canLive ? start.mutate("live") : onUpsell("live"))}
        loading={start.isPending}
      >
        <Play className="mr-1 h-3.5 w-3.5" />
        Live
      </Button>
    </div>
  );
}

function BotsPanel({
  bots,
  loading,
  canPaper,
  canLive,
  onUpsell,
}: {
  bots: Strategy[];
  loading: boolean;
  canPaper: boolean;
  canLive: boolean;
  onUpsell: (f: "paper" | "live") => void;
}) {
  const t = useT();
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (bots.length === 0) {
    return <EmptyState title={t("arb.emptyCarryBots")} description={t("arb.emptyCarryBotsHint")} />;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {bots.map((bot) => (
        <Card key={bot.id} className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-white">{bot.name}</div>
              <div className="mt-1 text-xs text-slate-500">{describeArb(bot.config_json)}</div>
            </div>
            <Badge tone="neutral">{bot.config_json.symbol}</Badge>
          </div>
          <div className="text-xs text-slate-400">
            {t("arb.sizeUsdt")}: {usd(bot.config_json.position_size_usdt ?? 0)} · lev {bot.config_json.leverage ?? 1}x
          </div>
          <BotControls bot={bot} canPaper={canPaper} canLive={canLive} onUpsell={onUpsell} />
        </Card>
      ))}
    </div>
  );
}

function PairsPanel({
  bots,
  loading,
  canPaper,
  canLive,
  onUpsell,
  onDeployed,
}: {
  bots: Strategy[];
  loading: boolean;
  canPaper: boolean;
  canLive: boolean;
  onUpsell: (f: "paper" | "live") => void;
  onDeployed: () => void;
}) {
  const t = useT();
  const [symA, setSymA] = useState("BTC/USDT");
  const [symB, setSymB] = useState("ETH/USDT");
  const [size, setSize] = useState(50);
  const [zEntry, setZEntry] = useState(2);
  const [zExit, setZExit] = useState(0.5);
  const [lookback, setLookback] = useState(48);
  const pairSymbols = useMemo(() => SYMBOLS, []);

  const deploy = useMutation({
    mutationFn: () =>
      deployPairs({
        symbol_a: symA,
        symbol_b: symB,
        position_size_usdt: size,
        z_entry: zEntry,
        z_exit: zExit,
        lookback,
      }),
    onSuccess: () => {
      toast.success(t("arb.deployed"), t("arb.deployedPairsHint"));
      onDeployed();
    },
    onError: () => toast.error(t("arb.deployFailed")),
  });

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-white">{t("arb.pairsTitle")}</h2>
          <p className="mt-1 text-xs text-slate-500">{t("arb.pairsHint")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("arb.symbolA")}>
            <Select value={symA} onChange={(e) => setSymA(e.target.value)}>
              {pairSymbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("arb.symbolB")}>
            <Select value={symB} onChange={(e) => setSymB(e.target.value)}>
              {pairSymbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("arb.sizeUsdt")}>
            <NumberField value={size} onValueChange={setSize} min={5} />
          </Field>
          <Field label={t("arb.zEntry")} hint={t("arb.zEntryTip")}>
            <NumberField value={zEntry} onValueChange={setZEntry} min={0.5} />
          </Field>
          <Field label={t("arb.zExit")} hint={t("arb.zExitTip")}>
            <NumberField value={zExit} onValueChange={setZExit} min={0.1} />
          </Field>
          <Field label={t("arb.lookback")}>
            <NumberField value={lookback} onValueChange={setLookback} min={10} />
          </Field>
        </div>
        <Button
          variant="primary"
          loading={deploy.isPending}
          disabled={symA === symB}
          onClick={() => {
            if (!canPaper) {
              onUpsell("paper");
              return;
            }
            deploy.mutate();
          }}
        >
          {t("arb.createPairsBot")}
        </Button>
        {!canPaper && <p className="text-xs text-slate-500">{t("arb.proRequired")}</p>}
      </Card>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : bots.length === 0 ? (
        <EmptyState title={t("arb.emptyPairsBots")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {bots.map((bot) => (
            <Card key={bot.id} className="space-y-3 p-5">
              <div className="font-semibold text-white">{bot.name}</div>
              <div className="text-xs text-slate-500">{describeArb(bot.config_json)}</div>
              <BotControls bot={bot} canPaper={canPaper} canLive={canLive} onUpsell={onUpsell} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
