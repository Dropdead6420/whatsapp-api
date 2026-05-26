"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";

interface TicketMessage {
  id: string;
  sender: "Client" | "Agency";
  content: string;
  timestamp: string;
}

interface Ticket {
  id: string;
  clientName: string;
  subject: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status: "NEW" | "OPEN" | "RESOLVED";
  date: string;
  messages: TicketMessage[];
}

export default function TicketManagerPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string>("");
  const [replyMessage, setReplyMessage] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "NEW" | "OPEN" | "RESOLVED">("ALL");

  useEffect(() => {
    const stored = localStorage.getItem("nexaflow_tickets");
    if (stored) {
      try {
        setTickets(JSON.parse(stored));
        const parsed = JSON.parse(stored);
        if (parsed.length > 0) setSelectedTicketId(parsed[0].id);
      } catch (e) {}
    } else {
      const initialTickets: Ticket[] = [
        {
          id: "TCK-8092",
          clientName: "Cutz & Bangs Salon",
          subject: "Meta WABA credentials validation failed",
          priority: "HIGH",
          status: "OPEN",
          date: "2026-05-25 11:20",
          messages: [
            { id: "msg-1", sender: "Client", content: "Hi support team, we are trying to verify our WhatsApp display number but it fails with token verification error. Can you help?", timestamp: "2026-05-25 11:20" },
            { id: "msg-2", sender: "Agency", content: "Hi! We've noticed Meta has flagged your accounts due to missing business details. Ensure your display name matches your legal business name in Meta Business Suite.", timestamp: "2026-05-25 11:35" },
            { id: "msg-3", sender: "Client", content: "Thanks, we've updated it. Please check the connection link now.", timestamp: "2026-05-25 11:40" },
          ],
        },
        {
          id: "TCK-7712",
          clientName: "PixelCraft Marketing",
          subject: "Request custom plan upgrade for message limits",
          priority: "MEDIUM",
          status: "NEW",
          date: "2026-05-24 16:05",
          messages: [
            { id: "msg-1", sender: "Client", content: "We are broadcasting an end-of-season sale next week and need to expand our limit from 10k to 50k messages. Please advise.", timestamp: "2026-05-24 16:05" },
          ],
        },
        {
          id: "TCK-6211",
          clientName: "Luxe Spa & Co",
          subject: "Refund duplicate Razorpay wallet recharge",
          priority: "URGENT",
          status: "RESOLVED",
          date: "2026-05-15 09:30",
          messages: [
            { id: "msg-1", sender: "Client", content: "We charged ₹1,000 twice on our wallet recharge. Please refund the secondary charge.", timestamp: "2026-05-15 09:30" },
            { id: "msg-2", sender: "Agency", content: "Refund processed. The transaction credit has been reversed, and you will see the funds returned within 5-7 working days.", timestamp: "2026-05-15 10:10" },
          ],
        },
      ];
      setTickets(initialTickets);
      setSelectedTicketId(initialTickets[0].id);
      localStorage.setItem("nexaflow_tickets", JSON.stringify(initialTickets));
    }
  }, []);

  const saveTickets = (updated: Ticket[]) => {
    setTickets(updated);
    localStorage.setItem("nexaflow_tickets", JSON.stringify(updated));
  };

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) || tickets[0];

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyMessage.trim() || !selectedTicket) return;

    const newMsg: TicketMessage = {
      id: `msg-${Date.now()}`,
      sender: "Agency",
      content: replyMessage,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 16),
    };

    const updated = tickets.map((t) => {
      if (t.id === selectedTicket.id) {
        return {
          ...t,
          status: "OPEN" as const, // Re-opened or kept Open on reply
          messages: [...t.messages, newMsg],
        };
      }
      return t;
    });

    saveTickets(updated);
    setReplyMessage("");
  };

  const handleStatusChange = (status: "NEW" | "OPEN" | "RESOLVED") => {
    if (!selectedTicket) return;
    const updated = tickets.map((t) => {
      if (t.id === selectedTicket.id) {
        return { ...t, status };
      }
      return t;
    });
    saveTickets(updated);
    alert(`Ticket status updated to ${status}.`);
  };

  if (loading || !user) {
    return <div className="p-10 text-center text-sm text-slate-500">Loading Support Tickets…</div>;
  }

  const filteredTickets = filterStatus === "ALL" ? tickets : tickets.filter((t) => t.status === filterStatus);

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">Agency Support Tickets</h1>
        <p className="text-sm text-slate-400">
          Manage client questions, help resolve configuration blockades, and verify subscriptions demands.
        </p>
      </header>

      {/* Grid: Tickets sidebar queue and messaging threads */}
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        
        {/* Sidebar: Tickets Queue */}
        <aside className="space-y-4">
          <div className="flex items-center gap-1.5 border-b border-slate-800 pb-3">
            {(["ALL", "NEW", "OPEN", "RESOLVED"] as const).map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`rounded px-2.5 py-1 text-[10px] font-bold border transition-all duration-300 ${
                  filterStatus === st
                    ? "bg-indigo-600 text-white border-indigo-500 shadow shadow-indigo-600/30"
                    : "border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-900/60 hover:text-white"
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <div className="space-y-2.5 overflow-y-auto max-h-[30rem]">
            {filteredTickets.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTicketId(t.id)}
                className={`w-full rounded-xl border p-4 text-left transition-all duration-300 ${
                  selectedTicket?.id === t.id
                    ? "border-indigo-500 bg-indigo-500/10 text-white shadow shadow-indigo-500/10"
                    : "border-slate-800 bg-slate-900/40 text-slate-300 hover:bg-slate-900/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[9px] font-mono text-slate-500 font-bold">{t.id}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold border ${
                    t.priority === "URGENT"
                      ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                      : t.priority === "HIGH"
                      ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                      : "text-slate-400 bg-slate-500/10 border-slate-500/20"
                  }`}>
                    {t.priority}
                  </span>
                </div>
                <h3 className="font-bold text-xs truncate text-slate-200">{t.subject}</h3>
                <div className="flex justify-between items-center text-[9px] text-slate-500 mt-3 border-t border-slate-800/40 pt-2">
                  <span>{t.clientName}</span>
                  <span className={`font-semibold ${t.status === "RESOLVED" ? "text-emerald-400" : "text-amber-400"}`}>
                    {t.status}
                  </span>
                </div>
              </button>
            ))}
            {filteredTickets.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-xs text-slate-500">
                No tickets matching active filters.
              </div>
            )}
          </div>
        </aside>

        {/* Messaging Area */}
        <main className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur-md min-h-[30rem]">
          {selectedTicket ? (
            <>
              {/* Header card details */}
              <div className="border-b border-slate-800 pb-4 mb-4 flex justify-between items-start gap-4 flex-wrap">
                <div>
                  <h2 className="text-base font-bold text-slate-200">{selectedTicket.subject}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Account: {selectedTicket.clientName} · Date: {selectedTicket.date}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">Change Status:</span>
                  <button
                    onClick={() => handleStatusChange("RESOLVED")}
                    className="rounded bg-emerald-600/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 text-[10px] font-bold hover:bg-emerald-600/20 transition-all"
                  >
                    Mark Resolved
                  </button>
                  <button
                    onClick={() => handleStatusChange("OPEN")}
                    className="rounded bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 px-3 py-1 text-[10px] font-bold hover:bg-indigo-600/20 transition-all"
                  >
                    Set Open
                  </button>
                </div>
              </div>

              {/* Chat timeline history */}
              <div className="flex-1 space-y-4 overflow-y-auto pr-2 max-h-[18rem] mb-4">
                {selectedTicket.messages.map((m) => {
                  const isAgency = m.sender === "Agency";
                  return (
                    <div key={m.id} className={`flex flex-col ${isAgency ? "items-end" : "items-start"}`}>
                      <div className={`max-w-md rounded-xl p-3 border text-xs leading-relaxed ${
                        isAgency 
                          ? "bg-indigo-600 border-indigo-500 text-white rounded-br-none shadow shadow-indigo-600/20" 
                          : "bg-slate-950/60 border-slate-800 text-slate-300 rounded-bl-none"
                      }`}>
                        <div className="font-bold text-[9px] text-slate-400 mb-1">{m.sender} · {m.timestamp}</div>
                        {m.content}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Response textbox input */}
              <form onSubmit={handleSendReply} className="border-t border-slate-800 pt-4 flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="Type support response to client..."
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-xs font-semibold text-white shadow-lg transition-all duration-300"
                >
                  Send Reply
                </button>
              </form>
            </>
          ) : (
            <div className="py-20 text-center text-sm text-slate-500 flex items-center justify-center h-full">
              No tickets selected. Select a card from the queue list to start support chat threads.
            </div>
          )}
        </main>

      </div>
    </PartnerShell>
  );
}
