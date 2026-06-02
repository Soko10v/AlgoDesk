import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { authConfig, me } from "../api/endpoints";
import { useAuthStore } from "../store/auth";

export function useAuthBootstrap() {
  const token = useAuthStore((s) => s.token);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!token) return;
    me()
      .then(setUser)
      .catch(() => logout());
  }, [token, setUser, logout]);
}

export function useAuthConfig() {
  return useQuery({ queryKey: ["auth-config"], queryFn: authConfig, staleTime: Infinity });
}
