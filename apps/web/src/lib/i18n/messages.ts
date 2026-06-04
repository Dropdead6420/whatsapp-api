// UI string dictionaries (Claude Final Complete Architecture §9).
//
// English is the reference/fallback. Other locales need only cover the
// keys they've translated — translate() falls back to English, then to
// the key itself, so partial coverage never blanks the UI. This is the
// seed set proving the system end-to-end (incl. RTL for ar/ur); the full
// catalogue + DB-backed PortalTranslation overrides land in later slices.

import type { Dict } from "./translate";

const en: Dict = {
  "common.searchPlaceholder": "Search contacts, campaigns...",
  "common.signOut": "Sign out",
  "common.language": "Language",
};

const hi: Dict = {
  "common.searchPlaceholder": "संपर्क, अभियान खोजें...",
  "common.signOut": "साइन आउट",
  "common.language": "भाषा",
};

const es: Dict = {
  "common.searchPlaceholder": "Buscar contactos, campañas...",
  "common.signOut": "Cerrar sesión",
  "common.language": "Idioma",
};

const fr: Dict = {
  "common.searchPlaceholder": "Rechercher contacts, campagnes...",
  "common.signOut": "Se déconnecter",
  "common.language": "Langue",
};

const de: Dict = {
  "common.searchPlaceholder": "Kontakte, Kampagnen suchen...",
  "common.signOut": "Abmelden",
  "common.language": "Sprache",
};

const ar: Dict = {
  "common.searchPlaceholder": "البحث في جهات الاتصال والحملات...",
  "common.signOut": "تسجيل الخروج",
  "common.language": "اللغة",
};

const ur: Dict = {
  "common.searchPlaceholder": "رابطے، مہمات تلاش کریں...",
  "common.signOut": "سائن آؤٹ",
  "common.language": "زبان",
};

export const MESSAGES: Record<string, Dict> = { en, hi, es, fr, de, ar, ur };

/** English is the fallback dictionary for any missing key. */
export const FALLBACK_DICT = en;

export function dictFor(locale: string): Dict {
  return MESSAGES[locale] ?? FALLBACK_DICT;
}
