"use client";

import React from "react";
import TaskList from "@/components/TaskList";

interface Task {
  id: string;
  title: string;
  description?: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string;
  assignee: string;
  conversationId?: string;
  createdAt: string;
}

export default function TasksPage() {
  const handleTaskClick = (task: Task) => {
    console.log("Task clicked:", task);
  };

  return (
    <div className="p-6 h-full overflow-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Tasks</h1>
          <p className="text-gray-600">Keep track of your tasks and priorities</p>
        </div>

        <TaskList onTaskClick={handleTaskClick} />
      </div>
    </div>
  );
}
