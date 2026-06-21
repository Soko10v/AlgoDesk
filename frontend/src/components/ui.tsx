import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  forwardRef,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown, Info, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin text-current", className ?? "h-5 w-5")} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" />
    </svg>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("card", className)} {...props}>
      {children}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading = false, className, children, disabled, ...props }, ref) => {
    const variants = {
      primary: "btn-primary",
      secondary: "btn-secondary",
      ghost: "btn-ghost",
      danger: "btn-danger",
    };
    const sizes = { sm: "rounded-lg px-3 py-1.5 text-xs", md: "" };
    return (
      <button
        ref={ref}
        className={cn("btn", variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Spinner className="h-4 w-4" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, onFocus, ...props }, ref) => (
    <input
      ref={ref}
      className={cn("input", className)}
      onFocus={(e) => {
        if (props.type === "number") e.target.select();
        onFocus?.(e);
      }}
      {...props}
    />
  )
);
Input.displayName = "Input";

type NumberFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min" | "max"
> & {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
};

// Numeric input that survives mobile/locale decimals. A plain <input type="number">
// rejects a comma ("1,5") and reports value="" → callers parse that as 0 and the
// field wipes. This keeps a local text buffer, accepts "," as the decimal point,
// allows partial entry ("1,", "") while typing, and clamps/normalises on blur.
export function NumberField({
  value,
  onValueChange,
  min,
  max,
  className,
  onFocus,
  onBlur,
  ...props
}: NumberFieldProps) {
  const [text, setText] = useState(() => String(value));
  const editing = useRef(false);

  // Reflect external value changes only while the user isn't actively typing.
  useEffect(() => {
    if (!editing.current) setText(Number.isFinite(value) ? String(value) : "");
  }, [value]);

  const clamp = (n: number) => {
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  };

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      className={cn("input", className)}
      value={text}
      onFocus={(e) => {
        editing.current = true;
        e.target.select();
        onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(",", ".");
        if (raw !== "" && !/^-?\d*\.?\d*$/.test(raw)) return; // reject stray chars
        setText(raw);
        const n = parseFloat(raw);
        if (Number.isFinite(n)) onValueChange(clamp(n));
      }}
      onBlur={(e) => {
        editing.current = false;
        const n = parseFloat(text.replace(",", "."));
        const final = Number.isFinite(n) ? clamp(n) : min ?? 0;
        setText(String(final));
        onValueChange(final);
        onBlur?.(e);
      }}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn("input cursor-pointer appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="label flex items-center gap-1.5">
        <span>{label}</span>
        {hint && <InfoTip text={hint} />}
      </div>
      {children}
    </div>
  );
}

/** Small "ⓘ" icon that reveals a hint on tap — keeps explanatory copy out of the
 *  way until asked for (works on touch; closes on outside tap). */
export function InfoTip({ text, className, label }: { text: ReactNode; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [open]);
  return (
    <span ref={ref} className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={label ?? "Details"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-grid h-4 w-4 place-items-center rounded-full text-slate-500 transition hover:text-slate-300",
          open && "text-brand-400"
        )}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className="absolute left-1/2 top-6 z-50 w-64 max-w-[78vw] -translate-x-1/2 rounded-xl border border-white/10 bg-ink-900 p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-300 shadow-xl"
        >
          {text}
        </span>
      )}
    </span>
  );
}

type Tone = "neutral" | "success" | "danger" | "warning" | "info" | "violet";

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-white/[0.06] text-slate-300",
    success: "bg-brand-500/15 text-brand-300",
    danger: "bg-rose-500/15 text-rose-300",
    warning: "bg-amber-500/15 text-amber-300",
    info: "bg-sky-500/15 text-sky-300",
    violet: "bg-indigo-500/15 text-indigo-300",
  };
  return <span className={cn("badge", tones[tone], className)}>{children}</span>;
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="inline-flex items-center gap-2.5">
      <span className={cn("relative h-6 w-11 rounded-full transition", checked ? "bg-brand-500" : "bg-white/10")}>
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[22px]" : "left-0.5"
          )}
        />
      </span>
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </button>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  valueClassName,
}: {
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card className="animate-slide-up p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-slate-500" />}
      </div>
      <div className={cn("mt-3 text-2xl font-bold tracking-tight text-slate-100", valueClassName)}>{value}</div>
      {sub !== undefined && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex animate-fade-in flex-col items-center justify-center gap-3 p-12 text-center">
      {Icon && (
        <div className="rounded-2xl bg-white/[0.04] p-3.5 text-slate-400">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <div>
        <h3 className="text-base font-semibold text-slate-200">{title}</h3>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </Card>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
