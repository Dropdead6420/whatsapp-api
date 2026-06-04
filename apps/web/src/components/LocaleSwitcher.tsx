"use client";

// Language picker (Claude Final Complete Architecture §9). Lists the
// enabled languages by endonym and switches the active locale, which the
// I18nProvider persists and applies (incl. RTL) across the app.

import { useI18n } from "../i18n/I18nProvider";

export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, languages, t } = useI18n();
  return (
    <select
      aria-label={t("common.language")}
      title={t("common.language")}
      value={locale}
      onChange={(e) => setLocale(e.target.value)}
      className={`rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 ${className}`}
    >
      {languages.map((l) => (
        <option key={l.code} value={l.code}>
          {l.nativeName}
        </option>
      ))}
    </select>
  );
}
