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
};

export function schemaFor(toolId) {
  return TOOL_SCHEMAS[toolId] || null;
}
