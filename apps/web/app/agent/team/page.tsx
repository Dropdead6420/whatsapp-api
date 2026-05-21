"use client";

import React from "react";
import TeamStatus from "@/components/TeamStatus";

interface Agent {
  id: string;
  name: string;
  status: "online" | "away" | "offline";
  statusMessage?: string;
  openConversations: number;
  totalHandled: number;
  avatar: string;
}

export default function TeamPage() {
  const handleAgentClick = (agent: Agent) => {
    console.log("Agent clicked:", agent);
  };

  return (
    <div className="p-6 h-full overflow-auto">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Team</h1>
          <p className="text-gray-600">Monitor team status and manage conversations</p>
        </div>

        <TeamStatus onAgentClick={handleAgentClick} />
      </div>
    </div>
  );
}
