import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Crown, Gift, Lock, Rocket, Sparkles, TrendingUp } from "lucide-react";
import { checkout, getSubscription, type PlanId } from "../api/endpoints";
import { toast } from "../store/toast";
import { PLAN_RANK } from "../hooks/usePlan";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { dateTime } from "../lib/formatters";
import { cn } from "../lib/cn";

type Tier = {
  id: PlanId;
  name: string;
  price: string;
  period: string;
  tagline: string;
  highlight?: "popular" | "best";
  cta: string;
  features: string[];
  locked?: string[]; // shown struck-through so users feel what they're missing
};

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "навсегда",
    tagline: "Посмотри, на что способна платформа — и чего лишаешься без подписки.",
    cta: "Текущий тариф",
    features: ["Конструктор стратегий", "Безлимитные бэктесты", "Стандартный оптимизатор (вход)"],
    locked: [
      "Live-торговля — деньги остаются на столе",
      "Paper-режим",
      "Карта чувствительности",
      "Walk-forward, Monte-Carlo, AI",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$25",
    period: "в месяц",
    tagline: "Запускай ботов вживую и начни зарабатывать. Золотые горы за чашку кофе в неделю.",
    highlight: "popular",
    cta: "Открыть Pro — $25",
    features: [
      "Всё из Free",
      "💸 Live-торговля на бирже",
      "🧪 Paper-режим (тест без риска)",
      "🗺️ Карта чувствительности",
      "🎯 Оптимизация SL / TP / Trailing",
      "🤖 Безлимит ботов + Telegram-алерты",
    ],
    locked: ["Walk-forward валидация", "Monte-Carlo", "AI-аналитик и AI-сборщик ботов"],
  },
  {
    id: "expert",
    name: "Expert",
    price: "$40",
    period: "в месяц",
    tagline: "Полный арсенал квант-трейдера. AI сам находит прибыльные стратегии. Богатство и успех. 🚀",
    highlight: "best",
    cta: "Хочу Expert — $40",
    features: [
      "Всё из Pro",
      "🧠 AI-аналитик: чинит и улучшает стратегии",
      "✨ AI-сборщик: 3 готовых бота по описанию",
      "🛡️ Walk-forward — проверка на будущем",
      "🎲 Monte-Carlo — реальный это эдж или удача",
      "🔁 Reverse-стратегия + фильтры по сторонам",
      "💬 Ask-AI чат и приоритет во всём",
    ],
  },
];

export function SubscriptionPage() {
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: getSubscription });
  const current: PlanId = subscription.data?.plan ?? "free";
  const freeMode = subscription.data?.free_mode ?? false;

  const upgrade = useMutation({
    mutationFn: (v: { plan: "pro" | "expert"; provider: "cryptomus" | "lava" }) => checkout(v.plan, v.provider),
    onSuccess: (d) => {
      toast.success("Счёт создан", "Доступ откроется автоматически после оплаты");
      if (d.pay_url) window.open(d.pay_url, "_blank", "noopener");
    },
    onError: () => toast.error("Не удалось создать счёт", "Попробуй другой способ оплаты или позже"),
  });

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Тарифы"
        description="На бесплатном видно весь функционал — но зарабатывать (live-торговля и AI) можно только на платных."
      />

      {freeMode ? (
        <Card className="mb-6 flex animate-slide-up items-center gap-3 border-brand-500/30 p-5 shadow-glow">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-300">
            <Gift className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-slate-100">Бесплатный доступ ко всему 🎉</div>
            <div className="text-sm text-slate-400">Идёт промо запуска — все функции Expert открыты для всех.</div>
          </div>
        </Card>
      ) : (
        <Card className="mb-6 flex animate-slide-up flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-amber-300">
              <Crown className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm text-slate-400">Текущий тариф</div>
              <div className="text-lg font-bold capitalize text-white">{current}</div>
            </div>
          </div>
          {subscription.data?.expires_at && (
            <div className="text-sm text-slate-400">
              Действует до <span className="text-slate-200">{dateTime(subscription.data.expires_at)}</span>
            </div>
          )}
        </Card>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-3">
        {TIERS.map((tier) => {
          const isCurrent = current === tier.id;
          const isUpgrade = PLAN_RANK[tier.id] > PLAN_RANK[current];
          const best = tier.highlight === "best";
          return (
            <Card
              key={tier.id}
              className={cn(
                "relative flex animate-slide-up flex-col p-6",
                best
                  ? "border-amber-400/40 shadow-glow ring-1 ring-amber-400/30 lg:-mt-2 lg:mb-2"
                  : tier.highlight === "popular" && "border-brand-500/30"
              )}
            >
              {tier.highlight && (
                <div className="absolute right-5 top-5">
                  <Badge tone={best ? "warning" : "success"}>
                    {best ? <Crown className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                    {best ? "Лучший выбор" : "Популярный"}
                  </Badge>
                </div>
              )}

              <div className="text-sm font-semibold uppercase tracking-wider text-slate-400">{tier.name}</div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className={cn("text-4xl font-extrabold", best ? "text-amber-300" : "text-white")}>
                  {tier.price}
                </span>
                <span className="text-sm text-slate-500">/ {tier.period}</span>
              </div>
              <p className="mt-2.5 min-h-[40px] text-sm leading-relaxed text-slate-400">{tier.tagline}</p>

              <ul className="mt-5 space-y-2.5">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-200">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500/15 text-brand-300">
                      <Check className="h-3 w-3" />
                    </span>
                    {f}
                  </li>
                ))}
                {tier.locked?.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-600">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/[0.04]">
                      <Lock className="h-3 w-3" />
                    </span>
                    <span className="line-through decoration-slate-700">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 pt-2">
                {isCurrent && !freeMode ? (
                  <Button variant="ghost" className="w-full" disabled>
                    Твой тариф
                  </Button>
                ) : tier.id === "free" ? (
                  <Button variant="ghost" className="w-full" disabled>
                    Базовый
                  </Button>
                ) : isUpgrade || freeMode ? (
                  <div>
                    <Button
                      variant={best ? "primary" : "secondary"}
                      className="w-full"
                      onClick={() => upgrade.mutate({ plan: tier.id as "pro" | "expert", provider: "cryptomus" })}
                      loading={upgrade.isPending && upgrade.variables?.plan === tier.id}
                      disabled={freeMode}
                    >
                      {best ? <Rocket className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />} {tier.cta}
                    </Button>
                    {!freeMode && (
                      <button
                        type="button"
                        onClick={() => upgrade.mutate({ plan: tier.id as "pro" | "expert", provider: "lava" })}
                        className="mt-2 w-full text-center text-xs text-slate-400 underline decoration-slate-600 hover:text-slate-200"
                      >
                        Оплатить картой / СБП
                      </button>
                    )}
                  </div>
                ) : (
                  <Button variant="ghost" className="w-full" disabled>
                    Включено
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-amber-300/90">
        🔥 Большинство берут <b>Expert</b> — окупается с первой удачной стратегии, которую находит AI.
      </p>
      <p className="mt-2 text-center text-xs text-slate-500">
        Оплата криптой или картой/СБП. Подписка активируется автоматически после оплаты. Торговля сопряжена с риском —
        прошлые результаты не гарантируют будущих.
      </p>
    </div>
  );
}
