import { create } from "zustand";
import type { Strategy } from "../api/endpoints";

type StrategyState = {
  strategies: Strategy[];
  setStrategies: (items: Strategy[]) => void;
};

export const useStrategyStore = create<StrategyState>((set) => ({
  strategies: [],
  setStrategies: (items) => set({ strategies: items }),
}));
