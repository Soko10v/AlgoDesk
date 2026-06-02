import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  forwardRef,
} from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
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
  ({ className, ...props }, ref) => <input ref={ref} className={cn("input", className)} {...props} />
);
Input.displayName = "Input";

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

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
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
