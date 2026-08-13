import { useLangStore } from "../store/lang";
import { en } from "./locales/en";
import { ru } from "./locales/ru";

export const dictionaries = { ru, en };

export type TranslationKey = keyof typeof ru;

/** `{name}`-style interpolation in a translated string. */
function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  let out = str;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** `t(key, vars?)` bound to the current language. Falls back to Russian (the
 *  source language every key is authored in first) if a translation is missing,
 *  so a gap in en.ts degrades to readable text instead of a raw key. */
export function useT() {
  const lang = useLangStore((s) => s.lang);
  const dict = dictionaries[lang];
  return (key: TranslationKey, vars?: Record<string, string | number>): string =>
    interpolate((dict as Record<string, string>)[key] ?? ru[key] ?? key, vars);
}
