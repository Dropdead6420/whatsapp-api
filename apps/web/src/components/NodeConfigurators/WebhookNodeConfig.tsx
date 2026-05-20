import React from 'react';
import { NodeConfiguratorProps } from './types';
import { BaseConfigurator, TextInput, Select, TextArea } from './BaseConfigurator';

export function WebhookNodeConfig({ node, onConfigChange, onDelete }: NodeConfiguratorProps) {
  const url = (node.config.url as string) || '';
  const method = (node.config.method as string) || 'POST';
  const body = (node.config.body as string) || '';

  return (
    <BaseConfigurator
      node={node}
      onConfigChange={onConfigChange}
      onDelete={onDelete}
      preview={<div className="text-xs bg-white p-2 rounded border border-slate-100"><span className="font-mono">{method}</span> {url || '(no URL)'}</div>}
    >
      <Select
        label="HTTP method"
        value={method}
        onChange={(val) => onConfigChange({ ...node.config, method: val })}
        options={[
          { value: 'GET', label: 'GET' },
          { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' },
          { value: 'DELETE', label: 'DELETE' },
        ]}
        required
      />
      <TextInput
        label="URL"
        value={url}
        onChange={(val) => onConfigChange({ ...node.config, url: val })}
        placeholder="https://api.example.com/webhook"
        help="Full HTTPS URL"
        required
      />
      <TextArea
        label="Request body (JSON)"
        value={body}
        onChange={(val) => onConfigChange({ ...node.config, body: val })}
        placeholder='{"message": "{{message}}", "phone": "{{phone}}"}'
        help="JSON template. Supports variables: {{message}}, {{phone}}, {{name}}"
        rows={3}
      />
    </BaseConfigurator>
  );
}
