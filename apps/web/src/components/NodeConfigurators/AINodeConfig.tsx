import React from 'react';
import { NodeConfiguratorProps } from './types';
import { BaseConfigurator, TextArea, Select, TextInput } from './BaseConfigurator';

export function AINodeConfig({ node, onConfigChange, onDelete }: NodeConfiguratorProps) {
  const nodeType = node.type;
  const prompt = (node.config.prompt as string) || '';
  const model = (node.config.model as string) || 'gpt-4-turbo';
  const temperature = (node.config.temperature as number) || 0.7;
  const maxTokens = (node.config.maxTokens as number) || 500;

  const promptPlaceholder = {
    AI_RESPONSE: 'Respond helpfully to this customer message: {{message}}',
    AI_CLASSIFY_INTENT: 'Classify the intent (support, sales, complaint, other): {{message}}',
    AI_SUMMARIZE: 'Summarize this in 1-2 sentences: {{message}}',
    AI_EXTRACT_DATA: 'Extract phone number and email from: {{message}}',
    AI_TRANSLATE: 'Translate to {{language}}: {{message}}',
    AI_COMPLIANCE_CHECK: 'Check if this complies with company policy: {{message}}',
  }[nodeType] || 'Enter your prompt...';

  return (
    <BaseConfigurator
      node={node}
      onConfigChange={onConfigChange}
      onDelete={onDelete}
      preview={<div className="text-xs bg-white p-2 rounded border border-slate-100 line-clamp-3">{prompt || '(no prompt)'}</div>}
    >
      <Select
        label="Model"
        value={model}
        onChange={(val) => onConfigChange({ ...node.config, model: val })}
        options={[
          { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
          { value: 'gpt-4', label: 'GPT-4' },
          { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
          { value: 'claude-3', label: 'Claude 3' },
        ]}
        required
      />
      <TextArea
        label="Prompt/Instruction"
        value={prompt}
        onChange={(val) => onConfigChange({ ...node.config, prompt: val })}
        placeholder={promptPlaceholder}
        help="Supports variables: {{message}}, {{name}}, {{phone}}, {{language}}"
        rows={4}
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Temperature</label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => onConfigChange({ ...node.config, temperature: parseFloat(e.target.value) })}
            className="w-full"
          />
          <span className="text-xs text-slate-500">{temperature.toFixed(1)} (0=precise, 2=creative)</span>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Max tokens</label>
          <input
            type="number"
            min="100"
            max="4000"
            value={maxTokens}
            onChange={(e) => onConfigChange({ ...node.config, maxTokens: parseInt(e.target.value) })}
            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md"
          />
        </div>
      </div>
    </BaseConfigurator>
  );
}
