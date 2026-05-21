"use client";

import React, { useState } from "react";
import InboxList from "@/components/InboxList";
import ChatThread from "@/components/ChatThread";
import ContactCard from "@/components/ContactCard";
import ReplySuggestor from "@/components/ReplySuggestor";

export default function ConversationsPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string>("conv-1");

  const selectedContact = {
    id: "contact-1",
    name: "John Smith",
    phone: "+1 (555) 123-4567",
    email: "john@example.com",
    tags: ["Hot Lead", "Sales", "New"],
    lastInteraction: "2 min ago",
    conversationCount: 3,
  };

  const handleSendMessage = (message: string) => {
    console.log("Sending message:", message);
  };

  const handleSelectSuggestion = (text: string) => {
    console.log("Selected suggestion:", text);
  };

  return (
    <div className="h-full p-4">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[calc(100vh-120px)]">
        <div className="lg:col-span-1">
          <InboxList
            selectedId={selectedConversationId}
            onSelectConversation={setSelectedConversationId}
          />
        </div>

        <div className="lg:col-span-2">
          <ChatThread
            conversationId={selectedConversationId}
            contactName={selectedContact.name}
            contactPhone={selectedContact.phone}
            onSendMessage={handleSendMessage}
          />
        </div>

        <div className="lg:col-span-1 overflow-y-auto">
          <div className="space-y-4">
            <ContactCard contact={selectedContact} />
            <ReplySuggestor onSelectSuggestion={handleSelectSuggestion} />
            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
              <h3 className="font-semibold text-gray-900 mb-3">Actions</h3>
              <button className="w-full px-4 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition">
                🏷️ Add Tag
              </button>
              <button className="w-full px-4 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition">
                👤 Assign to
              </button>
              <button className="w-full px-4 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition">
                ✓ Mark Resolved
              </button>
              <button className="w-full px-4 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition">
                📝 Create Task
              </button>
              <button className="w-full px-4 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50 rounded-lg transition">
                🚫 Add to Blocklist
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
