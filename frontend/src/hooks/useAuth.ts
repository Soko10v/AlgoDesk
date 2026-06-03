import { useEffect } from "react";
import { me } from "../api/endpoints";
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
      const accessToken = data.session?.access_token ?? null;
      setToken(accessToken);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setToken(session?.access_token ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [setToken]);

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

export async function signOut() {
  if (supabaseConfigured) {
    await supabase.auth.signOut();
  }
  useAuthStore.getState().logout();
}
