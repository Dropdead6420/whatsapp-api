"use client";

import React, { useState } from "react";

interface Suggestion {
  id: string;
  text: string;
  tone: "professional" | "friendly" | "quick";
}

const MOCK_SUGGESTIONS: Suggestion[] = [
  {
    id: "sugg-1",
    text: "Thank you for your inquiry. I'd be happy to provide you with detailed pricing information tailored to your needs. Could you tell me more about your requirements?",
    tone: "professional",
  },
  {
    id: "sugg-2",
    text: "Hey! Great question 😊 We have some awesome plans that might be perfect for you. Which industry are you in?",
    tone: "friendly",
  },
  {
    id: "sugg-3",
    text: "Check out our pricing page for details: [link]. Feel free to reach out with questions!",
    tone: "quick",
  },
];

interface ReplySuggestorProps {
  onSelectSuggestion: (text: string) => void;
  isLoading?: boolean;
}

export default function ReplySuggestor({
  onSelectSuggestion,
  isLoading = false,
}: ReplySuggestorProps) {
  const [selectedTone, setSelectedTone] = useState<string | null>(null);

  const filteredSuggestions =
    selectedTone === null
      ? MOCK_SUGGESTIONS
      : MOCK_SUGGESTIONS.filter((s) => s.tone === selectedTone);

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">💡 AI Suggestions</h3>
        {isLoading && <span className="text-xs text-gray-600">Generating...</span>}
      </div>

      {/* Tone Filter */}
      <div className="flex gap-2">
        {[
          { id: null, label: "All" },
          { id: "professional", label: "Professional" },
          { id: "friendly", label: "Friendly" },
          { id: "quick", label: "Quick" },
        ].map((option) => (
          <button
            key={option.id}
            onClick={() => setSelectedTone(option.id as string | null)}
            className={`px-3 py-1 text-xs font-medium rounded-full transition ${
              selectedTone === option.id
                ? "bg-blue-500 text-white"
                : "bg-white text-gray-700 border border-gray-200 hover:border-blue-300"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Suggestions */}
      <div className="space-y-2">
        {filteredSuggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            onClick={() => onSelectSuggestion(suggestion.text)}
            className="w-full text-left p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition group"
          >
            <p className="text-sm text-gray-900 group-hover:text-gray-700 mb-2">
              {suggestion.text}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 capitalize">
                {suggestion.tone}
              </span>
              <span className="text-blue-500 opacity-0 group-hover:opacity-100 transition">
                Use this →
              </span>
            </div>
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-600">
        💡 Use a suggestion and customize as needed before sending
      </p>
    </div>
  );
}
