import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../store/auth";
import { useWsStore } from "../store/ws";
import { toast } from "../store/toast";

type TradeEvent = {
  type: string;
  side?: string;
  price?: number;
  pnl_pct?: number;
  reason?: string;
  strategy?: string;
};

function notify(data: TradeEvent) {
  if (data.type === "trade_opened") {
    toast.success(
      `Opened ${data.side?.toUpperCase?.() ?? "position"}`,
      `${data.strategy ?? "Strategy"} @ ${data.price ?? "—"}`
    );
  } else if (data.type === "trade_closed") {
    const pnl = typeof data.pnl_pct === "number" ? ` · ${data.pnl_pct.toFixed(2)}%` : "";
    toast.info(`Closed position${pnl}`, `${data.strategy ?? "Strategy"} (${data.reason ?? "signal"})`);
  } else if (data.type === "bot_error") {
    toast.error("Bot error", data.strategy);
  }
}

export function useWsEvents() {
  const token = useAuthStore((s) => s.token);
  const pushEvent = useWsStore((s) => s.pushEvent);
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;
    const base = import.meta.env.VITE_WS_BASE ?? "ws://localhost:8000/api/v1/ws";
    const ws = new WebSocket(`${base}?token=${encodeURIComponent(token)}`);

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as TradeEvent;
        pushEvent({ ...data, _ts: Date.now() });
        notify(data);
        if (data.type === "trade_opened" || data.type === "trade_closed") {
          qc.invalidateQueries({ queryKey: ["trades"] });
          qc.invalidateQueries({ queryKey: ["strategies"] });
        }
      } catch {
        pushEvent({ type: "raw", payload: evt.data });
      }
    };

    return () => ws.close();
  }, [token, pushEvent, qc]);
}
