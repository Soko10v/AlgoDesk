import { type FormEvent, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Activity, BarChart3, Boxes, Send, ShieldCheck, Zap } from "lucide-react";
import { authTelegram, devLogin } from "../api/endpoints";
import { useAuthConfig } from "../hooks/useAuth";
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
  const setToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();
  const { data: config, isLoading } = useAuthConfig();
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config?.telegram_bot_username || !widgetRef.current) return;
    (window as unknown as { onTelegramAuth?: (u: Record<string, unknown>) => void }).onTelegramAuth = async (user) => {
      try {
        const { access_token } = await authTelegram(user);
        setToken(access_token);
        navigate("/");
      } catch {
        toast.error("Telegram login failed", "Check the bot domain configuration.");
      }
    };
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", config.telegram_bot_username);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    widgetRef.current.innerHTML = "";
    widgetRef.current.appendChild(script);
  }, [config?.telegram_bot_username, navigate, setToken]);

  if (token) return <Navigate to="/" replace />;

  async function handleDevLogin(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    try {
      const { access_token } = await devLogin(username.trim());
      setToken(access_token);
      navigate("/");
    } catch {
      toast.error("Dev login failed", "Is DEV_AUTH enabled on the backend?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Marketing panel */}
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

      {/* Auth panel */}
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md animate-slide-up p-8">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-ink-950 shadow-glow">
              <Activity className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div className="text-lg font-bold text-white">AlgoDesk</div>
          </div>

          <h2 className="text-xl font-bold text-white">Sign in</h2>
          <p className="mt-1 text-sm text-slate-400">Welcome back — choose how you want to continue.</p>

          {isLoading ? (
            <div className="mt-8 flex justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {config?.telegram_bot_username && (
                <div>
                  <div className="label flex items-center gap-2">
                    <Send className="h-3.5 w-3.5" /> Telegram
                  </div>
                  <div ref={widgetRef} className="flex min-h-[48px] items-center" />
                </div>
              )}

              {config?.telegram_bot_username && config?.dev_auth && (
                <div className="flex items-center gap-3 text-xs text-slate-600">
                  <span className="h-px flex-1 bg-white/[0.08]" /> or <span className="h-px flex-1 bg-white/[0.08]" />
                </div>
              )}

              {config?.dev_auth && (
                <form onSubmit={handleDevLogin} className="space-y-3">
                  <div>
                    <span className="label">Developer login</span>
                    <Input
                      placeholder="Pick a username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <Button type="submit" className="w-full" loading={busy}>
                    Continue
                  </Button>
                  <p className="text-center text-xs text-slate-500">
                    Local development bypass · disable with <code className="text-slate-400">DEV_AUTH=false</code>
                  </p>
                </form>
              )}

              {!config?.telegram_bot_username && !config?.dev_auth && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
                  No login method is configured. Set <code>TELEGRAM_BOT_USERNAME</code> or <code>DEV_AUTH=true</code> on
                  the backend.
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
