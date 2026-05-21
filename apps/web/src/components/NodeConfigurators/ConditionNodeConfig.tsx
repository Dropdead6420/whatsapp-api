import React from 'react';
import { NodeConfiguratorProps } from './types';
import { BaseConfigurator, Select, TextInput } from './BaseConfigurator';

export function ConditionNodeConfig({ node, onConfigChange, onDelete }: NodeConfiguratorProps) {
  const field = (node.config.field as string) || '';
  const operator = (node.config.operator as string) || 'equals';
  const value = (node.config.value as string) || '';
  const trueBranch = (node.config.trueBranch as string) || 'yes';
  const falseBranch = (node.config.falseBranch as string) || 'no';

  return (
    <BaseConfigurator
      node={node}
      onConfigChange={onConfigChange}
      onDelete={onDelete}
      preview={
        <div className="text-xs bg-white p-2 rounded border border-slate-100 space-y-1">
          <div>IF {field} {operator} "{value}"</div>
          <div className="flex gap-2">
            <span className="text-emerald-600">✓ {trueBranch}</span>
            <span className="text-red-600">✗ {falseBranch}</span>
          </div>
        </div>
      }
    >
      <TextInput
        label="Variable/field to check"
        value={field}
        onChange={(val) => onConfigChange({ ...node.config, field: val })}
        placeholder="e.g., message, intent, tag"
        help="The field to evaluate"
        required
      />
      <Select
        label="Operator"
        value={operator}
        onChange={(val) => onConfigChange({ ...node.config, operator: val })}
        options={[
          { value: 'equals', label: 'Equals' },
          { value: 'contains', label: 'Contains' },
          { value: 'startsWith', label: 'Starts with' },
          { value: 'endsWith', label: 'Ends with' },
          { value: 'isEmpty', label: 'Is empty' },
          { value: 'notEmpty', label: 'Not empty' },
        ]}
        required
      />
      <TextInput
        label="Value to compare"
        value={value}
        onChange={(val) => onConfigChange({ ...node.config, value: val })}
        placeholder="e.g., book, support"
        help="Leave empty for isEmpty/notEmpty checks"
      />
      <TextInput
        label="True branch ID"
        value={trueBranch}
        onChange={(val) => onConfigChange({ ...node.config, trueBranch: val })}
        placeholder="e.g., yes"
        help="Next node when condition is true"
        required
      />
      <TextInput
        label="False branch ID"
        value={falseBranch}
        onChange={(val) => onConfigChange({ ...node.config, falseBranch: val })}
        placeholder="e.g., no"
        help="Next node when condition is false"
        required
      />
    </BaseConfigurator>
  );
}
