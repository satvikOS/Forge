import { useState, useCallback } from 'react';
import {
  Pencil, Box, Crosshair, Zap, Waves, Link2, Layers,
  GitBranch, Pipette, BarChart3, Wrench, FileText, Ruler,
  ChevronDown
} from 'lucide-react';
import './RibbonToolbar.css';

/**
 * Ribbon Toolbar — ArchDisc's professional contextual toolbar.
 * Shows labeled tool groups with icons, organized by contextual tabs.
 * Active tab changes based on current operation (Sketch/Part/Assembly/etc).
 */

const TABS = {
  sketch: {
    label: 'Sketch',
    groups: [
      { label: 'Draw', tools: [
        { name: 'Line', icon: '/', key: 'sketch', shortcut: 'L' },
        { name: 'Circle', icon: 'O', key: 'sketch' },
        { name: 'Arc', icon: ')', key: 'sketch' },
        { name: 'Rectangle', icon: '□', key: 'sketch', shortcut: 'B' },
        { name: 'Polygon', icon: '⬡', key: 'sketch' },
        { name: 'Spline', icon: '~', key: 'sketch' },
        { name: 'Ellipse', icon: '⬭', key: 'sketch' },
        { name: 'Point', icon: '·', key: 'sketch' },
      ]},
      { label: 'Modify', tools: [
        { name: 'Trim', icon: '✂', key: 'sketch' },
        { name: 'Extend', icon: '→', key: 'sketch' },
        { name: 'Offset', icon: '⟹', key: 'sketch' },
        { name: 'Mirror Sketch', icon: '⟷', key: 'sketch' },
        { name: 'Fillet Sketch', icon: '◜', key: 'sketch' },
      ]},
      { label: 'Constrain', tools: [
        { name: 'Dimension', icon: '↔', key: 'sketch', shortcut: 'D' },
        { name: 'Horizontal', icon: '—', key: 'sketch' },
        { name: 'Vertical', icon: '|', key: 'sketch' },
        { name: 'Coincident', icon: '⊙', key: 'sketch' },
        { name: 'Parallel', icon: '∥', key: 'sketch' },
        { name: 'Perpendicular', icon: '⊥', key: 'sketch' },
        { name: 'Tangent', icon: '⌒', key: 'sketch' },
        { name: 'Equal', icon: '=', key: 'sketch' },
      ]},
      { label: 'Solve', tools: [
        { name: 'Auto-Constrain', icon: '✦', key: 'sketch', primary: true },
      ]},
    ]
  },
  part: {
    label: 'Part',
    groups: [
      { label: 'Solid Primitives', tools: [
        { name: 'Box', icon: '⬜', key: 'part', primary: true },
        { name: 'Cylinder', icon: '⬭', key: 'part' },
        { name: 'Sphere', icon: '●', key: 'part' },
        { name: 'Cone', icon: '△', key: 'part' },
        { name: 'Torus', icon: '◎', key: 'part' },
      ]},
      { label: 'Create', tools: [
        { name: 'Extrude Boss', icon: '⬆', key: 'part', primary: true },
        { name: 'Extrude Cut', icon: '⬇', key: 'part' },
        { name: 'Revolve Boss', icon: '↻', key: 'part' },
        { name: 'Revolve Cut', icon: '↺', key: 'part' },
        { name: 'Loft Boss', icon: '⋈', key: 'part' },
        { name: 'Sweep Boss', icon: '↝', key: 'part' },
        { name: 'Blade Row', icon: '✺', key: 'part' },
        { name: 'Import STEP', icon: '📥', key: 'part' },
      ]},
      { label: 'Modify', tools: [
        { name: 'Fillet', icon: '◜', key: 'part' },
        { name: 'Chamfer', icon: '◿', key: 'part' },
        { name: 'Shell', icon: '▢', key: 'part' },
        { name: 'Hole Wizard', icon: '◉', key: 'part' },
        { name: 'Draft', icon: '∠', key: 'part' },
        { name: 'Scale', icon: '⤡', key: 'part' },
        { name: 'Subdivide', icon: '⊞', key: 'part' },
        { name: 'Volumetric Fillet', icon: '◖', key: 'part' },
        { name: 'Smooth Fillet', icon: '◝', key: 'part' },
      ]},
      { label: 'Boolean', tools: [
        { name: 'Combine', icon: '∪', key: 'part' },
        { name: 'Subtract', icon: '−', key: 'part' },
        { name: 'Intersect', icon: '∩', key: 'part' },
      ]},
      { label: 'Pattern', tools: [
        { name: 'Linear Pattern', icon: '⫶', key: 'part' },
        { name: 'Circular Pattern', icon: '◎', key: 'part' },
        { name: 'Mirror Feature', icon: '⟷', key: 'part' },
      ]},
    ]
  },
  assembly: {
    label: 'Assembly',
    groups: [
      { label: 'Components', tools: [
        { name: 'Insert Component', icon: '⊕', key: 'assembly', primary: true },
        { name: 'New Component', icon: '+', key: 'assembly' },
        { name: 'Move Component', icon: '↗', key: 'assembly' },
      ]},
      { label: 'Mates', tools: [
        { name: 'Coincident', icon: '⊙', key: 'assembly' },
        { name: 'Distance', icon: '↔', key: 'assembly' },
        { name: 'Concentric', icon: '◎', key: 'assembly' },
        { name: 'Angle', icon: '∠', key: 'assembly' },
      ]},
      { label: 'Analyze', tools: [
        { name: 'Exploded View', icon: '💥', key: 'assembly' },
        { name: 'Interference', icon: '⚠', key: 'assembly' },
        { name: 'Mass Properties', icon: '⚖', key: 'measure' },
      ]},
      { label: 'Motion', tools: [
        { name: 'Motion Study', icon: '⟳', key: 'assembly', primary: true },
        { name: 'Assembly Animation', icon: '▶', key: 'assembly' },
      ]},
    ]
  },
  simulate: {
    label: 'Simulate',
    groups: [
      { label: 'Structural', tools: [
        { name: 'Linear Static FEA', icon: '📊', key: 'simulation', primary: true },
        { name: 'Modal Analysis', icon: '〰', key: 'simulation' },
        { name: 'Fatigue Analysis', icon: '⟳', key: 'simulation' },
        { name: 'Buckling Analysis', icon: '↕', key: 'simulation' },
        { name: 'Frame FEA', icon: '⊏', key: 'simulation' },
        { name: 'Rotordynamics', icon: '◌', key: 'simulation' },
        { name: 'Impact Simulation', icon: '💥', key: 'simulation' },
        { name: 'Dynamic Response', icon: '∿', key: 'simulation' },
        { name: 'Pressure Response', icon: '⊡', key: 'simulation' },
        { name: 'Shaft Whirl', icon: '◐', key: 'simulation' },
        { name: 'System Dynamic Test', icon: '⊛', key: 'simulation' },
      ]},
      { label: 'Mesh', tools: [
        { name: 'Voxel Hex Mesh', icon: '⊟', key: 'simulation' },
      ]},
      { label: 'Thermal', tools: [
        { name: 'Steady-State Thermal', icon: '🌡', key: 'simulation' },
        { name: 'CFD Flow Simulation', icon: '🌊', key: 'simulation' },
      ]},
      { label: 'Survival', tools: [
        { name: 'Survival Test', icon: '🔥', key: 'simulation' },
      ]},
      { label: 'Propulsion', tools: [
        { name: 'Brayton Cycle', icon: '◈', key: 'simulation' },
        { name: 'Compressor Stage', icon: '⊿', key: 'simulation' },
        { name: 'Turbine Stage', icon: '⊽', key: 'simulation' },
        { name: 'Combustor', icon: '✺', key: 'simulation' },
        { name: 'Nozzle', icon: '⌒', key: 'simulation' },
        { name: 'Blade Cooling', icon: '❄', key: 'simulation' },
        { name: 'Heat Exchanger', icon: '≋', key: 'simulation' },
        { name: 'Mission', icon: '✈', key: 'simulation' },
      ]},
      { label: 'Optimize', tools: [
        { name: 'Topology Optimization', icon: '🧬', key: 'simulation' },
        { name: 'Design Study', icon: '📈', key: 'simulation' },
      ]},
      { label: 'Machine Elements', tools: [
        { name: 'Bearing Life', icon: '◯', key: 'simulation' },
        { name: 'Gear Mesh', icon: '⚙', key: 'simulation' },
        { name: 'Shaft Sizing', icon: '⫼', key: 'simulation' },
        { name: 'Bolted Joint', icon: '⊕', key: 'simulation' },
        { name: 'Spring Design', icon: '〰', key: 'simulation' },
        { name: 'Pressure Vessel', icon: '⬮', key: 'simulation' },
        { name: 'Stress Concentration', icon: '⊻', key: 'simulation' },
        { name: 'Forced Vibration', icon: '∿', key: 'simulation' },
      ]},
    ]
  },
  manufacture: {
    label: 'Manufacture',
    groups: [
      { label: 'CNC', tools: [
        { name: '2.5-Axis Milling', icon: '⚙', key: 'manufacturing', primary: true },
        { name: '3-Axis Milling', icon: '⚙', key: 'manufacturing' },
        { name: 'Turning', icon: '⟳', key: 'manufacturing' },
        { name: 'G-Code Post', icon: '📄', key: 'manufacturing' },
      ]},
      { label: 'Additive', tools: [
        { name: 'Slice Preview', icon: '🖨', key: 'manufacturing' },
        { name: 'Export STL', icon: '📦', key: 'manufacturing' },
      ]},
      { label: 'Inspect', tools: [
        { name: 'Check Geometry', icon: '✓', key: 'measure' },
        { name: 'Cost Estimation', icon: '$', key: 'manufacturing' },
        { name: 'Assembly Cost', icon: '∑', key: 'manufacturing' },
        { name: 'DFM Check', icon: '⚠', key: 'manufacturing' },
        { name: 'Vendor Package', icon: '📦', key: 'manufacturing' },
      ]},
    ]
  },
  drawing: {
    label: 'Drawing',
    groups: [
      { label: 'Views', tools: [
        { name: 'Standard 3 View', icon: '⊞', key: 'documentation', primary: true },
        { name: 'Section View', icon: '⊟', key: 'documentation' },
        { name: 'Detail View', icon: '🔍', key: 'documentation' },
        { name: 'Isometric View', icon: '⬡', key: 'documentation' },
      ]},
      { label: 'Annotate', tools: [
        { name: 'Smart Dimension', icon: '↔', key: 'documentation' },
        { name: 'Note', icon: 'A', key: 'documentation' },
        { name: 'Balloon', icon: '①', key: 'documentation' },
        { name: 'GD&T Frame', icon: '⊕', key: 'documentation' },
        { name: 'Surface Finish', icon: '▽', key: 'documentation' },
      ]},
      { label: 'Export', tools: [
        { name: 'Export Assembly', icon: '⊕', key: 'documentation', primary: true },
        { name: 'Export STEP', icon: '📁', key: 'documentation' },
        { name: 'Export PDF', icon: '📄', key: 'documentation' },
        { name: 'Export glTF', icon: '🌐', key: 'documentation' },
      ]},
    ]
  },
};

export default function RibbonToolbar({ activeTab = 'part', onToolClick, onTabChange }) {
  const [hoveredTool, setHoveredTool] = useState(null);

  const handleToolClick = useCallback((tool) => {
    if (onToolClick) onToolClick(tool.key, tool.name);
  }, [onToolClick]);

  const tabData = TABS[activeTab];
  if (!tabData) return null;

  return (
    <div className="ribbon-container">
      {/* Tab strip */}
      <div className="ribbon-tabs">
        {Object.entries(TABS).map(([key, tab]) => (
          <button
            key={key}
            className={`ribbon-tab ${activeTab === key ? 'active' : ''}`}
            onClick={() => onTabChange?.(key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      <div className="ribbon-content">
        {tabData.groups.map((group, gi) => (
          <div key={gi} className="ribbon-group">
            <div className="ribbon-group-tools">
              {group.tools.map((tool, ti) => (
                <button
                  key={ti}
                  className={`ribbon-tool ${tool.primary ? 'primary' : ''}`}
                  onClick={() => handleToolClick(tool)}
                  onMouseEnter={() => setHoveredTool(tool)}
                  onMouseLeave={() => setHoveredTool(null)}
                  title={`${tool.name}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
                >
                  <span className="ribbon-tool-icon">{tool.icon}</span>
                  <span className="ribbon-tool-label">{tool.name}</span>
                </button>
              ))}
            </div>
            <div className="ribbon-group-label">{group.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
