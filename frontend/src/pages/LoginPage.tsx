import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Activity, BarChart3, Boxes, Mail, ShieldCheck, Zap } from "lucide-react";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";
import { Button, Card, Input, Spinner } from "../components/ui";

const features = [
  { icon: Boxes, title: "Visual builder", text: "Compose entry, exit, stop-loss and take-profit blocks — no code." },
  { icon: BarChart3, title: "Backtest instantly", text: "Replay strategies on real Bybit history with equity & drawdown." },
  { icon: Zap, title: "Paper & live", text: "Same engine, real-time prices over WebSocket, one click to go live." },
  { icon: ShieldCheck, title: "Keys stay encrypted", text: "API keys are Fernet-encrypted at rest. You stay in control." },
];

export function LoginPage() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (token) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (!supabaseConfigured) {
      toast.error("Auth not configured", "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        toast.success("Account created", "Check your email if confirmation is enabled, then sign in.");
        setMode("signin");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (!data.session?.access_token) {
          throw new Error("No session returned");
        }
        navigate("/");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      toast.error(mode === "signup" ? "Sign up failed" : "Sign in failed", message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.06] p-12 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-ink-950 shadow-glow">
            <Activity className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight text-white">AlgoDesk</div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">No-code trading bots</div>
          </div>
        </div>

        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white">
            Build, backtest and run <span className="text-brand-400">crypto trading bots</span> — without code.
          </h1>
          <p className="mt-4 text-slate-400">
            Design strategies visually, validate them on real market data, then deploy to paper or live trading on Bybit.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4">
            {features.map((f) => (
              <div key={f.title} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                <f.icon className="h-5 w-5 text-brand-400" />
                <div className="mt-2.5 text-sm font-semibold text-slate-200">{f.title}</div>
                <div className="mt-1 text-xs leading-relaxed text-slate-500">{f.text}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-xs text-slate-600">Built for crypto traders · Bybit · USDT</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md animate-slide-up p-8">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-ink-950 shadow-glow">
              <Activity className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div className="text-lg font-bold text-white">AlgoDesk</div>
          </div>

          <h2 className="text-xl font-bold text-white">{mode === "signin" ? "Sign in" : "Create account"}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {mode === "signin" ? "Welcome back — enter your email and password." : "Start with email and password."}
          </p>

          {!supabaseConfigured ? (
            <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
              Supabase Auth is not configured. Set <code className="text-slate-300">VITE_SUPABASE_URL</code> and{" "}
              <code className="text-slate-300">VITE_SUPABASE_ANON_KEY</code> in the frontend environment.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <span className="label flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5" /> Email
                </span>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <span className="label">Password</span>
                <Input
                  type="password"
                  placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={mode === "signup" ? 6 : 1}
                  required
                />
              </div>
              <Button type="submit" className="w-full" loading={busy}>
                {mode === "signin" ? "Sign in" : "Sign up"}
              </Button>
              <p className="text-center text-sm text-slate-500">
                {mode === "signin" ? (
                  <>
                    No account?{" "}
                    <button
                      type="button"
                      className="text-brand-400 hover:underline"
                      onClick={() => setMode("signup")}
                    >
                      Sign up
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      type="button"
                      className="text-brand-400 hover:underline"
                      onClick={() => setMode("signin")}
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
