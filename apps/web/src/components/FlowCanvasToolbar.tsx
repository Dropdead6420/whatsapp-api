/**
 * Canvas toolbar - undo/redo, zoom, layout, validation, etc.
 */

import React from 'react';

interface FlowCanvasToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAutoLayout: () => void;
  onValidate: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  isSaving?: boolean;
  validationErrors?: string[];
}

export function FlowCanvasToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAutoLayout,
  onValidate,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  isSaving,
  validationErrors,
}: FlowCanvasToolbarProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-200 bg-white flex-wrap">
      {/* Undo/Redo */}
      <div className="flex items-center gap-1 border-r border-slate-200 pr-2">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Undo (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Y)"
        >
          ↷
        </button>
      </div>

      {/* Layout */}
      <div className="flex items-center gap-1 border-r border-slate-200 pr-2">
        <button
          onClick={onAutoLayout}
          className="px-2 py-1.5 text-xs font-medium rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          title="Auto-arrange nodes"
        >
          📐 Layout
        </button>
      </div>

      {/* Zoom */}
      <div className="flex items-center gap-1 border-r border-slate-200 pr-2">
        <button
          onClick={onZoomOut}
          className="p-1.5 rounded-md hover:bg-slate-100"
          title="Zoom out"
        >
          −
        </button>
        <span className="text-xs font-mono w-12 text-center text-slate-600">{Math.round(zoom * 100)}%</span>
        <button
          onClick={onZoomIn}
          className="p-1.5 rounded-md hover:bg-slate-100"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={onZoomReset}
          className="p-1.5 text-xs rounded-md hover:bg-slate-100"
          title="Reset zoom"
        >
          ⟲
        </button>
      </div>

      {/* Validation */}
      <div className="flex items-center gap-1 border-r border-slate-200 pr-2">
        <button
          onClick={onValidate}
          className="px-2 py-1.5 text-xs font-medium rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100"
          title="Validate flow"
        >
          ✓ Validate
        </button>
      </div>

      {/* Status */}
      <div className="ml-auto flex items-center gap-2">
        {validationErrors && validationErrors.length > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-red-50 rounded-md">
            <span className="text-xs text-red-700">⚠️ {validationErrors.length} error{validationErrors.length > 1 ? 's' : ''}</span>
          </div>
        )}
        {isSaving && <span className="text-xs text-slate-500">Saving...</span>}
      </div>
    </div>
  );
}
