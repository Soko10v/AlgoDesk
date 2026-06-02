import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToastStore, type ToastType } from "../store/toast";
import { cn } from "../lib/cn";

const icons = { success: CheckCircle2, error: XCircle, info: Info } as const;

const tones: Record<ToastType, string> = {
  success: "border-brand-500/30",
  error: "border-rose-500/30",
  info: "border-sky-500/30",
};

const iconTones: Record<ToastType, string> = {
  success: "text-brand-300",
  error: "text-rose-300",
  info: "text-sky-300",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icons[t.type];
        return (
          <div
            key={t.id}
            className={cn("card pointer-events-auto flex animate-slide-in-right items-start gap-3 border p-3.5", tones[t.type])}
          >
            <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", iconTones[t.type])} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-100">{t.title}</div>
              {t.message && <div className="mt-0.5 truncate text-xs text-slate-400">{t.message}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-slate-500 transition hover:text-slate-300">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
