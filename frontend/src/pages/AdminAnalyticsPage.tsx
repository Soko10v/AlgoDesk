import { useQuery } from "@tanstack/react-query";
import { BarChart3, Lock, Users } from "lucide-react";
import { getAnalyticsSummary } from "../api/endpoints";
import { usePlan } from "../hooks/usePlan";
import { Card, EmptyState, PageHeader, Spinner } from "../components/ui";
import { cn } from "../lib/cn";

export function AdminAnalyticsPage() {
  const { isAdmin, loading: planLoading } = usePlan();
  const summary = useQuery({
    queryKey: ["analytics-summary"],
    queryFn: () => getAnalyticsSummary(30),
    enabled: isAdmin,
  });

  if (planLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <EmptyState
        icon={Lock}
        title="Только для админа"
        description="Эта страница доступна только владельцу проекта."
      />
    );
  }

  const funnel = summary.data?.funnel ?? [];
  const totals = summary.data?.totals ?? [];
  const maxUnique = Math.max(1, ...funnel.map((f) => f.unique_users));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Аналитика"
        description="Собственная статистика захода и воронки — без сторонних сервисов. За последние 30 дней."
      />

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Users className="h-4 w-4 text-brand-400" /> Воронка
        </div>
        {summary.isLoading ? (
          <Spinner className="h-5 w-5" />
        ) : funnel.every((f) => f.unique_users === 0) ? (
          <div className="text-sm text-slate-500">Пока нет данных — статистика появится по мере посещений.</div>
        ) : (
          <div className="space-y-3">
            {funnel.map((step) => (
              <div key={step.name}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-slate-300">{step.label}</span>
                  <span className="text-slate-400">
                    {step.unique_users}
                    {step.conversion_pct !== null && (
                      <span className="ml-2 text-xs text-slate-500">{step.conversion_pct}%</span>
                    )}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className={cn("h-full rounded-full bg-brand-500")}
                    style={{ width: `${(step.unique_users / maxUnique) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-5 p-6">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <BarChart3 className="h-4 w-4 text-brand-400" /> Все события
        </div>
        {totals.length === 0 ? (
          <div className="text-sm text-slate-500">Нет событий за период.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="pb-2 font-medium">Событие</th>
                <th className="pb-2 font-medium">Всего</th>
                <th className="pb-2 font-medium">Уникальных</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((row) => (
                <tr key={row.name} className="border-b border-white/[0.03] last:border-0">
                  <td className="py-2 text-slate-200">{row.name}</td>
                  <td className="py-2 text-slate-400">{row.count}</td>
                  <td className="py-2 text-slate-400">{row.unique_users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
