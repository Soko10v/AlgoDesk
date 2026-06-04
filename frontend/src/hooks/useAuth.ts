import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { authConfig, me } from "../api/endpoints";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";

export function useAuthBootstrap() {
  const token = useAuthStore((s) => s.token);
  const setToken = useAuthStore((s) => s.setToken);
  const setUser = useAuthStore((s) => s.setUser);
  const setReady = useAuthStore((s) => s.setReady);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!supabaseConfigured) {
      setReady(true);
      return;
    }

    let active = true;

    // Are we returning from an OAuth provider? Supabase exchanges the `?code`
    // (PKCE) or reads the `#access_token` (implicit) asynchronously, so hold
    // off marking auth "ready" until onAuthStateChange confirms the session —
    // otherwise a protected route can redirect away and drop the OAuth params.
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const oauthError = search.get("error_description") || search.get("error") || hash.get("error");
    const oauthPending = (search.has("code") || hash.has("access_token")) && !oauthError;

    if (oauthError) {
      toast.error("Google sign-in failed", oauthError);
    }

    // Safety net: never leave the app stuck on the loading gate if the code
    // exchange silently fails (e.g. an expired/invalid code).
    const fallback = setTimeout(() => {
      if (active) setReady(true);
    }, 5000);

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session?.access_token) {
        setToken(data.session.access_token);
      }
      if (!oauthPending) setReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) {
        setToken(session.access_token);
      } else if (event === "SIGNED_OUT") {
        logout();
      }
      setReady(true);
    });

    return () => {
      active = false;
      clearTimeout(fallback);
      subscription.unsubscribe();
    };
  }, [setToken, logout, setReady]);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    me()
      .then(setUser)
      .catch((err: { response?: { status?: number } }) => {
        // A 401 means the token was rejected; the axios interceptor already
        // cleared it. Surface why instead of silently bouncing to /login.
        // Keep the session for transient/network errors so a backend blip
        // doesn't log the user out.
        if (err?.response?.status === 401) {
          toast.error("Session expired", "Please sign in again. If this persists, check the server's Supabase settings.");
        }
      });
  }, [token, setUser]);
}

export function useAuthConfig() {
  return useQuery({ queryKey: ["auth-config"], queryFn: authConfig, staleTime: Infinity });
}

export async function signOut() {
  if (supabaseConfigured) {
    await supabase.auth.signOut();
  }
  useAuthStore.getState().logout();
}

export async function signInWithGoogle() {
  if (!supabaseConfigured) {
    throw new Error("Supabase Auth is not configured");
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) throw error;
}
