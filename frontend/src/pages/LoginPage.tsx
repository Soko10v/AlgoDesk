import { type FormEvent, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Activity, BarChart3, Boxes, Mail, Send, ShieldCheck, Zap } from "lucide-react";
import { authTelegram } from "../api/endpoints";
import { track } from "../lib/analytics";
import { signInWithGoogle, useAuthConfig } from "../hooks/useAuth";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";
import { Button, Card, Input, Spinner } from "../components/ui";

const authRedirectTo = `${window.location.origin}/auth/callback`;

const features = [
  { icon: Boxes, title: "Visual builder", text: "Compose entry, exit, stop-loss and take-profit blocks — no code." },
  { icon: BarChart3, title: "Backtest instantly", text: "Replay strategies on real Bybit history with equity & drawdown." },
  { icon: Zap, title: "Paper & live", text: "Same engine, real-time prices over WebSocket, one click to go live." },
  { icon: ShieldCheck, title: "Keys stay encrypted", text: "API keys are Fernet-encrypted at rest. You stay in control." },
];

function OAuthDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-600">
      <span className="h-px flex-1 bg-white/[0.08]" />
      or continue with
      <span className="h-px flex-1 bg-white/[0.08]" />
    </div>
  );
}

export function LoginPage() {
  const token = useAuthStore((s) => s.token);
  const ready = useAuthStore((s) => s.ready);
  const setToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();
  const { data: config } = useAuthConfig();
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const confirmPollBusy = useRef(false);
  const [tgScaleX, setTgScaleX] = useState(1);
  const [searchParams] = useSearchParams();
  // Landing CTAs like "Create free account" link here with ?mode=signup so the
  // signup form is what actually opens, instead of dumping everyone on sign-in.
  const [mode, setMode] = useState<"signin" | "signup">(searchParams.get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  // Set right after a signup that requires email confirmation — replaces the
  // form with an explicit "check your email" screen instead of a toast that
  // auto-dismisses in 4.5s and is easy to miss.
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState<string | null>(null);
  const [pendingConfirmPassword, setPendingConfirmPassword] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendBusy, setResendBusy] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Supabase's rate-limit error names the exact wait time — surface that
  // instead of a generic failure ("you can only request this after 13
  // seconds" isn't really a failure, it's a cooldown).
  function secondsFromRateLimitError(message: string): number | null {
    const m = /after (\d+) seconds?/i.exec(message);
    return m ? Number(m[1]) : null;
  }

  useEffect(() => {
    if (!pendingConfirmEmail || !pendingConfirmPassword) return;

    let active = true;

    const tryFinishSignIn = async () => {
      if (confirmPollBusy.current) return;
      confirmPollBusy.current = true;
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: pendingConfirmEmail,
          password: pendingConfirmPassword,
        });

        if (!active) return;
        if (error || !data.session?.access_token) return;

        setToken(data.session.access_token);
        setPendingConfirmEmail(null);
        setPendingConfirmPassword(null);
        toast.success("Email confirmed", "You are signed in.");
        navigate("/dashboard");
      } finally {
        confirmPollBusy.current = false;
      }
    };

    const t = setInterval(() => void tryFinishSignIn(), 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [navigate, pendingConfirmEmail, pendingConfirmPassword, setToken]);

  async function resendConfirmation() {
    if (!pendingConfirmEmail || resendCooldown > 0) return;
    setResendBusy(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: pendingConfirmEmail,
        options: { emailRedirectTo: authRedirectTo },
      });
      if (error) throw error;
      toast.success("Email sent", `Check ${pendingConfirmEmail} again.`);
      setResendCooldown(60);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not resend";
      const wait = secondsFromRateLimitError(message);
      if (wait) {
        setResendCooldown(wait);
        toast.info("Please wait", `You can resend in ${wait}s.`);
      } else {
        toast.error("Could not resend", message);
      }
    } finally {
      setResendBusy(false);
    }
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w > 0) setTgScaleX(w / 240);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!config?.telegram_bot_username || !widgetRef.current) return;

    (window as unknown as { onTelegramAuth?: (u: Record<string, unknown>) => void }).onTelegramAuth = async (user) => {
      try {
        const { access_token } = await authTelegram(user);
        setToken(access_token);
        navigate("/dashboard");
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

  // While Supabase resolves the session (e.g. finishing an OAuth redirect),
  // show a loader instead of the form so we don't flash it or let the user
  // re-submit mid-exchange.
  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner className="h-6 w-6 text-brand-400" />
      </div>
    );
  }
  if (token) return <Navigate to="/dashboard" replace />;

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
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: authRedirectTo },
        });
        if (error) throw error;
        track("signup_success");
        if (data.session) {
          // Confirmation disabled on this project — already signed in.
          setToken(data.session.access_token);
          toast.success("Signed in", "Your account is ready.");
          navigate("/dashboard");
        } else {
          setPendingConfirmEmail(email.trim());
          setPendingConfirmPassword(password);
          setResendCooldown(60); // Supabase just sent one; matches its own resend cooldown
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (!data.session?.access_token) {
          throw new Error("No session returned");
        }
        setToken(data.session.access_token);
        toast.success("Signed in", "Welcome back.");
        navigate("/dashboard");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      toast.error(mode === "signup" ? "Sign up failed" : "Sign in failed", message);
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!supabaseConfigured) {
      toast.error("Auth not configured", "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setOauthBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google sign-in failed";
      toast.error("Google sign-in failed", message);
      setOauthBusy(false);
    }
  }

  const showGoogle = supabaseConfigured;
  const showTelegram = Boolean(config?.telegram_bot_username);

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
            Design strategies visually, validate them on real market data, then deploy to paper or live trading on Bybit or Binance.
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

          {pendingConfirmEmail ? (
            <>
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/15 text-brand-300">
                <Mail className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-white">Confirm your email</h2>
              <p className="mt-1 text-sm text-slate-400">
                We sent a confirmation link to{" "}
                <span className="font-medium text-slate-200">{pendingConfirmEmail}</span>. Open it and we will finish
                signing you in automatically. If you confirm from another device, keep this page open and it will
                continue here too.
              </p>
              <div className="mt-6 space-y-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  loading={resendBusy}
                  disabled={resendCooldown > 0}
                  onClick={() => void resendConfirmation()}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend email"}
                </Button>
                <button
                  type="button"
                  className="w-full text-center text-sm text-slate-500 hover:text-slate-300"
                  onClick={() => {
                    setPendingConfirmEmail(null);
                    setPendingConfirmPassword(null);
                    setMode("signin");
                  }}
                >
                  Back to sign in
                </button>
              </div>
            </>
          ) : (
            <>
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
                      placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      minLength={mode === "signup" ? 8 : 1}
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
                        <button type="button" className="text-brand-400 hover:underline" onClick={() => setMode("signup")}>
                          Sign up
                        </button>
                      </>
                    ) : (
                      <>
                        Already have an account?{" "}
                        <button type="button" className="text-brand-400 hover:underline" onClick={() => setMode("signin")}>
                          Sign in
                        </button>
                      </>
                    )}
                  </p>
                </form>
              )}
            </>
          )}

          {!pendingConfirmEmail && (showGoogle || showTelegram) && (
            <div className="mt-6 space-y-4">
              <OAuthDivider />

              {showTelegram && (
                <div ref={containerRef} className="relative h-10 w-full overflow-hidden rounded-xl">
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-indigo-500 text-sm font-semibold text-white">
                    <Send className="h-4 w-4" />
                    Continue with Telegram
                  </div>
                  <div
                    ref={widgetRef}
                    className="absolute left-0 top-0 opacity-0"
                    style={{ transform: `scaleX(${tgScaleX})`, transformOrigin: "left top" }}
                  />
                </div>
              )}

              {showGoogle && (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  loading={oauthBusy}
                  onClick={() => void handleGoogleSignIn()}
                  title="May not work inside an in-app browser (e.g. Telegram) — open in Chrome/Safari if it fails"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </Button>
              )}
            </div>
          )}
          <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-500">
            Продолжая, вы соглашаетесь с{" "}
            <a href="/terms" className="text-slate-400 underline hover:text-slate-300">Условиями</a> и{" "}
            <a href="/privacy" className="text-slate-400 underline hover:text-slate-300">Политикой</a> и понимаете,
            что алгоритмическая торговля сопряжена с риском потери средств — прошлые результаты не гарантируют будущих.
          </p>
        </Card>
      </div>
    </div>
  );
}
