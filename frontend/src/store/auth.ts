import { create } from "zustand";
import { supabaseConfigured } from "../lib/supabase";

export type AppUser = {
  id: number;
  email: string | null;
  username: string | null;
} | null;

type AuthState = {
  token: string | null;
  user: AppUser;
  // False until the initial Supabase session (incl. any in-flight OAuth code
  // exchange) has resolved. Protected routes wait on this so they don't bounce
  // to /login before an OAuth redirect finishes establishing the session.
  ready: boolean;
  setToken: (token: string | null) => void;
  setUser: (user: AppUser) => void;
  setReady: (ready: boolean) => void;
  logout: () => void;
};

const TOKEN_KEY = "algodesk_token";

const initialToken = localStorage.getItem(TOKEN_KEY);

export const useAuthStore = create<AuthState>((set) => ({
  token: initialToken,
  user: null,
  // With no Supabase there's no async session to await (Telegram/JWT tokens
  // come straight from localStorage), so auth is ready immediately.
  ready: !supabaseConfigured,
  setToken: (token) => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    set({ token });
  },
  setUser: (user) => set({ user }),
  setReady: (ready) => set({ ready }),
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null, user: null });
  },
}));
