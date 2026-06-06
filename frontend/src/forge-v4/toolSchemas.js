// Forge-72 — schema-driven tool parameter UI.
//
// Each tool id maps to a list of fields { id, label, type, default,
// unit?, options?, min?, max?, step? }. ToolParamDialog renders them
// into the left dock when the user invokes the tool, and on confirm
// dispatches { tool, params } to the shell for kernel routing.
//
// Field types:
//   number  — numeric input (with optional unit chip)
//   vec3    — three numeric inputs for x/y/z
//   bool    — checkbox
//   enum    — segmented dropdown
//   ref     — pick-in-viewport surrogate (button that records the
//             current selection)
//   text    — short string

export const TOOL_SCHEMAS = {
  // ----- SKETCH primitives -----
  'sketch.new':     { title: 'New Sketch', fields: [
    { id: 'plane', label: 'Plane', type: 'enum',
      options: ['XY','YZ','XZ','Top face of body'], default: 'XY' },
  ]},
  // Slice-4 — reference / datum geometry.
  'datum.offsetPlane': { title: 'Offset Plane', fields: [
    { id: 'base',     label: 'Base plane', type: 'enum',
      options: ['XY','YZ','XZ','Top face of body'], default: 'XY' },
    { id: 'distance', label: 'Offset', type: 'number', default: 50, unit: 'mm' },
  ]},
  'datum.plane3pt': { title: 'Plane through 3 Points', fields: [
    { id: 'p1', label: 'Point 1', type: 'vec3', default: [0,0,0], unit: 'mm' },
    { id: 'p2', label: 'Point 2', type: 'vec3', default: [10,0,0], unit: 'mm' },
    { id: 'p3', label: 'Point 3', type: 'vec3', default: [0,10,0], unit: 'mm' },
  ]},
  'datum.midPlane': { title: 'Mid Plane', fields: [
    { id: 'planeA', label: 'Plane A', type: 'enum', options: ['XY','YZ','XZ'], default: 'XY' },
    { id: 'offsetA', label: 'A offset', type: 'number', default: 0, unit: 'mm' },
    { id: 'planeB', label: 'Plane B', type: 'enum', options: ['XY','YZ','XZ'], default: 'XY' },
    { id: 'offsetB', label: 'B offset', type: 'number', default: 100, unit: 'mm' },
  ]},
  'datum.axis2pt': { title: 'Axis through 2 Points', fields: [
    { id: 'p1', label: 'Point 1', type: 'vec3', default: [0,0,0], unit: 'mm' },
    { id: 'p2', label: 'Point 2', type: 'vec3', default: [0,0,50], unit: 'mm' },
  ]},
  'sketch.line':    { title: 'Line', fields: [
    { id: 'p0', label: 'From', type: 'vec3', default: [0,0,0], unit: 'mm' },
    { id: 'p1', label: 'To',   type: 'vec3', default: [10,0,0], unit: 'mm' },
  ]},
  'sketch.rect':    { title: 'Rectangle', fields: [
    { id: 'center', label: 'Center', type: 'vec3', default: [0,0,0], unit: 'mm' },
    { id: 'width',  label: 'Width',  type: 'number', default: 20, unit: 'mm', min: 0.01 },
    { id: 'height', label: 'Height', type: 'number', default: 20, unit: 'mm', min: 0.01 },
  ]},
  'sketch.circle':  { title: 'Circle', fields: [
    { id: 'center', label: 'Center', type: 'vec3', default: [0,0,0], unit: 'mm' },
    { id: 'radius', label: 'Radius', type: 'number', default: 10, unit: 'mm', min: 0.01 },
  ]},
  'sketch.arc':     { title: 'Arc', fields: [
    { id: 'center', label: 'Center', type: 'vec3', default: [0,0,0], unit: 'mm' },
    { id: 'radius', label: 'Radius', type: 'number', default: 10, unit: 'mm', min: 0.01 },
    { id: 'start',  label: 'Start angle', type: 'number', default: 0,    unit: '°' },
    { id: 'end',    label: 'End angle',   type: 'number', default: 180,  unit: '°' },
  ]},
  'sketch.polygon': { title: 'Polygon', fields: [
    { id: 'center', label: 'Center', type: 'vec3', default: [0,0,0], unit: 'mm' },
    { id: 'sides',  label: 'Sides',  type: 'number', default: 6, min: 3, max: 64, step: 1 },
    { id: 'radius', label: 'Radius', type: 'number', default: 10, unit: 'mm', min: 0.01 },
  ]},
  'sketch.spline':  { title: 'Spline', fields: [
    { id: 'points', label: 'Pick points (≥3)', type: 'ref', refKind: 'point' },
  ]},
  'sketch.dim':     { title: 'Dimension', fields: [
    { id: 'a',     label: 'Pick entity A', type: 'ref' },
    { id: 'b',     label: 'Pick entity B', type: 'ref' },
    { id: 'value', label: 'Value', type: 'number', default: 10, unit: 'mm' },
  ]},
  'sketch.constrain': { title: 'Constrain', fields: [
    { id: 'a',    label: 'Pick entity A', type: 'ref' },
    { id: 'b',    label: 'Pick entity B', type: 'ref' },
    { id: 'kind', label: 'Constraint',    type: 'enum',
      options: ['Coincident','Horizontal','Vertical','Parallel','Perpendicular',
                'Tangent','Concentric','Equal','Symmetric','Fix','Midpoint'],
      default: 'Coincident' },
  ]},
  'sketch.finish':  { title: 'Finish Sketch', fields: [] },

  // ----- 3D SOLID ops -----
  'solid.extrude':  { title: 'Extrude', fields: [
    { id: 'sketch',   label: 'Sketch / profile',   type: 'ref' },
    { id: 'distance', label: 'Distance',           type: 'number', default: 25, unit: 'mm', min: 0.01 },
    { id: 'direction',label: 'Direction',          type: 'enum',
      options: ['Up (+Z)','Down (-Z)','Both sides','Mid-plane'], default: 'Up (+Z)' },
    { id: 'op',       label: 'Operation',          type: 'enum',
      options: ['New body','Add','Cut','Intersect'], default: 'New body' },
    { id: 'draft',    label: 'Draft angle',        type: 'number', default: 0, unit: '°' },
    { id: 'thin',     label: 'Thin feature',       type: 'bool', default: false },
    { id: 'thickness',label: 'Thickness',          type: 'number', default: 1, unit: 'mm', min: 0.01 },
  ]},
  'solid.revolve':  { title: 'Revolve', fields: [
    { id: 'sketch', label: 'Sketch / profile', type: 'ref' },
    { id: 'axis',   label: 'Axis',             type: 'ref' },
    { id: 'angle',  label: 'Angle',            type: 'number', default: 360, unit: '°' },
    { id: 'op',     label: 'Operation',        type: 'enum',
      options: ['New body','Add','Cut','Intersect'], default: 'New body' },
  ]},
  'solid.sweep':    { title: 'Sweep', fields: [
    { id: 'profile', label: 'Profile sketch', type: 'ref' },
    { id: 'path',    label: 'Path sketch',    type: 'ref' },
    { id: 'twist',   label: 'Twist',          type: 'number', default: 0, unit: '°' },
    { id: 'guides',  label: 'Use guide curves', type: 'bool', default: false },
  ]},
  'solid.loft':     { title: 'Loft', fields: [
    { id: 'sections',label: 'Section sketches (≥2)', type: 'ref' },
    { id: 'guides',  label: 'Guide curves (optional)', type: 'ref' },
    { id: 'ruled',   label: 'Ruled',           type: 'bool', default: false },
    { id: 'closed',  label: 'Closed loop',     type: 'bool', default: false },
  ]},
  'solid.shell':    { title: 'Shell', fields: [
    { id: 'body',       label: 'Body',            type: 'ref' },
    { id: 'removeFaces',label: 'Faces to remove', type: 'ref' },
    { id: 'thickness',  label: 'Wall thickness',  type: 'number', default: 2, unit: 'mm', min: 0.01 },
  ]},
  'solid.thicken':  { title: 'Thicken', fields: [
    { id: 'body',      label: 'Surface body',   type: 'ref' },
    { id: 'thickness', label: 'Thickness',      type: 'number', default: 2, unit: 'mm', min: 0.01 },
    { id: 'side',      label: 'Side',           type: 'enum',
      options: ['Outward', 'Inward', 'Symmetric'], default: 'Outward' },
  ]},
  'solid.knit':     { title: 'Knit Surface', fields: [
    { id: 'surfaces',  label: 'Surfaces (≥2)',  type: 'ref' },
    { id: 'tolerance', label: 'Tolerance',      type: 'number', default: 0.001, unit: 'mm', min: 0.00001 },
  ]},
  'solid.trimSurface': { title: 'Trim Surface', fields: [
    { id: 'surface', label: 'Surface',  type: 'ref' },
    { id: 'uMin',    label: 'U min',    type: 'number', default: 0.25, min: 0, max: 1 },
    { id: 'uMax',    label: 'U max',    type: 'number', default: 0.75, min: 0, max: 1 },
    { id: 'vMin',    label: 'V min',    type: 'number', default: 0,    min: 0, max: 1 },
    { id: 'vMax',    label: 'V max',    type: 'number', default: 1,    min: 0, max: 1 },
  ]},
  'solid.fillet':   { title: 'Fillet', fields: [
    { id: 'edges',   label: 'Edges',  type: 'ref' },
    { id: 'radius',  label: 'Radius', type: 'number', default: 2, unit: 'mm', min: 0.01 },
    { id: 'variable',label: 'Variable radius', type: 'bool', default: false },
  ]},
  'solid.chamfer':  { title: 'Chamfer', fields: [
    { id: 'edges',     label: 'Edges',       type: 'ref' },
    { id: 'distance',  label: 'Distance',    type: 'number', default: 1, unit: 'mm', min: 0.01 },
    { id: 'asymmetric',label: 'Asymmetric',  type: 'bool', default: false },
    { id: 'distance2', label: 'Distance 2',  type: 'number', default: 1, unit: 'mm', min: 0.01 },
  ]},
  'solid.draft':    { title: 'Draft', fields: [
    { id: 'neutralPlane', label: 'Neutral plane', type: 'ref' },
    { id: 'faces',        label: 'Faces',         type: 'ref' },
    { id: 'angle',        label: 'Draft angle',   type: 'number', default: 3, unit: '°' },
  ]},
  'solid.hole':     { title: 'Hole Wizard', fields: [
    { id: 'position', label: 'Position',  type: 'ref' },
    { id: 'type',     label: 'Hole type', type: 'enum',
      options: ['Simple','Counterbore','Countersink','Tapped','Pipe Tap'],
      default: 'Simple' },
    { id: 'diameter', label: 'Diameter',    type: 'number', default: 6,  unit: 'mm', min: 0.01 },
    { id: 'depth',    label: 'Depth',       type: 'number', default: 20, unit: 'mm', min: 0.01 },
    { id: 'endCondition', label: 'End condition', type: 'enum',
      options: ['Blind','Through all','Up to surface','Up to next'], default: 'Blind' },
  ]},
  'solid.thread':   { title: 'Thread', fields: [
    { id: 'edge',     label: 'Cylindrical edge', type: 'ref' },
    { id: 'pitch',    label: 'Pitch',            type: 'number', default: 1.0, unit: 'mm', min: 0.01 },
    { id: 'standard', label: 'Standard',         type: 'enum',
      options: ['ISO Metric','ANSI Imperial','UNC','UNF','NPT'], default: 'ISO Metric' },
    { id: 'depth',    label: 'Depth',            type: 'number', default: 15, unit: 'mm', min: 0.01 },
  ]},
  'solid.rib':      { title: 'Rib', fields: [
    { id: 'sketch',     label: 'Sketch',        type: 'ref' },
    { id: 'depth',      label: 'Depth',         type: 'number', default: 10, unit: 'mm', min: 0.01 },
    { id: 'thickness',  label: 'Thickness',     type: 'number', default: 2,  unit: 'mm', min: 0.01 },
    { id: 'neutralFace',label: 'Neutral face',  type: 'ref' },
  ]},
  'solid.translate':{ title: 'Move (translate body)', fields: [
    { id: 'body', label: 'Body (defaults to last)', type: 'ref' },
    { id: 'dx',   label: 'dX', type: 'number', default: 0, unit: 'mm' },
    { id: 'dy',   label: 'dY', type: 'number', default: 0, unit: 'mm' },
    { id: 'dz',   label: 'dZ', type: 'number', default: 0, unit: 'mm' },
  ]},

  // ----- PATTERNS -----
  'pattern.linear':   { title: 'Linear Pattern', fields: [
    { id: 'feature', label: 'Feature / body',   type: 'ref' },
    { id: 'dir',     label: 'Direction',        type: 'enum',
      options: ['X','Y','Z','Edge / vector ref'], default: 'X' },
    { id: 'count',   label: 'Count',            type: 'number', default: 4, min: 2, step: 1 },
    { id: 'spacing', label: 'Spacing',          type: 'number', default: 20, unit: 'mm', min: 0.01 },
  ]},
  'pattern.circular': { title: 'Circular Pattern', fields: [
    { id: 'feature', label: 'Feature / body', type: 'ref' },
    { id: 'axis',    label: 'Axis',           type: 'ref' },
    { id: 'count',   label: 'Count',          type: 'number', default: 8, min: 2, step: 1 },
    { id: 'angle',   label: 'Total angle',    type: 'number', default: 360, unit: '°' },
    { id: 'equal',   label: 'Equal spacing',  type: 'bool', default: true },
  ]},
  'pattern.mirror':   { title: 'Mirror Pattern', fields: [
    { id: 'feature', label: 'Feature / body', type: 'ref' },
    { id: 'plane',   label: 'Mirror plane',   type: 'ref' },
  ]},
  'pattern.curve':    { title: 'Pattern on Curve', fields: [
    { id: 'feature', label: 'Feature / body', type: 'ref' },
    { id: 'path',    label: 'Path',           type: 'ref' },
    { id: 'count',   label: 'Count',          type: 'number', default: 6, min: 2, step: 1 },
  ]},

  // ----- BOOLEANS -----
  'bool.union':     { title: 'Boolean Union', fields: [
    { id: 'a', label: 'Body A', type: 'ref' },
    { id: 'b', label: 'Body B', type: 'ref' },
  ]},
  'bool.cut':       { title: 'Boolean Cut', fields: [
    { id: 'target', label: 'Target',    type: 'ref' },
    { id: 'tool',   label: 'Cut with',  type: 'ref' },
  ]},
  'bool.common':    { title: 'Boolean Intersect', fields: [
    { id: 'a', label: 'Body A', type: 'ref' },
    { id: 'b', label: 'Body B', type: 'ref' },
  ]},
  'bool.split':     { title: 'Split Body', fields: [
    { id: 'target', label: 'Target',       type: 'ref' },
    { id: 'plane',  label: 'Cutting plane', type: 'ref' },
  ]},

  // ----- MEASURE -----
  'measure.distance':  { title: 'Distance', fields: [
    { id: 'a', label: 'From', type: 'ref' },
    { id: 'b', label: 'To',   type: 'ref' },
  ]},
  'measure.angle':     { title: 'Angle', fields: [
    { id: 'a', label: 'Reference A', type: 'ref' },
    { id: 'b', label: 'Reference B', type: 'ref' },
  ]},
  'measure.area':      { title: 'Area', fields: [
    { id: 'face', label: 'Face / region', type: 'ref' },
  ]},
  'measure.mass':      { title: 'Mass Properties', fields: [
    { id: 'body', label: 'Body', type: 'ref' },
    { id: 'material', label: 'Material', type: 'enum',
      options: ['Steel','Aluminum','Titanium','Brass','Plastic ABS','Plastic PLA','Wood'],
      default: 'Steel' },
  ]},
  'measure.interfere': { title: 'Interference Check', fields: [
    { id: 'a', label: 'Body A', type: 'ref' },
    { id: 'b', label: 'Body B', type: 'ref' },
    { id: 'tol', label: 'Tolerance', type: 'number', default: 0.01, unit: 'mm', min: 0 },
  ]},

  // ----- DRAWING workbench -----
  'view.iso':       { title: 'Isometric View',   fields: [
    { id: 'body',  label: 'Body',  type: 'ref' },
    { id: 'scale', label: 'Scale', type: 'enum',
      options: ['1:1','1:2','1:5','1:10','1:20','1:50','1:100','2:1','5:1'], default: '1:1' },
  ]},
  'view.front':     { title: 'Front View',  fields: [
    { id: 'body',  label: 'Body',  type: 'ref' },
    { id: 'scale', label: 'Scale', type: 'enum',
      options: ['1:1','1:2','1:5','1:10'], default: '1:1' },
  ]},
  'view.section':   { title: 'Section View',  fields: [
    { id: 'parent', label: 'Parent view',  type: 'ref' },
    { id: 'plane',  label: 'Cutting plane', type: 'enum',
      options: ['Horizontal','Vertical','Custom'], default: 'Horizontal' },
    { id: 'hatch',  label: 'Hatch pattern', type: 'enum',
      options: ['ANSI 31','ANSI 32','ISO 128'], default: 'ANSI 31' },
    { id: 'scale',  label: 'Scale',         type: 'enum',
      options: ['1:1','1:2','1:5'], default: '1:1' },
  ]},
  // ----- SHEET METAL workbench (Forge-127 — CATIA SMD-style) -----
  //
  // Fifteen schemas covering Base / Flange / Bend / Forming / Corner /
  // Flat. Defaults mirror the kFactorTable.js baselines (Steel CR4,
  // K=0.44 at R/T=1). Every dialog drives the same dispatchSheet()
  // routing — see SheetMetalWorkbench.jsx.

  // ── Base ──────────────────────────────────────────────────────
  'sheet.baseFlange': { title: 'Base Flange', fields: [
    { id: 'width',     label: 'Width',     type: 'number', default: 100, unit: 'mm', min: 0.1 },
    { id: 'height',    label: 'Height',    type: 'number', default: 60,  unit: 'mm', min: 0.1 },
    { id: 'material',  label: 'Material',  type: 'enum',
      options: ['steel-cr4','steel-hr','aluminium-5052','aluminium-6061',
                'stainless-304','stainless-316','copper-c110','brass-c26','galvanised'],
      default: 'steel-cr4' },
    { id: 'thickness', label: 'Thickness', type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
    { id: 'k',         label: 'K-factor (auto if blank)', type: 'number', default: 0.44, min: 0, max: 0.5, step: 0.01 },
  ]},

  // ── Flange ────────────────────────────────────────────────────
  'sheet.edgeFlange': { title: 'Edge Flange', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'edgeId',    label: 'Edge ID',     type: 'number', default: 0, step: 1, min: 0 },
    { id: 'length',    label: 'Flange length', type: 'number', default: 25, unit: 'mm', min: 0.1 },
    { id: 'angleDeg',  label: 'Angle',       type: 'number', default: 90, unit: '°' },
    { id: 'relief',    label: 'Relief',      type: 'enum',
      options: ['rect','obround','tear','none'], default: 'rect' },
    { id: 'material',  label: 'Material',    type: 'enum',
      options: ['steel-cr4','steel-hr','aluminium-5052','aluminium-6061',
                'stainless-304','stainless-316','copper-c110','brass-c26','galvanised'],
      default: 'steel-cr4' },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
    { id: 'k',         label: 'K-factor',    type: 'number', default: 0.44, min: 0, max: 0.5, step: 0.01 },
  ]},
  'sheet.edgeFlangeRelief': { title: 'Edge Flange + Relief', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'edgeId',    label: 'Edge ID',     type: 'number', default: 0, step: 1, min: 0 },
    { id: 'length',    label: 'Length',      type: 'number', default: 25, unit: 'mm', min: 0.1 },
    { id: 'angleDeg',  label: 'Angle',       type: 'number', default: 90, unit: '°' },
    { id: 'relief',    label: 'Relief shape', type: 'enum',
      options: ['rect','obround','tear'], default: 'rect' },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
  ]},
  'sheet.miterFlange': { title: 'Miter Flange', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'edgeIds',   label: 'Edge IDs (comma)', type: 'text', default: '0' },
    { id: 'length',    label: 'Length',      type: 'number', default: 25, unit: 'mm', min: 0.1 },
    { id: 'angleDeg',  label: 'Angle',       type: 'number', default: 90, unit: '°' },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
  ]},
  'sheet.miterFlangeChain': { title: 'Miter Flange Chain', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'edgeIds',   label: 'Edge IDs (comma)', type: 'text', default: '0,1,2,3' },
    { id: 'length',    label: 'Length',      type: 'number', default: 25, unit: 'mm', min: 0.1 },
    { id: 'angleDeg',  label: 'Angle',       type: 'number', default: 90, unit: '°' },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
  ]},
  'sheet.loftedFlange': { title: 'Lofted Flange', fields: [
    { id: 'w0',        label: 'Bottom width', type: 'number', default: 40, unit: 'mm', min: 0.1 },
    { id: 'h0',        label: 'Bottom height', type: 'number', default: 20, unit: 'mm', min: 0.1 },
    { id: 'w1',        label: 'Top width',    type: 'number', default: 60, unit: 'mm', min: 0.1 },
    { id: 'h1',        label: 'Top height',   type: 'number', default: 30, unit: 'mm', min: 0.1 },
    { id: 'length',    label: 'Loft height',  type: 'number', default: 30, unit: 'mm', min: 0.1 },
    { id: 'thickness', label: 'Thickness',    type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius',  type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
  ]},
  'sheet.sweptFlange': { title: 'Swept Flange', fields: [
    { id: 'profile',   label: 'Profile wire', type: 'ref' },
    { id: 'path',      label: 'Sweep path',   type: 'ref' },
    { id: 'thickness', label: 'Thickness',    type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius',  type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
  ]},

  // ── Bend ──────────────────────────────────────────────────────
  'sheet.sketchedBend': { title: 'Sketched Bend', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'lineHandle',label: 'Sketch line', type: 'ref' },
    { id: 'angleDeg',  label: 'Bend angle',  type: 'number', default: 90, unit: '°' },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
  ]},
  'sheet.jog': { title: 'Jog', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'edgeId',    label: 'Edge ID',     type: 'number', default: 0, step: 1, min: 0 },
    { id: 'jogHeight', label: 'Jog height',  type: 'number', default: 8, unit: 'mm', min: 0.01 },
    { id: 'angleDeg',  label: 'Angle',       type: 'number', default: 90, unit: '°' },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
  ]},
  'sheet.jogRelief': { title: 'Jog Relief', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'edgeId',    label: 'Edge ID',     type: 'number', default: 0, step: 1, min: 0 },
    { id: 'jogHeight', label: 'Jog height',  type: 'number', default: 8, unit: 'mm', min: 0.01 },
    { id: 'angleDeg',  label: 'Angle',       type: 'number', default: 90, unit: '°' },
    { id: 'reliefMode',label: 'Relief shape', type: 'enum',
      options: ['circular','oval','rectangular'], default: 'circular' },
    { id: 'reliefSize',label: 'Relief size', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
  ]},

  // ── Forming (composed from boolean cut/fuse of stamp tools) ──
  'sheet.louver': { title: 'Louver', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'position',  label: 'Centre',      type: 'vec3', default: [0, 0, 0], unit: 'mm' },
    { id: 'length',    label: 'Length',      type: 'number', default: 30, unit: 'mm', min: 0.1 },
    { id: 'width',     label: 'Width',       type: 'number', default: 6, unit: 'mm', min: 0.05 },
    { id: 'depth',     label: 'Depth',       type: 'number', default: 3.5, unit: 'mm', min: 0.05 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
  ]},
  'sheet.lance': { title: 'Lance', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'length',    label: 'Length',      type: 'number', default: 25, unit: 'mm', min: 0.1 },
    { id: 'width',     label: 'Slit width',  type: 'number', default: 0.5, unit: 'mm', min: 0.05 },
    { id: 'depth',     label: 'Depth',       type: 'number', default: 2, unit: 'mm', min: 0.05 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
  ]},
  'sheet.ribForm': { title: 'Rib Form', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'length',    label: 'Rib length',  type: 'number', default: 60, unit: 'mm', min: 0.1 },
    { id: 'width',     label: 'Rib width',   type: 'number', default: 4, unit: 'mm', min: 0.05 },
    { id: 'height',    label: 'Rib height',  type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
  ]},
  'sheet.dimple': { title: 'Dimple', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'diameter',  label: 'Diameter',    type: 'number', default: 8, unit: 'mm', min: 0.05 },
    { id: 'height',    label: 'Height',      type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
  ]},
  'sheet.drawnCutout': { title: 'Drawn Cutout', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'diameter',  label: 'Cut diameter', type: 'number', default: 10, unit: 'mm', min: 0.05 },
    { id: 'depth',     label: 'Lip depth',   type: 'number', default: 2, unit: 'mm', min: 0.01 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
  ]},
  'sheet.crossBreak': { title: 'Cross Break', fields: [
    { id: 'shape',       label: 'Sheet body',   type: 'ref' },
    { id: 'panelLength', label: 'Panel length', type: 'number', default: 100, unit: 'mm', min: 0.1 },
    { id: 'panelWidth',  label: 'Panel width',  type: 'number', default: 60,  unit: 'mm', min: 0.1 },
    { id: 'height',      label: 'Rib height',   type: 'number', default: 1.0, unit: 'mm', min: 0.01 },
    { id: 'thickness',   label: 'Thickness',    type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
  ]},

  // ── Corner ────────────────────────────────────────────────────
  'sheet.hemClosed': { title: 'Hem (Closed)', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'edgeId',    label: 'Edge ID',     type: 'number', default: 0, step: 1, min: 0 },
    { id: 'length',    label: 'Hem length',  type: 'number', default: 3, unit: 'mm', min: 0.05 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
  ]},
  'sheet.hemOpen':     { title: 'Hem (Open)', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'edgeId',    label: 'Edge ID',     type: 'number', default: 0, step: 1, min: 0 },
    { id: 'length',    label: 'Hem length',  type: 'number', default: 3, unit: 'mm', min: 0.05 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
  ]},
  'sheet.hemRolled':   { title: 'Hem (Rolled)', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'edgeId',    label: 'Edge ID',     type: 'number', default: 0, step: 1, min: 0 },
    { id: 'length',    label: 'Hem length',  type: 'number', default: 4, unit: 'mm', min: 0.05 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 2.0, unit: 'mm', min: 0.01 },
  ]},
  'sheet.hemTeardrop': { title: 'Hem (Teardrop)', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'edgeId',    label: 'Edge ID',     type: 'number', default: 0, step: 1, min: 0 },
    { id: 'length',    label: 'Hem length',  type: 'number', default: 3.5, unit: 'mm', min: 0.05 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
  ]},
  'sheet.closedCorner': { title: 'Closed Corner', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'vertexId',  label: 'Vertex ID',   type: 'number', default: 0, step: 1, min: 0 },
    { id: 'gap',       label: 'Gap',         type: 'number', default: 0.1, unit: 'mm', min: 0 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
  ]},
  'sheet.cornerRelief': { title: 'Corner Relief', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'vertexId',  label: 'Vertex ID',   type: 'number', default: 0, step: 1, min: 0 },
    { id: 'reliefMode',label: 'Mode',        type: 'enum',
      options: ['circular','oval','rectangular'], default: 'circular' },
    { id: 'sizeMm',    label: 'Size',        type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
  ]},

  // ── Flat ──────────────────────────────────────────────────────
  'sheet.unfold': { title: 'Unfold Bend', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
    { id: 'k',         label: 'K-factor',    type: 'number', default: 0.44, min: 0, max: 0.5, step: 0.01 },
  ]},
  'sheet.flatPattern': { title: 'Flat Pattern', fields: [
    { id: 'shape',     label: 'Sheet body',  type: 'ref' },
    { id: 'thickness', label: 'Thickness',   type: 'number', default: 1.5, unit: 'mm', min: 0.05 },
    { id: 'bendRadius',label: 'Bend radius', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
    { id: 'k',         label: 'K-factor',    type: 'number', default: 0.44, min: 0, max: 0.5, step: 0.01 },
  ]},

  // ----- Legacy SHEET METAL entries (kept for back-compat with shell) -----
  'sheet.flange':  { title: 'Edge Flange', fields: [
    { id: 'edge',     label: 'Edge to flange', type: 'ref' },
    { id: 'length',   label: 'Length',         type: 'number', default: 25, unit: 'mm', min: 0.01 },
    { id: 'angle',    label: 'Angle',          type: 'number', default: 90, unit: '°' },
    { id: 'kfactor',  label: 'K-factor',       type: 'number', default: 0.44, min: 0, max: 1, step: 0.01 },
    { id: 'thickness',label: 'Material thickness', type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
    { id: 'bendRadius', label: 'Bend radius',  type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
    { id: 'relief',   label: 'Corner relief',  type: 'enum',
      options: ['None','Rectangular','Round','Tear'], default: 'Round' },
  ]},
  'sheet.bend':    { title: 'Sketched Bend', fields: [
    { id: 'sketch',   label: 'Sketch line',    type: 'ref' },
    { id: 'angle',    label: 'Bend angle',     type: 'number', default: 90, unit: '°' },
    { id: 'radius',   label: 'Bend radius',    type: 'number', default: 1.5, unit: 'mm', min: 0.01 },
    { id: 'direction',label: 'Direction',      type: 'enum',
      options: ['Up','Down'], default: 'Up' },
  ]},
  'sheet.hem':     { title: 'Hem', fields: [
    { id: 'edge',   label: 'Edge',     type: 'ref' },
    { id: 'type',   label: 'Hem type', type: 'enum',
      options: ['Closed','Open','Tear-drop','Rolled'], default: 'Closed' },
    { id: 'length', label: 'Length',   type: 'number', default: 3, unit: 'mm', min: 0.01 },
  ]},
  // (sheet.unfold is defined above in the new schema set; legacy
  // duplicate removed to avoid the JS object literal overriding it.)
  'sheet.pattern': { title: 'Flat Pattern', fields: [
    { id: 'body',         label: 'Sheet body', type: 'ref' },
    { id: 'fixedFace',    label: 'Fixed face', type: 'ref' },
    { id: 'mergeFaces',   label: 'Merge faces', type: 'bool', default: true },
    { id: 'simplifyBends',label: 'Simplify bends', type: 'bool', default: false },
  ]},
  // ----- WELDMENTS workbench -----
  'weld.member':  { title: 'Structural Member', fields: [
    { id: 'path',      label: 'Path sketches',  type: 'ref' },
    { id: 'profile',   label: 'Profile shape',  type: 'enum',
      options: ['Square tube','Rect tube','Round tube','Angle','C-channel','I-beam',
                'T-section','Pipe'], default: 'Square tube' },
    { id: 'standard',  label: 'Standard',       type: 'enum',
      options: ['ISO','ANSI','DIN','JIS'], default: 'ISO' },
    { id: 'size',      label: 'Size',           type: 'text', default: '50×50×4' },
    { id: 'alignment', label: 'Alignment',      type: 'enum',
      options: ['Centroid','Top-left','Top-right','Bottom-left','Bottom-right',
                'Center-top','Center-bottom'], default: 'Centroid' },
    { id: 'mirror',    label: 'Mirror profile', type: 'bool', default: false },
  ]},
  'weld.endcap':  { title: 'End Cap', fields: [
    { id: 'opening',   label: 'Opening edge',   type: 'ref' },
    { id: 'thickness', label: 'Thickness',      type: 'number', default: 5, unit: 'mm', min: 0.01 },
    { id: 'offset',    label: 'Offset',         type: 'number', default: 0, unit: 'mm' },
  ]},
  'weld.gusset':  { title: 'Gusset', fields: [
    { id: 'vertex',    label: 'Vertex',         type: 'ref' },
    { id: 'size',      label: 'Size',           type: 'number', default: 60, unit: 'mm', min: 0.01 },
    { id: 'thickness', label: 'Thickness',      type: 'number', default: 6, unit: 'mm', min: 0.01 },
  ]},
  'weld.bead':    { title: 'Weld Bead', fields: [
    { id: 'edges',     label: 'Edges',          type: 'ref' },
    { id: 'size',      label: 'Bead size',      type: 'number', default: 3, unit: 'mm', min: 0.01 },
    { id: 'kind',      label: 'Weld type',      type: 'enum',
      options: ['Fillet','Butt','Spot','Plug'], default: 'Fillet' },
  ]},
  // ----- MOLD TOOLS workbench -----
  'mold.parting':  { title: 'Parting Line', fields: [
    { id: 'body',     label: 'Part to mold',   type: 'ref' },
    { id: 'draftAngle', label: 'Min draft angle', type: 'number', default: 1, unit: '°' },
    { id: 'direction',  label: 'Pull direction', type: 'enum',
      options: ['+Z','-Z','+X','-X','+Y','-Y'], default: '+Z' },
  ]},
  'mold.core':     { title: 'Core', fields: [
    { id: 'parting',  label: 'Parting line',   type: 'ref' },
    { id: 'extend',   label: 'Extension',      type: 'number', default: 40, unit: 'mm' },
  ]},
  'mold.cavity':   { title: 'Cavity', fields: [
    { id: 'parting',  label: 'Parting line',   type: 'ref' },
    { id: 'block',    label: 'Mold block size', type: 'vec3', default: [200, 200, 50], unit: 'mm' },
  ]},
  // ----- SIMULATION workbench -----
  'sim.static':    { title: 'Static Structural Study', fields: [
    { id: 'body',     label: 'Body',           type: 'ref' },
    { id: 'material', label: 'Material',       type: 'enum',
      options: ['Structural steel','Aluminum 6061','Aluminum 7075','Titanium Ti-6Al-4V',
                'Brass','ABS plastic','PLA','Stainless 316L'], default: 'Structural steel' },
    { id: 'mesh',     label: 'Mesh element size', type: 'number', default: 5, unit: 'mm', min: 0.1 },
    { id: 'bcs',      label: 'Boundary conditions (fixed face)', type: 'ref' },
    { id: 'loads',    label: 'Load surfaces',  type: 'ref' },
    { id: 'loadMagnitude', label: 'Load magnitude', type: 'number', default: 100, unit: 'N' },
  ]},
  'sim.modal':     { title: 'Modal Study', fields: [
    { id: 'body',     label: 'Body',           type: 'ref' },
    { id: 'material', label: 'Material',       type: 'enum',
      options: ['Structural steel','Aluminum 6061','Titanium','Brass'], default: 'Structural steel' },
    { id: 'nModes',   label: 'Number of modes', type: 'number', default: 6, min: 1, max: 50, step: 1 },
  ]},
  'sim.dynamic':   { title: 'Dynamic Study', fields: [
    { id: 'body',     label: 'Body',           type: 'ref' },
    { id: 'material', label: 'Material',       type: 'enum',
      options: ['Structural steel','Aluminum','Titanium','Brass'], default: 'Structural steel' },
    { id: 'tEnd',     label: 'Time span',      type: 'number', default: 1, unit: 's', min: 0.001 },
    { id: 'dt',       label: 'Time step',      type: 'number', default: 0.001, unit: 's', min: 0.00001 },
  ]},
  'sim.thermal':   { title: 'Thermal Study', fields: [
    { id: 'body',     label: 'Body',           type: 'ref' },
    { id: 'material', label: 'Material',       type: 'enum',
      options: ['Structural steel','Aluminum','Titanium','Brass','Air','Water'], default: 'Structural steel' },
    { id: 'fixedTemp',label: 'Fixed temperature (°C)', type: 'number', default: 25, unit: '°C' },
    { id: 'sources',  label: 'Heat source faces', type: 'ref' },
    { id: 'sourceWatt', label: 'Heat source (W)', type: 'number', default: 10, unit: 'W' },
  ]},
  'sim.cfd':       { title: 'CFD Study', fields: [
    { id: 'fluidVolume', label: 'Fluid volume', type: 'ref' },
    { id: 'fluid',       label: 'Fluid',        type: 'enum',
      options: ['Air','Water','Oil SAE 10','Hydraulic Oil','Glycol'], default: 'Air' },
    { id: 'inletVel',    label: 'Inlet velocity', type: 'number', default: 5, unit: 'm/s' },
    { id: 'outletPressure', label: 'Outlet pressure', type: 'number', default: 0, unit: 'Pa' },
  ]},
  // ----- MANUFACTURING workbench -----
  'mfg.face':      { title: 'Face Milling', fields: [
    { id: 'face',     label: 'Face',           type: 'ref' },
    { id: 'tool',     label: 'Tool',           type: 'enum',
      options: ['Ø50 face mill','Ø32 face mill','Ø20 endmill','Ø10 endmill'], default: 'Ø50 face mill' },
    { id: 'rpm',      label: 'Spindle RPM',    type: 'number', default: 4000, min: 100, step: 100 },
    { id: 'feed',     label: 'Feed rate',      type: 'number', default: 800, unit: 'mm/min', min: 1 },
    { id: 'depth',    label: 'Cut depth',      type: 'number', default: 2, unit: 'mm', min: 0.01 },
    { id: 'stepover',label: 'Stepover',        type: 'number', default: 70, unit: '%', min: 1, max: 100 },
  ]},
  'mfg.contour':   { title: 'Contour', fields: [
    { id: 'edge',     label: 'Contour edge',   type: 'ref' },
    { id: 'tool',     label: 'Tool',           type: 'enum',
      options: ['Ø10 endmill','Ø6 endmill','Ø3 endmill'], default: 'Ø10 endmill' },
    { id: 'rpm',      label: 'Spindle RPM',    type: 'number', default: 6000, min: 100, step: 100 },
    { id: 'feed',     label: 'Feed rate',      type: 'number', default: 600, unit: 'mm/min', min: 1 },
    { id: 'leadIn',   label: 'Lead in',        type: 'enum',
      options: ['None','Linear','Arc tangent'], default: 'Arc tangent' },
  ]},
  'mfg.pocket':    { title: 'Pocket', fields: [
    { id: 'face',     label: 'Pocket face',    type: 'ref' },
    { id: 'tool',     label: 'Tool',           type: 'enum',
      options: ['Ø10 endmill','Ø6 endmill','Ø3 endmill'], default: 'Ø10 endmill' },
    { id: 'depth',    label: 'Pocket depth',   type: 'number', default: 5, unit: 'mm', min: 0.01 },
    { id: 'strategy', label: 'Strategy',       type: 'enum',
      options: ['Adaptive clearing','Conventional','Spiral','Parallel'], default: 'Adaptive clearing' },
    { id: 'rpm',      label: 'Spindle RPM',    type: 'number', default: 8000, min: 100, step: 100 },
  ]},
  'mfg.drill':     { title: 'Drill', fields: [
    { id: 'holes',    label: 'Hole features',  type: 'ref' },
    { id: 'tool',     label: 'Drill bit',      type: 'enum',
      options: ['Ø3 drill','Ø5 drill','Ø6 drill','Ø8 drill','Ø10 drill','Ø12 drill'], default: 'Ø6 drill' },
    { id: 'rpm',      label: 'Spindle RPM',    type: 'number', default: 1200, min: 100, step: 100 },
    { id: 'peck',     label: 'Peck depth',     type: 'number', default: 3, unit: 'mm', min: 0.01 },
  ]},
  'mfg.5axis':     { title: '5-axis Toolpath', fields: [
    { id: 'face',     label: 'Drive face',     type: 'ref' },
    { id: 'tool',     label: 'Tool',           type: 'enum',
      options: ['Ø6 ballmill','Ø8 ballmill','Ø10 ballmill','Ø12 bullnose'], default: 'Ø8 ballmill' },
    { id: 'strategy', label: 'Strategy',       type: 'enum',
      options: ['Swarf','Flowline','Parallel','Constant Z'], default: 'Flowline' },
    { id: 'stepover',label: 'Stepover',        type: 'number', default: 0.5, unit: 'mm', min: 0.01 },
  ]},
  'mfg.post':      { title: 'Post Process', fields: [
    { id: 'dialect',  label: 'Controller',     type: 'enum',
      options: ['Fanuc','Haas','Siemens','Mazak','LinuxCNC','GRBL (hobby)'], default: 'Fanuc' },
    { id: 'safeZ',    label: 'Safe Z',         type: 'number', default: 20, unit: 'mm' },
    { id: 'coolant',  label: 'Coolant',        type: 'enum',
      options: ['Off','Flood','Mist','Air blast'], default: 'Flood' },
  ]},
};

export function schemaFor(toolId) {
  return TOOL_SCHEMAS[toolId] || null;
}
