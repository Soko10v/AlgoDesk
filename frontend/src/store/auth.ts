import { create } from "zustand";

export type AppUser = {
  id: number;
  email: string | null;
  username: string | null;
} | null;

type AuthState = {
  token: string | null;
  user: AppUser;
  setToken: (token: string | null) => void;
  setUser: (user: AppUser) => void;
  logout: () => void;
};

const TOKEN_KEY = "algodesk_token";

const initialToken = localStorage.getItem(TOKEN_KEY);

export const useAuthStore = create<AuthState>((set) => ({
  token: initialToken,
  user: null,
  setToken: (token) => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    set({ token });
  },
  setUser: (user) => set({ user }),
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null, user: null });
  },
}));
