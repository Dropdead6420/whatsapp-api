import { ReactNode } from "react";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent Portal - NexaFlow",
  description: "Live chat, leads, and task management for agents",
};

interface AgentLayoutProps {
  children: ReactNode;
}

export default function AgentLayout({ children }: AgentLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold text-gray-900">Agent Portal</h1>
            <div className="w-px h-6 bg-gray-200"></div>
            <span className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-sm text-gray-600">Online</span>
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <button className="text-gray-600 hover:text-gray-900 text-sm font-medium">
              Settings
            </button>
            <button className="text-gray-600 hover:text-gray-900 text-sm font-medium">
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 h-[calc(100vh-73px)]">
        {/* Sidebar Navigation */}
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <nav className="p-4 space-y-2">
            <a
              href="/agent/dashboard"
              className="flex items-center space-x-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-50 hover:text-gray-900 font-medium"
            >
              <span className="text-xl">📊</span>
              <span>Dashboard</span>
            </a>
            <a
              href="/agent/conversations"
              className="flex items-center space-x-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-50 hover:text-gray-900 font-medium"
            >
              <span className="text-xl">💬</span>
              <span>Conversations</span>
            </a>
            <a
              href="/agent/leads"
              className="flex items-center space-x-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-50 hover:text-gray-900 font-medium"
            >
              <span className="text-xl">📈</span>
              <span>Leads</span>
            </a>
            <a
              href="/agent/tasks"
              className="flex items-center space-x-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-50 hover:text-gray-900 font-medium"
            >
              <span className="text-xl">✓</span>
              <span>Tasks</span>
            </a>
            <a
              href="/agent/team"
              className="flex items-center space-x-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-50 hover:text-gray-900 font-medium"
            >
              <span className="text-xl">👥</span>
              <span>Team</span>
            </a>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
