import Link from "next/link";
import { ArrowRight, CheckCircle2, Menu } from "lucide-react";

const navItems = [
  { label: "Product", href: "/#product" },
  { label: "AI Agents", href: "/features/ai-agents" },
  { label: "Workflows", href: "/features/workflows" },
  { label: "Pricing", href: "/pricing" },
];

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3" aria-label="NexaFlow AI home">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500 text-sm font-bold text-white shadow-sm">
            N
          </span>
          <span className="text-base font-semibold tracking-tight text-slate-950">
            NexaFlow AI
          </span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-slate-950">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
          >
            Get started
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/#product"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-700 md:hidden"
            aria-label="Open product sections"
          >
            <Menu className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-950 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_2fr] lg:px-8">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500 text-sm font-bold text-white">
              N
            </span>
            <span className="font-semibold text-white">NexaFlow AI</span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
            AI-powered WhatsApp sales, support, automation, and governance for
            growing businesses and agencies.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          <FooterColumn
            title="Product"
            links={[
              ["Inbox", "/features/inbox"],
              ["Campaigns", "/features/campaigns"],
              ["AI Agents", "/features/ai-agents"],
              ["Workflows", "/features/workflows"],
            ]}
          />
          <FooterColumn
            title="Platform"
            links={[
              ["Compliance", "/features/compliance"],
              ["Integrations", "/features/integrations"],
              ["Analytics", "/features/analytics"],
              ["Pricing", "/pricing"],
            ]}
          />
          <FooterColumn
            title="Account"
            links={[
              ["Log in", "/login"],
              ["Create account", "/signup"],
              ["Dashboard", "/dashboard"],
              ["Support", "/dashboard/support"],
            ]}
          />
        </div>
      </div>
      <div className="border-t border-slate-800 px-4 py-5 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} NexaFlow AI. Built for automation-first
        WhatsApp operations.
      </div>
    </footer>
  );
}

export function MarketingPageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-full bg-white text-slate-950">
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </main>
  );
}

export function SectionHeader({
  title,
  description,
  align = "left",
}: {
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <h2 className="text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-base leading-7 text-slate-600 md:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function CheckList({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-sm leading-6 text-slate-700">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<[string, string]>;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <ul className="mt-4 space-y-3 text-sm text-slate-400">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="hover:text-white">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
