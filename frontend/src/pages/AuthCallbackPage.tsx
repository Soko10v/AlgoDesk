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
 * 2. Supabase PKCE fallback  →  /auth/callback?code=<supabase_code>
 *    Used when Supabase handles other providers. We exchange the code
 *    for a session; onAuthStateChange in useAuthBootstrap picks up the token.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    // ── Pattern 1: backend Google OAuth ──────────────────────────────────────
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const backendToken = hash.get("token");

    if (backendToken) {
      setToken(backendToken);
      navigate("/dashboard", { replace: true });
      return;
    }

    // ── Pattern 2: Supabase PKCE ─────────────────────────────────────────────
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error_description") ?? params.get("error");

    if (error) {
      toast.error("Sign-in failed", error);
      navigate("/login", { replace: true });
      return;
    }

    if (code) {
      supabase.auth
        .exchangeCodeForSession(code)
        .then(({ error: err }) => {
          if (err) {
            toast.error("Sign-in failed", err.message);
            navigate("/login", { replace: true });
          } else {
            navigate("/dashboard", { replace: true });
          }
        })
        .catch(() => {
          toast.error("Sign-in failed", "Unexpected error during code exchange.");
          navigate("/login", { replace: true });
        });
      return;
    }

    // Nothing to process
    navigate("/login", { replace: true });
  }, [navigate, setToken]);

  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="h-8 w-8 text-brand-400" />
        <p className="text-sm text-slate-400">Signing you in…</p>
      </div>
    </div>
  );
}
