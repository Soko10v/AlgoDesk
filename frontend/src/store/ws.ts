import { create } from "zustand";

type EventItem = {
  type: string;
  [key: string]: unknown;
};

type WsState = {
  events: EventItem[];
  pushEvent: (item: EventItem) => void;
  clear: () => void;
};

export const useWsStore = create<WsState>((set) => ({
  events: [],
  pushEvent: (item) => set((state) => ({ events: [item, ...state.events].slice(0, 100) })),
  clear: () => set({ events: [] }),
}));
