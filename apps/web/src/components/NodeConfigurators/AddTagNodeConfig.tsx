import React from 'react';
import { NodeConfiguratorProps } from './types';
import { BaseConfigurator, TextInput } from './BaseConfigurator';

export function AddTagNodeConfig({ node, onConfigChange, onDelete }: NodeConfiguratorProps) {
  const tag = (node.config.tag as string) || '';

  return (
    <BaseConfigurator
      node={node}
      onConfigChange={onConfigChange}
      onDelete={onDelete}
      preview={<div className="text-xs bg-white p-2 rounded border border-slate-100">Tag: <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{tag || '(empty)'}</span></div>}
    >
      <TextInput
        label="Tag name"
        value={tag}
        onChange={(val) => onConfigChange({ ...node.config, tag: val })}
        placeholder="e.g., vip, complaint, qualified"
        help="The tag to add to the contact"
        required
      />
    </BaseConfigurator>
  );
}
