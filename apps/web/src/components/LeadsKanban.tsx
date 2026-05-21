"use client";

import React, { useState } from "react";

interface Lead {
  id: string;
  name: string;
  phone: string;
  value: number;
  assignee: string;
  tags: string[];
  status: "new" | "qualified" | "negotiation" | "closed";
  lastUpdated: string;
}

const MOCK_LEADS: Lead[] = [
  {
    id: "lead-1",
    name: "John Smith",
    phone: "+1 (555) 123-4567",
    value: 5000,
    assignee: "Sarah (You)",
    tags: ["Hot", "Enterprise"],
    status: "new",
    lastUpdated: "2 hours ago",
  },
  {
    id: "lead-2",
    name: "Tech Startup Inc",
    phone: "+1 (555) 234-5678",
    value: 15000,
    assignee: "Mike",
    tags: ["VIP"],
    status: "qualified",
    lastUpdated: "4 hours ago",
  },
  {
    id: "lead-3",
    name: "Jane Doe",
    phone: "+1 (555) 345-6789",
    value: 3000,
    assignee: "You",
    tags: ["SMB"],
    status: "negotiation",
    lastUpdated: "1 day ago",
  },
  {
    id: "lead-4",
    name: "Global Corp",
    phone: "+1 (555) 456-7890",
    value: 25000,
    assignee: "Alex",
    tags: ["Enterprise", "Closed Won"],
    status: "closed",
    lastUpdated: "3 days ago",
  },
];

interface LeadsKanbanProps {
  onLeadClick?: (lead: Lead) => void;
}

export default function LeadsKanban({ onLeadClick }: LeadsKanbanProps) {
  const [leads, setLeads] = useState<Lead[]>(MOCK_LEADS);
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);

  const columns: { id: Lead["status"]; label: string; color: string }[] = [
    { id: "new", label: "New", color: "bg-blue-50 border-blue-200" },
    {
      id: "qualified",
      label: "Qualified",
      color: "bg-purple-50 border-purple-200",
    },
    {
      id: "negotiation",
      label: "Negotiation",
      color: "bg-amber-50 border-amber-200",
    },
    { id: "closed", label: "Closed", color: "bg-green-50 border-green-200" },
  ];

  const getLeadsByStatus = (status: Lead["status"]) =>
    leads.filter((lead) => lead.status === status);

  const handleDragStart = (lead: Lead) => {
    setDraggedLead(lead);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (newStatus: Lead["status"]) => {
    if (!draggedLead) return;

    setLeads(
      leads.map((lead) =>
        lead.id === draggedLead.id
          ? { ...lead, status: newStatus, lastUpdated: "Just now" }
          : lead
      )
    );
    setDraggedLead(null);
  };

  const totalValue = leads.reduce((sum, lead) => sum + lead.value, 0);

  return (
    <div className="space-y-4">
      {/* Header Stats */}
      <div className="grid grid-cols-4 gap-4">
        {columns.map((col) => {
          const colLeads = getLeadsByStatus(col.id);
          const colValue = colLeads.reduce((sum, lead) => sum + lead.value, 0);
          return (
            <div key={col.id} className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-700 mb-1">
                {col.label}
              </p>
              <p className="text-2xl font-bold text-gray-900 mb-2">
                {colLeads.length}
              </p>
              <p className="text-xs text-gray-600">
                ${(colValue / 1000).toFixed(1)}k value
              </p>
            </div>
          );
        })}
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {columns.map((column) => (
          <div
            key={column.id}
            className={`rounded-lg border-2 p-4 min-h-[500px] ${column.color}`}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(column.id)}
          >
            <h3 className="font-semibold text-gray-900 mb-4">{column.label}</h3>

            <div className="space-y-3">
              {getLeadsByStatus(column.id).map((lead) => (
                <div
                  key={lead.id}
                  draggable
                  onDragStart={() => handleDragStart(lead)}
                  onClick={() => onLeadClick?.(lead)}
                  className="bg-white rounded-lg border border-gray-200 p-3 cursor-move hover:shadow-md transition hover:border-gray-300"
                >
                  <h4 className="font-semibold text-gray-900 text-sm mb-1">
                    {lead.name}
                  </h4>
                  <p className="text-xs text-gray-600 mb-2">{lead.phone}</p>

                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-green-600">
                      ${lead.value.toLocaleString()}
                    </span>
                  </div>

                  {lead.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {lead.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-gray-600 border-t border-gray-100 pt-2">
                    <span>{lead.assignee}</span>
                    <span>{lead.lastUpdated}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">Total Pipeline Value</p>
          <p className="text-2xl font-bold text-gray-900">
            ${(totalValue / 1000).toFixed(1)}k
          </p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition font-medium text-sm">
            ➕ New Lead
          </button>
          <button className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200 transition font-medium text-sm">
            📊 Analytics
          </button>
        </div>
      </div>
    </div>
  );
}
