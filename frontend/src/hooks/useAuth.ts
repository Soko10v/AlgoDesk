import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { authConfig, me } from "../api/endpoints";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { useAuthStore } from "../store/auth";

export function useAuthBootstrap() {
  const token = useAuthStore((s) => s.token);
  const setToken = useAuthStore((s) => s.setToken);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!supabaseConfigured) return;

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session?.access_token) {
        setToken(data.session.access_token);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) {
        setToken(session.access_token);
      } else if (event === "SIGNED_OUT") {
        logout();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [setToken, logout]);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    me()
      .then(setUser)
      .catch(() => logout());
  }, [token, setUser, logout]);
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
    options: { redirectTo: `${window.location.origin}/login` },
  });
  if (error) throw error;
}
