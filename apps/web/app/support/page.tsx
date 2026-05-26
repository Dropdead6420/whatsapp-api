"use client";

import { useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { HelpCircle, AlertOctagon, MessageSquare, Send, CheckCircle, ChevronRight, Plus, Search, Paperclip } from "lucide-react";

export default function SupportPage() {
  const { user, loading, signOut } = useAuth({ required: true });

  const [activeTab, setActiveTab] = useState<"open" | "resolved">("open");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>("t1");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [replyText, setReplyText] = useState("");

  // New ticket form states
  const [newTicket, setNewTicket] = useState({
    subject: "",
    category: "Meta WABA API",
    priority: "Medium",
    body: "",
  });

  // Support Tickets Lists mock
  const [tickets, setTickets] = useState([
    { id: "t1", subject: "Meta WhatsApp templates approval delay", category: "Meta WABA API", priority: "High", status: "OPEN", date: "2026-05-25", messagesCount: 3 },
    { id: "t2", subject: "Auto-recharge failed on Stripe", category: "Billing & Wallet", priority: "Medium", status: "OPEN", date: "2026-05-24", messagesCount: 1 },
    { id: "t3", subject: "API webhook endpoint returning 500 timeouts", category: "API Webhooks", priority: "High", status: "OPEN", date: "2026-05-23", messagesCount: 5 },
    { id: "t4", subject: "How to configure custom SMS fallback?", category: "General Support", priority: "Low", status: "RESOLVED", date: "2026-05-20", messagesCount: 2 },
  ]);

  // Messages logs inside active ticket t1
  const [ticketMessages, setTicketMessages] = useState<Record<string, Array<{ sender: "user" | "support"; name: string; avatar: string; body: string; time: string }>>>({
    t1: [
      { sender: "user", name: "Sidharth Kumar", avatar: "S", body: "Hi, I submitted three campaign templates for salon bookings re-engagement yesterday but they are still stuck in 'PENDING_APPROVAL' on Meta Commerce settings. Can you expedite this?", time: "May 25, 4:20 PM" },
      { sender: "support", name: "Sarah (Support Executive)", avatar: "A", body: "Hello Sidharth! We noticed that your templates containing '{{bookingLink}}' variables were missing a sample link placeholder in the request. Meta requires a raw sample URL for verification. We have modified your template submission and resubmitted it to Meta. Approval usually propagates within 2-4 hours now.", time: "May 25, 5:10 PM" },
      { sender: "user", name: "Sidharth Kumar", avatar: "S", body: "Ah, I see! Thanks for fixing that. I will wait for it to clear. Is there a way to validate placeholders inside NexaFlow before submitting next time?", time: "May 25, 5:45 PM" },
    ],
    t2: [
      { sender: "user", name: "Sidharth Kumar", avatar: "S", body: "My wallet failed to auto-recharge despite reaching the $20 threshold. The logs show a transaction timeout.", time: "May 24, 2:10 PM" },
    ],
    t3: [
      { sender: "user", name: "Sidharth Kumar", avatar: "S", body: "Webhook endpoints are failing. Please assist.", time: "May 23, 11:30 AM" },
    ],
  });

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading...</div>;

  const currentMessages = selectedTicketId ? ticketMessages[selectedTicketId] || [] : [];
  const selectedTicketObj = tickets.find((t) => t.id === selectedTicketId);

  const filteredTickets = tickets.filter((t) =>
    activeTab === "open" ? t.status === "OPEN" : t.status === "RESOLVED"
  );

  function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!newTicket.subject || !newTicket.body) return;
    const addedTicket = {
      id: `t${tickets.length + 1}`,
      subject: newTicket.subject,
      category: newTicket.category,
      priority: newTicket.priority,
      status: "OPEN",
      date: new Date().toISOString().split("T")[0],
      messagesCount: 1,
    };
    setTickets((prev) => [addedTicket, ...prev]);
    setTicketMessages((prev) => ({
      ...prev,
      [addedTicket.id]: [{ sender: "user", name: "Sidharth Kumar", avatar: "S", body: newTicket.body, time: "Just now" }],
    }));
    setSelectedTicketId(addedTicket.id);
    setNewTicket({ subject: "", category: "Meta WABA API", priority: "Medium", body: "" });
    setShowCreateModal(false);
  }

  function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim() || !selectedTicketId) return;
    const newMsg = {
      sender: "user" as const,
      name: "Sidharth Kumar",
      avatar: "S",
      body: replyText,
      time: "Just now",
    };
    setTicketMessages((prev) => ({
      ...prev,
      [selectedTicketId]: [...(prev[selectedTicketId] || []), newMsg],
    }));
    setReplyText("");
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 mb-2 border border-emerald-100">
            NexaFlow Helpdesk
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Support Ticket Center
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Open troubleshooting queries, submit Meta API complaints, and check active ticketing statuses.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="rounded-lg bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-sm flex items-center gap-1 transition-all active:scale-95 self-start"
        >
          <Plus className="h-4 w-4" />
          <span>New Ticket</span>
        </button>
      </header>

      {/* Ticket center split-pane layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Tickets listings */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
            <div className="flex rounded-xl bg-slate-100 p-1">
              <button
                onClick={() => setActiveTab("open")}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                  activeTab === "open" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                }`}
              >
                Open Tickets
              </button>
              <button
                onClick={() => setActiveTab("resolved")}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                  activeTab === "resolved" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                }`}
              >
                Resolved
              </button>
            </div>

            {/* Tickets stack */}
            <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
              {filteredTickets.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTicketId(t.id)}
                  className={`rounded-xl border p-3 cursor-pointer transition-all hover:bg-slate-50/50 ${
                    selectedTicketId === t.id
                      ? "border-emerald-500 bg-emerald-50/10 shadow-sm"
                      : "border-slate-100 bg-white"
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                      {t.category}
                    </span>
                    <span className={`text-[9px] font-bold uppercase ${
                      t.priority === "High" ? "text-red-600" : t.priority === "Medium" ? "text-amber-600" : "text-slate-400"
                    }`}>
                      {t.priority}
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-xs mt-1.5 truncate" title={t.subject}>
                    {t.subject}
                  </h4>
                  <div className="mt-2 flex justify-between items-center text-[10px] text-slate-400">
                    <span>{t.date}</span>
                    <span className="flex items-center gap-1 font-medium text-indigo-500">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {t.messagesCount}
                    </span>
                  </div>
                </div>
              ))}
              {filteredTickets.length === 0 && (
                <p className="text-center text-slate-400 text-xs py-8">No tickets found.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Columns: Active Ticket Message Timeline */}
        <div className="lg:col-span-2">
          {selectedTicketObj ? (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col h-[calc(100vh-220px)] overflow-hidden">
              {/* Active Ticket Header */}
              <div className="bg-slate-950 text-white p-4 flex justify-between items-center border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex rounded-md bg-slate-800 px-2 py-0.5 text-[9px] font-bold text-slate-300 border border-slate-700">
                      {selectedTicketObj.category}
                    </span>
                    <span className={`text-[9px] font-bold ${selectedTicketObj.priority === "High" ? "text-red-400" : "text-amber-400"}`}>
                      {selectedTicketObj.priority} priority
                    </span>
                  </div>
                  <h3 className="font-extrabold text-xs sm:text-sm mt-1">{selectedTicketObj.subject}</h3>
                </div>
                <div className="text-right text-[10px] text-slate-400">
                  <span>Ticket ID: {selectedTicketObj.id}</span>
                </div>
              </div>

              {/* Message History Thread Timeline */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
                {currentMessages.map((msg, idx) => (
                  <div key={idx} className={`flex gap-3 max-w-2xl ${msg.sender === "user" ? "ml-auto flex-row-reverse" : ""}`}>
                    <div className="h-8 w-8 rounded-full bg-slate-900 border border-slate-700 text-white flex items-center justify-center font-bold text-xs shrink-0 select-none">
                      {msg.avatar}
                    </div>
                    <div className={`rounded-2xl p-4.5 space-y-1 shadow-sm border ${
                      msg.sender === "user"
                        ? "bg-slate-900 border-slate-800 text-white"
                        : "bg-white border-slate-200 text-slate-800"
                    }`}>
                      <div className="flex justify-between items-center gap-4 text-[10px] opacity-75 font-semibold">
                        <span>{msg.name}</span>
                        <span>{msg.time}</span>
                      </div>
                      <p className="text-xs leading-relaxed font-sans">{msg.body}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply message text form */}
              {selectedTicketObj.status === "OPEN" && (
                <form onSubmit={handleSendReply} className="border-t border-slate-100 bg-white p-3 flex gap-2 items-center">
                  <button type="button" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 border border-transparent transition-all">
                    <Paperclip className="h-4.5 w-4.5" />
                  </button>
                  <input
                    type="text"
                    placeholder="Describe your issue reply or follow up..."
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-500 bg-slate-50/50"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm flex items-center gap-1 transition-all active:scale-95 shrink-0"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Send</span>
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm max-w-md mx-auto">
              <HelpCircle className="mx-auto h-12 w-12 text-slate-300 mb-2" />
              <h3 className="font-bold text-slate-800 text-sm">Select a ticket</h3>
              <p className="text-xs text-slate-400 mt-1">Select an open ticketing file from the side column stack to begin messaging support.</p>
            </div>
          )}
        </div>
      </div>

      {/* Create Support Ticket Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-md p-4 animate-fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-slide-up">
            <div className="bg-slate-950 text-white p-4 flex justify-between items-center">
              <h3 className="font-bold text-sm">Create Support Ticket</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white text-xs font-bold"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-600 mb-1">Subject Brief</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. My Meta Cloud API is returning timeouts"
                  value={newTicket.subject}
                  onChange={(e) => setNewTicket((prev) => ({ ...prev, subject: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-600 mb-1">Category</label>
                  <select
                    value={newTicket.category}
                    onChange={(e) => setNewTicket((prev) => ({ ...prev, category: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 outline-none focus:border-indigo-500 bg-white"
                  >
                    <option>Meta WABA API</option>
                    <option>Billing & Wallet</option>
                    <option>API Webhooks</option>
                    <option>General Support</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-600 mb-1">Priority</label>
                  <select
                    value={newTicket.priority}
                    onChange={(e) => setNewTicket((prev) => ({ ...prev, priority: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 outline-none focus:border-indigo-500 bg-white"
                  >
                    <option>High</option>
                    <option>Medium</option>
                    <option>Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-600 mb-1">Describe Issue Details</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Describe your issue in detail. Add any diagnostic errors or code snippets here."
                  value={newTicket.body}
                  onChange={(e) => setNewTicket((prev) => ({ ...prev, body: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 transition-all active:scale-95 mt-4"
              >
                Submit Ticket File
              </button>
            </form>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
