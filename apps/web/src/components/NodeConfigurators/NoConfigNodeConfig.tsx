import React from 'react';
import { NodeConfiguratorProps, NODE_DESCRIPTIONS } from './types';
import { BaseConfigurator } from './BaseConfigurator';

export function NoConfigNodeConfig({ node, onDelete }: NodeConfiguratorProps) {
  const description = NODE_DESCRIPTIONS[node.type] || 'No configuration needed for this node.';

  return (
    <BaseConfigurator node={node} onConfigChange={() => {}} onDelete={onDelete}>
      <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-md border border-slate-200">
        {description}
      </div>
    </BaseConfigurator>
  );
}
