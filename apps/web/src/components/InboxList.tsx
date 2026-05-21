"use client";

import React, { useState } from "react";

interface Conversation {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  status: "new" | "open" | "pending" | "resolved";
  lastMessageFrom: "inbound" | "outbound";
}

const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "conv-1",
    contactId: "contact-1",
    contactName: "John Smith",
    contactPhone: "+1 (555) 123-4567",
    lastMessage: "Hi, what's the price of your pricing plan?",
    lastMessageTime: "2 min ago",
    unreadCount: 2,
    status: "new",
    lastMessageFrom: "inbound",
  },
  {
    id: "conv-2",
    contactId: "contact-2",
    contactName: "Jane Doe",
    contactPhone: "+1 (555) 234-5678",
    lastMessage: "Thanks for the information!",
    lastMessageTime: "15 min ago",
    unreadCount: 0,
    status: "open",
    lastMessageFrom: "outbound",
  },
  {
    id: "conv-3",
    contactId: "contact-3",
    contactName: "Michael Johnson",
    contactPhone: "+1 (555) 345-6789",
    lastMessage: "I'd like to schedule an appointment",
    lastMessageTime: "1 hour ago",
    unreadCount: 1,
    status: "pending",
    lastMessageFrom: "inbound",
  },
  {
    id: "conv-4",
    contactId: "contact-4",
    contactName: "Sarah Williams",
    contactPhone: "+1 (555) 456-7890",
    lastMessage: "Order confirmed! Your tracking number is...",
    lastMessageTime: "3 hours ago",
    unreadCount: 0,
    status: "resolved",
    lastMessageFrom: "outbound",
  },
  {
    id: "conv-5",
    contactId: "contact-5",
    contactName: "Robert Brown",
    contactPhone: "+1 (555) 567-8901",
    lastMessage: "Can you help me with this issue?",
    lastMessageTime: "5 hours ago",
    unreadCount: 1,
    status: "open",
    lastMessageFrom: "inbound",
  },
];

interface InboxListProps {
  selectedId?: string;
  onSelectConversation: (id: string) => void;
}

export default function InboxList({
  selectedId,
  onSelectConversation,
}: InboxListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  const filtered = MOCK_CONVERSATIONS.filter((conv) => {
    const matchesSearch =
      conv.contactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      conv.contactPhone.includes(searchTerm);
    const matchesFilter = !filterStatus || conv.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const unreadTotal = MOCK_CONVERSATIONS.reduce(
    (sum, conv) => sum + conv.unreadCount,
    0
  );

  const getStatusBadge = (status: string) => {
    const styles: { [key: string]: string } = {
      new: "bg-blue-100 text-blue-800",
      open: "bg-amber-100 text-amber-800",
      pending: "bg-purple-100 text-purple-800",
      resolved: "bg-green-100 text-green-800",
    };
    return styles[status] || "bg-gray-100 text-gray-800";
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Inbox</h2>
          {unreadTotal > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-1">
              {unreadTotal}
            </span>
          )}
        </div>

        {/* Search */}
        <div className="mb-3">
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Filter Buttons */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterStatus(null)}
            className={`px-3 py-1 text-xs font-medium rounded-full transition ${
              filterStatus === null
                ? "bg-blue-500 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            All
          </button>
          {["new", "open", "pending", "resolved"].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition capitalize ${
                filterStatus === status
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            <p className="text-sm">No conversations found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filtered.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition ${
                  selectedId === conv.id ? "bg-blue-50 border-l-4 border-blue-500" : ""
                }`}
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 text-sm">
                      {conv.contactName}
                    </h3>
                    {conv.unreadCount > 0 && (
                      <span className="bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">
                    {conv.lastMessageTime}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mb-2">{conv.contactPhone}</p>
                <p className="text-sm text-gray-600 truncate mb-2">
                  {conv.lastMessageFrom === "inbound" && "📨 "}
                  {conv.lastMessageFrom === "outbound" && "✓ "}
                  {conv.lastMessage}
                </p>
                <span
                  className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full capitalize ${getStatusBadge(
                    conv.status
                  )}`}
                >
                  {conv.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
