"use client";

import React from "react";

export default function AgentDashboardPage() {
  return (
    <div className="p-6 h-full overflow-auto">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Dashboard</h1>
        <p className="text-gray-600 mb-6">Welcome to your agent dashboard</p>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <p className="text-sm text-gray-600 mb-2">Open Conversations</p>
            <p className="text-3xl font-bold text-gray-900">12</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <p className="text-sm text-gray-600 mb-2">Pending Responses</p>
            <p className="text-3xl font-bold text-amber-600">5</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <p className="text-sm text-gray-600 mb-2">Total Today</p>
            <p className="text-3xl font-bold text-green-600">38</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <p className="text-sm text-gray-600 mb-2">Avg Response Time</p>
            <p className="text-3xl font-bold text-blue-600">2.3m</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
            <div className="space-y-3">
              <p className="text-sm text-gray-600">No recent activity</p>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h2>
            <div className="space-y-2">
              <p className="text-sm text-gray-600">• Response rate: 98%</p>
              <p className="text-sm text-gray-600">• Resolution time: 1.2h avg</p>
              <p className="text-sm text-gray-600">• Customer satisfaction: 4.8/5</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
