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
        { name: 'Center Line', icon: '⋮', key: 'sketch' },
        { name: 'Circle', icon: 'O', key: 'sketch' },
        { name: 'Arc', icon: ')', key: 'sketch' },
        { name: 'Rectangle', icon: '□', key: 'sketch', shortcut: 'B' },
        { name: 'Center Rectangle', icon: '⊞', key: 'sketch' },
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
        { name: 'Sketch Chamfer', icon: '◿', key: 'sketch' },
        { name: 'Convert Entities', icon: '⤓', key: 'sketch' },
        { name: 'Toggle Construction', icon: '⌁', key: 'sketch' },
      ]},
      // Tier-2c — Move / Rotate / Copy / Scale / Stretch.
      // Selection-driven sketch transforms; each operates on the
      // currently-selected sketch entities (or, for Stretch, on the
      // selected endpoint picks).
      { label: 'Transform', tools: [
        { name: 'Move Entities',    icon: '⇄', key: 'sketch' },
        { name: 'Rotate Entities',  icon: '↻', key: 'sketch' },
        { name: 'Copy Entities',    icon: '⎘', key: 'sketch' },
        { name: 'Scale Entities',   icon: '⤢', key: 'sketch' },
        { name: 'Stretch Entities', icon: '↔', key: 'sketch' },
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
      // Tier-2b — SW-style named geometric relations as user-applied
      // constraints. Each relation acts on the CURRENT sketch selection.
      { label: 'Relations', tools: [
        { name: 'Concentric Relation', icon: '◎', key: 'sketch' },
        { name: 'Midpoint Relation',   icon: '⊙', key: 'sketch' },
        { name: 'Symmetric Relation',  icon: '⟷', key: 'sketch' },
        { name: 'Collinear Relation',  icon: '⌐', key: 'sketch' },
        { name: 'Fix Relation',        icon: '⊕', key: 'sketch' },
        { name: 'Display Relations',   icon: '🛈', key: 'sketch' },
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
      // UX Tier 3a — Advanced features (Boundary Boss/Cut + Rib + Helix).
      // Each is selection-driven + param-dialog-driven via the
      // PropertyManager Dock (SwUxOverlays DOCKED_TOOLS).
      { label: 'Advanced Features', tools: [
        { name: 'Boundary Boss', icon: '⌬', key: 'part' },
        { name: 'Rib',           icon: '▤', key: 'part' },
        { name: 'Helix',         icon: '⤴', key: 'part' },
      ]},
      { label: 'Modify', tools: [
        { name: 'Fillet', icon: '◜', key: 'part' },
        { name: 'Chamfer', icon: '◿', key: 'part' },
        { name: 'Variable Radius Fillet', icon: '◟', key: 'part' },
        { name: 'Shell', icon: '▢', key: 'part' },
        { name: 'Hole Wizard', icon: '◉', key: 'part' },
        { name: 'Draft', icon: '∠', key: 'part' },
        { name: 'Offset Shape', icon: '⊡', key: 'part' },
        { name: 'Scale', icon: '⤡', key: 'part' },
        { name: 'Subdivide', icon: '⊞', key: 'part' },
        { name: 'Volumetric Fillet', icon: '◖', key: 'part' },
        { name: 'Smooth Fillet', icon: '◝', key: 'part' },
        { name: 'Face Fillet', icon: '◠', key: 'part' },
        { name: 'Full Round Fillet', icon: '◡', key: 'part' },
        { name: 'Corner Mitre', icon: '◺', key: 'part' },
      ]},
      // SP-10 — Blending suite completion (Area D, T2).
      // Hold-Line Blend, Face-Face Blend, Setback Corner, G3 Blend
      // are the four new blend variants extending the existing fillet/chamfer
      // / variable-radius / mitre/G2 suite. Selection-driven; param dialogs
      // supply edge/face/vertex indices + per-edge setbacks + hold curve.
      { label: 'Blends', tools: [
        { name: 'Hold-Line Blend', icon: '⏧', key: 'part' },
        { name: 'Face-Face Blend', icon: '◣', key: 'part' },
        { name: 'Setback Corner',  icon: '⌬', key: 'part' },
        { name: 'G3 Blend',        icon: '∾', key: 'part' },
      ]},
      { label: 'Surface', tools: [
        { name: 'Thicken', icon: '⧈', key: 'surface' },
        { name: 'Subdivide Surface',       icon: '◈', key: 'surface' },
        { name: 'Catmull-Clark Subdivide', icon: '⬧', key: 'surface' },
        { name: 'Retopo Surface',          icon: '⬡', key: 'surface' },
        { name: 'NURBS Patch',       icon: '〜', key: 'surface' },
        { name: 'Refine NURBS',      icon: '⊡', key: 'surface' },
        { name: 'Elevate NURBS',     icon: '⤴', key: 'surface' },
        { name: 'NURBS Curvature',   icon: 'κ',  key: 'surface' },
        { name: 'Sweep Tortuous',              icon: '↭',  key: 'surface' },
        { name: 'Loft Tangent',               icon: '⋀',  key: 'surface' },
        { name: 'Stitch Faces',               icon: '⊕',  key: 'surface' },
        { name: 'Convergent Solid',           icon: '▣',  key: 'surface' },
        { name: 'Surface-Surface Intersection', icon: '⋈', key: 'surface' },
        { name: 'Trimmed NURBS Patch',          icon: '⊟', key: 'surface' },
        { name: 'N-Sided Patch',                icon: '⬠', key: 'surface' },
        { name: 'G2 Blend',                     icon: '⌒', key: 'surface' },
        { name: 'Class-A Analyze',              icon: '◐', key: 'surface' },
        { name: 'Zebra Stripes',                icon: '☰', key: 'surface' },
      ]},
      { label: 'Faceting', tools: [
        { name: 'Faceter Controls',          icon: '▦', key: 'surface', primary: true },
        { name: 'Hidden Line / Silhouette',  icon: '◰', key: 'surface' },
      ]},
      { label: 'Boolean', tools: [
        { name: 'Combine', icon: '∪', key: 'part' },
        { name: 'Subtract', icon: '−', key: 'part' },
        { name: 'Intersect', icon: '∩', key: 'part' },
        { name: 'Combine (Non-Manifold)', icon: '⋒', key: 'part' },
        { name: 'Combine (Coincident)', icon: '≈', key: 'part' },
        { name: 'Lattice Fuse', icon: '⊞', key: 'part' },
      ]},
      // SP-5 — Boolean & partition completion (Area C, T1).
      // Imprint adds tool-edge footprints to body faces (volume preserved).
      // Partition splits a body by N tools into multiple pieces (volume conserved).
      // Section cuts the body by a plane — curves (intersection wire) or split (halves).
      { label: 'Partition', tools: [
        { name: 'Imprint',   icon: '⊕', key: 'part' },
        { name: 'Partition', icon: '⊞', key: 'part' },
        { name: 'Section',   icon: '⊟', key: 'part' },
      ]},
      // SP-9 — Direct / synchronous modeling (Area E, T2).
      // Push-Pull face along its normal, Move Face by a delta, Delete Face
      // and auto-heal, Infer Feature (classify what feature the face is in).
      // Selection-driven: each consumes the user's face / body selection.
      { label: 'Direct Modeling', tools: [
        { name: 'Push-Pull',      icon: '⤢', key: 'part' },
        { name: 'Move Face',      icon: '↗', key: 'part' },
        { name: 'Delete Face',    icon: '✕', key: 'part' },
        { name: 'Infer Feature',  icon: '🔍', key: 'part' },
      ]},
      { label: 'Pattern', tools: [
        { name: 'Linear Pattern', icon: '⫶', key: 'part' },
        { name: 'Circular Pattern', icon: '◎', key: 'part' },
        { name: 'Mirror Feature', icon: '⟷', key: 'part' },
      ]},
      // SP-8 — Healing & repair completion (Area H, T1).
      // Auto-Fill Holes patches open-edge loops with N-sided patches;
      // Auto-Repair Self-Intersection detects + heals face crossings;
      // Harmonize Normals walks the shell and flips inconsistent faces.
      // Selection-driven — each consumes the user's body selection.
      { label: 'Heal / Repair', tools: [
        { name: 'Auto-Fill Holes',               icon: '✚', key: 'part' },
        { name: 'Auto-Repair Self-Intersection', icon: '⊗', key: 'part' },
        { name: 'Harmonize Normals',             icon: '⇅', key: 'part' },
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
        // Tier-7a — standard mates (SW set completion)
        { name: 'Parallel Mate', icon: '∥', key: 'assembly' },
        { name: 'Perpendicular Mate', icon: '⊥', key: 'assembly' },
        { name: 'Tangent Mate', icon: '◖', key: 'assembly' },
        { name: 'Lock Mate', icon: '⊞', key: 'assembly' },
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
  directEdit: {
    label: 'Direct Edit',
    groups: [
      { label: 'Direct Modeling', tools: [
        { name: 'Push/Pull Face', icon: '⤢', key: 'directEdit' },
        { name: 'Move Face', icon: '↗', key: 'directEdit' },
        { name: 'Offset Face', icon: '⊡', key: 'directEdit' },
        { name: 'Delete Face', icon: '✕', key: 'directEdit' },
        { name: 'Replace Face', icon: '↔', key: 'directEdit' },
      ]},
      { label: 'Import Repair', tools: [
        { name: 'Import Diagnosis', icon: '🔍', key: 'directEdit' },
        { name: 'Heal Faces', icon: '✚', key: 'directEdit' },
        { name: 'Stitch Surface', icon: '⊞', key: 'directEdit' },
        { name: 'Remove Duplicates', icon: '⊟', key: 'directEdit' },
        { name: 'Simplify Geometry', icon: '◈', key: 'directEdit', primary: true },
      ]},
    ]
  },
  // UX Tier 5a — Sheet Metal workbench. A dedicated CommandManager tab that
  // sits alongside Part / Assembly / Drawing. Activated when a sheet-metal
  // part is the active body (tagged by Base Flange) or by the user clicking
  // the tab directly. Foundation ops shipped this dispatch: Base Flange,
  // Edge Flange, Flat Pattern.
  sheetMetal: {
    label: 'Sheet Metal',
    groups: [
      { label: 'Create', tools: [
        { name: 'Base Flange', icon: '▭', key: 'sheetMetal', primary: true },
      ]},
      { label: 'Bend', tools: [
        { name: 'Edge Flange', icon: '⌐', key: 'sheetMetal' },
        // UX Tier 5b — additions extending the same Bend group.
        { name: 'Sketched Bend', icon: '∠', key: 'sheetMetal' },
        { name: 'Jog', icon: 'Z', key: 'sheetMetal' },
      ]},
      { label: 'Edge Features', tools: [
        // UX Tier 5b — hems + mitered flanges sit alongside Edge Flange.
        { name: 'Hem', icon: '⌒', key: 'sheetMetal' },
        { name: 'Miter Flange', icon: '◢', key: 'sheetMetal' },
      ]},
      { label: 'Manufacturing', tools: [
        { name: 'Flat Pattern', icon: '⊞', key: 'sheetMetal', primary: true },
      ]},
    ],
  },
  // UX Tier 6a — Weldments workbench. A dedicated CommandManager tab alongside
  // Part / Assembly / Drawing / Sheet Metal / Simulate. Foundation ops shipped
  // this dispatch: Structural Member (sweep an ISO/ANSI profile along a 3D
  // path), Trim/Extend Members (boolean trim joints — butt | mitered), End
  // Cap (close an open member end). Bodies tagged via body.metadata.weldment.
  weldments: {
    label: 'Weldments',
    groups: [
      { label: 'Members', tools: [
        { name: 'Structural Member', icon: '⌹', key: 'weldments', primary: true },
      ]},
      { label: 'Trim', tools: [
        { name: 'Trim/Extend Members', icon: '✂', key: 'weldments' },
      ]},
      { label: 'Caps', tools: [
        { name: 'End Cap', icon: '⊓', key: 'weldments' },
      ]},
    ],
  },
  // UX Tier 9 — Mold Tools workbench. A dedicated CommandManager tab alongside
  // Part / Assembly / Drawing / Sheet Metal / Weldments / Simulate. Foundation
  // ops shipped this dispatch: Draft Analysis (colour-code faces by draft
  // angle relative to pull direction), Parting Line (silhouette curve trace),
  // Tooling Split (partition into core + cavity halves). Bodies tagged via
  // body.metadata.mold; faces carry mold.draft SP-2 attributes.
  moldTools: {
    label: 'Mold Tools',
    groups: [
      { label: 'Analysis', tools: [
        { name: 'Draft Analysis', icon: '◐', key: 'moldTools', primary: true },
      ]},
      { label: 'Parting', tools: [
        { name: 'Parting Line', icon: '〰', key: 'moldTools' },
      ]},
      { label: 'Mold Block', tools: [
        { name: 'Tooling Split', icon: '⊟', key: 'moldTools', primary: true },
      ]},
    ],
  },
  drawing: {
    label: 'Drawing',
    groups: [
      { label: 'Views', tools: [
        { name: 'Standard 3 View', icon: '⊞', key: 'documentation', primary: true },
        { name: 'Section View', icon: '⊟', key: 'documentation' },
        { name: 'Detail View', icon: '🔍', key: 'documentation' },
        { name: 'Isometric View', icon: '⬡', key: 'documentation' },
        { name: 'Auxiliary View', icon: '⇗', key: 'documentation' },
        { name: 'Crop View', icon: '▭', key: 'documentation' },
        { name: 'Broken View', icon: '⌇', key: 'documentation' },
      ]},
      { label: 'Annotate', tools: [
        { name: 'Smart Dimension', icon: '↔', key: 'documentation' },
        { name: 'Note', icon: 'A', key: 'documentation' },
        { name: 'Balloon', icon: '①', key: 'documentation' },
        { name: 'GD&T Frame', icon: '⊕', key: 'documentation' },
        { name: 'Surface Finish', icon: '▽', key: 'documentation' },
        { name: 'Model Items', icon: '⤓', key: 'documentation', primary: true },
      ]},
      { label: 'BOM', tools: [
        { name: 'BOM', icon: '☷', key: 'documentation', primary: true },
        { name: 'Auto-Balloon', icon: '③', key: 'documentation' },
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
