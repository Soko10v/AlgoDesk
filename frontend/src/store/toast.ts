import { create } from "zustand";

export type ToastType = "success" | "error" | "info";
export type Toast = { id: number; type: ToastType; title: string; message?: string };

type ToastState = {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

let counter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = ++counter;
    set((state) => ({ toasts: [...state.toasts, { ...t, id }] }));
    setTimeout(() => set((state) => ({ toasts: state.toasts.filter((x) => x.id !== id) })), 4500);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (title: string, message?: string) => useToastStore.getState().push({ type: "success", title, message }),
  error: (title: string, message?: string) => useToastStore.getState().push({ type: "error", title, message }),
  info: (title: string, message?: string) => useToastStore.getState().push({ type: "info", title, message }),
};
