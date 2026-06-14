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
    const envBase = import.meta.env.VITE_WS_BASE;
    const base =
      envBase && envBase.length > 0
        ? envBase
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/v1/ws`;
    const url = `${base}?token=${encodeURIComponent(token)}`;

    let ws: WebSocket | null = null;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(url);

      ws.onopen = () => {
        retry = 0;
      };

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

      // Auto-reconnect with capped exponential backoff. Mobile browsers drop
      // sockets aggressively (tab backgrounded, network switch, server redeploy),
      // and without this the live feed silently dies after the first disconnect.
      ws.onclose = () => {
        if (closed) return;
        const delay = Math.min(15000, 1000 * 2 ** retry);
        retry += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    // When the tab returns to the foreground, reconnect right away instead of
    // waiting out the backoff timer (iOS often freezes timers while suspended).
    const onVisible = () => {
      if (document.visibilityState === "visible" && ws && ws.readyState > WebSocket.OPEN) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        retry = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, [token, pushEvent, qc]);
}
