import Link from "next/link";

const FEATURES = [
  {
    title: "AI Campaign Autopilot",
    body: "Type a goal — \"more bookings this weekend\" — and AI plans the audience, the copy, the send time, and the follow-up.",
  },
  {
    title: "AI Smart Segmentation",
    body: "Ask in plain English: \"show inactive customers likely to churn.\" Audiences build themselves.",
  },
  {
    title: "AI Lead Scoring",
    body: "Every contact gets a score. Your team works the hottest leads first, automatically.",
  },
  {
    title: "AI Reply Assistant",
    body: "Agents reply 3× faster. Claude reads the chat and drafts three on-brand options.",
  },
  {
    title: "Sentiment Radar",
    body: "Spot frustrated customers before they leave. Conversation tone is tracked automatically.",
  },
  {
    title: "Outcome Analytics",
    body: "Track revenue, bookings, and retention — not just delivery rates.",
  },
];

const OUTCOMES = [
  { label: "More bookings", hint: "Weekend re-engagement" },
  { label: "More repeat customers", hint: "AI win-back flows" },
  { label: "More qualified leads", hint: "Lead scoring + auto-follow-up" },
  { label: "Less agent time", hint: "AI reply suggestions" },
];

export default function LandingPage() {
  return (
    <main className="flex min-h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500 text-white">
              N
            </span>
            NexaFlow AI
          </div>
          <nav className="flex items-center gap-3 text-sm">
            <Link
              href="/login"
              className="rounded-md px-3 py-1.5 text-slate-600 hover:text-slate-900"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
            >
              Get started free
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-6xl px-6 pt-20 pb-12">
        <span className="mb-3 inline-flex w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          The AI Customer Growth OS
        </span>
        <h1 className="max-w-4xl text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
          Get more bookings, leads, and repeat customers with{" "}
          <span className="text-emerald-600">AI-powered WhatsApp automation.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-600">
          NexaFlow isn't another WhatsApp tool. It's an AI growth platform that
          finds your best customers, writes your campaigns, scores your leads,
          and replies on your behalf — so your team can focus on revenue.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800"
          >
            Start free →
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-medium hover:bg-slate-50"
          >
            I have an account
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Built for salons, clinics, coaches, e-commerce, and agencies.
        </p>
      </section>

      {/* Outcome strip */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-6 py-8 md:grid-cols-4">
          {OUTCOMES.map((o) => (
            <div key={o.label}>
              <div className="text-sm font-semibold text-slate-900">{o.label}</div>
              <div className="text-xs text-slate-500">{o.hint}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto w-full max-w-6xl px-6 py-20">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          AI sits inside every workflow.
        </h2>
        <p className="mt-2 max-w-2xl text-slate-600">
          Other platforms give you tools. NexaFlow makes the decisions.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-sm"
            >
              <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                ✦
              </div>
              <h3 className="text-base font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-200 bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl px-6 py-16 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Stop sending messages. Start growing customers.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-300">
            Most platforms broadcast. NexaFlow predicts, decides, and acts.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-flex rounded-md bg-emerald-500 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-400"
          >
            Get started free
          </Link>
        </div>
      </section>

      <footer className="bg-slate-950 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} NexaFlow AI — The AI Customer Growth OS.
      </footer>
    </main>
  );
}
