/**
 * Node configuration panel - displayed when a node is selected
 * Shows the appropriate configurator for the selected node type
 */

import React from 'react';
import { getNodeConfigurator } from './NodeConfigurators/registry';
import { NODE_DESCRIPTIONS } from './NodeConfigurators/types';
import type { NexaNode } from './FlowEditor';

interface FlowNodePanelProps {
  node: NexaNode | null;
  onConfigChange: (config: Record<string, unknown>) => void;
  onNodeDelete: () => void;
}

export function FlowNodePanel({ node, onConfigChange, onNodeDelete }: FlowNodePanelProps) {
  if (!node) {
    return (
      <div className="h-full flex items-center justify-center text-center text-slate-500 p-4">
        <div>
          <div className="text-4xl mb-2">✋</div>
          <p className="text-sm">Select a node to configure it</p>
        </div>
      </div>
    );
  }

  const Configurator = getNodeConfigurator(node.type);
  const description = NODE_DESCRIPTIONS[node.type];

  return (
    <div className="h-full overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-slate-200 p-4 bg-slate-50">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <h3 className="font-semibold text-sm text-slate-900">{node.id}</h3>
            <p className="text-xs text-slate-500 mt-1">{node.type}</p>
          </div>
          <span
            className={`inline-block px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap ${
              node.type === 'START'
                ? 'bg-emerald-100 text-emerald-700'
                : node.type === 'END'
                  ? 'bg-slate-100 text-slate-700'
                  : 'bg-blue-100 text-blue-700'
            }`}
          >
            {node.type}
          </span>
        </div>
        {description && <p className="text-xs text-slate-600">{description}</p>}
      </div>

      {/* Config form */}
      <div className="flex-grow overflow-y-auto p-4">
        <Configurator
          node={{
            id: node.id,
            type: node.type,
            config: node.config,
          }}
          onConfigChange={onConfigChange}
          onDelete={onNodeDelete}
        />
      </div>

      {/* Info footer */}
      <div className="flex-shrink-0 border-t border-slate-200 p-3 bg-slate-50 text-xs text-slate-500 space-y-1">
        <p>💡 Changes auto-save when you edit</p>
        <p>🔗 Connect nodes by dragging edges on the canvas</p>
      </div>
    </div>
  );
}
