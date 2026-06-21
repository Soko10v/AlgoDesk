import axios from "axios";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";

const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", expert: "Expert" };

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000/api/v1";

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("algodesk_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      useAuthStore.getState().logout();
    } else if (status === 402) {
      // Paywall: a gated feature was hit directly. Buttons usually upsell before
      // this, but surface a clear nudge as a safety net.
      const detail = error?.response?.data?.detail;
      const req = PLAN_LABEL[detail?.required_plan] ?? "Pro";
      toast.info(`Нужен тариф ${req}`, "Открой эту функцию на странице «Подписка».");
    }
    return Promise.reject(error);
  }
);
