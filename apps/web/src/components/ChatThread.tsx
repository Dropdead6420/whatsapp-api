"use client";

import React, { useState } from "react";

interface Message {
  id: string;
  body: string;
  from: "inbound" | "outbound";
  timestamp: string;
  status: "sending" | "sent" | "delivered" | "read";
  mediaUrl?: string;
}

interface ChatThreadProps {
  conversationId: string;
  contactName: string;
  contactPhone: string;
  onSendMessage: (message: string) => void;
}

const MOCK_MESSAGES: Message[] = [
  {
    id: "msg-1",
    body: "Hi there! I'm interested in your services.",
    from: "inbound",
    timestamp: "10:30 AM",
    status: "read",
  },
  {
    id: "msg-2",
    body: "Great! I'd be happy to help. What can I assist you with?",
    from: "outbound",
    timestamp: "10:31 AM",
    status: "delivered",
  },
  {
    id: "msg-3",
    body: "I'd like to know more about your pricing plans.",
    from: "inbound",
    timestamp: "10:32 AM",
    status: "read",
  },
  {
    id: "msg-4",
    body: "We have three main plans:\n1. Starter - $29/month\n2. Pro - $79/month\n3. Enterprise - Custom pricing",
    from: "outbound",
    timestamp: "10:33 AM",
    status: "delivered",
  },
  {
    id: "msg-5",
    body: "Thanks! Which plan would you recommend for a small team?",
    from: "inbound",
    timestamp: "10:35 AM",
    status: "read",
  },
];

export default function ChatThread({
  conversationId,
  contactName,
  contactPhone,
  onSendMessage,
}: ChatThreadProps) {
  const [messages, setMessages] = useState<Message[]>(MOCK_MESSAGES);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      body: inputValue,
      from: "outbound",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: "sending",
    };

    setMessages([...messages, newMessage]);
    setInputValue("");

    try {
      setIsLoading(true);
      onSendMessage(inputValue);
      // Simulate delivery
      setTimeout(() => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === newMessage.id ? { ...msg, status: "delivered" } : msg
          )
        );
      }, 500);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "sending":
        return "⏱️";
      case "sent":
        return "✓";
      case "delivered":
        return "✓✓";
      case "read":
        return "✓✓";
      default:
        return "";
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div>
          <h2 className="font-semibold text-gray-900">{contactName}</h2>
          <p className="text-xs text-gray-600">{contactPhone}</p>
        </div>
        <div className="flex gap-2">
          <button className="p-2 hover:bg-gray-100 rounded-lg transition">
            📞
          </button>
          <button className="p-2 hover:bg-gray-100 rounded-lg transition">
            ℹ️
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.from === "outbound" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                msg.from === "outbound"
                  ? "bg-blue-500 text-white rounded-br-none"
                  : "bg-gray-100 text-gray-900 rounded-bl-none"
              }`}
            >
              <p className="text-sm break-words whitespace-pre-wrap">
                {msg.body}
              </p>
              {msg.mediaUrl && (
                <div className="mt-2 bg-black bg-opacity-20 rounded p-2">
                  <p className="text-xs">📎 {msg.mediaUrl.split("/").pop()}</p>
                </div>
              )}
              <div
                className={`flex items-center justify-end gap-1 mt-1 text-xs ${
                  msg.from === "outbound"
                    ? "text-blue-100"
                    : "text-gray-500"
                }`}
              >
                <span>{msg.timestamp}</span>
                {msg.from === "outbound" && (
                  <span>{getStatusIcon(msg.status)}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 p-4 space-y-3">
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <button
            type="button"
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            📎
          </button>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 transition font-medium"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
