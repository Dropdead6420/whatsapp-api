import React from 'react';
import { NodeConfiguratorProps, NodeConfig } from './types';

/**
 * Reusable config input components
 */

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  help?: string;
  required?: boolean;
}

export function TextInput({ label, value, onChange, placeholder, help, required }: TextInputProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  help?: string;
  rows?: number;
}

export function TextArea({ label, value, onChange, placeholder, help, rows = 3 }: TextAreaProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

interface SelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  help?: string;
  required?: boolean;
}

export function Select({ label, value, onChange, options, help, required }: SelectProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-500">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <option value="">Select...</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

interface NumberInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  help?: string;
  required?: boolean;
}

export function NumberInput({ label, value, onChange, min, max, help, required }: NumberInputProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        min={min}
        max={max}
        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

interface CheckboxProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  help?: string;
}

export function Checkbox({ label, value, onChange, help }: CheckboxProps) {
  return (
    <div className="mb-3">
      <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 border border-slate-300 rounded-md"
        />
        {label}
      </label>
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

/**
 * Base configurator component wrapper
 */

interface BaseConfiguratorProps extends NodeConfiguratorProps {
  children: React.ReactNode;
  preview?: React.ReactNode;
}

export function BaseConfigurator({ node, onDelete, children, preview }: BaseConfiguratorProps) {
  return (
    <div className="space-y-3">
      {preview && (
        <div className="p-2 bg-slate-50 rounded-md border border-slate-200">
          <p className="text-xs font-medium text-slate-600 mb-1">Preview:</p>
          {preview}
        </div>
      )}
      {children}
      {onDelete && (
        <button
          onClick={onDelete}
          className="w-full text-xs px-2 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-md hover:bg-red-100"
        >
          Delete node
        </button>
      )}
    </div>
  );
}
