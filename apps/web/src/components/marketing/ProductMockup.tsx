import {
  BarChart3,
  Bot,
  CheckCircle2,
  GitBranch,
  Inbox,
  Megaphone,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { platformSignals } from "./data";

const conversations = [
  {
    name: "Priya",
    message: "Need a hair spa slot tomorrow.",
    tag: "Booking",
    tone: "Warm",
  },
  {
    name: "Arjun",
    message: "Can you share bridal package pricing?",
    tag: "Hot lead",
    tone: "Ready",
  },
  {
    name: "Meera",
    message: "I want to reschedule my appointment.",
    tag: "Support",
    tone: "Neutral",
  },
];

const flowNodes = [
  { label: "Keyword", icon: Inbox, color: "text-cyan-600" },
  { label: "AI Agent", icon: Bot, color: "text-violet-600" },
  { label: "Template", icon: Megaphone, color: "text-emerald-600" },
  { label: "Compliance", icon: ShieldCheck, color: "text-amber-600" },
];

export function HeroProductMockup() {
  return (
    <div className="relative mx-auto max-w-3xl lg:max-w-none">
      <div className="rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-200/80">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-rose-400" />
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            <span className="h-3 w-3 rounded-full bg-emerald-400" />
          </div>
          <span className="text-xs font-medium text-slate-500">NexaFlow workspace</span>
        </div>

        <div className="grid min-h-[520px] bg-slate-50 md:grid-cols-[240px_1fr]">
          <aside className="hidden border-r border-slate-200 bg-white p-4 md:block">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Modules
            </div>
            <div className="mt-4 space-y-1">
              {[
                ["Inbox", Inbox],
                ["Campaigns", Megaphone],
                ["AI Agents", Bot],
                ["Workflows", GitBranch],
                ["Analytics", BarChart3],
              ].map(([label, Icon]) => (
                <div
                  key={label as string}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                    label === "Inbox"
                      ? "bg-emerald-50 font-semibold text-emerald-700"
                      : "text-slate-600"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label as string}
                </div>
              ))}
            </div>
            <div className="mt-8 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                <Sparkles className="h-4 w-4" />
                AI suggestion
              </div>
              <p className="mt-2 text-xs leading-5 text-emerald-900">
                Ask for preferred slot, then offer package upgrade if available.
              </p>
            </div>
          </aside>

          <div className="p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <section className="rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">
                      Priority conversations
                    </div>
                    <div className="text-xs text-slate-500">AI-ranked for today</div>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                    18 open
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {conversations.map((item) => (
                    <div key={item.name} className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-slate-950">{item.name}</div>
                        <span className="rounded-md bg-cyan-50 px-2 py-1 text-xs font-medium text-cyan-700">
                          {item.tag}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{item.message}</p>
                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        Sentiment: {item.tone}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-950">
                    AI Agent test run
                  </div>
                  <div className="mt-3 rounded-md bg-slate-950 p-3 text-sm leading-6 text-white">
                    "Sure, we have 11:30 AM and 4:00 PM open. Would you like me to
                    reserve one?"
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md bg-violet-50 px-2 py-1 font-medium text-violet-700">
                      Knowledge matched
                    </span>
                    <span className="rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                      Safe to send
                    </span>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-950">
                    Active workflow
                  </div>
                  <div className="mt-4 space-y-2">
                    {flowNodes.map((node, index) => (
                      <div key={node.label} className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white">
                          <node.icon className={`h-4 w-4 ${node.color}`} />
                        </div>
                        <div className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                          {node.label}
                        </div>
                        {index < flowNodes.length - 1 ? (
                          <span className="text-xs text-slate-400">→</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {platformSignals.map((signal) => (
                <div
                  key={signal.label}
                  className="rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <signal.icon className="h-4 w-4 text-emerald-500" />
                    {signal.label}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">
                    {signal.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CompactProductPreview() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/70">
      <div className="grid gap-3 sm:grid-cols-3">
        {flowNodes.slice(1).map((node) => (
          <div key={node.label} className="rounded-lg border border-slate-200 p-4">
            <node.icon className={`h-5 w-5 ${node.color}`} />
            <div className="mt-4 text-sm font-semibold text-slate-950">
              {node.label}
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-500">
              Configured, tested, and tenant-scoped.
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
