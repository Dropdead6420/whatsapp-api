"use client";

import React, { useState } from "react";

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

const MOCK_TASKS: Task[] = [
  {
    id: "task-1",
    title: "Follow up with Tech Startup Inc",
    description: "Send pricing proposal",
    status: "todo",
    priority: "high",
    dueDate: "Today, 3:00 PM",
    assignee: "You",
    conversationId: "conv-2",
    createdAt: "2 hours ago",
  },
  {
    id: "task-2",
    title: "Prepare demo for Global Corp",
    description: "Create custom demo video",
    status: "in_progress",
    priority: "urgent",
    dueDate: "Today, 2:00 PM",
    assignee: "You",
    createdAt: "1 hour ago",
  },
  {
    id: "task-3",
    title: "Update lead notes",
    description: "Add conversation summary",
    status: "done",
    priority: "low",
    dueDate: "Yesterday",
    assignee: "Mike",
    conversationId: "conv-1",
    createdAt: "3 hours ago",
  },
  {
    id: "task-4",
    title: "Schedule call with Jane Doe",
    description: "Discuss negotiation terms",
    status: "todo",
    priority: "medium",
    dueDate: "Tomorrow, 10:00 AM",
    assignee: "Alex",
    createdAt: "1 day ago",
  },
];

interface TaskListProps {
  onTaskClick?: (task: Task) => void;
}

export default function TaskList({ onTaskClick }: TaskListProps) {
  const [tasks, setTasks] = useState<Task[]>(MOCK_TASKS);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<string | null>(null);

  const filtered = tasks.filter((task) => {
    const matchesStatus = !filterStatus || task.status === filterStatus;
    const matchesPriority = !filterPriority || task.priority === filterPriority;
    return matchesStatus && matchesPriority;
  });

  const updateTaskStatus = (taskId: string, newStatus: Task["status"]) => {
    setTasks(
      tasks.map((task) =>
        task.id === taskId ? { ...task, status: newStatus } : task
      )
    );
  };

  const getPriorityColor = (priority: string) => {
    const colors: { [key: string]: string } = {
      low: "bg-blue-100 text-blue-800",
      medium: "bg-amber-100 text-amber-800",
      high: "bg-orange-100 text-orange-800",
      urgent: "bg-red-100 text-red-800",
    };
    return colors[priority] || "bg-gray-100 text-gray-800";
  };

  const getStatusBadge = (status: string) => {
    const styles: { [key: string]: string } = {
      todo: "bg-gray-100 text-gray-800",
      in_progress: "bg-blue-100 text-blue-800",
      done: "bg-green-100 text-green-800",
    };
    return styles[status] || "bg-gray-100 text-gray-800";
  };

  const stats = {
    todo: tasks.filter((t) => t.status === "todo").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    done: tasks.filter((t) => t.status === "done").length,
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">To Do</p>
          <p className="text-2xl font-bold text-gray-900">{stats.todo}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">In Progress</p>
          <p className="text-2xl font-bold text-blue-600">
            {stats.in_progress}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Done</p>
          <p className="text-2xl font-bold text-green-600">{stats.done}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { id: null, label: "All" },
                { id: "todo", label: "To Do" },
                { id: "in_progress", label: "In Progress" },
                { id: "done", label: "Done" },
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => setFilterStatus(option.id as string | null)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition ${
                    filterStatus === option.id
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Priority
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { id: null, label: "All" },
                { id: "low", label: "Low" },
                { id: "medium", label: "Medium" },
                { id: "high", label: "High" },
                { id: "urgent", label: "Urgent" },
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => setFilterPriority(option.id as string | null)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition capitalize ${
                    filterPriority === option.id
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">No tasks found</p>
          </div>
        ) : (
          filtered
            .sort((a, b) => {
              const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
              return (
                priorityOrder[a.priority as keyof typeof priorityOrder] -
                priorityOrder[b.priority as keyof typeof priorityOrder]
              );
            })
            .map((task) => (
              <div
                key={task.id}
                onClick={() => onTaskClick?.(task)}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-md transition cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {task.title}
                    </h3>
                    {task.description && (
                      <p className="text-sm text-gray-600 mt-1">
                        {task.description}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (task.status === "todo") {
                          updateTaskStatus(task.id, "in_progress");
                        } else if (task.status === "in_progress") {
                          updateTaskStatus(task.id, "done");
                        }
                      }}
                      className="px-3 py-1 bg-blue-500 text-white text-xs font-medium rounded hover:bg-blue-600 transition"
                    >
                      {task.status === "todo" && "Start"}
                      {task.status === "in_progress" && "Complete"}
                      {task.status === "done" && "Done"}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                  <div className="flex gap-2">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded capitalize ${getStatusBadge(
                        task.status
                      )}`}
                    >
                      {task.status.replace("_", " ")}
                    </span>
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded capitalize ${getPriorityColor(
                        task.priority
                      )}`}
                    >
                      {task.priority}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600">
                    {task.dueDate} • {task.assignee}
                  </div>
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
