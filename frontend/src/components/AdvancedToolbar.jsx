/**
 * Advanced Toolbar - Specialized 3D design tools
 * Focus on tools NOT in top toolbar to avoid duplication
 */

import { useState } from 'react';

const ToolButton = ({ tool, isActive, onClick }) => (
  <button
    onClick={() => onClick(tool.id)}
    title={`${tool.name}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
    style={{
      padding: '8px 12px',
      background: isActive ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      color: isActive ? 'white' : 'var(--text-secondary)',
      cursor: 'pointer',
      fontSize: '13px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      transition: 'all 0.2s',
      minWidth: '40px',
      justifyContent: 'center',
    }}
    onMouseEnter={(e) => {
      if (!isActive) {
        e.target.style.background = 'var(--bg-hover)';
        e.target.style.borderColor = '#555';
      }
    }}
    onMouseLeave={(e) => {
      if (!isActive) {
        e.target.style.background = 'var(--bg-tertiary)';
        e.target.style.borderColor = 'var(--border-color)';
      }
    }}
  >
    <span>{tool.icon}</span>
    {tool.showLabel && <span>{tool.name}</span>}
  </button>
);

const ToolGroup = ({ title, tools, activeTool, onToolSelect, collapsed = false }) => {
  const [isCollapsed, setIsCollapsed] = useState(collapsed);

  return (
    <div style={{ marginBottom: '4px' }}>
      <div
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          padding: '6px 10px',
          background: 'var(--bg-secondary)',
          fontSize: '11px',
          fontWeight: 'bold',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          borderRadius: '4px',
          userSelect: 'none',
        }}
      >
        <span>{isCollapsed ? '▸' : '▾'}</span>
        <span>{title}</span>
      </div>
      {!isCollapsed && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(45px, 1fr))',
          gap: '4px',
          padding: '6px',
          background: 'var(--bg-tertiary)',
          borderRadius: '4px',
          marginTop: '2px',
        }}>
          {tools.map(tool => (
            <ToolButton
              key={tool.id}
              tool={tool}
              isActive={activeTool === tool.id}
              onClick={onToolSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function AdvancedToolbar({ 
  activeTool, 
  onToolSelect, 
  viewMode, 
  onViewModeChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) {
  // Specialized modeling tools not in top toolbar
  const modelingTools = [
    { id: 'extrude', name: 'Extrude', icon: '⬆️', shortcut: 'E' },
    { id: 'push_pull', name: 'Push/Pull', icon: '↕️', shortcut: 'P' },
    { id: 'bevel', name: 'Bevel', icon: '◢', shortcut: 'Ctrl+B' },
    { id: 'subdivide', name: 'Subdivide', icon: '⊞' },
    { id: 'duplicate', name: 'Duplicate', icon: '⊕', shortcut: 'Shift+D' },
    { id: 'mirror', name: 'Mirror', icon: '↔️', shortcut: 'Ctrl+M' },
  ];

  // Drawing Tools
  const drawingTools = [
    { id: 'line', name: 'Line', icon: '📏', shortcut: 'L' },
    { id: 'rectangle', name: 'Rectangle', icon: '▭', shortcut: 'Shift+R' },
    { id: 'circle_draw', name: 'Circle', icon: '○', shortcut: 'Shift+C' },
    { id: 'polygon', name: 'Polygon', icon: '⬡', shortcut: 'Shift+P' },
  ];

  // Measurement Tools
  const measurementTools = [
    { id: 'tape_measure', name: 'Measure', icon: '📏', shortcut: 'M' },
    { id: 'protractor', name: 'Angle', icon: '📐' },
    { id: 'dimension', name: 'Dimension', icon: '↔' },
    { id: 'area_calculator', name: 'Area', icon: '▭' },
    { id: 'volume_calculator', name: 'Volume', icon: '⬚' },
  ];

  // Camera Tools
  const cameraTools = [
    { id: 'view_top', name: 'Top', icon: '⬇' },
    { id: 'view_front', name: 'Front', icon: '⬅' },
    { id: 'view_side', name: 'Side', icon: '⬆' },
    { id: 'view_perspective', name: 'Perspective', icon: '🔲' },
    { id: 'focus_selection', name: 'Focus', icon: '🎯', shortcut: 'F' },
    { id: 'frame_all', name: 'Frame All', icon: '🖼️', shortcut: 'Home' },
  ];

  // Light Tools
  const lightTools = [
    { id: 'add_point_light', name: 'Point', icon: '💡' },
    { id: 'add_directional_light', name: 'Sun', icon: '☀️' },
    { id: 'add_spot_light', name: 'Spot', icon: '🔦' },
    { id: 'add_area_light', name: 'Area', icon: '▭' },
  ];

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      padding: '8px',
      background: 'var(--bg-primary)',
    }}>
      {/* Undo/Redo - Quick access */}
      <div style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '8px',
        padding: '4px',
        background: 'var(--bg-secondary)',
        borderRadius: '4px',
      }}>
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          style={{
            flex: 1,
            padding: '6px',
            background: canUndo ? 'var(--bg-tertiary)' : 'transparent',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: canUndo ? 'var(--text-primary)' : 'var(--text-secondary)',
            cursor: canUndo ? 'pointer' : 'not-allowed',
            fontSize: '16px',
            opacity: canUndo ? 1 : 0.4,
          }}
        >
          ↶
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          style={{
            flex: 1,
            padding: '6px',
            background: canRedo ? 'var(--bg-tertiary)' : 'transparent',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: canRedo ? 'var(--text-primary)' : 'var(--text-secondary)',
            cursor: canRedo ? 'pointer' : 'not-allowed',
            fontSize: '16px',
            opacity: canRedo ? 1 : 0.4,
          }}
        >
          ↷
        </button>
      </div>

      <ToolGroup
        title="Modeling"
        tools={modelingTools}
        activeTool={activeTool}
        onToolSelect={onToolSelect}
      />
      
      <ToolGroup
        title="Drawing"
        tools={drawingTools}
        activeTool={activeTool}
        onToolSelect={onToolSelect}
      />
      
      <ToolGroup
        title="Measurement"
        tools={measurementTools}
        activeTool={activeTool}
        onToolSelect={onToolSelect}
        collapsed={true}
      />
      
      <ToolGroup
        title="Camera"
        tools={cameraTools}
        activeTool={activeTool}
        onToolSelect={onToolSelect}
        collapsed={true}
      />
      
      <ToolGroup
        title="Lights"
        tools={lightTools}
        activeTool={activeTool}
        onToolSelect={onToolSelect}
        collapsed={true}
      />
    </div>
  );
}
