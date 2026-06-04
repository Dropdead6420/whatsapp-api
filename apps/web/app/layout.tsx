import type { Metadata } from "next";
import "../src/globals.css";
import { I18nProvider } from "../src/i18n/I18nProvider";

export const metadata: Metadata = {
  title: "NexaFlow AI",
  description: "AI-powered WhatsApp marketing & automation platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // lang/dir are seeded to the default here and updated client-side by the
  // I18nProvider once the saved locale hydrates (incl. RTL for ar/ur).
  return (
    <html lang="en" dir="ltr" className="h-full bg-slate-50">
      <body className="h-full text-slate-900 antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
