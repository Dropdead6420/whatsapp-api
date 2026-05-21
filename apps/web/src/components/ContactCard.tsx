"use client";

import React from "react";

interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  tags: string[];
  lastInteraction: string;
  conversationCount: number;
}

interface ContactCardProps {
  contact: Contact;
  onTagClick?: (tag: string) => void;
}

export default function ContactCard({ contact, onTagClick }: ContactCardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      {/* Header */}
      <div>
        <h3 className="font-semibold text-gray-900 text-lg">{contact.name}</h3>
        <p className="text-sm text-gray-600">{contact.phone}</p>
        {contact.email && (
          <p className="text-sm text-gray-600">{contact.email}</p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded p-3">
          <p className="text-xs text-gray-600 mb-1">Conversations</p>
          <p className="text-lg font-semibold text-gray-900">
            {contact.conversationCount}
          </p>
        </div>
        <div className="bg-gray-50 rounded p-3">
          <p className="text-xs text-gray-600 mb-1">Last Interaction</p>
          <p className="text-lg font-semibold text-gray-900">
            {contact.lastInteraction}
          </p>
        </div>
      </div>

      {/* Tags */}
      {contact.tags.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">Tags</p>
          <div className="flex flex-wrap gap-2">
            {contact.tags.map((tag) => (
              <button
                key={tag}
                onClick={() => onTagClick?.(tag)}
                className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full hover:bg-blue-200 transition"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button className="flex-1 px-3 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition">
          Add Tag
        </button>
        <button className="flex-1 px-3 py-2 bg-gray-100 text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-200 transition">
          View History
        </button>
      </div>
    </div>
  );
}
