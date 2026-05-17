import type { Metadata } from "next";
import "../src/globals.css";

export const metadata: Metadata = {
  title: "NexaFlow AI",
  description: "AI-powered WhatsApp marketing & automation platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full bg-slate-50">
      <body className="h-full text-slate-900 antialiased">{children}</body>
    </html>
  );
}
