import React from 'react';
import { NodeConfiguratorProps } from './types';
import { BaseConfigurator, TextArea } from './BaseConfigurator';

export function MessageNodeConfig({ node, onConfigChange, onDelete }: NodeConfiguratorProps) {
  const text = (node.config.text as string) || '';

  return (
    <BaseConfigurator
      node={node}
      onConfigChange={onConfigChange}
      onDelete={onDelete}
      preview={<div className="text-xs bg-white p-2 rounded border border-slate-100 whitespace-pre-wrap">{text || '(empty)'}</div>}
    >
      <TextArea
        label="Message text"
        value={text}
        onChange={(val) => onConfigChange({ ...node.config, text: val })}
        placeholder="Hi {{firstName}}, how can we help?"
        help="Supports variables: {{firstName}}, {{lastName}}, {{email}}, {{phone}}"
        rows={4}
      />
    </BaseConfigurator>
  );
}
