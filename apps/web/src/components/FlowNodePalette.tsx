/**
 * Node palette sidebar - shows available node types organized by category
 * Users can drag nodes from palette to canvas to create them
 */

import React, { useState, useMemo } from 'react';

export interface PaletteNode {
  type: string;
  label: string;
  category: string;
  description: string;
}

export const PALETTE_NODES: PaletteNode[] = [
  // Flow Control
  { type: 'START', label: 'Start', category: 'Flow Control', description: 'Entry point' },
  { type: 'END', label: 'End', category: 'Flow Control', description: 'Exit point' },

  // Messages
  { type: 'MESSAGE', label: 'Message', category: 'Messages', description: 'Send text message' },
  { type: 'SEND_TEMPLATE', label: 'Template', category: 'Messages', description: 'Send WhatsApp template' },

  // Data
  { type: 'CREATE_LEAD', label: 'Create Lead', category: 'Data', description: 'Create lead from message' },
  { type: 'ADD_TAG', label: 'Add Tag', category: 'Data', description: 'Tag the contact' },

  // Routing
  { type: 'CONDITION', label: 'Condition', category: 'Routing', description: 'If/else branching' },
  { type: 'SWITCH', label: 'Switch', category: 'Routing', description: 'Multi-branch routing' },
  { type: 'FILTER', label: 'Filter', category: 'Routing', description: 'Filter messages' },
  { type: 'WAIT_FOR_REPLY', label: 'Wait for Reply', category: 'Routing', description: 'Pause until message' },

  // Integration
  { type: 'WEBHOOK', label: 'Webhook', category: 'Integration', description: 'Call external API' },
  { type: 'AGENT_TRANSFER', label: 'Agent Transfer', category: 'Integration', description: 'Route to human' },
  { type: 'DELAY', label: 'Delay', category: 'Integration', description: 'Pause workflow' },

  // AI
  { type: 'AI_RESPONSE', label: 'AI Response', category: 'AI', description: 'Generate using AI' },
  { type: 'AI_CLASSIFY_INTENT', label: 'Classify Intent', category: 'AI', description: 'Intent detection' },
  { type: 'AI_SUMMARIZE', label: 'Summarize', category: 'AI', description: 'Summarize text' },
  { type: 'AI_EXTRACT_DATA', label: 'Extract Data', category: 'AI', description: 'Extract info' },
  { type: 'AI_TRANSLATE', label: 'Translate', category: 'AI', description: 'Translate message' },
  { type: 'AI_COMPLIANCE_CHECK', label: 'Compliance', category: 'AI', description: 'Check compliance' },
];

interface FlowNodePaletteProps {
  onDragStart: (nodeType: string, event: React.DragEvent<HTMLDivElement>) => void;
}

export function FlowNodePalette({ onDragStart }: FlowNodePaletteProps) {
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => {
    const filtered = PALETTE_NODES.filter(
      (n) =>
        n.label.toLowerCase().includes(search.toLowerCase()) ||
        n.description.toLowerCase().includes(search.toLowerCase()) ||
        n.type.toLowerCase().includes(search.toLowerCase())
    );

    const groups: Record<string, PaletteNode[]> = {};
    filtered.forEach((n) => {
      if (!groups[n.category]) groups[n.category] = [];
      groups[n.category].push(n);
    });

    return groups;
  }, [search]);

  const categories = Object.keys(grouped).sort();

  return (
    <div className="h-full flex flex-col bg-white border-l border-slate-200">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-slate-200 p-3">
        <input
          type="text"
          placeholder="Search nodes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {/* Nodes list */}
      <div className="flex-grow overflow-y-auto p-3 space-y-4">
        {categories.length === 0 ? (
          <div className="text-xs text-slate-500 text-center py-4">No nodes match "{search}"</div>
        ) : (
          categories.map((category) => (
            <div key={category}>
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">{category}</h4>
              <div className="space-y-1.5">
                {grouped[category].map((node) => (
                  <div
                    key={node.type}
                    draggable
                    onDragStart={(e) => onDragStart(node.type, e)}
                    className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md cursor-move transition-colors"
                  >
                    <div className="text-xs font-medium text-slate-900">{node.label}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{node.description}</div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer hint */}
      <div className="flex-shrink-0 border-t border-slate-200 p-3 bg-slate-50 text-xs text-slate-500 text-center">
        Drag nodes to canvas
      </div>
    </div>
  );
}
