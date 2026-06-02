import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Crown, Sparkles } from "lucide-react";
import { checkout, getSubscription } from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { dateTime } from "../lib/formatters";
import { cn } from "../lib/cn";

const plans = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    features: ["Visual strategy builder", "Unlimited backtests", "Paper trading", "1 active bot"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "10 USDT",
    period: "per month",
    features: ["Everything in Free", "Live trading on Bybit", "Unlimited active bots", "Telegram alerts", "Priority execution"],
  },
];

export function SubscriptionPage() {
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: getSubscription });
  const current = subscription.data?.plan ?? "free";

  const upgrade = useMutation({
    mutationFn: () => checkout("pro"),
    onSuccess: (d) => {
      toast.success("Invoice created", `#${d.invoice_id}`);
      if (d.pay_url) window.open(d.pay_url, "_blank", "noopener");
    },
    onError: () => toast.error("Checkout failed", "Is CRYPTOBOT_TOKEN configured?"),
  });

  return (
    <div className="animate-fade-in">
      <PageHeader title="Subscription" description="Upgrade to unlock live trading and more." />

      <Card className="mb-6 flex animate-slide-up flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-amber-300">
            <Crown className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm text-slate-400">Current plan</div>
            <div className="text-lg font-bold capitalize text-white">{current}</div>
          </div>
        </div>
        {subscription.data?.expires_at && (
          <div className="text-sm text-slate-400">
            Renews / expires <span className="text-slate-200">{dateTime(subscription.data.expires_at)}</span>
          </div>
        )}
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        {plans.map((plan) => {
          const isCurrent = current === plan.id;
          const isPro = plan.id === "pro";
          return (
            <Card
              key={plan.id}
              className={cn(
                "relative animate-slide-up p-6",
                isPro && "border-brand-500/30 shadow-glow"
              )}
            >
              {isPro && (
                <div className="absolute right-5 top-5">
                  <Badge tone="success">
                    <Sparkles className="h-3 w-3" /> Popular
                  </Badge>
                </div>
              )}
              <div className="text-sm font-semibold uppercase tracking-wider text-slate-400">{plan.name}</div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-white">{plan.price}</span>
                <span className="text-sm text-slate-500">/ {plan.period}</span>
              </div>

              <ul className="mt-5 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-slate-300">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500/15 text-brand-300">
                      <Check className="h-3 w-3" />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {isCurrent ? (
                  <Button variant="ghost" className="w-full" disabled>
                    Current plan
                  </Button>
                ) : isPro ? (
                  <Button className="w-full" onClick={() => upgrade.mutate()} loading={upgrade.isPending}>
                    <Crown className="h-4 w-4" /> Upgrade to Pro
                  </Button>
                ) : (
                  <Button variant="ghost" className="w-full" disabled>
                    Free forever
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        Payments are processed in USDT via CryptoBot. Your Pro plan activates automatically after payment.
      </p>
    </div>
  );
}
