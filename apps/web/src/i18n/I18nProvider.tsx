"use client";

// Client-side i18n context (Claude Final Complete Architecture §9).
//
// Holds the active locale, exposes t() + dir + the enabled language list,
// persists the choice to localStorage, and reflects locale onto
// <html lang/dir> so RTL (Urdu/Arabic) flips the whole document. No URL
// locale routing — the app is client-rendered behind JWT auth, so a
// context keeps it simple and dependency-free. A later slice can seed the
// initial locale from the customer's saved language setting.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LANGUAGES,
  directionOf,
  resolveLocale,
  type Direction,
  type LanguageDef,
} from "../lib/i18n/config";
import { dictFor, FALLBACK_DICT } from "../lib/i18n/messages";
import { translate } from "../lib/i18n/translate";

const STORAGE_KEY = "nexaflow.locale";

export interface I18nContextValue {
  locale: string;
  dir: Direction;
  languages: readonly LanguageDef[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (code: string) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: string;
}) {
  const [locale, setLocaleState] = useState(
    resolveLocale(initialLocale ?? DEFAULT_LOCALE),
  );

  // Hydrate the saved preference after mount (avoids SSR/client mismatch).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setLocaleState(resolveLocale(saved));
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  // Reflect locale onto the document for a11y + RTL layout.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dir = directionOf(locale);
  }, [locale]);

  const setLocale = useCallback((code: string) => {
    const next = resolveLocale(code);
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failure */
    }
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const dict = dictFor(locale);
    return {
      locale,
      dir: directionOf(locale),
      languages: LANGUAGES.filter((l) => l.enabled),
      t: (key, vars) => translate(dict, key, vars, FALLBACK_DICT),
      setLocale,
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an <I18nProvider>.");
  }
  return ctx;
}
