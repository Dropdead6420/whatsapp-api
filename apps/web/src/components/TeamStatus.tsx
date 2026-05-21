"use client";

import React, { useState } from "react";

interface Agent {
  id: string;
  name: string;
  status: "online" | "away" | "offline";
  statusMessage?: string;
  openConversations: number;
  totalHandled: number;
  avatar: string;
}

const MOCK_AGENTS: Agent[] = [
  {
    id: "agent-1",
    name: "Sarah (You)",
    status: "online",
    statusMessage: "Helping customers",
    openConversations: 3,
    totalHandled: 42,
    avatar: "👩",
  },
  {
    id: "agent-2",
    name: "Mike Johnson",
    status: "online",
    statusMessage: "Available",
    openConversations: 2,
    totalHandled: 38,
    avatar: "👨",
  },
  {
    id: "agent-3",
    name: "Alex Chen",
    status: "away",
    statusMessage: "In a meeting",
    openConversations: 1,
    totalHandled: 35,
    avatar: "👨",
  },
  {
    id: "agent-4",
    name: "Jane Martinez",
    status: "offline",
    openConversations: 0,
    totalHandled: 41,
    avatar: "👩",
  },
];

interface TeamStatusProps {
  onAgentClick?: (agent: Agent) => void;
}

export default function TeamStatus({ onAgentClick }: TeamStatusProps) {
  const [agents, setAgents] = useState<Agent[]>(MOCK_AGENTS);
  const [currentUserStatus, setCurrentUserStatus] = useState<
    "online" | "away" | "offline"
  >("online");
  const [statusMessage, setStatusMessage] = useState("Helping customers");

  const updateStatus = (newStatus: typeof currentUserStatus) => {
    setCurrentUserStatus(newStatus);
  };

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      online: "bg-green-500",
      away: "bg-yellow-500",
      offline: "bg-gray-400",
    };
    return colors[status] || "bg-gray-400";
  };

  const getStatusLabel = (status: string) => {
    const labels: { [key: string]: string } = {
      online: "Online",
      away: "Away",
      offline: "Offline",
    };
    return labels[status] || status;
  };

  const onlineAgents = agents.filter((a) => a.status === "online").length;
  const awayAgents = agents.filter((a) => a.status === "away").length;
  const offlineAgents = agents.filter((a) => a.status === "offline").length;
  const totalOpenConversations = agents.reduce(
    (sum, a) => sum + a.openConversations,
    0
  );

  return (
    <div className="space-y-6">
      {/* Current User Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">My Status</h2>
        <div className="space-y-4">
          {/* Status Indicator */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <span className="text-4xl">👩</span>
              <div
                className={`absolute bottom-0 right-0 w-4 h-4 ${getStatusColor(
                  currentUserStatus
                )} rounded-full border-2 border-white`}
              ></div>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Sarah Anderson</h3>
              <p className="text-sm text-gray-600">
                {getStatusLabel(currentUserStatus)}
              </p>
            </div>
          </div>

          {/* Status Buttons */}
          <div className="flex gap-2">
            {["online", "away", "offline"].map((status) => (
              <button
                key={status}
                onClick={() =>
                  updateStatus(status as "online" | "away" | "offline")
                }
                className={`px-4 py-2 rounded-lg font-medium text-sm transition capitalize ${
                  currentUserStatus === status
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                }`}
              >
                {getStatusLabel(status)}
              </button>
            ))}
          </div>

          {/* Status Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Status Message
            </label>
            <input
              type="text"
              value={statusMessage}
              onChange={(e) => setStatusMessage(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What are you working on?"
            />
          </div>
        </div>
      </div>

      {/* Team Statistics */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-green-50 rounded-lg border border-green-200 p-4">
          <p className="text-sm text-green-700 font-medium mb-1">Online</p>
          <p className="text-2xl font-bold text-green-900">{onlineAgents}</p>
        </div>
        <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4">
          <p className="text-sm text-yellow-700 font-medium mb-1">Away</p>
          <p className="text-2xl font-bold text-yellow-900">{awayAgents}</p>
        </div>
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-700 font-medium mb-1">Offline</p>
          <p className="text-2xl font-bold text-gray-900">{offlineAgents}</p>
        </div>
      </div>

      {/* Queue Overview */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Queue Overview
        </h2>
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
          <p className="text-sm text-blue-700 font-medium">
            Total Open Conversations
          </p>
          <p className="text-3xl font-bold text-blue-900 mt-1">
            {totalOpenConversations}
          </p>
        </div>
      </div>

      {/* Team Members */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Team</h2>
        <div className="space-y-3">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onAgentClick?.(agent)}
              className="w-full flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition text-left"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <span className="text-2xl">{agent.avatar}</span>
                  <div
                    className={`absolute bottom-0 right-0 w-3 h-3 ${getStatusColor(
                      agent.status
                    )} rounded-full border-2 border-white`}
                  ></div>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{agent.name}</h3>
                  <p className="text-sm text-gray-600">
                    {agent.statusMessage || getStatusLabel(agent.status)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">
                  {agent.openConversations}
                </p>
                <p className="text-xs text-gray-600">open</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
