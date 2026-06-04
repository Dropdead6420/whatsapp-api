// UI string dictionaries (Claude Final Complete Architecture §9).
//
// English is the reference/fallback. Other locales need only cover the
// keys they've translated — translate() falls back to English, then to
// the key itself, so partial coverage never blanks the UI. This seed set
// proves the system end-to-end (incl. RTL for ar/ur) across the app shell
// and the login surface; the full catalogue + DB-backed PortalTranslation
// overrides land in later slices.

import type { Dict } from "./translate";

const en: Dict = {
  "common.searchPlaceholder": "Search contacts, campaigns...",
  "common.signOut": "Sign out",
  "common.language": "Language",
  "auth.login.title": "Log in",
  "auth.login.subtitle": "Welcome back. Enter your credentials below.",
  "auth.login.continueAfter": "Continue after login.",
  "auth.login.continueWithPlan": "Continue after login with the {plan} plan.",
  "auth.common.email": "Email",
  "auth.common.password": "Password",
  "auth.login.submit": "Log in",
  "auth.login.submitting": "Logging in…",
  "auth.login.resend": "Resend verification email",
  "auth.login.resending": "Sending…",
  "auth.login.forgotPassword": "Forgot password?",
  "auth.login.createAccount": "Create account",
};

const hi: Dict = {
  "common.searchPlaceholder": "संपर्क, अभियान खोजें...",
  "common.signOut": "साइन आउट",
  "common.language": "भाषा",
  "auth.login.title": "लॉग इन करें",
  "auth.login.subtitle": "वापसी पर स्वागत है। नीचे अपनी जानकारी दर्ज करें।",
  "auth.login.continueAfter": "लॉगिन के बाद जारी रखें।",
  "auth.login.continueWithPlan": "लॉगिन के बाद {plan} प्लान के साथ जारी रखें।",
  "auth.common.email": "ईमेल",
  "auth.common.password": "पासवर्ड",
  "auth.login.submit": "लॉग इन करें",
  "auth.login.submitting": "लॉग इन हो रहा है…",
  "auth.login.resend": "सत्यापन ईमेल पुनः भेजें",
  "auth.login.resending": "भेजा जा रहा है…",
  "auth.login.forgotPassword": "पासवर्ड भूल गए?",
  "auth.login.createAccount": "खाता बनाएं",
};

const es: Dict = {
  "common.searchPlaceholder": "Buscar contactos, campañas...",
  "common.signOut": "Cerrar sesión",
  "common.language": "Idioma",
  "auth.login.title": "Iniciar sesión",
  "auth.login.subtitle": "Bienvenido de nuevo. Introduce tus credenciales.",
  "auth.login.continueAfter": "Continuar después de iniciar sesión.",
  "auth.login.continueWithPlan": "Continuar después de iniciar sesión con el plan {plan}.",
  "auth.common.email": "Correo electrónico",
  "auth.common.password": "Contraseña",
  "auth.login.submit": "Iniciar sesión",
  "auth.login.submitting": "Iniciando sesión…",
  "auth.login.resend": "Reenviar correo de verificación",
  "auth.login.resending": "Enviando…",
  "auth.login.forgotPassword": "¿Olvidaste tu contraseña?",
  "auth.login.createAccount": "Crear cuenta",
};

const fr: Dict = {
  "common.searchPlaceholder": "Rechercher contacts, campagnes...",
  "common.signOut": "Se déconnecter",
  "common.language": "Langue",
  "auth.login.title": "Se connecter",
  "auth.login.subtitle": "Bon retour. Saisissez vos identifiants ci-dessous.",
  "auth.login.continueAfter": "Continuer après la connexion.",
  "auth.login.continueWithPlan": "Continuer après la connexion avec le forfait {plan}.",
  "auth.common.email": "E-mail",
  "auth.common.password": "Mot de passe",
  "auth.login.submit": "Se connecter",
  "auth.login.submitting": "Connexion…",
  "auth.login.resend": "Renvoyer l’e-mail de vérification",
  "auth.login.resending": "Envoi…",
  "auth.login.forgotPassword": "Mot de passe oublié ?",
  "auth.login.createAccount": "Créer un compte",
};

const de: Dict = {
  "common.searchPlaceholder": "Kontakte, Kampagnen suchen...",
  "common.signOut": "Abmelden",
  "common.language": "Sprache",
  "auth.login.title": "Anmelden",
  "auth.login.subtitle": "Willkommen zurück. Geben Sie unten Ihre Zugangsdaten ein.",
  "auth.login.continueAfter": "Nach der Anmeldung fortfahren.",
  "auth.login.continueWithPlan": "Nach der Anmeldung mit dem {plan}-Tarif fortfahren.",
  "auth.common.email": "E-Mail",
  "auth.common.password": "Passwort",
  "auth.login.submit": "Anmelden",
  "auth.login.submitting": "Anmeldung…",
  "auth.login.resend": "Bestätigungs-E-Mail erneut senden",
  "auth.login.resending": "Senden…",
  "auth.login.forgotPassword": "Passwort vergessen?",
  "auth.login.createAccount": "Konto erstellen",
};

const ar: Dict = {
  "common.searchPlaceholder": "البحث في جهات الاتصال والحملات...",
  "common.signOut": "تسجيل الخروج",
  "common.language": "اللغة",
  "auth.login.title": "تسجيل الدخول",
  "auth.login.subtitle": "مرحبًا بعودتك. أدخل بيانات اعتمادك أدناه.",
  "auth.login.continueAfter": "المتابعة بعد تسجيل الدخول.",
  "auth.login.continueWithPlan": "المتابعة بعد تسجيل الدخول مع خطة {plan}.",
  "auth.common.email": "البريد الإلكتروني",
  "auth.common.password": "كلمة المرور",
  "auth.login.submit": "تسجيل الدخول",
  "auth.login.submitting": "جارٍ تسجيل الدخول…",
  "auth.login.resend": "إعادة إرسال بريد التحقق",
  "auth.login.resending": "جارٍ الإرسال…",
  "auth.login.forgotPassword": "هل نسيت كلمة المرور؟",
  "auth.login.createAccount": "إنشاء حساب",
};

const ur: Dict = {
  "common.searchPlaceholder": "رابطے، مہمات تلاش کریں...",
  "common.signOut": "سائن آؤٹ",
  "common.language": "زبان",
  "auth.login.title": "لاگ ان کریں",
  "auth.login.subtitle": "واپسی پر خوش آمدید۔ نیچے اپنی تفصیلات درج کریں۔",
  "auth.login.continueAfter": "لاگ ان کے بعد جاری رکھیں۔",
  "auth.login.continueWithPlan": "لاگ ان کے بعد {plan} پلان کے ساتھ جاری رکھیں۔",
  "auth.common.email": "ای میل",
  "auth.common.password": "پاس ورڈ",
  "auth.login.submit": "لاگ ان کریں",
  "auth.login.submitting": "لاگ ان ہو رہا ہے…",
  "auth.login.resend": "تصدیقی ای میل دوبارہ بھیجیں",
  "auth.login.resending": "بھیجا جا رہا ہے…",
  "auth.login.forgotPassword": "پاس ورڈ بھول گئے؟",
  "auth.login.createAccount": "اکاؤنٹ بنائیں",
};

export const MESSAGES: Record<string, Dict> = { en, hi, es, fr, de, ar, ur };

/** English is the fallback dictionary for any missing key. */
export const FALLBACK_DICT = en;

export function dictFor(locale: string): Dict {
  return MESSAGES[locale] ?? FALLBACK_DICT;
}
