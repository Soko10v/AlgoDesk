import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  BarChart3,
  Boxes,
  Coins,
  Crown,
  Gift,
  Plug,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Trophy,
  Umbrella,
  Wallet,
} from "lucide-react";
import {
  exchangeBalance,
  exchangeStatus,
  getSubscription,
  getTradeStats,
  listStrategies,
  me,
} from "../api/endpoints";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, StatCard } from "../components/ui";
import { dateTime, num, pct, pnlTone, signedPct, usd } from "../lib/formatters";
import { isRunning } from "../lib/strategy";

export function ProfilePage() {
  const profile = useQuery({ queryKey: ["me"], queryFn: me });
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: getSubscription });
  const status = useQuery({ queryKey: ["exchange-status"], queryFn: exchangeStatus });
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: listStrategies });
  const stats = useQuery({ queryKey: ["trade-stats"], queryFn: getTradeStats });
  const balance = useQuery({
    queryKey: ["exchange-balance"],
    queryFn: exchangeBalance,
    enabled: status.data?.connected === true,
    staleTime: 30_000,
  });

  const user = profile.data;
  const items = strategies.data ?? [];
  const running = items.filter((s) => isRunning(s.status)).length;
  const liveReady = items.filter((s) => s.live_enabled).length;
  const plan = subscription.data?.plan ?? "free";
  const freeMode = subscription.data?.free_mode ?? false;
  const connected = status.data?.connected ?? false;
  const st = stats.data;

  const initials = (user?.username ?? user?.email ?? "T").slice(0, 2).toUpperCase();

  return (
    <div className="animate-fade-in">
      <PageHeader title="Profile" description="Your account, exchange balance and trading results in one place." />

      {/* Identity */}
      <Card className="animate-slide-up flex flex-wrap items-center gap-4 p-5">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-xl font-bold text-ink-950 shadow-glow">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-white">{user?.username ?? user?.email ?? "Trader"}</span>
            <Badge tone={plan === "pro" ? "warning" : "neutral"}>
              <Crown className="h-3 w-3" /> <span className="capitalize">{plan}</span>
            </Badge>
            {connected && (
              <Badge tone="success">
                <Plug className="h-3 w-3" /> <span className="capitalize">{status.data?.exchange}</span>
              </Badge>
            )}
          </div>
          <div className="mt-1 truncate text-sm text-slate-400">{user?.email ?? "—"}</div>
          {user?.created_at && (
            <div className="mt-1 text-xs text-slate-500">Member since {dateTime(user.created_at)}</div>
          )}
        </div>
        <Link to="/settings">
          <Button variant="ghost">
            <SlidersHorizontal className="h-4 w-4" /> Manage account
          </Button>
        </Link>
      </Card>

      {/* Quick stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Wallet}
          label="Wallet (USDT)"
          value={connected ? usd(balance.data?.usdt) : "—"}
          sub={connected ? `${status.data?.exchange} spot balance` : "Connect an exchange"}
        />
        <StatCard
          icon={Boxes}
          label="Bots"
          value={items.length}
          sub={`${running} running · ${liveReady} live-ready`}
          valueClassName={running ? "text-brand-400" : undefined}
        />
        <StatCard
          icon={Trophy}
          label="Win rate"
          value={st ? pct(st.win_rate) : "—"}
          sub={st ? `${st.closed_trades} closed trades` : "No trades yet"}
        />
        <StatCard
          icon={BarChart3}
          label="Total PnL"
          value={st ? signedPct(st.total_pnl) : "—"}
          sub="Sum of closed-trade PnL"
          valueClassName={pnlTone(st?.total_pnl)}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Exchange balance */}
        <Card className="animate-slide-up overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Coins className="h-4 w-4 text-brand-400" /> Exchange account
            </div>
            {connected && <Badge tone="neutral" className="capitalize">{status.data?.exchange}</Badge>}
          </div>

          {!connected ? (
            <div className="p-6">
              <EmptyState
                icon={Plug}
                title="No exchange connected"
                description="Link your Bybit or Binance API keys to see your balance and enable live trading."
                action={
                  <Link to="/settings">
                    <Button>
                      <Plug className="h-4 w-4" /> Connect exchange
                    </Button>
                  </Link>
                }
              />
            </div>
          ) : balance.isLoading ? (
            <div className="flex items-center justify-center gap-3 p-12 text-slate-400">
              <Spinner /> Fetching balances…
            </div>
          ) : balance.data?.error ? (
            <div className="p-6 text-sm text-slate-500">
              Couldn't load balances — check that your API key has read permission.
            </div>
          ) : balance.data && balance.data.balances.length > 0 ? (
            <div>
              <div className="px-5 pt-4">
                <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Available USDT</div>
                <div className="mt-1 text-2xl font-bold tracking-tight text-white">{usd(balance.data.usdt)}</div>
              </div>
              <div className="mt-3 max-h-[280px] overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-ink-900/80 text-left text-xs uppercase tracking-wider text-slate-500 backdrop-blur">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Asset</th>
                      <th className="px-5 py-2.5 text-right font-medium">Total</th>
                      <th className="px-5 py-2.5 text-right font-medium">Available</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {balance.data.balances.map((b) => (
                      <tr key={b.asset} className="hover:bg-white/[0.02]">
                        <td className="px-5 py-2.5 font-medium text-slate-200">{b.asset}</td>
                        <td className="px-5 py-2.5 text-right font-mono text-slate-300">{num(b.total, 6)}</td>
                        <td className="px-5 py-2.5 text-right font-mono text-slate-400">{num(b.free, 6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-6 text-sm text-slate-500">No balances found on this account yet.</div>
          )}
        </Card>

        {/* Trading results */}
        <Card className="animate-slide-up p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <BarChart3 className="h-4 w-4 text-brand-400" /> Trading results
          </div>
          {st && st.total_trades > 0 ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Metric label="Total orders" value={num(st.total_trades, 0)} />
              <Metric label="Closed trades" value={num(st.closed_trades, 0)} />
              <Metric label="Win rate" value={pct(st.win_rate)} />
              <Metric label="Wins" value={`${st.wins} / ${st.closed_trades}`} />
              <Metric label="Avg PnL / trade" value={signedPct(st.avg_pnl)} tone={pnlTone(st.avg_pnl)} />
              <Metric label="Total PnL" value={signedPct(st.total_pnl)} tone={pnlTone(st.total_pnl)} />
              <Metric
                label="Best trade"
                value={signedPct(st.best_pnl)}
                tone="text-brand-400"
                icon={TrendingUp}
              />
              <Metric
                label="Worst trade"
                value={signedPct(st.worst_pnl)}
                tone="text-rose-400"
                icon={TrendingDown}
              />
              {st.hedge_trades > 0 && (
                <Metric label="Hedge fills" value={num(st.hedge_trades, 0)} icon={Umbrella} />
              )}
            </div>
          ) : (
            <EmptyState
              icon={BarChart3}
              title="No trades yet"
              description="Run a bot in paper or live mode and your performance will be summarised here."
            />
          )}
        </Card>
      </div>

      {/* Subscription & wallet */}
      <Card className="mt-6 animate-slide-up flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.05] text-amber-300">
            {freeMode ? <Gift className="h-5 w-5" /> : <Crown className="h-5 w-5" />}
          </div>
          <div>
            <div className="text-sm text-slate-400">Subscription</div>
            <div className="text-lg font-bold capitalize text-white">{plan}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {freeMode
                ? "Free during launch — all Pro features unlocked 🎉"
                : subscription.data?.expires_at
                  ? `Renews / expires ${dateTime(subscription.data.expires_at)}`
                  : "No active paid plan"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-slate-500">Spent on plans</div>
            <div className="text-lg font-bold text-slate-100">{usd(subscription.data?.paid_in_usdt ?? 0)}</div>
          </div>
          <Link to="/subscription">
            <Button variant="ghost">
              Manage <ArrowUpRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: string;
  icon?: typeof TrendingUp;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-500">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className={`mt-1.5 text-lg font-bold tracking-tight ${tone ?? "text-slate-100"}`}>{value}</div>
    </div>
  );
}
