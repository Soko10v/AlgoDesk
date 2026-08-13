import { create } from "zustand";

export type Lang = "ru" | "en";

const LANG_KEY = "algodesk_lang";

function detectDefault(): Lang {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === "ru" || saved === "en") return saved;
  // Product launched RU-first (SEO, ads, discovery board copy) — default new
  // visitors to Russian and let them switch explicitly.
  return "ru";
}

type LangState = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggle: () => void;
};

export const useLangStore = create<LangState>((set, get) => ({
  lang: detectDefault(),
  setLang: (lang) => {
    localStorage.setItem(LANG_KEY, lang);
    set({ lang });
  },
  toggle: () => get().setLang(get().lang === "ru" ? "en" : "ru"),
}));
