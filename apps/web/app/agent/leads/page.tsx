"use client";

import React, { useState } from "react";
import LeadsKanban from "@/components/LeadsKanban";

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

export default function LeadsPage() {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  return (
    <div className="p-6 h-full overflow-auto">
      <div className="max-w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Pipeline</h1>
          <p className="text-gray-600">Manage your sales pipeline with drag-and-drop</p>
        </div>

        <LeadsKanban onLeadClick={setSelectedLead} />

        {selectedLead && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">{selectedLead.name}</h2>
                <button
                  onClick={() => setSelectedLead(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-600">Phone</p>
                  <p className="text-gray-900">{selectedLead.phone}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Value</p>
                  <p className="text-lg font-semibold text-green-600">
                    ${selectedLead.value.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <p className="text-gray-900 capitalize">{selectedLead.status}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Assigned To</p>
                  <p className="text-gray-900">{selectedLead.assignee}</p>
                </div>
                <button
                  onClick={() => setSelectedLead(null)}
                  className="w-full mt-4 px-4 py-2 bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200 transition font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
