import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";
import { Spinner } from "../components/ui";

/**
 * Handles two OAuth callback patterns:
 *
 * 1. Backend Google OAuth  →  /auth/callback#token=<our_jwt>
 *    The backend issues our own JWT and puts it in the URL fragment.
 *    We store it and navigate to /dashboard.
 *
 * 2. Supabase PKCE / implicit redirects:
 *    - /auth/callback?code=<supabase_code>
 *    - /auth/callback#access_token=<supabase_token>&refresh_token=<...>
 *    We persist the Supabase session and then navigate to the app.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const setReady = useAuthStore((s) => s.setReady);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    // ── Pattern 1: backend Google OAuth ──────────────────────────────────────
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const backendToken = hash.get("token");

    if (backendToken) {
      setToken(backendToken);
      setReady(true);
      toast.success("Signed in", "Welcome back.");
      navigate("/dashboard", { replace: true });
      return;
    }

    // ── Pattern 2: Supabase implicit redirect ────────────────────────────────
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const hashError = hash.get("error_description") ?? hash.get("error");

    if (hashError) {
      setReady(true);
      toast.error("Sign-in failed", hashError);
      navigate("/login", { replace: true });
      return;
    }

    if (accessToken && refreshToken) {
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ data, error: err }) => {
          if (err || !data.session?.access_token) {
            setReady(true);
            toast.error("Sign-in failed", err?.message ?? "Could not create a session.");
            navigate("/login", { replace: true });
          } else {
            setToken(data.session.access_token);
            setReady(true);
            toast.success("Email confirmed", "You are signed in.");
            navigate("/dashboard", { replace: true });
          }
        })
        .catch(() => {
          setReady(true);
          toast.error("Sign-in failed", "Unexpected error during session setup.");
          navigate("/login", { replace: true });
        });
      return;
    }

    // ── Pattern 3: Supabase PKCE ─────────────────────────────────────────────
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error_description") ?? params.get("error");

    if (error) {
      setReady(true);
      toast.error("Sign-in failed", error);
      navigate("/login", { replace: true });
      return;
    }

    if (code) {
      supabase.auth
        .exchangeCodeForSession(code)
        .then(({ data, error: err }) => {
          if (err || !data.session?.access_token) {
            setReady(true);
            toast.error("Sign-in failed", err?.message ?? "Could not create a session.");
            navigate("/login", { replace: true });
          } else {
            setToken(data.session.access_token);
            setReady(true);
            toast.success("Email confirmed", "You are signed in.");
            navigate("/dashboard", { replace: true });
          }
        })
        .catch(() => {
          setReady(true);
          toast.error("Sign-in failed", "Unexpected error during code exchange.");
          navigate("/login", { replace: true });
        });
      return;
    }

    // Nothing to process
    setReady(true);
    navigate("/login", { replace: true });
  }, [navigate, setReady, setToken]);

  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="h-8 w-8 text-brand-400" />
        <p className="text-sm text-slate-400">Signing you in…</p>
      </div>
    </div>
  );
}
