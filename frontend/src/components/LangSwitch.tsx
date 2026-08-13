import { useLangStore } from "../store/lang";
import { cn } from "../lib/cn";

export function LangSwitch({ className }: { className?: string }) {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);

  return (
    <div className={cn("inline-flex items-center rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5 text-xs font-semibold", className)}>
      {(["ru", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={cn(
            "rounded-md px-2 py-1 uppercase transition",
            lang === l ? "bg-white/[0.08] text-white" : "text-slate-500 hover:text-slate-300"
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
