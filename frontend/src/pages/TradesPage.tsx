import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { listStrategies, listTrades } from "../api/endpoints";
import { Badge, Card, EmptyState, Field, PageHeader, Select, Spinner, StatCard } from "../components/ui";
import { dateTime, num, pct, pnlTone, price, signedPct } from "../lib/formatters";

export function TradesPage() {
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: listStrategies });
  const [strategyId, setStrategyId] = useState<number | null>(null);
  const trades = useQuery({
    queryKey: ["trades", strategyId],
    queryFn: () => listTrades(strategyId ?? undefined),
  });

  const rows = trades.data ?? [];
  const summary = useMemo(() => {
    const closed = rows.filter((t) => t.pnl !== null && t.pnl !== undefined);
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
    const avg = closed.length ? closed.reduce((a, t) => a + (t.pnl ?? 0), 0) / closed.length : 0;
    return {
      total: rows.length,
      winRate: closed.length ? (wins / closed.length) * 100 : 0,
      avg,
      closed: closed.length,
    };
  }, [rows]);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Trade Log" description="Every order placed by your bots, paper and live." />

      <Card className="animate-slide-up p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Filter by strategy">
            <Select value={strategyId ?? ""} onChange={(e) => setStrategyId(Number(e.target.value) || null)}>
              <option value="">All strategies</option>
              {strategies.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Orders" value={summary.total} />
        <StatCard label="Closed" value={summary.closed} />
        <StatCard label="Win rate" value={pct(summary.winRate)} />
        <StatCard
          label="Avg PnL"
          value={signedPct(summary.avg)}
          valueClassName={pnlTone(summary.avg)}
        />
      </div>

      <Card className="mt-6 overflow-hidden p-0">
        {trades.isLoading ? (
          <div className="flex items-center justify-center gap-3 p-12 text-slate-400">
            <Spinner /> Loading trades…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No trades yet"
            description="Once a bot opens or closes a position, it will show up here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-ink-900/60 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-5 py-3 font-medium">Symbol</th>
                  <th className="px-5 py-3 font-medium">Side</th>
                  <th className="px-5 py-3 text-right font-medium">Price</th>
                  <th className="px-5 py-3 text-right font-medium">Size</th>
                  <th className="px-5 py-3 text-right font-medium">PnL %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {rows.map((t) => (
                  <tr key={t.id} className="transition hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-400">{dateTime(t.timestamp)}</td>
                    <td className="px-5 py-3 font-mono text-slate-200">{t.symbol}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={t.side === "buy" ? "success" : "info"}>{t.side.toUpperCase()}</Badge>
                        {t.leg === "hedge" && <Badge tone="violet">HEDGE</Badge>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-slate-300">{price(t.price)}</td>
                    <td className="px-5 py-3 text-right text-slate-400">{num(t.amount, 4)}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${pnlTone(t.pnl)}`}>
                      {t.pnl === null || t.pnl === undefined ? "—" : signedPct(t.pnl)}
                    </td>
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
