import { Navigate, Link } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Boxes,
  ExternalLink,
  KeyRound,
  Lock,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useAuthStore } from "../store/auth";
import { Button } from "../components/ui";

const features = [
  {
    icon: Boxes,
    title: "Visual strategy builder",
    text: "Drag-and-drop entry, exit, stop-loss and take-profit blocks. No programming required.",
  },
  {
    icon: BarChart3,
    title: "Instant backtesting",
    text: "Replay your strategies against real historical Bybit and Binance market data with equity curves and drawdown charts.",
  },
  {
    icon: Zap,
    title: "Paper & live trading",
    text: "Test risk-free in paper mode, then deploy to live markets on Bybit or Binance with a single click.",
  },
  {
    icon: ShieldCheck,
    title: "Non-custodial",
    text: "We never hold your funds. API keys are restricted to trading-only — no withdrawal permission is ever needed or requested.",
  },
];

const securityPoints = [
  {
    icon: Lock,
    title: "Fernet encryption at rest",
    text: "Your API key and secret are encrypted with Fernet symmetric encryption before being stored. The plaintext never touches the database.",
  },
  {
    icon: KeyRound,
    title: "Write-only key storage",
    text: "Once saved, your API secret is never returned to the browser. It can only be replaced or deleted.",
  },
  {
    icon: ShieldCheck,
    title: "No withdrawal access",
    text: "AlgoDesk only requires Read and Trade permissions. Withdrawal permission must stay disabled — our platform cannot and does not move your funds off the exchange.",
  },
  {
    icon: Activity,
    title: "You stay in control",
    text: "Revoke the API key from your exchange at any time to instantly disconnect AlgoDesk. No lock-in.",
  },
];

export function LandingPage() {
  const token = useAuthStore((s) => s.token);
  const ready = useAuthStore((s) => s.ready);

  // Redirect authenticated users straight to the app
  if (ready && token) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen">
      {/* ── Nav ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-ink-950 shadow-glow">
              <Activity className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-white">AlgoDesk</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Trading bots</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-slate-400 hover:text-white transition">
              Sign in
            </Link>
            <Link to="/login">
              <Button variant="primary" className="text-sm">Get started free</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-4 py-1.5 text-xs font-medium text-brand-300 mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulse-soft" />
          Supports Bybit &amp; Binance
        </div>

        <h1 className="text-5xl font-bold leading-tight tracking-tight text-white lg:text-6xl">
          Build crypto trading bots<br />
          <span className="text-brand-400">without writing code</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          AlgoDesk is an algorithmic trading platform. Design your strategy visually, validate it
          against real market history, then run it on Bybit or Binance — paper or live.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link to="/login">
            <Button variant="primary" className="px-8 py-3 text-base">
              Start for free
            </Button>
          </Link>
          <a
            href="#how-it-works"
            className="text-sm font-medium text-slate-400 hover:text-white transition"
          >
            How it works ↓
          </a>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-white">Everything you need to automate trading</h2>
          <p className="mt-3 text-slate-400">From idea to live bot in minutes — no code required.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="card p-6"
            >
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-brand-500/10 text-brand-400">
                <f.icon className="h-5 w-5" />
              </div>
              <div className="mb-2 font-semibold text-slate-100">{f.title}</div>
              <div className="text-sm leading-relaxed text-slate-400">{f.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How API keys work ────────────────────────────── */}
      <section className="border-y border-white/[0.06] bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-300">
                <ShieldCheck className="h-4 w-4" /> Security &amp; Privacy
              </div>
              <h2 className="text-3xl font-bold text-white">
                Your exchange API keys — explained
              </h2>
              <p className="mt-4 text-slate-400 leading-relaxed">
                To place orders on your behalf, AlgoDesk connects to Bybit or Binance through their
                official API. You create a restricted API key on your exchange and paste it here.
                We never have access to your funds — only the ability to open and close trading
                positions as instructed by your strategy.
              </p>
              <div className="mt-6 flex gap-4 text-sm text-slate-400">
                <a
                  href="https://www.bybit.com/app/user/api-management"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-brand-300 transition"
                >
                  Bybit API docs <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <a
                  href="https://www.binance.com/en/my/settings/api-management"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-brand-300 transition"
                >
                  Binance API docs <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {securityPoints.map((p) => (
                <div key={p.title} className="card p-5">
                  <p.icon className="mb-3 h-5 w-5 text-brand-400" />
                  <div className="mb-1 text-sm font-semibold text-slate-100">{p.title}</div>
                  <div className="text-xs leading-relaxed text-slate-400">{p.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-24 text-center">
        <h2 className="text-3xl font-bold text-white">Ready to automate your trading?</h2>
        <p className="mt-4 text-slate-400">Free to start. No credit card required.</p>
        <div className="mt-8">
          <Link to="/login">
            <Button variant="primary" className="px-10 py-3 text-base">
              Create free account
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] bg-ink-950/60">
        <div className="mx-auto max-w-6xl px-5 py-8">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <div className="grid h-6 w-6 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-ink-950">
                <Activity className="h-3.5 w-3.5" strokeWidth={2.5} />
              </div>
              <span className="font-medium text-slate-400">AlgoDesk</span>
              <span>— Algorithmic trading platform</span>
            </div>
            <div className="flex items-center gap-5">
              <a href="mailto:sokolovpeterdev@gmail.com" className="hover:text-slate-300 transition">Support</a>
              <Link to="/privacy" className="hover:text-slate-300 transition">Privacy Policy</Link>
              <Link to="/terms" className="hover:text-slate-300 transition">Terms of Service</Link>
              <span>© {new Date().getFullYear()} AlgoDesk</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
