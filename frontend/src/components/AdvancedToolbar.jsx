/**
 * Advanced Toolbar - Comprehensive 3D design tools organized by category
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
  // Selection Tools
  const selectionTools = [
    { id: 'select', name: 'Select', icon: '🖱️', shortcut: 'S' },
    { id: 'select_box', name: 'Box Select', icon: '⬚', shortcut: 'B' },
    { id: 'select_circle', name: 'Circle Select', icon: '⭕', shortcut: 'C' },
    { id: 'select_all', name: 'Select All', icon: '⬚', shortcut: 'A' },
    { id: 'invert_selection', name: 'Invert', icon: '↔', shortcut: 'I' },
  ];

  // Transform Tools
  const transformTools = [
    { id: 'move', name: 'Move', icon: '↔️', shortcut: 'G' },
    { id: 'rotate', name: 'Rotate', icon: '🔄', shortcut: 'R' },
    { id: 'scale', name: 'Scale', icon: '⇔', shortcut: 'S' },
  ];

  // Mesh Primitives
  const meshTools = [
    { id: 'add_cube', name: 'Cube', icon: '⬛' },
    { id: 'add_sphere', name: 'Sphere', icon: '⚫' },
    { id: 'add_cylinder', name: 'Cylinder', icon: '⬭' },
    { id: 'add_cone', name: 'Cone', icon: '🔺' },
    { id: 'add_plane', name: 'Plane', icon: '▭' },
    { id: 'add_torus', name: 'Torus', icon: '⭕' },
    { id: 'add_icosphere', name: 'Ico Sphere', icon: '⬢' },
    { id: 'add_circle', name: 'Circle', icon: '○' },
    { id: 'add_grid', name: 'Grid', icon: '⊞' },
  ];

  // Modeling Tools
  const modelingTools = [
    { id: 'extrude', name: 'Extrude', icon: '⬆️', shortcut: 'E' },
    { id: 'push_pull', name: 'Push/Pull', icon: '↕️', shortcut: 'P' },
    { id: 'bevel', name: 'Bevel', icon: '◢', shortcut: 'Ctrl+B' },
    { id: 'subdivide', name: 'Subdivide', icon: '⊞' },
    { id: 'duplicate', name: 'Duplicate', icon: '⊕', shortcut: 'Shift+D' },
    { id: 'mirror', name: 'Mirror', icon: '↔️', shortcut: 'Ctrl+M' },
    { id: 'delete', name: 'Delete', icon: '🗑️', shortcut: 'Del' },
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
    { id: 'add_camera', name: 'Add Camera', icon: '📷' },
  ];

  // Light Tools
  const lightTools = [
    { id: 'add_point_light', name: 'Point', icon: '💡' },
    { id: 'add_directional_light', name: 'Sun', icon: '☀️' },
    { id: 'add_spot_light', name: 'Spot', icon: '🔦' },
    { id: 'add_area_light', name: 'Area', icon: '▭' },
  ];

  const viewModes = [
    { id: 'solid', label: 'Solid', icon: '◼' },
    { id: 'wireframe', label: 'Wireframe', icon: '▢' },
  ];

  return (
    <div style={{
      display: 'flex',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-color)',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Left Sidebar - Tool Categories */}
      <div style={{
        width: '220px',
        borderRight: '1px solid var(--border-color)',
        overflowY: 'auto',
        padding: '8px',
        background: 'var(--bg-primary)',
      }}>
        <ToolGroup
          title="Selection"
          tools={selectionTools}
          activeTool={activeTool}
          onToolSelect={onToolSelect}
        />
        
        <ToolGroup
          title="Transform"
          tools={transformTools}
          activeTool={activeTool}
          onToolSelect={onToolSelect}
        />
        
        <ToolGroup
          title="Mesh Primitives"
          tools={meshTools}
          activeTool={activeTool}
          onToolSelect={onToolSelect}
        />
        
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
        
        <ToolGroup
          title="Camera"
          tools={cameraTools}
          activeTool={activeTool}
          onToolSelect={onToolSelect}
          collapsed={true}
        />
      </div>

      {/* Top Bar - Quick Actions & View Controls */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 12px',
        flexWrap: 'wrap',
      }}>
        {/* View Mode */}
        <div style={{
          display: 'flex',
          gap: '4px',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px',
          padding: '4px',
        }}>
          {viewModes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => onViewModeChange(mode.id)}
              style={{
                padding: '6px 12px',
                background: viewMode === mode.id ? 'var(--accent-orange)' : 'transparent',
                border: 'none',
                borderRadius: '4px',
                color: viewMode === mode.id ? 'white' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span>{mode.icon}</span>
              <span>{mode.label}</span>
            </button>
          ))}
        </div>

        {/* Separator */}
        <div style={{
          width: '1px',
          height: '30px',
          background: 'var(--border-color)',
        }} />

        {/* Undo/Redo */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            style={{
              padding: '6px 12px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: canUndo ? 'var(--text-primary)' : 'var(--text-disabled)',
              cursor: canUndo ? 'pointer' : 'not-allowed',
              fontSize: '14px',
              opacity: canUndo ? 1 : 0.5,
            }}
          >
            ↶
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
            style={{
              padding: '6px 12px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: canRedo ? 'var(--text-primary)' : 'var(--text-disabled)',
              cursor: canRedo ? 'pointer' : 'not-allowed',
              fontSize: '14px',
              opacity: canRedo ? 1 : 0.5,
            }}
          >
            ↷
          </button>
        </div>

        {/* Separator */}
        <div style={{
          width: '1px',
          height: '30px',
          background: 'var(--border-color)',
        }} />

        {/* Active Tool Display */}
        <div style={{
          padding: '6px 12px',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px',
          fontSize: '12px',
          color: 'var(--accent-orange)',
          fontWeight: 'bold',
        }}>
          Active: {activeTool || 'None'}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Help */}
        <div style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          fontStyle: 'italic',
          padding: '6px 12px',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px',
        }}>
          Press tool shortcut keys for quick access
        </div>
      </div>
    </div>
  );
}
