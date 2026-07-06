import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getSubscription, type FeatureKey, type PlanId } from "../api/endpoints";
import { toast } from "../store/toast";

export const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, expert: 2 };
export const PLAN_LABEL: Record<PlanId, string> = { free: "Free", pro: "Pro", expert: "Expert" };

// Mirrors backend app/core/plans.py — the minimum plan that unlocks each feature.
export const FEATURE_MIN_PLAN: Record<FeatureKey, PlanId> = {
  backtest: "free",
  optimize_entry: "free",
  walkforward: "free",
  monte_carlo: "free",
  paper: "pro",
  live: "pro",
  ai: "expert",
  sensitivity: "expert",
  optimize_exits: "expert",
  optimize_filters: "expert",
};

/** Plan + entitlement checks for gating the UI. Uses the server's entitlement map
 *  when present, falling back to the mirrored plan-rank table. */
export function usePlan() {
  const q = useQuery({ queryKey: ["subscription"], queryFn: getSubscription });
  const plan: PlanId = q.data?.plan ?? "free";
  const ent = q.data?.entitlements;
  const can = (f: FeatureKey): boolean =>
    ent && f in ent ? !!ent[f] : PLAN_RANK[plan] >= PLAN_RANK[FEATURE_MIN_PLAN[f]];
  return {
    plan,
    can,
    requiredPlan: (f: FeatureKey): PlanId => FEATURE_MIN_PLAN[f],
    freeMode: q.data?.free_mode ?? false,
    prices: q.data?.prices,
    data: q.data,
    loading: q.isLoading,
  };
}

/** Returns a function that nudges the user to upgrade and sends them to pricing. */
export function useUpsell() {
  const navigate = useNavigate();
  return (required: PlanId, feature?: string) => {
    toast.info(
      `Доступно на тарифе ${PLAN_LABEL[required]}`,
      feature ? `${feature} открывается на ${PLAN_LABEL[required]}.` : "Оформи подписку, чтобы открыть."
    );
    navigate("/subscription");
  };
}
