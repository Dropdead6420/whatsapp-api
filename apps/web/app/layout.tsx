import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NexaFlow AI - WhatsApp Marketing Automation",
  description:
    "AI-powered WhatsApp marketing and automation platform for businesses",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
