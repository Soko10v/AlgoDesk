import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Crown, Gift, Lock, Rocket, Sparkles, TrendingUp, X } from "lucide-react";
import {
  checkout,
  getPayStatus,
  getSubscription,
  type CheckoutResult,
  type PlanId,
  type UsdtNetwork,
} from "../api/endpoints";
import { toast } from "../store/toast";
import { PLAN_RANK } from "../hooks/usePlan";
import { Badge, Button, Card, PageHeader, Spinner } from "../components/ui";
import { dateTime } from "../lib/formatters";
import { cn } from "../lib/cn";

// USDT networks the user can pay through — only ones with an active wallet in
// the Plisio shop (an unlisted network makes invoice creation fail).
const NETWORKS: { id: UsdtNetwork; label: string; hint: string }[] = [
  { id: "USDT_TRX", label: "TRC-20 (Tron)", hint: "Самая распространённая — есть на любой бирже" },
  { id: "USDT_TON", label: "TON", hint: "Низкие комиссии — удобно из Telegram-кошелька" },
];

function networkLabel(currency: string): string {
  return NETWORKS.find((n) => n.id === currency)?.label ?? currency;
}

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

// Display-only — must match backend PLAN_PRICES in app/core/plans.py, which
// is the amount actually charged.
const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "навсегда",
    tagline: "Пробуй всё без ограничений: собирай стратегии, тестируй, смотри на зелёные цифры.",
    cta: "Текущий тариф",
    features: [
      "Конструктор стратегий",
      "Безлимитные бэктесты",
      "Оптимизатор входа",
      "🛡️ Walk-forward — проверка на будущем",
      "🎲 Monte-Carlo — удача или реальный эдж",
      "🧠 AI-аналитик и AI-сборщик ботов",
    ],
    locked: ["Live-торговля — пока деньги мимо тебя", "Paper-режим"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$25",
    period: "в месяц",
    tagline: "Перестань просто смотреть на прибыль в бэктесте — запусти ботов вживую и зарабатывай.",
    highlight: "popular",
    cta: "Открыть Pro — $25",
    features: [
      "Всё из Free (вся аналитика и AI)",
      "💸 Live-торговля на бирже 24/7",
      "🧪 Paper-режим (обкатка без риска)",
    ],
    locked: ["Карта чувствительности", "Оптимизация SL / TP / Trailing", "Безлимит ботов + Telegram-алерты"],
  },
  {
    id: "expert",
    name: "Expert",
    price: "$40",
    period: "в месяц",
    tagline: "Полный арсенал квант-трейдера. Дожимай стратегии до максимума. Богатство и успех. 🚀",
    highlight: "best",
    cta: "Хочу Expert — $40",
    features: [
      "Всё из Pro",
      "🗺️ Карта чувствительности — устойчива ли стратегия",
      "🎯 Оптимизация SL / TP / Trailing и фильтров",
      "🤖 Безлимит ботов + Telegram-алерты",
      "⚡ Приоритетное исполнение и поддержка",
    ],
  },
];

export function SubscriptionPage() {
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: getSubscription });
  const current: PlanId = subscription.data?.plan ?? "free";
  const freeMode = subscription.data?.free_mode ?? false;

  const qc = useQueryClient();
  const [pay, setPay] = useState<CheckoutResult | null>(null);
  const [payPlan, setPayPlan] = useState<"pro" | "expert" | null>(null);
  // Plan picked but network not chosen yet → network-chooser dialog is open.
  const [pickNet, setPickNet] = useState<"pro" | "expert" | null>(null);

  const upgrade = useMutation({
    mutationFn: ({ plan, network }: { plan: "pro" | "expert"; network: UsdtNetwork }) =>
      checkout(plan, "plisio", network),
    onSuccess: (d, { plan }) => {
      if (d.address) {
        setPay(d); // on-page: show QR + address, no redirect
        setPayPlan(plan);
      } else if (d.pay_url) {
        window.location.href = d.pay_url; // fallback if no white-label address
      } else {
        toast.error("Не удалось открыть оплату", "Попробуй ещё раз");
      }
    },
    onError: () => toast.error("Не удалось создать счёт", "Попробуй ещё раз позже"),
  });

  // Poll the invoice while the payment panel is open; unlock the moment it's paid.
  const payStatus = useQuery({
    queryKey: ["pay-status", pay?.invoice_id],
    queryFn: () => getPayStatus(pay!.invoice_id),
    enabled: !!pay?.invoice_id,
    refetchInterval: (q) => (q.state.data?.paid ? false : 5000),
  });
  const paid = payStatus.data?.paid ?? false;
  useEffect(() => {
    if (paid) {
      toast.success("Оплачено!", "Доступ открыт");
      qc.invalidateQueries({ queryKey: ["subscription"] });
    }
  }, [paid, qc]);

  const copyAddress = () => {
    if (pay?.address) {
      navigator.clipboard?.writeText(pay.address);
      toast.success("Адрес скопирован");
    }
  };

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
                  <Button
                    variant={best ? "primary" : "secondary"}
                    className="w-full"
                    onClick={() => setPickNet(tier.id as "pro" | "expert")}
                    loading={upgrade.isPending && upgrade.variables?.plan === tier.id}
                    disabled={freeMode}
                  >
                    {best ? <Rocket className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />} {tier.cta}
                  </Button>
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
        Оплата криптой (USDT). Адрес и QR прямо здесь — никуда переходить не нужно, доступ откроется автоматически.
        Торговля сопряжена с риском — прошлые результаты не гарантируют будущих.
      </p>

      {pickNet && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setPickNet(null)}
        >
          <Card className="w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-200">
                Оплата {pickNet.toUpperCase()} · выбери сеть USDT
              </div>
              <button type="button" onClick={() => setPickNet(null)} className="text-slate-500 hover:text-slate-300">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-2.5">
              {NETWORKS.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  disabled={upgrade.isPending}
                  onClick={() => {
                    const plan = pickNet;
                    setPickNet(null);
                    upgrade.mutate({ plan, network: n.id });
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 text-left transition hover:border-brand-500/40 hover:bg-brand-500/[0.06] disabled:opacity-50"
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-100">{n.label}</span>
                    <span className="block text-xs text-slate-500">{n.hint}</span>
                  </span>
                  <span className="shrink-0 text-slate-500">→</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Сумма одинаковая — выбирай сеть, из которой удобнее отправить USDT.
            </p>
          </Card>
        </div>
      )}

      {pay && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setPay(null)}
        >
          <Card className="w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            {paid ? (
              <div className="space-y-3">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-500/15 text-brand-300">
                  <Check className="h-7 w-7" />
                </div>
                <div className="text-lg font-bold text-white">Оплачено!</div>
                <div className="text-sm text-slate-400">Тариф {payPlan?.toUpperCase()} активирован.</div>
                <Button className="w-full" onClick={() => setPay(null)}>
                  Готово
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-200">
                    Оплата {payPlan?.toUpperCase()} · {pay.amount} USDT
                  </div>
                  <button type="button" onClick={() => setPay(null)} className="text-slate-500 hover:text-slate-300">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {pay.qr && (
                  <img src={pay.qr} alt="QR" className="mx-auto mt-4 h-44 w-44 rounded-xl bg-white p-2" />
                )}
                <div className="mt-4 text-xs uppercase tracking-wider text-slate-500">
                  Сеть: {networkLabel(pay.currency)}
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-ink-900 p-2.5">
                  <span className="min-w-0 flex-1 truncate text-left font-mono text-xs text-slate-300">
                    {pay.address}
                  </span>
                  <Button size="sm" variant="ghost" onClick={copyAddress}>
                    <Copy className="h-3.5 w-3.5" /> Копир.
                  </Button>
                </div>
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-amber-300">
                  <Spinner className="h-4 w-4" /> Ждём оплату…
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Отправь ровно <b className="text-slate-300">{pay.amount} USDT</b> (сеть{" "}
                  {networkLabel(pay.currency)}) на адрес выше. Доступ откроется автоматически.
                </p>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
