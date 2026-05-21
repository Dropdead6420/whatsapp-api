import React from 'react';
import { NodeConfiguratorProps } from './types';
import { BaseConfigurator, NumberInput, Select } from './BaseConfigurator';

export function DelayNodeConfig({ node, onConfigChange, onDelete }: NodeConfiguratorProps) {
  const duration = (node.config.duration as number) || 5;
  const unit = (node.config.unit as string) || 'seconds';

  const durationDisplay = `${duration} ${unit}`;

  return (
    <BaseConfigurator
      node={node}
      onConfigChange={onConfigChange}
      onDelete={onDelete}
      preview={<div className="text-xs bg-white p-2 rounded border border-slate-100">⏱️ Wait {durationDisplay}</div>}
    >
      <NumberInput
        label="Duration"
        value={duration}
        onChange={(val) => onConfigChange({ ...node.config, duration: val })}
        min={1}
        max={7200}
        help="Time value (1-7200)"
        required
      />
      <Select
        label="Unit"
        value={unit}
        onChange={(val) => onConfigChange({ ...node.config, unit: val })}
        options={[
          { value: 'seconds', label: 'Seconds' },
          { value: 'minutes', label: 'Minutes' },
          { value: 'hours', label: 'Hours' },
          { value: 'days', label: 'Days' },
        ]}
        required
      />
    </BaseConfigurator>
  );
}
