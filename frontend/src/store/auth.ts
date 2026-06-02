import { create } from "zustand";

type User = { id: number; username: string | null; telegram_id: number } | null;

type AuthState = {
  token: string | null;
  user: User;
  setToken: (token: string | null) => void;
  setUser: (user: User) => void;
  logout: () => void;
};

const initialToken = localStorage.getItem("algodesk_token");

export const useAuthStore = create<AuthState>((set) => ({
  token: initialToken,
  user: null,
  setToken: (token) => {
    if (token) {
      localStorage.setItem("algodesk_token", token);
    } else {
      localStorage.removeItem("algodesk_token");
    }
    set({ token });
  },
  setUser: (user) => set({ user }),
  logout: () => {
    localStorage.removeItem("algodesk_token");
    set({ token: null, user: null });
  },
}));
