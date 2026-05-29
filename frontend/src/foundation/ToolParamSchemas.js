/**
 * ArchDisc Tool Parameter Schemas.
 *
 * Each foundation ribbon tool that needs user-tweakable inputs
 * declares a small schema here. The schema is consumed by
 * ToolParamDialog (renders the modal) and by ToolExecutionEngine
 * handlers (read values from the dialog's submit).
 *
 * Why centralise: every tool previously hardcoded its inputs at
 * the top of its handler ("Trent-XWB at FL350 cruise" for Brayton,
 * "100 kg/s, 8000 RPM" for Compressor Stage, etc.). Industry peers
 * pop a small dialog before each compute — this matches that UX
 * while keeping the math identical.
 *
 * Schema shape:
 *   {
 *     title:  string,
 *     blurb:  string,         // one-line context for the dialog header
 *     fields: [{
 *       name:    string,      // key in the returned values object
 *       label:   string,
 *       type:    'number' | 'enum',
 *       default: number | string,
 *       unit?:   string,
 *       min?:    number,
 *       max?:    number,
 *       step?:   number,
 *       options?: string[],   // for enum
 *       hint?:   string,
 *     }],
 *   }
 *
 * Handlers call `requestToolParams(toolName)` which returns a
 * promise resolving to `{values, cancelled}`. If cancelled, the
 * handler should bail with a soft message.
 */

export const TOOL_PARAM_SCHEMAS = {

  // ─── ATOMIC SCULPT (pure platform-driven construction) ───────────────────
  // Every dimension is user-input here. No baked geometry, no catalog
  // recipe. The e2e (or a human) sequences these to sculpt each part
  // sketch-by-sketch, feature-by-feature, through the ribbon UI.
  'Sculpt Rectangle': {
    title: 'Sculpt — Sketch Rectangle',
    blurb: 'Start (or continue) the active sculpt part with a rectangle on the chosen plane. Centre + size in mm.',
    fields: [
      { name: 'cx', label: 'Centre X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'cy', label: 'Centre Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'w',  label: 'Width',    type: 'number', default: 100, unit: 'mm', min: 0.1, step: 1 },
      { name: 'h',  label: 'Height',   type: 'number', default: 100, unit: 'mm', min: 0.1, step: 1 },
      { name: 'plane', label: 'Plane', type: 'enum', default: 'XY', options: ['XY', 'top', 'bottom'] },
    ],
  },
  'Sculpt Circle': {
    title: 'Sculpt — Sketch Circle',
    blurb: 'Add a circle to the active sculpt sketch. Centre + radius in mm.',
    fields: [
      { name: 'cx', label: 'Centre X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'cy', label: 'Centre Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'r',  label: 'Radius',   type: 'number', default: 50, unit: 'mm', min: 0.1, step: 1 },
      { name: 'plane', label: 'Plane', type: 'enum', default: 'XY', options: ['XY', 'top', 'bottom'] },
    ],
  },
  'Sculpt Polygon': {
    title: 'Sculpt — Sketch N-gon',
    blurb: 'Add a regular polygon to the active sculpt sketch.',
    fields: [
      { name: 'cx', label: 'Centre X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'cy', label: 'Centre Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'r',  label: 'Circumradius', type: 'number', default: 50, unit: 'mm', min: 0.1, step: 1 },
      { name: 'n',  label: 'Sides',    type: 'number', default: 6, min: 3, step: 1 },
      { name: 'plane', label: 'Plane', type: 'enum', default: 'XY', options: ['XY', 'top', 'bottom'] },
    ],
  },
  'Sculpt Extrude': {
    title: 'Sculpt — Extrude',
    blurb: 'Finish the open sketch and extrude it by the given distance (mm).',
    fields: [
      { name: 'distance', label: 'Distance', type: 'number', default: 50, unit: 'mm', min: 0.1, step: 1 },
    ],
  },
  'Sculpt Cut': {
    title: 'Sculpt — Cut',
    blurb: 'Finish the open sketch and subtract it (through-cut) from the active part.',
    fields: [
      { name: 'distance', label: 'Depth', type: 'number', default: 50, unit: 'mm', min: 0.1, step: 1 },
    ],
  },
  'Sculpt Revolve': {
    title: 'Sculpt — Revolve',
    blurb: 'Finish the open sketch (X≥0 half-plane) and revolve it around the Y axis.',
    fields: [
      { name: 'segments', label: 'Segments', type: 'number', default: 64, min: 3, step: 1 },
      { name: 'degrees',  label: 'Sweep °',  type: 'number', default: 360, min: 1, max: 360, step: 1 },
    ],
  },
  'Sculpt Loft': {
    title: 'Sculpt — Loft (Class-A frustum)',
    blurb: 'Loft a smooth surface between two circular profiles (r1 → r2 over height). Curved transition, not a staircased cone.',
    fields: [
      { name: 'r1', label: 'Base radius',  type: 'number', default: 200, unit: 'mm', min: 0.1, step: 1 },
      { name: 'r2', label: 'Top radius',   type: 'number', default: 80,  unit: 'mm', min: 0.1, step: 1 },
      { name: 'height', label: 'Height',   type: 'number', default: 400, unit: 'mm', min: 0.1, step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x9aa3ad, step: 1 },
    ],
  },
  'Sculpt Pipe': {
    title: 'Sculpt — Pipe / Harness (swept tube)',
    blurb: 'Sweep a circular cross-section along a 3-point path (start → bend → end). For hoses, wiring harnesses, exhaust runs.',
    fields: [
      { name: 'radius', label: 'Pipe radius', type: 'number', default: 40, unit: 'mm', min: 0.1, step: 1 },
      { name: 'x1', label: 'Start X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y1', label: 'Start Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z1', label: 'Start Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'x2', label: 'End X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y2', label: 'End Y', type: 'number', default: 1000, unit: 'mm', step: 1 },
      { name: 'z2', label: 'End Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'bend', label: 'Bend offset', type: 'number', default: 0, unit: 'mm', step: 1, hint: 'lateral bow of the midpoint' },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0xb9bcc1, step: 1 },
    ],
  },
  'Sculpt Perforated Panel': {
    title: 'Sculpt — Perforated Panel (mesh / grille)',
    blurb: 'Sketch a panel + cut a grid of holes through it. For radiator grilles, perforated heat shields, vented covers.',
    fields: [
      { name: 'w', label: 'Width', type: 'number', default: 1500, unit: 'mm', min: 1, step: 10 },
      { name: 'h', label: 'Height', type: 'number', default: 500, unit: 'mm', min: 1, step: 10 },
      { name: 't', label: 'Thickness', type: 'number', default: 6, unit: 'mm', min: 0.5, step: 1 },
      { name: 'holeR', label: 'Hole radius', type: 'number', default: 9, unit: 'mm', min: 0.5, step: 1 },
      { name: 'cols', label: 'Columns', type: 'number', default: 40, min: 1, step: 1 },
      { name: 'rows', label: 'Rows', type: 'number', default: 14, min: 1, step: 1 },
      { name: 'spacing', label: 'Hole spacing', type: 'number', default: 30, unit: 'mm', min: 1, step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x223a52, step: 1 },
    ],
  },
  'Sculpt Circular Pattern': {
    title: 'Sculpt — Circular Pattern',
    blurb: 'Pattern the open sketch into a ring of copies about the origin (bolt circles, gear teeth, valve seats). Sketch the feature offset from the origin.',
    fields: [
      { name: 'mode', label: 'Mode', type: 'enum', options: ['extrude', 'cut'], default: 'extrude' },
      { name: 'count', label: 'Count', type: 'number', default: 6, min: 1, step: 1 },
      { name: 'distance', label: 'Depth', type: 'number', default: 30, unit: 'mm', min: 0.1, step: 1 },
      { name: 'angle', label: 'Spread', type: 'number', default: 360, unit: '°', min: 1, step: 5 },
    ],
  },
  'Sculpt Linear Pattern': {
    title: 'Sculpt — Linear Pattern',
    blurb: 'Pattern the open sketch into a straight row (head-bolt rows, cooling fins, rivet lines). Each copy offset by (dx, dy) from the last.',
    fields: [
      { name: 'mode', label: 'Mode', type: 'enum', options: ['extrude', 'cut'], default: 'extrude' },
      { name: 'count', label: 'Count', type: 'number', default: 5, min: 1, step: 1 },
      { name: 'distance', label: 'Depth', type: 'number', default: 30, unit: 'mm', min: 0.1, step: 1 },
      { name: 'dx', label: 'Step X', type: 'number', default: 50, unit: 'mm', step: 1 },
      { name: 'dy', label: 'Step Y', type: 'number', default: 0, unit: 'mm', step: 1 },
    ],
  },
  'Sculpt Tire': {
    title: 'Sculpt — Tire (tread wrapped on carcass)',
    blurb: 'Revolve a tyre carcass then circular-pattern tread blocks around the circumference. Defaults model a Volvo FH 315/80R22.5 drive tyre.',
    fields: [
      { name: 'rimR', label: 'Rim radius', type: 'number', default: 286, unit: 'mm', min: 1, step: 1 },
      { name: 'outerR', label: 'Outer radius', type: 'number', default: 537, unit: 'mm', min: 1, step: 1 },
      { name: 'width', label: 'Section width', type: 'number', default: 315, unit: 'mm', min: 1, step: 5 },
      { name: 'treadCount', label: 'Tread blocks', type: 'number', default: 54, min: 6, step: 1 },
      { name: 'treadDepth', label: 'Tread depth', type: 'number', default: 22, unit: 'mm', min: 1, step: 1 },
      { name: 'axis', label: 'Spin axis', type: 'enum', options: ['X', 'Y', 'Z'], default: 'X' },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x1a1a1a, step: 1 },
    ],
  },
  'Sculpt Bolt Array': {
    title: 'Sculpt — Bolt Array (instanced)',
    blurb: 'Sculpt one hex bolt then stamp it `count` times as a single GPU-instanced sub-assembly (one draw call). Hundreds–thousands of fasteners at near-zero cost.',
    fields: [
      { name: 'count', label: 'Bolt count', type: 'number', default: 240, min: 1, step: 10 },
      { name: 'layout', label: 'Layout', type: 'enum', options: ['grid', 'circle'], default: 'grid' },
      { name: 'spacing', label: 'Grid spacing', type: 'number', default: 64, unit: 'mm', min: 1, step: 2 },
      { name: 'radius', label: 'Circle radius', type: 'number', default: 320, unit: 'mm', min: 1, step: 5 },
      { name: 'headR', label: 'Head radius', type: 'number', default: 16, unit: 'mm', min: 0.5, step: 1 },
      { name: 'headH', label: 'Head height', type: 'number', default: 12, unit: 'mm', min: 0.5, step: 1 },
      { name: 'shankR', label: 'Shank radius', type: 'number', default: 9, unit: 'mm', min: 0.5, step: 1 },
      { name: 'shankLen', label: 'Shank length', type: 'number', default: 42, unit: 'mm', min: 1, step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x8a8d92, step: 1 },
    ],
  },
  'Sculpt Crown Panel': {
    title: 'Sculpt — Crown Panel (Class-A skin)',
    blurb: 'A doubly-curved, constant-thickness exterior skin — crowned across the width AND along the length. Smooth (Class-A); verify with Zebra Check.',
    fields: [
      { name: 'width', label: 'Width', type: 'number', default: 2000, unit: 'mm', min: 10, step: 10 },
      { name: 'length', label: 'Length', type: 'number', default: 2400, unit: 'mm', min: 10, step: 10 },
      { name: 'crownX', label: 'Transverse crown', type: 'number', default: 180, unit: 'mm', min: 0, step: 5 },
      { name: 'crownZ', label: 'Longitudinal crown', type: 'number', default: 120, unit: 'mm', min: 0, step: 5 },
      { name: 'thickness', label: 'Thickness', type: 'number', default: 40, unit: 'mm', min: 1, step: 1 },
      { name: 'nu', label: 'Width samples', type: 'number', default: 30, min: 8, step: 2 },
      { name: 'nv', label: 'Length stations', type: 'number', default: 26, min: 4, step: 2 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x33597a, step: 1 },
    ],
  },
  'Sculpt Fender Arch': {
    title: 'Sculpt — Fender Arch (Class-A wheel arch)',
    blurb: 'A single-curvature crowned skin swept along a circular arch — fender flares, wheel arches, cab corner radii.',
    fields: [
      { name: 'archRadius', label: 'Arch radius', type: 'number', default: 560, unit: 'mm', min: 10, step: 10 },
      { name: 'archSpan', label: 'Arch span', type: 'number', default: 200, unit: '°', min: 20, step: 10 },
      { name: 'width', label: 'Width', type: 'number', default: 360, unit: 'mm', min: 10, step: 10 },
      { name: 'section', label: 'Lip height', type: 'number', default: 140, unit: 'mm', min: 5, step: 5 },
      { name: 'thickness', label: 'Thickness', type: 'number', default: 30, unit: 'mm', min: 1, step: 1 },
      { name: 'nv', label: 'Arch stations', type: 'number', default: 40, min: 8, step: 2 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x2c4d6a, step: 1 },
    ],
  },
  'Sculpt Embossed Text': {
    title: 'Sculpt — Embossed Text (real-font relief)',
    blurb: 'Extrude any string as smooth real-font 3D lettering (e.g. the VOLVO wordmark) — a true manifold you can mount raised on a panel.',
    fields: [
      { name: 'text', label: 'Text', type: 'text', default: 'VOLVO' },
      { name: 'size', label: 'Cap height', type: 'number', default: 300, unit: 'mm', min: 5, step: 5 },
      { name: 'depth', label: 'Relief depth', type: 'number', default: 40, unit: 'mm', min: 1, step: 1 },
      { name: 'curveSegments', label: 'Glyph smoothness', type: 'number', default: 8, min: 2, step: 1 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0xcfd3d7, step: 1 },
    ],
  },
  'Sculpt Cam': {
    title: 'Sculpt — Radial Cam',
    blurb: 'A disc cam: a base circle with a smooth raised-cosine nose (rise-dwell-fall) that a follower rides. Central bore. Axis +Z.',
    fields: [
      { name: 'baseR', label: 'Base radius', type: 'number', default: 120, unit: 'mm', min: 5, step: 2 },
      { name: 'lift', label: 'Nose lift', type: 'number', default: 70, unit: 'mm', min: 1, step: 2 },
      { name: 'noseCenter', label: 'Nose angle', type: 'number', default: 90, unit: '°', step: 5 },
      { name: 'noseWidth', label: 'Nose width', type: 'number', default: 120, unit: '°', min: 10, step: 5 },
      { name: 'thickness', label: 'Thickness', type: 'number', default: 90, unit: 'mm', min: 2, step: 5 },
      { name: 'boreR', label: 'Bore radius', type: 'number', default: 40, unit: 'mm', min: 0, step: 2 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x6a6f76, step: 1 },
    ],
  },
  'Sculpt Bearing': {
    title: 'Sculpt — Ball Bearing',
    blurb: 'A rolling-element bearing: outer race + inner race + a ring of balls at the pitch circle. Axis +Z.',
    fields: [
      { name: 'boreR', label: 'Bore radius', type: 'number', default: 80, unit: 'mm', min: 2, step: 2 },
      { name: 'outerR', label: 'Outer radius', type: 'number', default: 160, unit: 'mm', min: 5, step: 2 },
      { name: 'width', label: 'Width', type: 'number', default: 90, unit: 'mm', min: 2, step: 2 },
      { name: 'balls', label: 'Ball count', type: 'number', default: 10, min: 4, step: 1 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x9aa0a6, step: 1 },
    ],
  },
  'Sculpt Thread': {
    title: 'Sculpt — Threaded Rod (V-thread)',
    blurb: 'A real single-start helical V-thread (screws / studs / lead screws). One crest wraps the circumference and spirals up by the pitch. Axis +Y.',
    fields: [
      { name: 'length', label: 'Length', type: 'number', default: 600, unit: 'mm', min: 10, step: 10 },
      { name: 'majorR', label: 'Major radius', type: 'number', default: 80, unit: 'mm', min: 2, step: 1 },
      { name: 'pitch', label: 'Pitch (lead)', type: 'number', default: 60, unit: 'mm', min: 4, step: 2 },
      { name: 'threadDepth', label: 'Thread depth', type: 'number', default: 20, unit: 'mm', min: 1, step: 1 },
      { name: 'sides', label: 'Facets', type: 'number', default: 56, min: 24, step: 2 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x9aa0a6, step: 1 },
    ],
  },
  'Sculpt Spring': {
    title: 'Sculpt — Helical Spring',
    blurb: 'A coil spring: a circular wire swept along a helix (suspension / valve / compression). Keep pitch > 2·wire-radius so coils do not fuse. Axis +Y.',
    fields: [
      { name: 'coilR', label: 'Coil radius', type: 'number', default: 120, unit: 'mm', min: 5, step: 5 },
      { name: 'wireR', label: 'Wire radius', type: 'number', default: 20, unit: 'mm', min: 1, step: 1 },
      { name: 'pitch', label: 'Pitch (rise/turn)', type: 'number', default: 80, unit: 'mm', min: 4, step: 2 },
      { name: 'turns', label: 'Turns', type: 'number', default: 8, min: 1, step: 1 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x9aa0a6, step: 1 },
    ],
  },
  'Sculpt Gear': {
    title: 'Sculpt — Spur Gear (involute-style)',
    blurb: 'A parametric spur gear: module × teeth on standard pitch/addendum/dedendum circles, with a central bore. Two same-module gears mesh at centre distance m·(z1+z2)/2.',
    fields: [
      { name: 'module', label: 'Module (m)', type: 'number', default: 8, unit: 'mm', min: 0.5, step: 0.5 },
      { name: 'teeth', label: 'Teeth (z)', type: 'number', default: 24, min: 6, step: 1 },
      { name: 'thickness', label: 'Face width', type: 'number', default: 120, unit: 'mm', min: 2, step: 5 },
      { name: 'boreR', label: 'Bore radius', type: 'number', default: 60, unit: 'mm', min: 0, step: 2 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x8a8d92, step: 1 },
    ],
  },
  'Sculpt Flex Pipe': {
    title: 'Sculpt — Flex Pipe (corrugated bellows)',
    blurb: 'A corrugated bellows tube (exhaust flex section) — radius oscillates along the axis to form real convolutions. Built along +Z; rotate onto the run.',
    fields: [
      { name: 'length', label: 'Length', type: 'number', default: 600, unit: 'mm', min: 10, step: 10 },
      { name: 'radius', label: 'Mean radius', type: 'number', default: 90, unit: 'mm', min: 2, step: 2 },
      { name: 'amplitude', label: 'Convolution depth', type: 'number', default: 22, unit: 'mm', min: 1, step: 1 },
      { name: 'convolutions', label: 'Convolutions', type: 'number', default: 12, min: 1, step: 1 },
      { name: 'sides', label: 'Facets', type: 'number', default: 36, min: 8, step: 2 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x8a9098, step: 1 },
    ],
  },
  'Sculpt Edge Fillet': {
    title: 'Sculpt — Edge Fillet (G1 blend)',
    blurb: 'A tangent-continuous rolling-ball quarter-round run along an axis-aligned edge. Place it in a concave panel junction then Merge to weld a smooth fillet into the corner.',
    fields: [
      { name: 'radius', label: 'Fillet radius', type: 'number', default: 80, unit: 'mm', min: 1, step: 2 },
      { name: 'length', label: 'Run length', type: 'number', default: 1000, unit: 'mm', min: 5, step: 10 },
      { name: 'segments', label: 'Arc segments', type: 'number', default: 28, min: 4, step: 2 },
      { name: 'axis', label: 'Edge axis', type: 'enum', options: ['X', 'Y', 'Z'], default: 'Z' },
      { name: 'quadrant', label: 'Quadrant (0-3)', type: 'enum', options: ['0', '1', '2', '3'], default: '0' },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'x', label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y', label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z', label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x33597a, step: 1 },
    ],
  },
  'Sculpt Merge Bodies': {
    title: 'Sculpt — Merge Bodies (weld watertight)',
    blurb: 'Boolean-union every solid body into ONE watertight solid (overlapping panels weld at their seams). Exact — keeps smooth Class-A surfaces, no voxelization.',
    fields: [
      { name: 'color', label: 'Merged colour (hex)', type: 'number', default: 0x33597a, step: 1 },
    ],
  },
  'Sculpt Zebra Check': {
    title: 'Sculpt — Zebra Check (Class-A QC)',
    blurb: 'Overlay striped reflection lines on every body to inspect surface continuity. Smooth, evenly-spaced stripes = clean Class-A; kinks/jumps = discontinuity. Run again to toggle off.',
    fields: [
      { name: 'stripeFrequency', label: 'Stripe count', type: 'number', default: 18, min: 1, step: 1 },
      { name: 'direction', label: 'Direction', type: 'enum', options: ['horizontal', 'vertical'], default: 'horizontal' },
      { name: 'sharpness', label: 'Edge sharpness', type: 'number', default: 0.85, min: 0, max: 1, step: 0.05 },
    ],
  },
  'Sculpt Place Body': {
    title: 'Sculpt — Place + Finish Body',
    blurb: 'Rotate + translate the finished sculpt part into the assembly and register it as a body. Clears the active part for the next one.',
    fields: [
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°', step: 1 },
      { name: 'x',  label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y',  label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z',  label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'color', label: 'Colour (hex)', type: 'number', default: 0x9aa3ad, step: 1 },
    ],
  },

  // ─── SOLID PRIMITIVES ────────────────────────────────────────────────────
  'Box': {
    title: 'Box — Solid Primitive',
    blurb: 'Create an axis-aligned box. Defaults: 40×40×40 mm. Use position / rotation to place + orient.',
    fields: [
      { name: 'dx', label: 'Width (X)',  type: 'number', default: 40, unit: 'mm', min: 0.1, max: 100000, step: 1 },
      { name: 'dy', label: 'Depth (Y)',  type: 'number', default: 40, unit: 'mm', min: 0.1, max: 100000, step: 1 },
      { name: 'dz', label: 'Height (Z)', type: 'number', default: 40, unit: 'mm', min: 0.1, max: 100000, step: 1 },
      { name: 'x',  label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y',  label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z',  label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°',  step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°',  step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°',  step: 1 },
    ],
  },

  'Cylinder': {
    title: 'Cylinder — Solid Primitive',
    blurb: 'Create a cylinder along +Z. Defaults: r=20 mm, h=40 mm. Position / rotation place + orient the body.',
    fields: [
      { name: 'radius', label: 'Radius', type: 'number', default: 20, unit: 'mm', min: 0.1, max: 100000, step: 1 },
      { name: 'height', label: 'Height', type: 'number', default: 40, unit: 'mm', min: 0.1, max: 100000, step: 1 },
      { name: 'x',  label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y',  label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z',  label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°',  step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°',  step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°',  step: 1 },
    ],
  },

  'Sphere': {
    title: 'Sphere — Solid Primitive',
    blurb: 'Create a sphere. Default: r=25 mm.',
    fields: [
      { name: 'radius', label: 'Radius', type: 'number', default: 25, unit: 'mm', min: 0.1, max: 100000, step: 1 },
      { name: 'x',  label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y',  label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z',  label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
    ],
  },

  'Cone': {
    title: 'Cone — Solid Primitive',
    blurb: 'Create a truncated cone along +Z (r1 = base, r2 = top). Position / rotation place + orient the body.',
    fields: [
      { name: 'radius1', label: 'Base radius (r1)', type: 'number', default: 25, unit: 'mm', min: 0,   max: 100000, step: 1 },
      { name: 'radius2', label: 'Top radius (r2)',  type: 'number', default: 8,  unit: 'mm', min: 0,   max: 100000, step: 1, hint: '0 = sharp apex' },
      { name: 'height',  label: 'Height',           type: 'number', default: 45, unit: 'mm', min: 0.1, max: 100000, step: 1 },
      { name: 'x',  label: 'Position X', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'y',  label: 'Position Y', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'z',  label: 'Position Z', type: 'number', default: 0, unit: 'mm', step: 1 },
      { name: 'rx', label: 'Rotation X', type: 'number', default: 0, unit: '°',  step: 1 },
      { name: 'ry', label: 'Rotation Y', type: 'number', default: 0, unit: '°',  step: 1 },
      { name: 'rz', label: 'Rotation Z', type: 'number', default: 0, unit: '°',  step: 1 },
    ],
  },

  'Torus': {
    title: 'Torus — Solid Primitive',
    blurb: 'Create a torus around +Z. Defaults: R=30 mm, r=10 mm.',
    fields: [
      { name: 'majorRadius', label: 'Major radius (R)', type: 'number', default: 30, unit: 'mm', min: 1, max: 1000, step: 1 },
      { name: 'minorRadius', label: 'Minor radius (r)', type: 'number', default: 10, unit: 'mm', min: 0.1, max: 500, step: 1, hint: 'Must be < major radius' },
    ],
  },

  // ─── B-REP FEATURES (arity 1) ─────────────────────────────────────────────
  'Fillet': {
    title: 'Fillet — Edge Blend',
    blurb: 'Apply a constant-radius fillet to all edges of the selected body. Default: r=2 mm.',
    fields: [
      { name: 'radius', label: 'Radius', type: 'number', default: 2, unit: 'mm', min: 0.01, max: 100, step: 0.5 },
    ],
  },

  'Chamfer': {
    title: 'Chamfer — Edge Cut',
    blurb: 'Apply a 45° chamfer to all edges of the selected body. Default: d=2 mm.',
    fields: [
      { name: 'distance', label: 'Distance', type: 'number', default: 2, unit: 'mm', min: 0.01, max: 100, step: 0.5 },
    ],
  },

  // ─── SKETCH TIER-2a — sketch-tab tools ───────────────────────────────────
  'Sketch Chamfer': {
    title: 'Sketch Chamfer — 2D Corner Cut',
    blurb: 'Replace the corner formed by two intersecting sketch lines with a 45° chamfer segment of the given distance.',
    fields: [
      { name: 'distance', label: 'Distance', type: 'number', default: 5, unit: 'mm', min: 0.01, max: 500, step: 0.5,
        hint: 'Chamfer cuts each source line by this distance from their shared corner.' },
    ],
  },

  'Convert Entities': {
    title: 'Convert Entities — Project to Sketch',
    blurb: 'Project the boundary edges of the picked face/body into the active sketch plane. NX calls this "Curve from Body".',
    fields: [
      { name: 'isConstruction', label: 'For construction', type: 'enum', default: 'no',
        options: ['yes', 'no'], hint: 'Make the projected curves construction (reference-only, excluded from the extrusion boundary).' },
      { name: 'fixedToSource',  label: 'Fixed to source',  type: 'enum', default: 'yes',
        options: ['yes', 'no'], hint: 'Pin endpoints to the source position (fully-defined). Disable to leave them free.' },
    ],
  },

  // ─── SKETCH TIER-2b — Named geometric relations ──────────────────────────
  // Five SW relations: Concentric, Midpoint, Symmetric, Collinear, Fix.
  // Each one is selection-driven (the user pre-picks entities in the
  // viewport, then clicks the relation). The schema fields below are
  // GUIDANCE for the PropertyManager dock — they describe what the
  // current selection should provide, not data the user types in. Each
  // schema has zero numeric inputs because relations are intent
  // declarations, not parametric values.
  'Concentric Relation': {
    title: 'Concentric — Geometric Relation',
    blurb: 'Constrain two or more circles / arcs to share a common centre. Pre-select the circles/arcs in the viewport, then click Apply. Drops 2 DoF per additional circle.',
    fields: [],
  },
  'Midpoint Relation': {
    title: 'Midpoint — Geometric Relation',
    blurb: 'Constrain a point to lie at the midpoint of a line. Pre-select one point AND one line in the viewport, then click Apply. Drops 2 DoF.',
    fields: [],
  },
  'Symmetric Relation': {
    title: 'Symmetric — Geometric Relation',
    blurb: 'Constrain two entities to be mirror images about an axis. Pre-select two entities + one line (the axis); the line is the symmetry axis. Lines, arcs, and circles supported; mixed types reject.',
    fields: [],
  },
  'Collinear Relation': {
    title: 'Collinear — Geometric Relation',
    blurb: 'Constrain two or more lines to lie on the same infinite line. Pre-select the lines in the viewport, then click Apply. Drops 2 DoF per additional line.',
    fields: [],
  },
  'Fix Relation': {
    title: 'Fix — Geometric Relation',
    blurb: 'Anchor the selected entity at its current position. Pre-select the entity, then click Apply. Drops 2 DoF (point), 4 DoF (line endpoints), 3 DoF (circle = centre+radius), or 6 DoF (arc = centre+start+end).',
    fields: [],
  },

  // ─── SKETCH TIER-2c — Sketch transform tools ─────────────────────────────
  // Five SW transforms: Move / Rotate / Copy / Scale / Stretch.
  // All selection-driven: pick the entities in the viewport first, then
  // click the transform button + fill in the geometric parameters.
  'Move Entities': {
    title: 'Move Entities — Sketch Translation',
    blurb: 'Translate the selected sketch entities by (toX-fromX, toY-fromY). Pre-select the entities in the viewport, then specify from-point and to-point. Existing relations follow the moved geometry.',
    fields: [
      { name: 'fromX', label: 'From X', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'fromY', label: 'From Y', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'toX',   label: 'To X',   type: 'number', default: 10, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'toY',   label: 'To Y',   type: 'number', default: 0,  unit: 'mm', min: -1000, max: 1000, step: 1 },
    ],
  },
  'Rotate Entities': {
    title: 'Rotate Entities — Sketch Rotation',
    blurb: 'Rotate the selected sketch entities about a centre point by an angle (positive = CCW). Pre-select the entities in the viewport, then specify centre and angle.',
    fields: [
      { name: 'centerX', label: 'Centre X', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'centerY', label: 'Centre Y', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'angleDeg', label: 'Angle',   type: 'number', default: 90, unit: '°', min: -360, max: 360, step: 1 },
    ],
  },
  'Copy Entities': {
    title: 'Copy Entities — Sketch Duplication',
    blurb: 'Duplicate the selected sketch entities, placing the copy at (toX-fromX, toY-fromY) from the original. Linked copies stay parametrically coupled; unlinked copies become independent.',
    fields: [
      { name: 'fromX', label: 'From X', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'fromY', label: 'From Y', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'toX',   label: 'To X',   type: 'number', default: 20, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'toY',   label: 'To Y',   type: 'number', default: 0,  unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'linked', label: 'Linked copy', type: 'enum', default: 'no', options: ['yes', 'no'],
        hint: 'Linked copies stay distance-constrained to the original (moving the original drags the copy).' },
    ],
  },
  'Scale Entities': {
    title: 'Scale Entities — Sketch Scaling',
    blurb: 'Scale the selected sketch entities about a centre point. Set scaleY = scaleX for uniform scaling, or set them independently for non-uniform. Negative scale mirrors the geometry.',
    fields: [
      { name: 'centerX', label: 'Centre X', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'centerY', label: 'Centre Y', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'scaleX',  label: 'Scale X',  type: 'number', default: 2, min: -100, max: 100, step: 0.1 },
      { name: 'scaleY',  label: 'Scale Y',  type: 'number', default: 2, min: -100, max: 100, step: 0.1,
        hint: 'Set equal to Scale X for uniform scaling. Different values = non-uniform (circles stay circles, radius = geometric mean).' },
    ],
  },
  'Stretch Entities': {
    title: 'Stretch Entities — Endpoint Translation',
    blurb: 'Translate the EXPLICITLY-PICKED endpoints by (toX-fromX, toY-fromY). Pre-select the endpoint picks in the viewport (the entities whose endpoints should move); non-picked endpoints stay fixed.',
    fields: [
      { name: 'fromX', label: 'From X', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'fromY', label: 'From Y', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'toX',   label: 'To X',   type: 'number', default: 5,  unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'toY',   label: 'To Y',   type: 'number', default: 0,  unit: 'mm', min: -1000, max: 1000, step: 1 },
    ],
  },

  'Variable Radius Fillet': {
    title: 'Variable Radius Fillet',
    blurb: 'Fillet that transitions from r1 to r2 along each edge. Defaults: r1=1 mm → r2=4 mm.',
    fields: [
      { name: 'r1', label: 'Start radius (r1)', type: 'number', default: 1, unit: 'mm', min: 0.01, max: 100, step: 0.5 },
      { name: 'r2', label: 'End radius (r2)',   type: 'number', default: 4, unit: 'mm', min: 0.01, max: 100, step: 0.5 },
    ],
  },

  'Shell': {
    title: 'Shell — Hollow Solid',
    blurb: 'Hollow the selected solid body, keeping a uniform wall. Default: t=3 mm.',
    fields: [
      { name: 'thickness', label: 'Wall thickness', type: 'number', default: 3, unit: 'mm', min: 0.01, max: 100, step: 0.5 },
    ],
  },

  'Draft': {
    title: 'Draft — Mould Taper',
    blurb: 'Taper the side faces of the selected body about a fully parametric neutral (parting) plane. Defaults: 5° about the z=0 plane, pulled +Z.',
    fields: [
      { name: 'angleDeg', label: 'Draft angle', type: 'number', default: 5, unit: '°', min: 0.1, max: 30, step: 0.5 },
      { name: 'neutralOriginX', label: 'Neutral plane origin X', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1, hint: 'parting-plane reference point' },
      { name: 'neutralOriginY', label: 'Neutral plane origin Y', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'neutralOriginZ', label: 'Neutral plane origin Z', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'neutralNormalX', label: 'Neutral plane normal X', type: 'number', default: 0, min: -1, max: 1, step: 0.1, hint: 'parting-plane normal — any orientation' },
      { name: 'neutralNormalY', label: 'Neutral plane normal Y', type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'neutralNormalZ', label: 'Neutral plane normal Z', type: 'number', default: 1, min: -1, max: 1, step: 0.1 },
      { name: 'pullDirX', label: 'Pull direction X', type: 'number', default: 0, min: -1, max: 1, step: 0.1, hint: 'demould / draw direction' },
      { name: 'pullDirY', label: 'Pull direction Y', type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'pullDirZ', label: 'Pull direction Z', type: 'number', default: 1, min: -1, max: 1, step: 0.1 },
    ],
  },

  'Offset Shape': {
    title: 'Offset Shape',
    blurb: 'Uniformly offset all faces of the selected body outward. Default: d=2 mm.',
    fields: [
      { name: 'distance', label: 'Offset distance', type: 'number', default: 2, unit: 'mm', min: 0.01, max: 100, step: 0.5 },
    ],
  },

  'Face Fillet': {
    title: 'Face Fillet — G2 Blend',
    blurb: 'Build a C2-continuous fill surface over a planar wire boundary. Default: hole box side=6 mm.',
    fields: [
      { name: 'holeBoxSize', label: 'Boundary box size', type: 'number', default: 6, unit: 'mm', min: 1, max: 200, step: 1 },
    ],
  },

  'Full Round Fillet': {
    title: 'Full Round Fillet — Cliff-Edge Blend',
    blurb: 'Large-radius blend on all edges of the selected body. Default: r=8 mm.',
    fields: [
      { name: 'radius', label: 'Blend radius', type: 'number', default: 8, unit: 'mm', min: 0.1, max: 200, step: 1 },
    ],
  },

  'Corner Mitre': {
    title: 'Corner Mitre',
    blurb: 'Auto-mitre all corners by filleting every edge. Default: r=3 mm.',
    fields: [
      { name: 'radius', label: 'Mitre radius', type: 'number', default: 3, unit: 'mm', min: 0.01, max: 100, step: 0.5 },
    ],
  },

  'Simplify Geometry': {
    title: 'Simplify Geometry',
    blurb: 'Remove tiny internal features (small holes, sliver islands) below the minimum feature size, then merge same-domain faces. Default: 1 mm.',
    fields: [
      { name: 'minFeatureSize', label: 'Min feature size', type: 'number', default: 1, unit: 'mm', min: 0.01, max: 50, step: 0.1, hint: 'Internal features smaller than this are removed' },
    ],
  },

  // ── SP-8 — Healing & repair completion (Area H, T1). ──────────────────────
  'Auto-Fill Holes': {
    title: 'Auto-Fill Holes',
    blurb: 'Automatic: finds every closed open-edge loop (a hole / missing face) of an open-shell body and patches it with an N-sided variational patch, stitching the result back into a watertight body. Selection: pick the body first. Single-loop holes handled correctly; multi-loop holes (a hole bridged by an internal wire) fill the OUTER loop only.',
    fields: [
      { name: 'tolerance',         label: 'Closure tolerance', type: 'number', default: 0.001, unit: 'mm', min: 0.0001, max: 1,   step: 0.001, hint: 'Free-bound endpoints within this distance are unified into one loop' },
      { name: 'subdivisions',      label: 'Patch density',     type: 'number', default: 3,    unit: '',    min: 0,      max: 5,   step: 1,    hint: '1→5 refinement passes per patch' },
      { name: 'fairingIterations', label: 'Fairing iterations', type: 'number', default: 40,  unit: '',    min: 0,      max: 200, step: 5,    hint: 'Patch bending-energy minimisation iterations' },
    ],
  },

  'Auto-Repair Self-Intersection': {
    title: 'Auto-Repair Self-Intersection',
    blurb: 'Detect every face-pair crossing in the body (Möller triangle-triangle detector on the tessellation), then heal them via ShapeFix_Shape tolerance widening + ShapeFix_Shell.FixFaceOrientation. Selection: pick the body first. Simple cases (sliver overlaps, single inverted face) repair cleanly; tangled multi-curve crossings are reported as un-repairable with per-pair diagnosis.',
    fields: [
      { name: 'tolerance',  label: 'Heal tolerance',  type: 'number', default: 0.01, unit: 'mm', min: 0.0001, max: 1,   step: 0.001, hint: 'ShapeFix max-tolerance for tolerant-edge absorption' },
      { name: 'deflection', label: 'Detector mesh',   type: 'number', default: 0.1,  unit: 'mm', min: 0.01,   max: 2,   step: 0.01,  hint: 'Tessellation chord deviation for the detector; finer = more sensitive' },
    ],
  },

  'Harmonize Normals': {
    title: 'Harmonize Normals',
    blurb: 'Walk the body shell and flip every face whose outward-normal disagrees with its neighbours. Backed by ShapeFix_Shell.FixFaceOrientation. Selection: pick the body first. outward=1 (default) makes every normal point OUT; outward=0 makes every normal point IN.',
    fields: [
      { name: 'outward',    label: 'Outward (1) / Inward (0)', type: 'number', default: 1,   unit: '',   min: 0,    max: 1, step: 1,    hint: '1 = every face normal points outward; 0 = every face normal points inward' },
      { name: 'deflection', label: 'Gauss-test mesh',          type: 'number', default: 0.5, unit: 'mm', min: 0.05, max: 5, step: 0.05, hint: 'Tessellation chord deviation for the JS-side consistency verifier' },
    ],
  },

  'Subdivide Surface': {
    title: 'Subdivide Surface — Loop Subdivision',
    blurb: 'Apply piecewise-smooth Loop subdivision to the selected body. Defaults: 2 levels, 30° crease threshold.',
    fields: [
      { name: 'levels',      label: 'Subdivision levels',    type: 'number', default: 2,   unit: '',    min: 1, max: 4,  step: 1,    hint: '1–4 levels; each level 4× triangles' },
      { name: 'dihedralDeg', label: 'Crease threshold',      type: 'number', default: 30,  unit: '°',   min: 0, max: 90, step: 1,    hint: 'Edges sharper than this are treated as creases' },
      { name: 'deflection',  label: 'Mesh deflection',       type: 'number', default: 0.5, unit: 'mm',  min: 0.01, max: 2, step: 0.01, hint: 'Controls initial tessellation quality' },
    ],
  },

  'Retopo Surface': {
    title: 'Retopo Surface — Isotropic Remeshing',
    blurb: 'Retopologise the selected body via Botsch-Kobbelt 2004 isotropic remeshing (split/collapse/flip/tangential-relax). Set targetEdgeLength=0 to use auto (mean baseline edge length). Pull-back (1=on, 0=off) snaps vertices back onto the B-rep surface after each relax step.',
    fields: [
      { name: 'targetEdgeLength',  label: 'Target edge length', type: 'number', default: 0,   unit: 'mm', min: 0, max: 100, step: 0.1, hint: '0 = auto (mean edge length of input mesh)' },
      { name: 'iterations',        label: 'Iterations',         type: 'number', default: 5,   unit: '',   min: 1, max: 10,  step: 1,   hint: '1–10 iterations of split/collapse/flip/relax' },
      { name: 'pullBackToSurface', label: 'Surface pull-back',  type: 'number', default: 1,   unit: '',   min: 0, max: 1,   step: 1,   hint: '1 = snap vertices onto B-rep surface (recommended); 0 = tangential only' },
    ],
  },

  'Catmull-Clark Subdivide': {
    title: 'Catmull-Clark Subdivide — Quad Mesh',
    blurb: 'Apply Catmull-Clark subdivision to the selected body. Converts triangles to quads, detects creases, and refines. Defaults: 2 levels, 30° crease threshold, 5° quad-pairing angle.',
    fields: [
      { name: 'levels',      label: 'Subdivision levels',      type: 'number', default: 2,  unit: '',  min: 1, max: 4,  step: 1,   hint: '1–4 levels; each level 4× quads' },
      { name: 'dihedralDeg', label: 'Crease threshold',         type: 'number', default: 30, unit: '°', min: 0, max: 90, step: 1,   hint: 'Quad edges sharper than this become creases' },
      { name: 'quadAngleDeg', label: 'Tri→quad pairing angle', type: 'number', default: 5,  unit: '°', min: 0, max: 45, step: 1,   hint: 'Max dihedral for pairing coplanar triangles into quads' },
    ],
  },

  // ─── FACETER OPTION SURFACE (SP-7, Area I) ───────────────────────────────
  'Faceter Controls': {
    title: 'Faceter Controls — Tessellation Quality',
    blurb: 'Re-facet the selected body with full faceter control. Pick a quality profile (Render = display-tuned; Analysis = simulation/curvature-grade, ~7× finer), then tune the chordal (linear) and angular deflection — the two tolerances a commercial faceter exposes. Set a deflection to 0 to use the profile default. The body re-tessellates live in the viewport.',
    fields: [
      { name: 'profile', label: 'Quality profile', type: 'enum', default: 'render',
        options: ['render', 'analysis'],
        hint: 'render = display mesh; analysis = fine mesh for simulation / curvature' },
      { name: 'chordalMm', label: 'Chordal (linear) deflection', type: 'number', default: 0, unit: 'mm',
        min: 0, max: 50, step: 0.01,
        hint: 'Max chord-to-surface gap. Smaller = finer. 0 = profile default' },
      { name: 'angularDeg', label: 'Angular deflection', type: 'number', default: 0, unit: '°',
        min: 0, max: 80, step: 1,
        hint: 'Max facet-normal turn per triangle. Smaller = rounder curves. 0 = profile default' },
      { name: 'minSizeMm', label: 'Minimum triangle edge', type: 'number', default: 0, unit: 'mm',
        min: 0, max: 10, step: 0.001,
        hint: 'Floor on triangle edge length — guards against sliver explosion. 0 = auto' },
    ],
  },

  'Hidden Line / Silhouette': {
    title: 'Hidden Line / Silhouette View',
    blurb: 'Extract the hidden-line projection and silhouette of the selected body along a view direction — the engineering-drawing edge set. Visible sharp edges and silhouette outlines are drawn solid; hidden edges dashed. Uses the exact B-rep hidden-line removal algorithm; the mesh-based silhouette overlay is also rendered for comparison.',
    fields: [
      { name: 'viewX', label: 'View direction X', type: 'number', default: 0.55, min: -1, max: 1, step: 0.05,
        hint: 'Projection / viewing direction' },
      { name: 'viewY', label: 'View direction Y', type: 'number', default: -0.6, min: -1, max: 1, step: 0.05 },
      { name: 'viewZ', label: 'View direction Z', type: 'number', default: 0.58, min: -1, max: 1, step: 0.05 },
      { name: 'showHidden', label: 'Show hidden edges', type: 'enum', default: 'yes',
        options: ['yes', 'no'], hint: 'Draw occluded edges as dashed lines' },
    ],
  },

  // ─── NURBS SURFACE OPS ────────────────────────────────────────────────────

  'NURBS Patch': {
    title: 'NURBS Patch — sail-like control surface',
    blurb: 'Build a 4×4 cubic NURBS sail-like patch (size × size base; inner crown height).',
    fields: [
      { name: 'size',  label: 'Base size',   type: 'number', default: 40, unit: 'mm', min: 10, max: 200, step: 1, hint: 'Footprint of the patch base (mm)' },
      { name: 'crown', label: 'Crown height', type: 'number', default: 8,  unit: 'mm', min: 0,  max: 50,  step: 1, hint: 'Z-lift of the inner 2×2 control poles (0 = flat)' },
    ],
  },

  'Refine NURBS': {
    title: 'Refine NURBS — insert mid-knots',
    blurb: 'Insert knots at u=0.25, 0.5, 0.75 and v=0.25, 0.5, 0.75. Preserves surface shape exactly (h-refinement).',
    fields: [],
  },

  'Elevate NURBS': {
    title: 'Elevate NURBS Degree',
    blurb: 'Raise the polynomial degree of the NURBS surface (p-refinement). Does not change the shape.',
    fields: [
      { name: 'uDegree', label: 'U degree', type: 'number', default: 4, unit: '', min: 2, max: 8, step: 1, hint: 'Target u-degree (must be ≥ current, default cubic=3)' },
      { name: 'vDegree', label: 'V degree', type: 'number', default: 4, unit: '', min: 2, max: 8, step: 1, hint: 'Target v-degree (must be ≥ current, default cubic=3)' },
    ],
  },

  'NURBS Curvature': {
    title: 'NURBS Curvature — sample point',
    blurb: 'Sample principal/Gaussian/mean curvature at (u,v) on a NURBS face.',
    fields: [
      { name: 'u', label: 'u parameter', type: 'number', default: 0.5, unit: '', min: 0, max: 1, step: 0.05, hint: 'Parameter along u-direction [0, 1]' },
      { name: 'v', label: 'v parameter', type: 'number', default: 0.5, unit: '', min: 0, max: 1, step: 0.05, hint: 'Parameter along v-direction [0, 1]' },
    ],
  },

  // ─── SUB-PROJECT G — AUTO-TRIMMING NURBS B-REP FACE ─────────────────────

  'Trimmed NURBS Patch': {
    title: 'Trimmed NURBS Patch — windowed sail panel',
    blurb: 'Build a bicubic NURBS sail surface and auto-trim it to a rectangular parametric sub-domain (UV box trim via BRepBuilderAPI_MakeFace).',
    fields: [
      { name: 'sizeX',   label: 'Patch width (X)',  type: 'number', default: 80,   unit: 'mm',  min: 10,  max: 400,  step: 5,    hint: 'Full patch footprint in X (mm)' },
      { name: 'sizeY',   label: 'Patch depth (Y)',  type: 'number', default: 80,   unit: 'mm',  min: 10,  max: 400,  step: 5,    hint: 'Full patch footprint in Y (mm)' },
      { name: 'bulge',   label: 'Bulge height',     type: 'number', default: 12,   unit: 'mm',  min: 0,   max: 120,  step: 1,    hint: 'Z-lift of inner 2×2 control poles — makes a real curved surface (0 = flat)' },
      { name: 'trimMin', label: 'Trim start (UV)',  type: 'number', default: 0.25, unit: '',     min: 0,   max: 0.5,  step: 0.05, hint: 'Normalised start of the trim window in both U and V [0..0.5)' },
      { name: 'trimMax', label: 'Trim end (UV)',    type: 'number', default: 0.75, unit: '',     min: 0.5, max: 1.0,  step: 0.05, hint: 'Normalised end of the trim window in both U and V (0.5..1]' },
    ],
  },

  // ─── SUB-PROJECT G — NURBS SSI ────────────────────────────────────────────

  'Surface-Surface Intersection': {
    title: 'Surface-Surface Intersection — NURBS SSI',
    blurb: 'Intersect the first face of two selected bodies via GeomAPI_IntSS. Returns sampled polyline curves along the intersection locus.',
    fields: [
      { name: 'samples',   label: 'Samples per curve', type: 'number', default: 32,  unit: '',     min: 8,    max: 256,  step: 8,    hint: 'Number of points sampled along each intersection curve' },
      { name: 'tolerance', label: 'Tolerance',          type: 'number', default: 1e-6, unit: 'mm', min: 1e-9, max: 1e-2, step: 1e-7, hint: 'Geometric tolerance for SSI (mm)' },
      { name: 'lineWidth', label: 'Line width',          type: 'number', default: 2,   unit: 'px', min: 0.5,  max: 6,    step: 0.5,  hint: 'Visual line width for intersection curves in the viewport' },
    ],
  },

  'N-Sided Patch': {
    title: 'N-Sided Patch — variational fill of an N-sided opening',
    blurb: 'Fill an arbitrary non-four-sided boundary loop of the selected body with a smooth surface patch. Ear-clip triangulation of the loop interior, then discrete cotangent-Laplacian variational fairing (minimum bending energy) with the boundary fixed. faceIndex=-1 auto-picks the face with the most edges (the N-sided opening). Adds the fill surface; the body is kept.',
    fields: [
      { name: 'faceIndex',         label: 'Boundary face index', type: 'number', default: -1, unit: '', min: -1, max: 400, step: 1, hint: '-1 = auto-pick the face with the most edges; otherwise the face whose outer wire is filled' },
      { name: 'subdivisions',      label: 'Interior density',    type: 'number', default: 3,  unit: '', min: 0,  max: 5,   step: 1, hint: '1→4 refinement passes; more = smoother fill, more triangles' },
      { name: 'fairingIterations', label: 'Fairing iterations',  type: 'number', default: 40, unit: '', min: 0,  max: 200, step: 5, hint: 'Discrete bending-energy minimisation iterations' },
    ],
  },

  'G2 Blend': {
    title: 'G2 Blend — curvature-continuous fairing surface',
    blurb: 'Fair a true G2 (curvature-continuous) blend surface between two edges of the selected body. Degree-5-in-v / degree-3-in-u NURBS — matches position, tangent AND curvature at both edges. Adds the fairing surface; the body is kept.',
    fields: [
      { name: 'edgeA',     label: 'Edge A index',     type: 'number', default: 0,  unit: '', min: 0, max: 200, step: 1, hint: 'Index of the first boundary edge' },
      { name: 'edgeB',     label: 'Edge B index',     type: 'number', default: 2,  unit: '', min: 0, max: 200, step: 1, hint: 'Index of the second boundary edge' },
      { name: 'uSegments', label: 'U segments',       type: 'number', default: 32, unit: '', min: 8, max: 128, step: 4, hint: 'Tessellation segments across the boundary parameter' },
      { name: 'vSegments', label: 'V segments',       type: 'number', default: 16, unit: '', min: 4, max: 64,  step: 2, hint: 'Tessellation segments from edge A to edge B' },
    ],
  },

  // ─── SP-10 — Blending suite completion (Area D, T2) ──────────────────────
  // Four new blending operators on the Part tab Blends group:
  //   - Hold-Line Blend   : variable-radius G2 surface that touches a hold curve
  //   - Face-Face Blend   : rolling-ball fillet between two selected faces
  //   - Setback Corner    : multi-edge vertex blend w/ per-edge setback
  //   - G3 Blend          : curvature-derivative-continuous blend (degree 7 in v)
  // Selection: pick the body first. Face/edge/vertex/hold-curve parameters
  // supplied via the dialog as INDICES into the body's enumeration, plus
  // numeric setbacks / hold-curve points encoded as small parametric strings.

  'Hold-Line Blend': {
    title: 'Hold-Line Blend — variable-radius G2 blend constrained to a 3-D hold curve',
    blurb: 'Build a degree-3×5 G2 blend surface between two edges, with its centreline (rolling-ball locus) constrained to pass within tolerance of a supplied 3-D hold curve. The hold curve is supplied as four offset points (default = thumb-track curve). Variable-reach per station so the midpoint of the blend lands on the hold curve.',
    fields: [
      { name: 'edgeA',     label: 'Edge A index',     type: 'number', default: 0,  unit: '', min: 0, max: 200, step: 1, hint: 'Index of the first boundary edge' },
      { name: 'edgeB',     label: 'Edge B index',     type: 'number', default: 2,  unit: '', min: 0, max: 200, step: 1, hint: 'Index of the second boundary edge' },
      { name: 'holdCenterX', label: 'Hold curve mid X', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1, hint: 'Mid-point of the hold curve in mm' },
      { name: 'holdCenterY', label: 'Hold curve mid Y', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'holdCenterZ', label: 'Hold curve mid Z', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
      { name: 'holdSpread',  label: 'Hold curve spread', type: 'number', default: 20, unit: 'mm', min: 1, max: 200, step: 1, hint: 'Half-length of the hold curve' },
      { name: 'uSegments', label: 'U segments',       type: 'number', default: 32, unit: '', min: 8, max: 128, step: 4 },
      { name: 'vSegments', label: 'V segments',       type: 'number', default: 16, unit: '', min: 4, max: 64,  step: 2 },
    ],
  },

  'Face-Face Blend': {
    title: 'Face-Face Blend — rolling-ball blend between two selected faces',
    blurb: 'Apply a constant-radius rolling-ball blend along the shared edges between two selected faces of the body. OCCT BRepFilletAPI over the face-pair shared edge set. Selection: pick the body, supply face indices + radius. Adds the filleted body; the original is consumed.',
    fields: [
      { name: 'face1', label: 'Face 1 index', type: 'number', default: 0, unit: '', min: 0, max: 1000, step: 1, hint: 'Index of face 1 (0-based unique-face enumeration)' },
      { name: 'face2', label: 'Face 2 index', type: 'number', default: 1, unit: '', min: 0, max: 1000, step: 1, hint: 'Index of face 2' },
      { name: 'radius', label: 'Blend radius', type: 'number', default: 4, unit: 'mm', min: 0.05, max: 100, step: 0.5, hint: 'Rolling-ball blend radius' },
    ],
  },

  'Setback Corner': {
    title: 'Setback Corner — multi-edge vertex blend with per-edge setbacks',
    blurb: 'At a multi-edge vertex (3+ edges meeting), specify a per-edge setback distance; the fillet retracts (smaller radius) near the vertex and expands to full radius further along the edge. Selection: pick the body; supply vertex index + the three per-edge setbacks + the base radius.',
    fields: [
      { name: 'vertex',   label: 'Vertex index', type: 'number', default: 0, unit: '', min: 0, max: 10000, step: 1, hint: 'Index of the multi-edge corner vertex' },
      { name: 'setback1', label: 'Setback edge 1', type: 'number', default: 2, unit: 'mm', min: 0.05, max: 50, step: 0.1 },
      { name: 'setback2', label: 'Setback edge 2', type: 'number', default: 3, unit: 'mm', min: 0.05, max: 50, step: 0.1 },
      { name: 'setback3', label: 'Setback edge 3', type: 'number', default: 4, unit: 'mm', min: 0.05, max: 50, step: 0.1 },
      { name: 'radius',   label: 'Base fillet radius', type: 'number', default: 2, unit: 'mm', min: 0.05, max: 50, step: 0.1, hint: 'Far-from-vertex blend radius' },
    ],
  },

  'G3 Blend': {
    title: 'G3 Blend — curvature-derivative-continuous blend between two edges',
    blurb: 'Fair a true G3 (third-derivative-continuous) blend surface between two edges. Degree-7-in-v / degree-3-in-u NURBS — matches position, tangent, curvature AND curvature-derivative (jerk) at both edges. The Class-A industrial-design contract beyond G2. Adds the fairing surface; the body is kept.',
    fields: [
      { name: 'edgeA',     label: 'Edge A index',     type: 'number', default: 0,  unit: '', min: 0, max: 200, step: 1 },
      { name: 'edgeB',     label: 'Edge B index',     type: 'number', default: 2,  unit: '', min: 0, max: 200, step: 1 },
      { name: 'uSegments', label: 'U segments',       type: 'number', default: 32, unit: '', min: 8, max: 128, step: 4 },
      { name: 'vSegments', label: 'V segments',       type: 'number', default: 16, unit: '', min: 4, max: 64,  step: 2 },
    ],
  },

  // ─── SUB-PROJECT G — CLASS-A MODELLING WORKFLOW ───────────────────────────

  'Class-A Analyze': {
    title: 'Class-A Analyze — Gaussian-curvature heatmap',
    blurb: 'Tessellate the selected body and colour it by discrete Gaussian curvature (angle-deficit method): red = convex, blue = saddle, white = flat — the production class-A convention. Adds a coloured analysis mesh; the body is kept.',
    fields: [
      { name: 'gridSamples', label: 'Analysis resolution', type: 'number', default: 48, unit: '', min: 16, max: 128, step: 8, hint: 'Higher = finer tessellation, smoother heatmap (more vertices analysed)' },
    ],
  },

  'Zebra Stripes': {
    title: 'Zebra Stripes — striped-reflection continuity overlay',
    blurb: 'Overlay a striped-environment reflection on the selected body. Stripes break across a G0 join, kink across a G1 join, and flow smoothly across a G2 join — the classic class-A continuity instrument. Toggling the tool again removes the overlay.',
    fields: [
      { name: 'stripeFrequency', label: 'Stripe frequency', type: 'number', default: 16, unit: '', min: 4, max: 64, step: 1, hint: 'Number of stripe bands; more bands reveal finer continuity flaws' },
      { name: 'direction',       label: 'Stripe direction', type: 'number', default: 0,  unit: '', min: 0, max: 1,  step: 1, hint: '0 = horizontal stripes, 1 = vertical stripes' },
    ],
  },

  // ─── SUB-PROJECT F — FINAL §3 CAPABILITIES ────────────────────────────────

  'Sweep Tortuous': {
    title: 'Tortuous-path Sweep',
    blurb: 'Sweep a circular profile along a tortuous polyline path.',
    fields: [
      { name: 'profileRadius', label: 'Profile radius', type: 'number', default: 4,  unit: 'mm', min: 0.1, max: 50,  step: 0.5, hint: 'Circular profile radius (mm)' },
      { name: 'segLength',     label: 'Segment length', type: 'number', default: 20, unit: 'mm', min: 1,   max: 200, step: 1,   hint: 'Length of each polyline segment (mm)' },
      { name: 'bendCount',     label: 'Bend count',     type: 'number', default: 2,  unit: '',   min: 1,   max: 6,   step: 1,   hint: 'Number of right-angle bends (1–6)' },
    ],
  },

  'Loft Tangent': {
    title: 'Tangent-Smoothed Loft',
    blurb: 'Loft 3 square sections with tangent smoothing (SetSmoothing).',
    fields: [
      { name: 's0', label: 'Section 0 side', type: 'number', default: 40, unit: 'mm', min: 0, max: 200, step: 1, hint: 'Side length of bottom section' },
      { name: 's1', label: 'Section 1 side', type: 'number', default: 20, unit: 'mm', min: 0, max: 200, step: 1, hint: 'Side length of middle section' },
      { name: 's2', label: 'Section 2 side', type: 'number', default: 30, unit: 'mm', min: 0, max: 200, step: 1, hint: 'Side length of top section' },
      { name: 'z0', label: 'Z height 0',     type: 'number', default: 0,  unit: 'mm', min: 0, max: 200, step: 1, hint: 'Z position of bottom section' },
      { name: 'z1', label: 'Z height 1',     type: 'number', default: 20, unit: 'mm', min: 0, max: 200, step: 1, hint: 'Z position of middle section' },
      { name: 'z2', label: 'Z height 2',     type: 'number', default: 40, unit: 'mm', min: 0, max: 200, step: 1, hint: 'Z position of top section' },
    ],
  },

  'Stitch Faces': {
    title: 'Tolerant Stitching',
    blurb: 'Stitch two planar panels across a small gap using BRepBuilderAPI_Sewing.',
    fields: [
      { name: 'gap',       label: 'Gap',        type: 'number', default: 0.05, unit: 'mm', min: 0,     max: 1,   step: 0.01, hint: 'Gap between panel edges (mm)' },
      { name: 'tolerance', label: 'Tolerance',  type: 'number', default: 0.1,  unit: 'mm', min: 0.001, max: 1,   step: 0.01, hint: 'Sewing tolerance (must be > gap)' },
      { name: 'panelW',    label: 'Panel width', type: 'number', default: 20,  unit: 'mm', min: 1,     max: 200, step: 1,    hint: 'Width of each panel (mm)' },
      { name: 'panelH',    label: 'Panel height', type: 'number', default: 20, unit: 'mm', min: 1,     max: 200, step: 1,    hint: 'Height of each panel (mm)' },
    ],
  },

  'Convergent Solid': {
    title: 'Convergent Modeling (Facet→B-rep)',
    blurb: 'Build a solid from a facet mesh via Sewing + MakeSolid_3 (convergent modeling pipeline).',
    fields: [
      { name: 'size',      label: 'Cube size',  type: 'number', default: 20,    unit: 'mm', min: 1,      max: 200, step: 1,     hint: 'Side length of the demo cube (mm)' },
      { name: 'tolerance', label: 'Tolerance',  type: 'number', default: 0.001, unit: 'mm', min: 0.0001, max: 0.1, step: 0.001, hint: 'Sewing tolerance for triangle edge stitching' },
    ],
  },

  // ─── B-REP BOOLEANS (arity 2 / Infinity) ─────────────────────────────────
  // Combine, Subtract, Intersect, Combine (Non-Manifold), Lattice Fuse have
  // no parameters — a schema entry with empty fields ensures the dialog
  // can be future-extended and `requestToolParams` resolves immediately
  // with an empty values object when bypass is active.

  'Combine': {
    title: 'Combine (Boolean Fuse)',
    blurb: 'Fuse two selected bodies into one. Select two bodies then click Combine.',
    fields: [],
  },

  'Subtract': {
    title: 'Subtract (Boolean Cut)',
    blurb: 'Subtract the second selected body from the first. Select tool body last.',
    fields: [],
  },

  'Intersect': {
    title: 'Intersect (Boolean Common)',
    blurb: 'Keep only the volume common to both selected bodies.',
    fields: [],
  },

  'Combine (Non-Manifold)': {
    title: 'Combine (Non-Manifold)',
    blurb: 'Multi-shell compound of two selected bodies sharing a face (non-manifold topology).',
    fields: [],
  },

  'Combine (Coincident)': {
    title: 'Combine (Coincident) — Fuzzy Fuse',
    blurb: 'Fuse two selected bodies that are nearly touching within a tolerance. Default: tol=0.01 mm.',
    fields: [
      { name: 'tolerance', label: 'Fuzzy tolerance', type: 'number', default: 0.01, unit: 'mm', min: 0.0001, max: 1, step: 0.001 },
    ],
  },

  'Lattice Fuse': {
    title: 'Lattice Fuse — N-ary Boolean',
    blurb: 'Single-pass fuse of all selected bodies (≥2). Efficient for lattice structures.',
    fields: [],
  },

  // ─── SP-5 BOOLEAN COMPLETION (Area C) ────────────────────────────────────
  // Imprint, Partition, Section — split/imprint/slice without losing volume.
  // All three accept a viewport selection: Imprint takes (body, tool), Partition
  // takes (body, tool₁, …, toolₙ ≥ 1), Section takes (body) and resolves the
  // plane from the dialog params (origin + normal) or an optional 3-point pick.

  'Imprint': {
    title: 'Imprint — Project Tool Footprint onto Body',
    blurb: 'Project the tool body\'s boundary edges onto the recipient body\'s faces as new edges, splitting faces along the projection curves WITHOUT changing the body\'s volume. Selection: pick the body first, then the tool.',
    fields: [],
  },

  'Partition': {
    title: 'Partition — Split Body by Tools',
    blurb: 'Split the selected body along one or more tool surfaces / solids into multiple pieces. Volume is conserved (Σ pieces = original). Selection: pick the body first, then ≥ 1 tools.',
    fields: [],
  },

  'Section': {
    title: 'Section — Planar Cut',
    blurb: 'Cut the selected body by a plane (origin + normal). Output: \'curves\' returns the intersection wire body (cross-section outline); \'split\' partitions the body into the two half-pieces. Selection: pick the body to section.',
    fields: [
      { name: 'output',  label: 'Output mode',        type: 'string', default: 'curves', hint: '\'curves\' (intersection wire) or \'split\' (partition into halves)' },
      { name: 'originX', label: 'Plane origin X',     type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'originY', label: 'Plane origin Y',     type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'originZ', label: 'Plane origin Z',     type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'normalX', label: 'Plane normal X',     type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'normalY', label: 'Plane normal Y',     type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'normalZ', label: 'Plane normal Z',     type: 'number', default: 1, min: -1, max: 1, step: 0.1 },
    ],
  },

  // ─── SP-9 DIRECT / SYNCHRONOUS MODELING (Area E) ─────────────────────────
  // Push-Pull, Move Face, Delete Face, Infer Feature — selection-driven
  // direct edits on a chosen face. faceIndex is a 1-based positional index
  // into the body's spine faces (matches the SpineBody.body.faces() order);
  // an explicit persistent id string can also be supplied (the kernel op
  // accepts either via resolveFace).

  'Push-Pull': {
    title: 'Push-Pull — Direct Face Edit',
    blurb: 'Extrude (push, distance > 0 → add material) or cut (pull, distance < 0 → remove material) the selected face along its outward normal. Selection: pick the body first; faceIndex picks which face (1-based positional index into spine faces).',
    fields: [
      { name: 'faceIndex', label: 'Face index',  type: 'number', default: 1, unit: '', min: 1, max: 999, step: 1, hint: '1-based index of the face to push/pull' },
      { name: 'distance',  label: 'Distance',    type: 'number', default: 5, unit: 'mm', min: -500, max: 500, step: 0.5, hint: 'positive = push (add material), negative = pull (cut)' },
    ],
  },

  'Move Face': {
    title: 'Move Face — Translate Face by Delta',
    blurb: 'Translate a planar / cylindrical face by a 3-vector. The normal-aligned component moves the face along its outward normal; the tangential component is a documented residual gap (face-slide). Selection: pick the body first; faceIndex picks which face.',
    fields: [
      { name: 'faceIndex', label: 'Face index', type: 'number', default: 1, unit: '', min: 1, max: 999, step: 1, hint: '1-based index of the face to move' },
      // UX Tier-12a — translation is now the universal Specify Vector
      // picker. legacyKeys map the picker's x/y/z to tx/ty/tz so the
      // existing handler (`Number(values.tx) || 0`, etc.) keeps working.
      // Default = (0,0,2) custom — face-normal-default is the most common
      // Move-Face intent (push the face out by 2 mm).
      { name: 'translation', label: 'Translation', type: 'vector',
        default: { mode: 'custom', x: 0, y: 0, z: 2 },
        legacyKeys: { x: 'tx', y: 'ty', z: 'tz' },
        hint: 'Delta vector — CSYS axis / custom dx/dy/dz / sketch line / face normal.' },
    ],
  },

  'Delete Face': {
    title: 'Delete Face — Remove & Heal',
    blurb: 'Remove the selected face from the body and automatically heal the resulting opening by extending the adjacent faces (BRepAlgoAPI_Defeaturing). Result: a closed solid with one fewer face. Selection: pick the body first; faceIndex picks which face to remove.',
    fields: [
      { name: 'faceIndex', label: 'Face index', type: 'number', default: 1, unit: '', min: 1, max: 999, step: 1, hint: '1-based index of the face to remove' },
    ],
  },

  'Infer Feature': {
    title: 'Infer Feature — Classify Face Context',
    blurb: 'Given a face the user is gesturing on, return what FEATURE that face belongs to (hole / boss / fillet / chamfer / boss-face / pocket-floor / planar-step / sculpted-face) using spine adjacency + SP-4 surface evaluation. Pure read — no geometry change. Selection: pick the body first; faceIndex picks which face to classify.',
    fields: [
      { name: 'faceIndex', label: 'Face index', type: 'number', default: 1, unit: '', min: 1, max: 999, step: 1, hint: '1-based index of the face to classify' },
    ],
  },

  // ─── TOPOLOGY / DIRECT EDIT ───────────────────────────────────────────────
  'Replace Face': {
    title: 'Replace Face',
    blurb: 'Swap a face of the selected body onto a new surface. Curved swap (1) re-seats the face onto an arbitrary curved NURBS surface — fresh pcurves are generated natively in ArchDisc\'s topology kernel by Newton point-inversion. Same-surface (0) rebuilds the face from its boundary wire.',
    fields: [
      { name: 'faceIndex', label: 'Face index', type: 'number', default: 1, unit: '', min: 1, max: 999, step: 1, hint: '1-based index of the face to replace' },
      { name: 'curvedSwap', label: 'Curved swap', type: 'number', default: 1, unit: '', min: 0, max: 1, step: 1, hint: '1 = re-seat onto an arbitrary curved NURBS surface (native pcurves); 0 = same-surface boundary-wire rebuild' },
      { name: 'bulge', label: 'Curved-swap bulge', type: 'number', default: 0, unit: 'mm', min: 0, max: 200, step: 1, hint: 'Peak interior lift of the new curved surface (0 = auto, scales with the face size)' },
    ],
  },

  // ─── SURFACING (arity 0 — internal profile) ───────────────────────────────
  'Thicken': {
    title: 'Thicken — Sheet to Solid',
    blurb: 'Thicken the selected open-surface body (sheet / shell) into a watertight solid. Default wall: 3 mm.',
    fields: [
      { name: 'thickness', label: 'Wall thickness', type: 'number', default: 3, unit: 'mm', min: 0.1, max: 100, step: 0.5, hint: 'offset applied to the selected open surface' },
    ],
  },

  'Sweep Boss': {
    title: 'Sweep Boss',
    blurb: 'Sweep a circular profile along a straight path. Defaults: r=8 mm, length=60 mm.',
    fields: [
      { name: 'radius', label: 'Profile radius', type: 'number', default: 8,  unit: 'mm', min: 0.1, max: 1000, step: 1 },
      { name: 'length', label: 'Path length',    type: 'number', default: 60, unit: 'mm', min: 1,   max: 5000, step: 1 },
    ],
  },

  'Loft Boss': {
    title: 'Loft Boss',
    blurb: 'Loft between a square bottom section and a square top section. Defaults: bottom=40 mm, top=16 mm, h=50 mm.',
    fields: [
      { name: 'bottomSize', label: 'Bottom section side', type: 'number', default: 40, unit: 'mm', min: 1, max: 5000, step: 1 },
      { name: 'topSize',    label: 'Top section side',    type: 'number', default: 16, unit: 'mm', min: 1, max: 5000, step: 1 },
      { name: 'height',     label: 'Height',              type: 'number', default: 50, unit: 'mm', min: 1, max: 5000, step: 1 },
    ],
  },

  // ─── THERMODYNAMIC / ROTATING MACHINERY ───────────────────────────────────
  'Brayton Cycle': {
    title: 'Brayton Cycle — Turbofan Inputs',
    blurb: 'Define the engine cycle. Defaults match Rolls-Royce Trent XWB at FL350.',
    fields: [
      { name: 'altitudeM',     label: 'Cruise altitude',  type: 'number', default: 10670, unit: 'm',  min: 0,    max: 15000, step: 100 },
      { name: 'machNumber',    label: 'Cruise Mach',      type: 'number', default: 0.85,  unit: 'M',  min: 0,    max: 1.2,   step: 0.01 },
      { name: 'bypassRatio',   label: 'Bypass ratio',     type: 'number', default: 9.6,   unit: ':1', min: 0,    max: 18,    step: 0.1, hint: 'High-bypass turbofans: 8–12' },
      { name: 'fanPR',         label: 'Fan pressure ratio', type: 'number', default: 1.45, unit: '',  min: 1.1,  max: 2.0,   step: 0.05 },
      { name: 'compressorPR',  label: 'HP/IP compressor PR', type: 'number', default: 34.5, unit: '', min: 5,   max: 60,    step: 0.5, hint: 'Total OPR = fanPR × this' },
      { name: 'T4_K',          label: 'TIT (T₄)',         type: 'number', default: 1750,  unit: 'K',  min: 1200, max: 2100,  step: 10 },
      { name: 'massFlowKgS',   label: 'Core mass flow',   type: 'number', default: 1300,  unit: 'kg/s', min: 50, max: 2000,  step: 10 },
    ],
  },

  'Compressor Stage': {
    title: 'Compressor Stage — Mean-line Inputs',
    blurb: 'Single axial fan/compressor stage. Defaults: 100 kg/s, 8 000 RPM, sea-level inlet.',
    fields: [
      { name: 'massFlowKgS', label: 'Mass flow',     type: 'number', default: 100,    unit: 'kg/s', min: 1,   max: 1500, step: 1 },
      { name: 'T_t1_K',      label: 'Inlet total T', type: 'number', default: 288.15, unit: 'K',    min: 200, max: 800,  step: 1 },
      { name: 'P_t1_Pa',     label: 'Inlet total P', type: 'number', default: 101325, unit: 'Pa',   min: 1e4, max: 5e6,  step: 1000 },
      { name: 'rpm',         label: 'Shaft speed',   type: 'number', default: 8000,   unit: 'RPM',  min: 1000, max: 30000, step: 100 },
      { name: 'r_tip_m',     label: 'Tip radius',    type: 'number', default: 0.6,    unit: 'm',    min: 0.05, max: 1.5,  step: 0.01 },
      { name: 'hubToTip',    label: 'Hub-to-tip',    type: 'number', default: 0.45,   unit: '',     min: 0.2,  max: 0.95, step: 0.01 },
      { name: 'axialMach1',  label: 'Inlet axial M', type: 'number', default: 0.5,    unit: 'M',    min: 0.3,  max: 0.7,  step: 0.01 },
      { name: 'deltaTtotal_K', label: 'ΔT_t per stage', type: 'number', default: 25, unit: 'K',    min: 5,    max: 60,   step: 1 },
      { name: 'polytropicEff', label: 'η_poly',     type: 'number', default: 0.90,    unit: '',     min: 0.7,  max: 0.97, step: 0.01 },
    ],
  },

  'Combustor': {
    title: 'Annular Combustor — Sizing Inputs',
    blurb: 'Lefebvre rules. Defaults match a 25 kg/s engine cruise design point.',
    fields: [
      { name: 'massFlowKgS',     label: 'Core flow',         type: 'number', default: 25,   unit: 'kg/s', min: 5,    max: 500,  step: 1 },
      { name: 'T_t3_K',          label: 'Inlet T (post-HPC)', type: 'number', default: 850, unit: 'K',    min: 500,  max: 1200, step: 10 },
      { name: 'P_t3_Pa',         label: 'Inlet P',            type: 'number', default: 3.7e6, unit: 'Pa', min: 5e5,  max: 1e7,  step: 1e5 },
      { name: 'T_t4_K',          label: 'Target TIT',         type: 'number', default: 1750, unit: 'K',  min: 1300, max: 2100, step: 10 },
      { name: 'residenceTime_ms', label: 'Residence time',    type: 'number', default: 10,   unit: 'ms', min: 2,    max: 50,   step: 1 },
    ],
  },

  // ─── STRUCTURAL ──────────────────────────────────────────
  'Linear Static FEA': {
    title: 'Linear Static FEA — Cantilever Inputs',
    blurb: 'Quad-tet Mirtich-validated cantilever solver. Defaults: 100×10×10 mm Al-6061 beam, 100 N tip load.',
    fields: [
      { name: 'L_mm',      label: 'Length',         type: 'number', default: 100, unit: 'mm',  min: 10,  max: 5000, step: 1 },
      { name: 'b_mm',      label: 'Width',          type: 'number', default: 10,  unit: 'mm',  min: 1,   max: 500,  step: 1 },
      { name: 'h_mm',      label: 'Height',         type: 'number', default: 10,  unit: 'mm',  min: 1,   max: 500,  step: 1 },
      { name: 'P_N',       label: 'Tip load',       type: 'number', default: 100, unit: 'N',   min: 1,   max: 1e6,  step: 1 },
      { name: 'E_MPa',     label: 'E',              type: 'number', default: 68900, unit: 'MPa', min: 1000, max: 500000, step: 1000 },
      { name: 'nu',        label: 'Poisson ν',      type: 'number', default: 0.33, unit: '',   min: 0,    max: 0.49, step: 0.01 },
      { name: 'yield_MPa', label: 'Yield strength', type: 'number', default: 276, unit: 'MPa', min: 50,   max: 3000, step: 10 },
    ],
  },

  'Fatigue Analysis': {
    title: 'Fatigue Analysis — Goodman + Basquin Inputs',
    blurb: 'Defaults: AISI 4340 fully-reversed bending (σ = ±400 MPa), surface ground (k_a=0.93), R=90 %.',
    fields: [
      { name: 'sigmaMax',         label: 'σ_max',           type: 'number', default: 400,  unit: 'MPa', min: -2000, max: 2000, step: 5 },
      { name: 'sigmaMin',         label: 'σ_min',           type: 'number', default: -400, unit: 'MPa', min: -2000, max: 2000, step: 5 },
      { name: 'materialName',     label: 'Material key',    type: 'string', default: '4340',                                                hint: 'lookup key in MaterialDB' },
      { name: 'surfaceFinish',    label: 'k_a (surface)',   type: 'number', default: 0.93, unit: '',    min: 0.5,   max: 1.0,  step: 0.01 },
      { name: 'size',             label: 'k_b (size)',      type: 'number', default: 1.0,  unit: '',    min: 0.6,   max: 1.0,  step: 0.01 },
      { name: 'load',             label: 'k_c (load type)', type: 'number', default: 1.0,  unit: '',    min: 0.5,   max: 1.0,  step: 0.01 },
      { name: 'temperature',      label: 'k_d (temp)',      type: 'number', default: 1.0,  unit: '',    min: 0.5,   max: 1.0,  step: 0.01 },
      { name: 'reliability',      label: 'k_e (R)',         type: 'number', default: 0.897, unit: '',   min: 0.5,   max: 1.0,  step: 0.001 },
    ],
  },

  'Rotordynamics': {
    title: 'Rotordynamics — Shaft + Disk Inputs',
    blurb: 'Defaults: steel Ø30 × 600 mm shaft, mid-span 5 kg disk, simply-supported.',
    fields: [
      { name: 'length_mm',   label: 'Shaft length',  type: 'number', default: 600,  unit: 'mm',     min: 50,   max: 5000, step: 5 },
      { name: 'diameter_mm', label: 'Shaft Ø',       type: 'number', default: 30,   unit: 'mm',     min: 5,    max: 500,  step: 1 },
      { name: 'E_MPa',       label: 'E',             type: 'number', default: 200000, unit: 'MPa',  min: 50000, max: 500000, step: 1000 },
      { name: 'density_g_per_mm3', label: 'ρ',       type: 'number', default: 7.85e-6, unit: 'g/mm³', min: 1e-6, max: 2e-5, step: 1e-7 },
      { name: 'disk_mass_kg', label: 'Mid-disk mass', type: 'number', default: 5.0,  unit: 'kg',    min: 0.1,   max: 200,  step: 0.1 },
      { name: 'disk_position_mm', label: 'Disk position', type: 'number', default: 300, unit: 'mm', min: 1,    max: 5000, step: 1 },
      { name: 'numModes',    label: '# modes',       type: 'number', default: 4,    unit: '',       min: 1,     max: 12,   step: 1 },
    ],
  },

  'Bearing Life': {
    title: 'Bearing Life — Lundberg-Palmgren Inputs',
    blurb: 'Defaults: SKF 6210-class deep-groove ball bearing, 4 kN radial + 2 kN axial @ 1700 RPM.',
    fields: [
      { name: 'Fr_kN',  label: 'Radial load',  type: 'number', default: 4,    unit: 'kN', min: 0,   max: 1000, step: 0.1 },
      { name: 'Fa_kN',  label: 'Axial load',   type: 'number', default: 2,    unit: 'kN', min: 0,   max: 1000, step: 0.1 },
      { name: 'C_kN',   label: 'C (dynamic)',  type: 'number', default: 35.1, unit: 'kN', min: 1,   max: 5000, step: 0.1 },
      { name: 'C0_kN',  label: 'C₀ (static)',  type: 'number', default: 23.2, unit: 'kN', min: 1,   max: 5000, step: 0.1 },
      { name: 'rpm',    label: 'Shaft speed',  type: 'number', default: 1700, unit: 'RPM', min: 10, max: 200000, step: 10 },
      { name: 'type',   label: 'Element type', type: 'string', default: 'ball', hint: 'ball | roller' },
    ],
  },

  'Gear Mesh': {
    title: 'Gear Mesh — AGMA Inputs',
    blurb: 'Defaults: Shigley Ex 14-4 spur pinion (17 T, m=6 mm, F=75 mm, 1.5 kW @ 1750 RPM).',
    fields: [
      { name: 'teeth',         label: '# teeth',         type: 'number', default: 17,   unit: '',    min: 8,    max: 200,  step: 1 },
      { name: 'module_mm',     label: 'Module',          type: 'number', default: 6,    unit: 'mm',  min: 0.5,  max: 30,   step: 0.25 },
      { name: 'faceWidth_mm',  label: 'Face width',      type: 'number', default: 75,   unit: 'mm',  min: 5,    max: 500,  step: 1 },
      { name: 'power_W',       label: 'Power',           type: 'number', default: 1500, unit: 'W',   min: 10,   max: 1e6,  step: 10 },
      { name: 'rpm',           label: 'Pinion speed',    type: 'number', default: 1750, unit: 'RPM', min: 10,   max: 50000, step: 10 },
      { name: 'J',             label: 'AGMA J (bend)',   type: 'number', default: 0.31, unit: '',    min: 0.1,  max: 0.6,  step: 0.01 },
      { name: 'I',             label: 'AGMA I (cont.)',  type: 'number', default: 0.10, unit: '',    min: 0.05, max: 0.30, step: 0.01 },
      { name: 'allowable_bending_MPa',  label: 'σ_bending limit', type: 'number', default: 250,  unit: 'MPa', min: 50,   max: 1500, step: 10 },
      { name: 'allowable_contact_MPa',  label: 'σ_contact limit', type: 'number', default: 1100, unit: 'MPa', min: 100,  max: 3000, step: 10 },
    ],
  },

  'Shaft Sizing': {
    title: 'Shaft Sizing — DE-Goodman / ASME Elliptic',
    blurb: 'Defaults: AISI 1050 CD shaft, M=70 N·m reversed bending + T=45 N·m steady torque, n=1.5.',
    fields: [
      { name: 'M_Nm',    label: 'Bending moment', type: 'number', default: 70,  unit: 'N·m', min: 0,   max: 1e6, step: 1 },
      { name: 'T_Nm',    label: 'Torque',         type: 'number', default: 45,  unit: 'N·m', min: 0,   max: 1e6, step: 1 },
      { name: 'Sut_MPa', label: 'S_ut',           type: 'number', default: 690, unit: 'MPa', min: 100, max: 3000, step: 10 },
      { name: 'Sy_MPa',  label: 'S_y',            type: 'number', default: 580, unit: 'MPa', min: 50,  max: 3000, step: 10 },
      { name: 'Se_MPa',  label: 'S_e (Marin)',    type: 'number', default: 276, unit: 'MPa', min: 30,  max: 2000, step: 10 },
      { name: 'n',       label: 'Design SF',      type: 'number', default: 1.5, unit: '',    min: 1,   max: 5,    step: 0.1 },
      { name: 'Kf',      label: 'K_f (bend)',     type: 'number', default: 1.6, unit: '',    min: 1,   max: 4,    step: 0.05 },
      { name: 'Kfs',     label: 'K_fs (torsion)', type: 'number', default: 1.3, unit: '',    min: 1,   max: 4,    step: 0.05 },
    ],
  },

  'Bolted Joint': {
    title: 'Bolted Joint — Wileman Stiffness + Goodman',
    blurb: 'Defaults: M10×1.5 grade 8.8, 25 mm grip, 6 kN external load, 75 % preload.',
    fields: [
      { name: 'boltSize',         label: 'Bolt size',         type: 'string', default: 'M10',  hint: 'M5 | M6 | M8 | M10 | M12 | M16 | M20' },
      { name: 'grade',            label: 'Grade',             type: 'string', default: '8.8',   hint: '4.6 | 5.8 | 8.8 | 10.9 | 12.9' },
      { name: 'grip_mm',          label: 'Grip length',       type: 'number', default: 25,  unit: 'mm',  min: 1,   max: 500, step: 1 },
      { name: 'P_ext_N',          label: 'External load',     type: 'number', default: 6000, unit: 'N',  min: 0,   max: 1e6, step: 10 },
      { name: 'preloadFraction',  label: 'Preload fraction',  type: 'number', default: 0.75, unit: '',   min: 0.3, max: 0.9, step: 0.01 },
    ],
  },

  'Spring Design': {
    title: 'Helical Spring — Wahl Stress + Sines Fatigue',
    blurb: 'Defaults: music-wire d=2 mm, D=20 mm, 14 active coils, 0–20 N load.',
    fields: [
      { name: 'd_mm',     label: 'Wire Ø',          type: 'number', default: 2,  unit: 'mm', min: 0.1, max: 50,  step: 0.05 },
      { name: 'D_mm',     label: 'Coil mean Ø',     type: 'number', default: 20, unit: 'mm', min: 1,   max: 500, step: 0.5 },
      { name: 'N_active', label: 'Active coils',    type: 'number', default: 14, unit: '',   min: 2,   max: 100, step: 1 },
      { name: 'F_min_N',  label: 'F_min',           type: 'number', default: 0,  unit: 'N',  min: -1e5, max: 1e5, step: 1 },
      { name: 'F_max_N',  label: 'F_max',           type: 'number', default: 20, unit: 'N',  min: -1e5, max: 1e5, step: 1 },
      { name: 'material', label: 'Material key',    type: 'string', default: 'music_wire_A228', hint: 'music_wire_A228 | hard_drawn_A227 | chrome_silicon_A401' },
      { name: 'ends',     label: 'End condition',   type: 'string', default: 'closed_ground',   hint: 'plain | plain_ground | closed | closed_ground' },
    ],
  },

  'Pressure Vessel': {
    title: 'Pressure Vessel — ASME BPVC Inputs',
    blurb: 'Defaults: P=1 MPa, R=200 mm, t=5 mm; ASME with S=138 MPa, E=0.85, CA=1.5 mm.',
    fields: [
      { name: 'P_MPa',                label: 'Design pressure', type: 'number', default: 1,    unit: 'MPa', min: 0.01, max: 200, step: 0.1 },
      { name: 'r_inner_mm',           label: 'Inner radius',    type: 'number', default: 200,  unit: 'mm',  min: 5,    max: 5000, step: 1 },
      { name: 't_mm',                 label: 'Wall thickness',  type: 'number', default: 5,    unit: 'mm',  min: 0.5,  max: 200,  step: 0.5 },
      { name: 'allowableStress_MPa',  label: 'Allowable stress S', type: 'number', default: 138, unit: 'MPa', min: 30,  max: 1000, step: 5 },
      { name: 'jointEfficiency',      label: 'Joint efficiency E', type: 'number', default: 0.85, unit: '',   min: 0.5, max: 1.0,  step: 0.05 },
      { name: 'corrosionAllowance_mm', label: 'Corrosion allowance', type: 'number', default: 1.5, unit: 'mm', min: 0,  max: 20,   step: 0.5 },
    ],
  },

  'Stress Concentration': {
    title: 'Stress Concentration — Peterson Curves',
    blurb: 'Defaults: shoulder D/d=2, r/d=0.1, hole d/W=0.3, notch r=2 mm in 4340 (S_ut = 1280 MPa).',
    fields: [
      { name: 'D_over_d',        label: 'Shoulder D/d',  type: 'number', default: 2.0, unit: '', min: 1.05, max: 5.0, step: 0.05 },
      { name: 'r_over_d',        label: 'Shoulder r/d',  type: 'number', default: 0.1, unit: '', min: 0.01, max: 1.0, step: 0.01 },
      { name: 'hole_d_over_W',   label: 'Plate hole d/W', type: 'number', default: 0.3, unit: '', min: 0.05, max: 0.8, step: 0.05 },
      { name: 'notch_radius_mm', label: 'Notch radius',  type: 'number', default: 2,   unit: 'mm', min: 0.1, max: 20,   step: 0.1 },
      { name: 'Sut_MPa',         label: 'S_ut',          type: 'number', default: 1280, unit: 'MPa', min: 200, max: 3000, step: 10 },
    ],
  },

  'Forced Vibration': {
    title: 'Forced Vibration — SDOF FRF',
    blurb: 'Defaults: m=5 kg, k=1000 N/m, ζ=0.05; peak D at resonance = 1/(2ζ) = 10.',
    fields: [
      { name: 'm_kg',       label: 'Mass',         type: 'number', default: 5,    unit: 'kg',    min: 0.01, max: 1e5, step: 0.1 },
      { name: 'k_N_per_m',  label: 'Stiffness',    type: 'number', default: 1000, unit: 'N/m',   min: 1,    max: 1e9,  step: 10 },
      { name: 'zeta',       label: 'Damping ratio', type: 'number', default: 0.05, unit: '',     min: 0.001, max: 0.5,  step: 0.005 },
      { name: 'F0_N',       label: 'Forcing amp',  type: 'number', default: 10,   unit: 'N',     min: 0.01, max: 1e6,  step: 0.1 },
    ],
  },

  'Blade Cooling': {
    title: 'HPT Blade Cooling — Inputs',
    blurb: 'Thermal-resistance model. Defaults: CMSX-4 + 0.3 mm YSZ TBC at T_gas = 1750 K.',
    fields: [
      { name: 'T_gas_K',     label: 'Gas T',         type: 'number', default: 1750, unit: 'K', min: 1200, max: 2100, step: 10 },
      { name: 'T_coolant_K', label: 'Coolant T',     type: 'number', default: 800,  unit: 'K', min: 500,  max: 1000, step: 10 },
      { name: 't_metal_m',   label: 'Metal thickness', type: 'number', default: 0.0015, unit: 'm', min: 0.0005, max: 0.005, step: 0.0001 },
      { name: 'k_metal',     label: 'k_metal',       type: 'number', default: 24,   unit: 'W/m·K', min: 5,  max: 50, step: 1 },
      { name: 't_TBC_m',     label: 'TBC thickness', type: 'number', default: 0.0003, unit: 'm', min: 0, max: 0.001, step: 0.00005 },
      { name: 'k_TBC',       label: 'k_TBC',         type: 'number', default: 1.0,  unit: 'W/m·K', min: 0.3, max: 3, step: 0.1 },
    ],
  },

  // ─── GEOMETRY (parametric — orchestration plans drive these) ──────
  // Plans may also pass non-dialog params: Extrude Boss `profile`,
  // Revolve Boss `profile`, the pattern tools `axis`/`useCurrentBody`.
  'Extrude Boss': {
    title: 'Extrude Boss — Inputs',
    blurb: 'Extrude a rectangular profile. Defaults: 80×50 mm × 25 mm box.',
    fields: [
      { name: 'width',  label: 'Width',  type: 'number', default: 80, unit: 'mm', min: 1, max: 5000, step: 1 },
      { name: 'depth',  label: 'Depth',  type: 'number', default: 50, unit: 'mm', min: 1, max: 5000, step: 1 },
      { name: 'height', label: 'Height', type: 'number', default: 25, unit: 'mm', min: 1, max: 5000, step: 1 },
    ],
  },

  // ─── UX TIER 11D — BOOLEAN-INSIDE-EXTRUDE (NX takeaway #104) ──────────────
  //
  // NX collapses ArchDisc's previously-separate Extrude Boss + Extrude Cut
  // ribbon tools into ONE `Extrude` tool with a Boolean toggle at the top of
  // the dialog (None / Unite / Subtract / Intersect). The default boolean
  // mode is `'none'` for a brand-new body; when the user has an existing
  // body in the scene the handler auto-detects and switches the dock
  // default to `'unite'` (NX's "use the target body" inference).
  //
  // The kernel ops themselves are unchanged — Tier-11d is a pure UX
  // consolidation that dispatches to the existing foundation extrude +
  // manifold boolean ops based on the picked boolean mode. The legacy
  // `Extrude Boss` + `Extrude Cut` ribbon entries are kept as
  // deprecated/hidden direct-access buttons for one release cycle so
  // existing integration specs + AI plans keep working unchanged.
  //
  //   boolean='none'      → extrude + add as a new body (Boss behaviour).
  //   boolean='unite'     → extrude + fuse with the current target body.
  //   boolean='subtract'  → extrude + cut from the current target body (Cut).
  //   boolean='intersect' → extrude + common with the current target body.
  //
  // The dialog renders every field; the handler reads only the relevant
  // subset based on `boolean`. Hints document which mode each field
  // applies to.
  'Extrude': {
    title: 'Extrude — Inputs (NX-unified Boss + Cut)',
    blurb: 'NX-style unified Extrude. Pick a Boolean mode (None=new body / Unite=fuse / Subtract=cut / Intersect=common); the handler reads the depth + draft fields and dispatches to the existing foundation extrude + manifold boolean ops. Default boolean=none for new bodies; auto-flips to `unite` when an existing target body is selected (NX behaviour). The rectangular profile defaults can be overridden by an orchestration plan via `profile` (closed wire pts) for arbitrary shapes.',
    fields: [
      { name: 'boolean',    label: 'Boolean',       type: 'enum',   default: 'none',
        options: ['none', 'unite', 'subtract', 'intersect'],
        hint: 'none=add as new body; unite=fuse with target; subtract=cut from target; intersect=common with target. Default auto-flips to unite when a target body is selected.' },
      { name: 'width',      label: 'Width',         type: 'number', default: 80, unit: 'mm', min: 0.1, max: 5000, step: 1,    hint: 'rect profile X extent (centred on origin); ignored if `profile` param supplies an explicit closed wire' },
      { name: 'depth',      label: 'Depth (Y)',     type: 'number', default: 50, unit: 'mm', min: 0.1, max: 5000, step: 1,    hint: 'rect profile Y extent (centred on origin); ignored if `profile` param supplies an explicit closed wire' },
      { name: 'distance',   label: 'Distance (Z)',  type: 'number', default: 25, unit: 'mm', min: 0.1, max: 5000, step: 1,    hint: 'extrude depth along the direction vector — the NX "Distance" field' },
      // UX Tier-12a — direction is now the universal Specify Vector picker
      // (NX takeaway #117). Backward compat: the dialog commit path also
      // emits dirX / dirY / dirZ from the picker's x/y/z so the existing
      // foundation Extrude handler (which reads `values.dirX/dirY/dirZ`)
      // keeps working unchanged.
      { name: 'direction',  label: 'Direction',     type: 'vector',
        default: { mode: 'csys', x: 0, y: 0, z: 1, csysAxis: '+Z' },
        legacyKeys: { x: 'dirX', y: 'dirY', z: 'dirZ' },
        hint: 'CSYS axis / custom vector / sketch line / face normal. Default +Z.' },
      { name: 'draft',      label: 'Draft angle',   type: 'number', default: 0,  unit: 'deg', min: -30, max: 30,  step: 0.5,  hint: 'per-side taper angle (NX "Draft" field); 0 = straight prism. Positive = outward taper, negative = inward' },
      { name: 'posX',       label: 'Position X',    type: 'number', default: 0,  unit: 'mm', min: -5000, max: 5000, step: 1,  hint: 'translates the resulting prism before the boolean (NX positions the Section against the target body via the sketch plane offset)' },
      { name: 'posY',       label: 'Position Y',    type: 'number', default: 0,  unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'posZ',       label: 'Position Z',    type: 'number', default: 0,  unit: 'mm', min: -5000, max: 5000, step: 1 },
    ],
  },
  'Revolve Boss': {
    title: 'Revolve Boss — Inputs',
    blurb: 'Revolve a (radius,height) profile 360°. Defaults: stepped shaft.',
    fields: [
      { name: 'revolveSegs', label: 'Revolution segments', type: 'number', default: 64, unit: '', min: 8, max: 256, step: 8 },
    ],
  },
  'Linear Pattern': {
    title: 'Linear Pattern — Inputs',
    blurb: 'N copies of a seed body along an axis. Defaults: 4× Ø6×15 mm @ 20 mm along +X.',
    fields: [
      { name: 'count',      label: 'Count',       type: 'number', default: 4,  unit: '',  min: 1, max: 200, step: 1 },
      { name: 'spacing',    label: 'Spacing',     type: 'number', default: 20, unit: 'mm', min: 0.1, max: 5000, step: 1 },
      // UX Tier-12a — direction is now the universal Specify Vector picker.
      // legacyKeys writes the picker's x/y/z into dirX/dirY/dirZ for any
      // caller that still reads the individual components; the handler
      // itself prefers `values.direction.x/y/z` (or falls back to
      // legacy `values.axis` array shape for AI-plan callers).
      { name: 'direction',  label: 'Direction',   type: 'vector',
        default: { mode: 'csys', x: 1, y: 0, z: 0, csysAxis: '+X' },
        legacyKeys: { x: 'dirX', y: 'dirY', z: 'dirZ' },
        hint: 'Axis the N copies sit along — CSYS axis / custom vector / sketch line / face normal. Default +X.' },
      { name: 'seedRadius', label: 'Seed radius', type: 'number', default: 3,  unit: 'mm', min: 0.1, max: 1000, step: 0.5 },
      { name: 'seedHeight', label: 'Seed height', type: 'number', default: 15, unit: 'mm', min: 0.1, max: 5000, step: 1 },
    ],
  },
  'Circular Pattern': {
    title: 'Circular Pattern — Inputs',
    blurb: 'N copies around an axis. Defaults: 6 fins around +Z at R=20 mm.',
    fields: [
      { name: 'count',  label: 'Count',  type: 'number', default: 6,  unit: '',  min: 1, max: 400, step: 1 },
      { name: 'radius', label: 'Radius', type: 'number', default: 20, unit: 'mm', min: 0.1, max: 5000, step: 1 },
    ],
  },

  // ─── UX TIER 11C — UNIFIED PATTERN FEATURE (NX takeaway #2) ────────────────
  //
  // NX consolidates Linear / Circular / Curve-Driven / Sketch-Driven / etc.
  // into ONE "Pattern Feature" tool with a Layout selector at the top of
  // the dialog. ArchDisc previously shipped Linear Pattern + Circular
  // Pattern as separate ribbon entries; this unified schema replaces them
  // on the ribbon while leaving the kernel ops (and the underlying
  // 'Linear Pattern' / 'Circular Pattern' handlers) intact for backward
  // compatibility with AI plans + direct API callers.
  //
  // Fields are listed for every layout; the handler reads only the
  // relevant subset based on `layout`. The dialog renders every field
  // (no conditional rendering in the schema layer) — hints document which
  // layout each field applies to so the user can ignore the rest.
  //
  //   layout='linear'   → uses dirX/Y/Z + count + spacing
  //   layout='circular' → uses axisX/Y/Z + count + angle
  //   layout='polygon'  → uses axisX/Y/Z + count + polygonRadius + startAngle
  //                       (implemented as N circular-pattern instances at
  //                        equal angular increments on a circle of
  //                        radius=polygonRadius)
  //
  // Queued (not yet implemented; will surface as the 'sketchDriven' and
  // 'reference' layouts in a follow-up): NX-style sketch-driven pattern
  // (place instances at each point in a driver sketch) + reference pattern
  // (pattern-of-a-pattern propagating the seed of another feature).
  'Pattern': {
    title: 'Pattern Feature — Unified Layouts',
    blurb: 'NX-style unified Pattern Feature. Pick a layout (linear / circular / polygon); the handler reads only the relevant fields. Pattern of the currently-selected foundation body (useCurrentBody=true) OR a default Ø6×15 mm seed cylinder.',
    fields: [
      { name: 'layout',         label: 'Layout',                type: 'enum',   default: 'linear',
        options: ['linear', 'circular', 'polygon'],
        hint: 'linear=along a direction; circular=around an axis; polygon=N copies at equal angles on a circle of polygonRadius. sketchDriven + reference queued for a follow-up.' },
      { name: 'count',          label: 'Count',                 type: 'number', default: 4,   unit: '',   min: 1,    max: 400,  step: 1 },
      // ─ linear-layout inputs
      { name: 'spacing',        label: 'Spacing (linear)',      type: 'number', default: 20,  unit: 'mm', min: 0.1,  max: 5000, step: 1,    hint: 'linear layout only — distance between adjacent copies along the direction vector' },
      { name: 'dirX',           label: 'Direction X (linear)',  type: 'number', default: 1,   unit: '',   min: -1,   max: 1,    step: 0.05, hint: 'linear layout only — unit vector; default (1,0,0) = +X' },
      { name: 'dirY',           label: 'Direction Y (linear)',  type: 'number', default: 0,   unit: '',   min: -1,   max: 1,    step: 0.05 },
      { name: 'dirZ',           label: 'Direction Z (linear)',  type: 'number', default: 0,   unit: '',   min: -1,   max: 1,    step: 0.05 },
      // ─ circular / polygon shared axis
      { name: 'axisX',          label: 'Axis X (circ/poly)',    type: 'number', default: 0,   unit: '',   min: -1,   max: 1,    step: 0.05, hint: 'circular + polygon — rotation axis through origin; default (0,0,1) = +Z' },
      { name: 'axisY',          label: 'Axis Y (circ/poly)',    type: 'number', default: 0,   unit: '',   min: -1,   max: 1,    step: 0.05 },
      { name: 'axisZ',          label: 'Axis Z (circ/poly)',    type: 'number', default: 1,   unit: '',   min: -1,   max: 1,    step: 0.05 },
      // ─ circular-layout inputs
      { name: 'angle',          label: 'Total angle (circular)',type: 'number', default: 360, unit: 'deg', min: 1,   max: 360,  step: 1,    hint: 'circular layout only — sweep angle of the N copies; 360 = full revolution' },
      { name: 'radius',         label: 'Radius (circular)',     type: 'number', default: 20,  unit: 'mm', min: 0.1,  max: 5000, step: 1,    hint: 'circular layout only — seed offset from axis; ignored if useCurrentBody=true' },
      // ─ polygon-layout inputs
      { name: 'polygonRadius',  label: 'Radius (polygon)',      type: 'number', default: 30,  unit: 'mm', min: 0.1,  max: 5000, step: 1,    hint: 'polygon layout only — circle radius on which the N copies sit' },
      { name: 'startAngle',     label: 'Start angle (polygon)', type: 'number', default: 0,   unit: 'deg', min: -360, max: 360, step: 1,    hint: 'polygon layout only — angular offset of the first copy' },
    ],
  },

  'Impact Simulation': {
    title: 'Impact Simulation — Explicit Dynamics',
    blurb: 'Mass-spring transient impact. Defaults: a 1.8 kg bird-strike-class impact at 90 m/s.',
    fields: [
      { name: 'gridN',          label: 'Panel grid (N×N)', type: 'number', default: 11,  unit: '',    min: 5, max: 25, step: 2 },
      { name: 'panelSize_mm',   label: 'Panel size',       type: 'number', default: 220, unit: 'mm',  min: 50, max: 2000, step: 10 },
      { name: 'stiffness',      label: 'Spring stiffness', type: 'number', default: 9000, unit: 'N/m', min: 500, max: 1e5, step: 500 },
      { name: 'nodeMass',       label: 'Node mass',        type: 'number', default: 0.05, unit: 'kg',  min: 0.005, max: 1, step: 0.005 },
      { name: 'breakStrain',    label: 'Spring break strain', type: 'number', default: 0.25, unit: '', min: 0.05, max: 1, step: 0.05 },
      { name: 'impactSpeed_ms', label: 'Impact speed',     type: 'number', default: 90,  unit: 'm/s', min: 1, max: 400, step: 5 },
      { name: 'impactorMass_kg', label: 'Impactor mass',   type: 'number', default: 1.8, unit: 'kg',  min: 0.05, max: 50, step: 0.05 },
      { name: 'damping',        label: 'Viscous damping',  type: 'number', default: 1.5, unit: 'N·s/m', min: 0, max: 20, step: 0.5 },
    ],
  },
  'Blade Row': {
    title: 'Blade Row — Turbomachinery',
    blurb: 'A ring of lofted, twisted aerofoils. The same tool builds a fan, compressor or turbine row.',
    fields: [
      { name: 'count',      label: 'Blade count', type: 'number', default: 24,  unit: '',  min: 2, max: 200, step: 1 },
      { name: 'rHub',       label: 'Hub radius',  type: 'number', default: 100, unit: 'mm', min: 5, max: 3000, step: 5 },
      { name: 'rTip',       label: 'Tip radius',  type: 'number', default: 300, unit: 'mm', min: 10, max: 3000, step: 5 },
      { name: 'xMid',       label: 'Axial position', type: 'number', default: 0, unit: 'mm', min: -10000, max: 10000, step: 10 },
      { name: 'chordHub',   label: 'Hub chord',   type: 'number', default: 80,  unit: 'mm', min: 2, max: 1000, step: 1 },
      { name: 'chordTip',   label: 'Tip chord',   type: 'number', default: 60,  unit: 'mm', min: 2, max: 1000, step: 1 },
      { name: 'thickRatio', label: 'Thickness ratio', type: 'number', default: 0.10, unit: '', min: 0.02, max: 0.3, step: 0.01 },
      { name: 'staggerHub', label: 'Hub stagger', type: 'number', default: 0.9, unit: 'rad', min: -1.5, max: 1.5, step: 0.05 },
      { name: 'staggerTip', label: 'Tip stagger', type: 'number', default: 0.4, unit: 'rad', min: -1.5, max: 1.5, step: 0.05 },
    ],
  },

  // ─── DRAWING WORKBENCH — UX TIER 8a (Auxiliary / Crop / Broken Views) ────
  //
  // Each schema pops a small dialog before generating the corresponding
  // 2D drawing sheet. The Auxiliary View dialog takes the projection
  // direction (face-normal); the Crop View dialog takes a rectangle in
  // paper-space mm; the Broken View dialog takes two break X positions.
  // Defaults are sane for a generic 100-mm-class part; the in-app handler
  // also accepts overrides via `window.__archdiscDrawingViewParams` so an
  // e2e or AI plan can plug in real face-derived numbers.
  'Auxiliary View': {
    title: 'Auxiliary View — Project Normal to Face',
    blurb: 'Generate a drawing view projected perpendicular to a picked face. The face normal is the projection direction.',
    fields: [
      { name: 'nx',    label: 'Normal X', type: 'number', default: 1.0, unit: '', min: -10, max: 10, step: 0.05 },
      { name: 'ny',    label: 'Normal Y', type: 'number', default: 0.0, unit: '', min: -10, max: 10, step: 0.05 },
      { name: 'nz',    label: 'Normal Z', type: 'number', default: 0.5, unit: '', min: -10, max: 10, step: 0.05, hint: 'Magnitude is irrelevant; direction only' },
      { name: 'label', label: 'View label', type: 'enum', default: 'A', options: ['A', 'B', 'C', 'D', 'E', 'F'] },
    ],
  },
  'Crop View': {
    title: 'Crop View — Clip Drawing to Region',
    blurb: 'Clip the front view to a rectangular boundary in paper-space mm. Use to focus on a detail without generating a separate Detail view.',
    fields: [
      { name: 'x', label: 'Crop X (paper mm, from view centre)', type: 'number', default: -25, unit: 'mm', min: -200, max: 200, step: 1 },
      { name: 'y', label: 'Crop Y (paper mm, from view centre)', type: 'number', default: -20, unit: 'mm', min: -200, max: 200, step: 1 },
      { name: 'w', label: 'Crop width',  type: 'number', default: 60, unit: 'mm', min: 1, max: 400, step: 1 },
      { name: 'h', label: 'Crop height', type: 'number', default: 50, unit: 'mm', min: 1, max: 400, step: 1 },
    ],
  },
  'Broken View': {
    title: 'Broken View — Foreshorten Long Part',
    blurb: 'Drop a stretch from the middle of the drawing and connect with a zig-zag break line. For long shafts / beams / rods.',
    fields: [
      { name: 'breakStartFrac', label: 'Break start (frac. of length)', type: 'number', default: 0.35, unit: '', min: 0.05, max: 0.95, step: 0.05 },
      { name: 'breakEndFrac',   label: 'Break end (frac. of length)',   type: 'number', default: 0.65, unit: '', min: 0.05, max: 0.95, step: 0.05, hint: 'Must be > start' },
      { name: 'axis',           label: 'Long axis',                     type: 'enum',   default: 'x',  options: ['x', 'y'] },
    ],
  },

  // ─── ASSEMBLY TIER-7a — Standard mates (Parallel / Perpendicular / Tangent / Lock) ──
  //
  // Four new SW standard mates that complete the standard-mate set
  // (Coincident / Distance / Concentric / Angle already exposed). Each is
  // selection-driven: the user pre-picks two components (or two faces / two
  // edges of the components) in the viewport, then clicks the mate. The
  // axis vectors below are GUIDANCE that the handler honours when the
  // selection doesn't carry an explicit axis — defaults to component Z-axis
  // (the most common case for cylindrical / face-normal mates).
  'Parallel Mate': {
    title: 'Parallel — Standard Assembly Mate',
    blurb: 'Constrain two faces / edges / axes of two components to be parallel (or anti-parallel). Pre-select TWO components, then click. Removes 2 rotational DOF.',
    fields: [
      { name: 'axisAx', label: 'Axis A — X', type: 'number', default: 0, min: -1, max: 1, step: 0.1, hint: 'Local-frame axis of component A (default Z)' },
      { name: 'axisAy', label: 'Axis A — Y', type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'axisAz', label: 'Axis A — Z', type: 'number', default: 1, min: -1, max: 1, step: 0.1 },
      { name: 'axisBx', label: 'Axis B — X', type: 'number', default: 0, min: -1, max: 1, step: 0.1, hint: 'Local-frame axis of component B (default Z)' },
      { name: 'axisBy', label: 'Axis B — Y', type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'axisBz', label: 'Axis B — Z', type: 'number', default: 1, min: -1, max: 1, step: 0.1 },
      { name: 'antiparallel', label: 'Anti-parallel', type: 'enum', default: 'no', options: ['no', 'yes'],
        hint: 'no = vectors point the same way; yes = opposite direction' },
    ],
  },
  'Perpendicular Mate': {
    title: 'Perpendicular — Standard Assembly Mate',
    blurb: 'Constrain two faces / edges / axes of two components to be at 90° to each other. Pre-select TWO components, then click. Removes 1 rotational DOF.',
    fields: [
      { name: 'axisAx', label: 'Axis A — X', type: 'number', default: 0, min: -1, max: 1, step: 0.1, hint: 'Local-frame axis of component A (default Z)' },
      { name: 'axisAy', label: 'Axis A — Y', type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'axisAz', label: 'Axis A — Z', type: 'number', default: 1, min: -1, max: 1, step: 0.1 },
      { name: 'axisBx', label: 'Axis B — X', type: 'number', default: 0, min: -1, max: 1, step: 0.1, hint: 'Local-frame axis of component B (default Z)' },
      { name: 'axisBy', label: 'Axis B — Y', type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'axisBz', label: 'Axis B — Z', type: 'number', default: 1, min: -1, max: 1, step: 0.1 },
    ],
  },
  'Tangent Mate': {
    title: 'Tangent — Standard Assembly Mate',
    blurb: 'Constrain a point/anchor on component B to touch a cylindrical/spherical surface on component A at radius R. Pre-select TWO components (A = cylinder, B = touching component), then click. Removes 1 DOF.',
    fields: [
      { name: 'axisOriginX', label: 'Cyl. axis origin X (A-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'axisOriginY', label: 'Cyl. axis origin Y (A-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'axisOriginZ', label: 'Cyl. axis origin Z (A-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'axisDirX',    label: 'Cyl. axis dir X',  type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'axisDirY',    label: 'Cyl. axis dir Y',  type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'axisDirZ',    label: 'Cyl. axis dir Z',  type: 'number', default: 1, min: -1, max: 1, step: 0.1 },
      { name: 'pointBx',     label: 'Anchor on B — X (B-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'pointBy',     label: 'Anchor on B — Y (B-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'pointBz',     label: 'Anchor on B — Z (B-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 1 },
      { name: 'radius',      label: 'Cylinder radius',  type: 'number', default: 10, unit: 'mm', min: 0.01, max: 5000, step: 0.5 },
    ],
  },
  'Lock Mate': {
    title: 'Lock — Standard Assembly Mate',
    blurb: 'Fully constrain two components in their CURRENT relative position. Pre-select TWO components, then click. Removes all 6 DOF (3 trans + 3 rot) — the two components become a rigid sub-assembly.',
    fields: [],
  },

  // ─── ASSEMBLY TIER-7b — Advanced mates (Width / Path / Distance-Limit) ──
  //
  // Three SolidWorks-advanced mates that complete the SW advanced-mate
  // family in ArchDisc. Each contributes a real residual equation +
  // correct DOF reduction (see kernel MateSolver Tier-7b satisfiers +
  // foundation KinematicsCore residual helpers):
  //
  //   Width          — TAB on partB centred equidistantly between two
  //                    reference anchors on partA. 1 trans DOF.
  //   Path           — point on partB lies on a polyline curve in
  //                    partA's local frame. 2 trans DOF (the two
  //                    components normal to the local tangent).
  //   Distance-Limit — distance(A↔B) constrained to [min, max] — slack
  //                    in range (0 DOF removed), 1 DOF at either clamp.
  //
  'Width Mate': {
    title: 'Width — Advanced Assembly Mate',
    blurb: 'Centre a TAB on component B equidistantly between two reference faces on component A. Pre-select TWO components, then click. Removes 1 translational DOF along the gap normal.',
    fields: [
      { name: 'refA1x', label: 'Ref A1 — X (A-local)', type: 'number', default: -10, unit: 'mm', min: -5000, max: 5000, step: 0.5, hint: 'Left/first reference anchor on component A.' },
      { name: 'refA1y', label: 'Ref A1 — Y (A-local)', type: 'number', default: 0,   unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'refA1z', label: 'Ref A1 — Z (A-local)', type: 'number', default: 0,   unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'refA2x', label: 'Ref A2 — X (A-local)', type: 'number', default: 10,  unit: 'mm', min: -5000, max: 5000, step: 0.5, hint: 'Right/second reference anchor on component A.' },
      { name: 'refA2y', label: 'Ref A2 — Y (A-local)', type: 'number', default: 0,   unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'refA2z', label: 'Ref A2 — Z (A-local)', type: 'number', default: 0,   unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'tabBx',  label: 'Tab on B — X (B-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5, hint: 'Centred face / mid-anchor on component B.' },
      { name: 'tabBy',  label: 'Tab on B — Y (B-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'tabBz',  label: 'Tab on B — Z (B-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
    ],
  },
  'Path Mate': {
    title: 'Path — Advanced Assembly Mate',
    blurb: 'Constrain a point on component B to lie on a path curve in component A\'s local frame. The path is supplied as a polyline (via __archdiscPathMatePath = [[x,y,z], ...] mm in A-local frame, or built from the schema endpoints + segment count). Removes 2 translational DOF; the along-path DOF is free.',
    fields: [
      { name: 'startX',   label: 'Path start — X (A-local)', type: 'number', default: 0,    unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'startY',   label: 'Path start — Y (A-local)', type: 'number', default: 0,    unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'startZ',   label: 'Path start — Z (A-local)', type: 'number', default: 0,    unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'endX',     label: 'Path end — X (A-local)',   type: 'number', default: 100,  unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'endY',     label: 'Path end — Y (A-local)',   type: 'number', default: 0,    unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'endZ',     label: 'Path end — Z (A-local)',   type: 'number', default: 0,    unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointBx',  label: 'Anchor on B — X (B-local)',type: 'number', default: 0,    unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointBy',  label: 'Anchor on B — Y (B-local)',type: 'number', default: 0,    unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointBz',  label: 'Anchor on B — Z (B-local)',type: 'number', default: 0,    unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'segments', label: 'Polyline segments',        type: 'number', default: 32,   min: 2, max: 512, step: 1, hint: 'Used when no __archdiscPathMatePath override is set — straight-line samples from start to end.' },
    ],
  },
  'Distance-Limit Mate': {
    title: 'Distance-Limit — Advanced Assembly Mate',
    blurb: 'Constrain the distance between two anchors on components A and B to stay within [min, max]. Slack inside the range (0 DOF removed); clamps at either limit (1 DOF removed). Pre-select TWO components, then click.',
    fields: [
      { name: 'pointAx', label: 'Anchor A — X (A-local)', type: 'number', default: 0,   unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointAy', label: 'Anchor A — Y (A-local)', type: 'number', default: 0,   unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointAz', label: 'Anchor A — Z (A-local)', type: 'number', default: 0,   unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointBx', label: 'Anchor B — X (B-local)', type: 'number', default: 0,   unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointBy', label: 'Anchor B — Y (B-local)', type: 'number', default: 0,   unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointBz', label: 'Anchor B — Z (B-local)', type: 'number', default: 0,   unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'minDist', label: 'Min distance', type: 'number', default: 0,   unit: 'mm', min: 0, max: 10000, step: 0.5, hint: 'Lower clamp — distance ≥ this.' },
      { name: 'maxDist', label: 'Max distance', type: 'number', default: 150, unit: 'mm', min: 0, max: 10000, step: 0.5, hint: 'Upper clamp — distance ≤ this. Set huge to disable the upper limit.' },
    ],
  },

  // ─── UX TIER 7c — Mechanical Mates (Gear + Hinge) ────────────────────
  //
  // Two mechanical-mate kinds that go beyond geometric constraint into
  // kinematic coupling:
  //   - GEAR  : two along-axis rotations coupled by a fixed ratio
  //             (theta_A * ratio - theta_B === phase mod 2 pi). 1 rotational DOF.
  //   - HINGE : concentric + coincident-on-axis = 5 DOF removed, leaving
  //             one rotational DOF about the shared axis, optionally
  //             clamped by [angleMin, angleMax].
  //
  'Gear Mate': {
    title: 'Gear — Mechanical Assembly Mate',
    blurb: 'Couple two rotational components by a fixed gear ratio so that theta_A * ratio - theta_B === phase (mod 2 pi). Pre-select TWO components, then click. Removes 1 rotational DOF; translational + perpendicular rotational DOFs remain free. Gear ratio = omega_B / omega_A (so a 2:1 reduction has ratio 0.5; for tooth counts N_A:N_B set ratio = N_A / N_B).',
    fields: [
      { name: 'axisAx',    label: 'Axis A — X (A-local)', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAy',    label: 'Axis A — Y (A-local)', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAz',    label: 'Axis A — Z (A-local)', type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBx',    label: 'Axis B — X (B-local)', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBy',    label: 'Axis B — Y (B-local)', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBz',    label: 'Axis B — Z (B-local)', type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'gearRatio', label: 'Gear ratio (wB / wA)', type: 'number', default: 1, min: -100, max: 100, step: 0.01, hint: 'Positive ratio = same direction; negative = belt reverse direction.' },
      { name: 'phase',     label: 'Phase offset', type: 'number', default: 0, unit: 'rad', min: -100, max: 100, step: 0.01, hint: 'Set the relative phase at theta_A = 0.' },
    ],
  },
  'Hinge Mate': {
    title: 'Hinge — Mechanical Assembly Mate',
    blurb: 'Single rotational DOF about a shared axis — equivalent to concentric + coincident-along-axis (5 DOF removed). Optional angle limits clamp the remaining hinge angle. Pre-select TWO components, then click.',
    fields: [
      { name: 'axisOriginAx', label: 'Pivot A — X (A-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisOriginAy', label: 'Pivot A — Y (A-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisOriginAz', label: 'Pivot A — Z (A-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisDirAx',    label: 'Hinge axis A — X',     type: 'number', default: 0, unit: '',   min: -1, max: 1, step: 0.001 },
      { name: 'axisDirAy',    label: 'Hinge axis A — Y',     type: 'number', default: 0, unit: '',   min: -1, max: 1, step: 0.001 },
      { name: 'axisDirAz',    label: 'Hinge axis A — Z',     type: 'number', default: 1, unit: '',   min: -1, max: 1, step: 0.001 },
      { name: 'axisOriginBx', label: 'Pivot B — X (B-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisOriginBy', label: 'Pivot B — Y (B-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisOriginBz', label: 'Pivot B — Z (B-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisDirBx',    label: 'Hinge axis B — X',     type: 'number', default: 0, unit: '',   min: -1, max: 1, step: 0.001 },
      { name: 'axisDirBy',    label: 'Hinge axis B — Y',     type: 'number', default: 0, unit: '',   min: -1, max: 1, step: 0.001 },
      { name: 'axisDirBz',    label: 'Hinge axis B — Z',     type: 'number', default: 1, unit: '',   min: -1, max: 1, step: 0.001 },
      { name: 'angleMin',     label: 'Angle min',            type: 'number', default: -180, unit: 'deg', min: -3600, max: 3600, step: 1, hint: 'Lower angle clamp (deg). Set -3600 for free spin in the negative direction.' },
      { name: 'angleMax',     label: 'Angle max',            type: 'number', default: 180,  unit: 'deg', min: -3600, max: 3600, step: 1, hint: 'Upper angle clamp (deg). Set +3600 for free spin in the positive direction.' },
    ],
  },
  // ─── UX TIER 7c-rest — Screw + Rack-Pinion mechanical mates ──────────
  //
  // Both couple a rotational coordinate to a translational coordinate by a
  // single scalar parameter — Screw uses `pitch` (mm/rev) and divides by
  // 2π so one full turn advances by `pitch`; Rack-Pinion uses
  // `pinionRadius` (mm) directly so θ rad of pinion rotation moves the
  // rack by R·θ mm (rolling-without-slipping). Each removes 1 DOF.
  //
  'Screw Mate': {
    title: 'Screw — Mechanical Assembly Mate',
    blurb: 'Couple a rotation of part A about its axis to a translation of part B along the same axis by `pitch` (mm/rev). Real leadscrew / CNC linear-stage kinematics — one full revolution advances the carriage by `pitch` mm. Pre-select TWO components, then click. Removes 1 DOF. Handedness toggle: Right-hand (default) vs Left-hand reverses the coupling sign.',
    fields: [
      { name: 'axisAx',         label: 'Axis A — X (A-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAy',         label: 'Axis A — Y (A-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAz',         label: 'Axis A — Z (A-local)',  type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBx',         label: 'Axis B — X (B-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBy',         label: 'Axis B — Y (B-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBz',         label: 'Axis B — Z (B-local)',  type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisOriginAx',   label: 'Axis origin A — X',     type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisOriginAy',   label: 'Axis origin A — Y',     type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisOriginAz',   label: 'Axis origin A — Z',     type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pitch',          label: 'Pitch',                 type: 'number', default: 2, unit: 'mm/rev', min: -50, max: 50, step: 0.01, hint: 'Lead per revolution. One full turn of A advances B by `pitch` mm.' },
      { name: 'handedness',     label: 'Handedness',            type: 'enum',   default: 'right', options: ['right', 'left'], hint: 'Right-hand thread (default) vs left-hand reverses the rotation-to-translation direction.' },
    ],
  },
  'Rack-Pinion Mate': {
    title: 'Rack-Pinion — Mechanical Assembly Mate',
    blurb: 'Couple a rotation of pinion (part A) about its axis to a translation of rack (part B) along the tangent line by `pinionRadius`. Rolling-without-slipping kinematics: θ rad of pinion rotation advances the rack by R·θ mm. Pre-select pinion then rack, then click. Removes 1 DOF.',
    fields: [
      { name: 'axisAx',         label: 'Pinion axis A — X (A-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAy',         label: 'Pinion axis A — Y (A-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAz',         label: 'Pinion axis A — Z (A-local)',  type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBx',         label: 'Rack tangent B — X (B-local)', type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBy',         label: 'Rack tangent B — Y (B-local)', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBz',         label: 'Rack tangent B — Z (B-local)', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisOriginAx',   label: 'Pinion axis origin — X',       type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisOriginAy',   label: 'Pinion axis origin — Y',       type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisOriginAz',   label: 'Pinion axis origin — Z',       type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pinionRadius',   label: 'Pinion pitch radius',          type: 'number', default: 10, unit: 'mm', min: -500, max: 500, step: 0.1, hint: 'Pitch radius of the pinion. θ rad of rotation moves the rack by R·θ mm. Negative = rack on the opposite side (reverses direction).' },
    ],
  },

  // ─── UX TIER 7c-final — Cam + Universal-Joint mechanical mates (6/6) ───
  //
  // Cam — point-on-cam-surface contact. The follower's contact point stays
  // on the cam profile (the cam's perimeter polyline in its rotating frame).
  // As the cam rotates, the follower translates radially. Schema drives:
  //   - cam rotation axis (local-frame direction)
  //   - cam profile shape (enum: ellipse / circle / heart; semi-axes in mm)
  //   - profile-sample count (resolution of the polyline)
  //   - follower contact point (B-local, mm)
  //   - follower translation axis (local-frame direction)
  // Profile polyline is generated procedurally from the shape parameters in
  // the ToolExecutionEngine handler so the schema stays user-friendly.
  //
  // Universal-Joint — velocity-coupling between two non-collinear shafts
  // through a cross-pin at angle `crossAngle` (the misalignment angle
  // between the input and output shafts; default 90° for a standard Cardan
  // joint but most automotive drivelines run 10°–30°). Static residual:
  //   cos(crossAngle) · θ_A − θ_B  →  0.
  // Schema drives the two axis directions + the cross-angle in degrees.
  //
  'Cam Mate': {
    title: 'Cam — Mechanical Assembly Mate',
    blurb: 'Point-on-cam-surface contact. The follower\'s contact point stays on the cam profile as the cam rotates. Removes 1 DOF. Profile polyline is generated from the chosen shape (ellipse / circle / heart) + semi-axis dimensions; the handler transforms it into the cam\'s rotating frame so it spins with the cam. Pre-select cam, then follower.',
    fields: [
      { name: 'axisDirAx',   label: 'Cam axis A — X (A-local)', type: 'number', default: 0, unit: '',   min: -1, max: 1, step: 0.001 },
      { name: 'axisDirAy',   label: 'Cam axis A — Y (A-local)', type: 'number', default: 1, unit: '',   min: -1, max: 1, step: 0.001 },
      { name: 'axisDirAz',   label: 'Cam axis A — Z (A-local)', type: 'number', default: 0, unit: '',   min: -1, max: 1, step: 0.001 },
      { name: 'profileShape',label: 'Profile shape',            type: 'enum',   default: 'ellipse', options: ['ellipse', 'circle', 'heart'], hint: 'Ellipse = standard automotive cam lobe; Circle = round (no lift, sanity check); Heart = symmetric dual-lobe.' },
      { name: 'profileA',    label: 'Semi-major axis (a)',      type: 'number', default: 20, unit: 'mm', min: 0.1, max: 500, step: 0.1, hint: 'Cam max radius (the far point of the lobe).' },
      { name: 'profileB',    label: 'Semi-minor axis (b)',      type: 'number', default: 12, unit: 'mm', min: 0.1, max: 500, step: 0.1, hint: 'Cam min radius (the near point of the lobe). Lift = a − b.' },
      { name: 'profileSamples', label: 'Profile sample count',  type: 'number', default: 64, min: 8, max: 512, step: 1, hint: 'Polyline resolution. 64 samples is plenty for smooth contact.' },
      { name: 'followerPtBx',label: 'Follower point B — X',     type: 'number', default: 0,  unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'followerPtBy',label: 'Follower point B — Y',     type: 'number', default: -25, unit: 'mm', min: -5000, max: 5000, step: 0.5, hint: 'Contact point on the follower in B-local. Should sit ON the cam profile in world space at the initial pose.' },
      { name: 'followerPtBz',label: 'Follower point B — Z',     type: 'number', default: 0,  unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'followerAxisDirBx', label: 'Follower axis B — X', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'followerAxisDirBy', label: 'Follower axis B — Y', type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001, hint: 'Direction the follower can slide. Typically the radial direction from the cam centre.' },
      { name: 'followerAxisDirBz', label: 'Follower axis B — Z', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
    ],
  },
  'Universal-Joint Mate': {
    title: 'Universal-Joint — Mechanical Assembly Mate',
    blurb: 'Velocity-coupling between two non-collinear shafts through a cross-pin at angle `crossAngle` (the misalignment angle between input and output shafts). Static residual: cos(crossAngle) · θ_A − θ_B → 0. Real Cardan-joint kinematics. Removes 2 DOF (axis-alignment-up-to-cross + along-axis phase coupling); 1 rotational + 3 translational DOFs remain. Pre-select input shaft, then output shaft.',
    fields: [
      { name: 'axisAx',     label: 'Input axis A — X (A-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAy',     label: 'Input axis A — Y (A-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAz',     label: 'Input axis A — Z (A-local)',  type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBx',     label: 'Output axis B — X (B-local)', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBy',     label: 'Output axis B — Y (B-local)', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBz',     label: 'Output axis B — Z (B-local)', type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'crossAngle', label: 'Cross-angle',                 type: 'number', default: 15, unit: 'deg', min: 0, max: 90, step: 0.1, hint: 'Misalignment angle between input and output shafts. Real automotive drivelines run 10°–30°. 0 = in-line rigid coupling; 90° = Cardan singularity (decouples).' },
    ],
  },

  // ─── UX TIER 7b-rest — Symmetric + Linear-Coupler + Angle-Limit (advanced 6/6) ─
  //
  // Symmetric  — two entity points mirror about a symmetry plane anchored on A.
  //              Removes 3 DOF (midpoint along normal + 2 perpendicular AB).
  // Linear-Coupler — translation of A along its axis ↔ translation of B along
  //                  its axis, coupled by `ratio`. Pure translational analogue
  //                  of Gear. Removes 1 DOF.
  // Angle-Limit  — relative rotation of B vs A about a shared axis clamped to
  //                [angleMin, angleMax]. Pure rotational analogue of Distance-
  //                Limit (slack in-range; 1 DOF when clamped).
  //
  'Symmetric Mate': {
    title: 'Symmetric — Advanced Assembly Mate',
    blurb: 'Two entity points (one on A, one on B) mirror about a symmetry plane anchored on A. Pre-select TWO components, then click. Removes 3 DOF (midpoint lies in the plane + AB-line is perpendicular to the plane). Real CAD symmetry — two bolts at mirrored holes, two arms scissor-mounted symmetrically about a centreline.',
    fields: [
      { name: 'planeOriginAx', label: 'Plane origin A — X (A-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'planeOriginAy', label: 'Plane origin A — Y (A-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'planeOriginAz', label: 'Plane origin A — Z (A-local)', type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'planeNormalAx', label: 'Plane normal A — X',           type: 'number', default: 1, unit: '',   min: -1, max: 1, step: 0.001, hint: 'Symmetry-plane normal. (1,0,0) = YZ plane, (0,1,0) = XZ plane, (0,0,1) = XY plane.' },
      { name: 'planeNormalAy', label: 'Plane normal A — Y',           type: 'number', default: 0, unit: '',   min: -1, max: 1, step: 0.001 },
      { name: 'planeNormalAz', label: 'Plane normal A — Z',           type: 'number', default: 0, unit: '',   min: -1, max: 1, step: 0.001 },
      { name: 'pointAx',       label: 'Entity A — X (A-local)',       type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointAy',       label: 'Entity A — Y (A-local)',       type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointAz',       label: 'Entity A — Z (A-local)',       type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointBx',       label: 'Entity B — X (B-local)',       type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointBy',       label: 'Entity B — Y (B-local)',       type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'pointBz',       label: 'Entity B — Z (B-local)',       type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
    ],
  },
  'Linear-Coupler Mate': {
    title: 'Linear-Coupler — Advanced Assembly Mate',
    blurb: 'Translation of part A along its axis coupled to translation of part B along its axis by `ratio`. Pure translational analogue of Gear. Residual: tA · ratio − tB → 0. Pre-select TWO components, then click. Removes 1 DOF. Real CAD coupling: two carriages on parallel rails coupled by a cable+pulley pair (ratio = pulley_R_out / pulley_R_in).',
    fields: [
      { name: 'axisAx',         label: 'Axis A — X (A-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAy',         label: 'Axis A — Y (A-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAz',         label: 'Axis A — Z (A-local)',  type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBx',         label: 'Axis B — X (B-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBy',         label: 'Axis B — Y (B-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBz',         label: 'Axis B — Z (B-local)',  type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisOriginAx',   label: 'Axis origin A — X',     type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisOriginAy',   label: 'Axis origin A — Y',     type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'axisOriginAz',   label: 'Axis origin A — Z',     type: 'number', default: 0, unit: 'mm', min: -5000, max: 5000, step: 0.5 },
      { name: 'ratio',          label: 'Coupling ratio',        type: 'number', default: 1, unit: '',   min: -20, max: 20, step: 0.01, hint: 'tA · ratio − tB → 0. 1 = 1:1 coupling; -1 = opposite-direction; 2 = B moves twice as fast as A; 0.5 = B at half-speed.' },
    ],
  },
  'Angle-Limit Mate': {
    title: 'Angle-Limit — Advanced Assembly Mate',
    blurb: 'Relative rotation of part B versus part A about a shared axis clamped to [angleMin, angleMax]. Pure rotational analogue of Distance-Limit: 0 DOF removed inside the range (slack), 1 DOF removed when clamped at a limit. Pre-select TWO components, then click. Real CAD: a safety pivot limiting a scissor-arm angle to 0°–60°.',
    fields: [
      { name: 'axisAx',     label: 'Axis A — X (A-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAy',     label: 'Axis A — Y (A-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisAz',     label: 'Axis A — Z (A-local)',  type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBx',     label: 'Axis B — X (B-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBy',     label: 'Axis B — Y (B-local)',  type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'axisBz',     label: 'Axis B — Z (B-local)',  type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.001 },
      { name: 'angleMin',   label: 'Angle min',             type: 'number', default: -90, unit: 'deg', min: -3600, max: 3600, step: 0.5, hint: 'Lower angle clamp (deg).' },
      { name: 'angleMax',   label: 'Angle max',             type: 'number', default: +90, unit: 'deg', min: -3600, max: 3600, step: 0.5, hint: 'Upper angle clamp (deg).' },
    ],
  },

  // ─── UX TIER 8b — Model Items + BOM + Auto-Balloon ─────────────────────
  //
  // Three drafting-tab tools that turn a 3D part / assembly into a
  // dimensioned, annotated, balloon-labelled drawing sheet. All three are
  // selection-driven — read the active body or the registered assembly —
  // so the schemas only carry the few user-tweakable options.
  'Model Items': {
    title: 'Model Items — Auto-Import Part Dimensions',
    blurb: 'Project every parametric dimension from the active body\'s feature history (sketch widths, extrude depths, fillet radii, etc.) onto the FRONT drawing view with auto-placed leader lines.',
    fields: [
      { name: 'viewKind', label: 'Target view', type: 'enum', default: 'front', options: ['front', 'top', 'right', 'iso'], hint: 'Currently FRONT is wired; others coming.' },
    ],
  },
  'BOM': {
    title: 'BOM — Bill of Materials Table',
    blurb: 'Build a Bill-of-Materials table from every body in the scene. Pulls partNumber / description / material from each body\'s attribute bag (set via BodyRegistry.attachAttribute or the Body Properties panel).',
    fields: [
      { name: 'mergeByPartNumber', label: 'Merge identical part numbers', type: 'enum', default: 'yes', options: ['yes', 'no'], hint: 'Yes = four identical bolts → one row qty 4; No = four rows qty 1.' },
    ],
  },
  'Auto-Balloon': {
    title: 'Auto-Balloon — Number Every Component',
    blurb: 'Drop a numbered balloon callout on each component, linked to its BOM row. Auto-placement uses radial layout around the assembly centroid with overlap detection.',
    fields: [
      { name: 'balloonRadius', label: 'Balloon radius', type: 'number', default: 5, unit: 'mm', min: 2, max: 12, step: 0.5 },
      { name: 'mergeByPartNumber', label: 'Merge identical part numbers', type: 'enum', default: 'yes', options: ['yes', 'no'], hint: 'Match the BOM merge setting.' },
    ],
  },

  // ─── UX TIER 8c — Title Block + Sheet Format ──────────────────────────
  'Title Block': {
    title: 'Title Block — Engineering Drawing Header',
    blurb: 'Stamp a real ASME / ISO engineering title block in the bottom-right corner of the active sheet. 3-row grid: Title (part number + description), Properties (drawn-by / date / material / scale / sheet / standard / units / tolerance), Approval. The block becomes part of the drawing SVG and prints with it.',
    fields: [
      { name: 'partNumber',  label: 'Part Number',   type: 'string', default: 'PN-0001',              hint: 'Top-line identifier (e.g. CR-2104-A).' },
      { name: 'description', label: 'Description',   type: 'string', default: 'Untitled Part',        hint: 'One-line part description.' },
      { name: 'drawnBy',     label: 'Drawn By',      type: 'string', default: 'A.Eng',                hint: 'Initials or name of the drafter.' },
      { name: 'date',        label: 'Date',          type: 'string', default: new Date().toISOString().slice(0, 10) },
      { name: 'material',    label: 'Material',      type: 'string', default: 'AISI 1020 Steel',      hint: 'Per BOM or as-shown.' },
      { name: 'scale',       label: 'Scale',         type: 'string', default: '1:1',                  hint: 'Print scale (1:1, 1:2, 2:1, etc.).' },
      { name: 'sheetN',      label: 'Sheet number',  type: 'number', default: 1, min: 1, max: 99, step: 1 },
      { name: 'sheetTotal',  label: 'Sheets total',  type: 'number', default: 1, min: 1, max: 99, step: 1 },
      { name: 'approval',    label: 'Approved',      type: 'string', default: 'PENDING' },
      { name: 'size',        label: 'Sheet size',    type: 'enum',   default: 'A3', options: ['A0', 'A1', 'A2', 'A3', 'A4', 'ANSI-A', 'ANSI-B', 'ANSI-C', 'ANSI-D', 'ANSI-E'] },
      { name: 'orientation', label: 'Orientation',   type: 'enum',   default: 'landscape', options: ['landscape', 'portrait'] },
    ],
  },
  'Sheet Format': {
    title: 'Sheet Format — Change Drawing Sheet Size',
    blurb: 'Re-render the drawing sheet at a different ISO / ANSI size + orientation. Updates the viewBox, redraws the double-line ASME border, and fits a mini title block into the new corner. Real-world mm: A0=841×1189, A1=594×841, A2=420×594, A3=297×420, A4=210×297, ANSI-A=216×279, ANSI-B=279×432, ANSI-C=432×559, ANSI-D=559×864, ANSI-E=864×1118.',
    fields: [
      { name: 'size',        label: 'Sheet size',    type: 'enum',   default: 'A3', options: ['A0', 'A1', 'A2', 'A3', 'A4', 'ANSI-A', 'ANSI-B', 'ANSI-C', 'ANSI-D', 'ANSI-E'] },
      { name: 'orientation', label: 'Orientation',   type: 'enum',   default: 'landscape', options: ['landscape', 'portrait'] },
      { name: 'partName',    label: 'Sheet title',   type: 'string', default: 'Sheet', hint: 'Shown in the mini corner block.' },
    ],
  },

  // ─── UX TIER 12 — Stepped Section Line + Tabular Note (NX-distinctive) ──
  //
  // Two Drafting ops the SW gap list missed but the Siemens NX synthesis
  // flagged (`siemens-nx-course-synthesis.md` §6 items 112 + 114).
  //
  //   Stepped Section Line — multi-segment cut path with right-angle jogs;
  //   composite cross-section hops between parallel planes.
  //
  //   Tabular Note         — generic editable N×M table (NOT BOM-linked).
  //   Used for hole charts, revision blocks, tolerance tables.
  //
  // Both schemas carry sane defaults for a generic 100-mm-class part; e2e
  // / AI plans bypass the dialog by stashing real polyline / column /
  // row data at `window.__archdiscSteppedSectionPoints` and
  // `window.__archdiscTabularNoteData` respectively.
  'Stepped Section Line': {
    title: 'Stepped Section Line — Multi-Plane Cut with Jogs',
    blurb: 'Build a multi-segment section line on the FRONT view (right-angle jogs allowed). Each segment defines a cutting plane; the result is a composite cross-section that hops between parallel planes (NX "Section Line → Stand Alone"). Stash a real polyline at __archdiscSteppedSectionPoints = [{x,y}, ...] to override the dialog defaults.',
    fields: [
      { name: 'label',  label: 'Section label', type: 'enum',   default: 'A', options: ['A', 'B', 'C', 'D', 'E', 'F'] },
      { name: 'p0x',    label: 'P0 — X (paper mm)', type: 'number', default: -30, unit: 'mm', min: -300, max: 300, step: 1 },
      { name: 'p0y',    label: 'P0 — Y (paper mm)', type: 'number', default: 0,   unit: 'mm', min: -300, max: 300, step: 1 },
      { name: 'p1x',    label: 'P1 — X (paper mm)', type: 'number', default: 0,   unit: 'mm', min: -300, max: 300, step: 1 },
      { name: 'p1y',    label: 'P1 — Y (paper mm)', type: 'number', default: 0,   unit: 'mm', min: -300, max: 300, step: 1 },
      { name: 'p2x',    label: 'P2 — X (paper mm)', type: 'number', default: 0,   unit: 'mm', min: -300, max: 300, step: 1, hint: 'Right-angle jog: keep px constant from previous point.' },
      { name: 'p2y',    label: 'P2 — Y (paper mm)', type: 'number', default: 20,  unit: 'mm', min: -300, max: 300, step: 1 },
      { name: 'p3x',    label: 'P3 — X (paper mm)', type: 'number', default: 30,  unit: 'mm', min: -300, max: 300, step: 1 },
      { name: 'p3y',    label: 'P3 — Y (paper mm)', type: 'number', default: 20,  unit: 'mm', min: -300, max: 300, step: 1 },
    ],
  },
  'Tabular Note': {
    title: 'Tabular Note — Generic N×M Annotation Table',
    blurb: 'Place an editable annotation table anywhere on the sheet (NOT BOM-linked). Used for hole charts, revision blocks, tolerance tables, inspection sheets. Stash real columns + rows at __archdiscTabularNoteData = {columns: [{label, width}], rows: [[...], ...]} to fill the cells.',
    fields: [
      { name: 'title',    label: 'Table title',  type: 'string', default: 'HOLE CHART' },
      { name: 'x',        label: 'X (paper mm)', type: 'number', default: 30,  unit: 'mm', min: 0,   max: 1500, step: 1 },
      { name: 'y',        label: 'Y (paper mm)', type: 'number', default: 30,  unit: 'mm', min: 0,   max: 1500, step: 1 },
      { name: 'cols',     label: 'Columns',      type: 'number', default: 4,   min: 1, max: 10, step: 1 },
      { name: 'rows',     label: 'Rows',         type: 'number', default: 3,   min: 1, max: 30, step: 1 },
      { name: 'colWidth', label: 'Default col width', type: 'number', default: 30, unit: 'mm', min: 6, max: 120, step: 1 },
      { name: 'size',        label: 'Sheet size',   type: 'enum',   default: 'A3', options: ['A0', 'A1', 'A2', 'A3', 'A4', 'ANSI-A', 'ANSI-B', 'ANSI-C', 'ANSI-D', 'ANSI-E'] },
      { name: 'orientation', label: 'Orientation',  type: 'enum',   default: 'landscape', options: ['landscape', 'portrait'] },
    ],
  },

  // ─── UX TIER 5a — Sheet Metal workbench foundation ────────────────────
  //
  // Three foundational sheet-metal ops with their param schemas. Base
  // Flange seeds the part + stamps the sheet-metal metadata; Edge Flange
  // grows a bent wall off any selected edge; Flat Pattern unfolds the
  // bent part to its laser-cut layout.
  'Base Flange': {
    title: 'Base Flange — Sheet Metal Foundation',
    blurb: 'Create the FIRST sheet-metal feature. A rectangular sketch profile is thickened by the sheet thickness, and the resulting body is tagged as sheet metal — thickness, K-factor, and bend radius travel with the body so every downstream sheet-metal op can ask. Defaults: 100×80 mm, t=1.5 mm, K=0.4.',
    fields: [
      { name: 'width',      label: 'Width (X)',     type: 'number', default: 100,  unit: 'mm', min: 1,    max: 5000, step: 1, hint: 'Sketch profile width.' },
      { name: 'depth',      label: 'Depth (Y)',     type: 'number', default: 80,   unit: 'mm', min: 1,    max: 5000, step: 1, hint: 'Sketch profile depth.' },
      { name: 'thickness',  label: 'Sheet thickness', type: 'number', default: 1.5, unit: 'mm', min: 0.1, max: 50,   step: 0.1, hint: 'Material gauge.' },
      { name: 'kFactor',    label: 'K-factor',      type: 'number', default: 0.4,  min: 0,    max: 1,    step: 0.05, hint: 'Neutral-fibre ratio (0..1). SW default 0.4.' },
      { name: 'bendRadius', label: 'Bend radius',   type: 'number', default: 1.5,  unit: 'mm', min: 0.1, max: 100,  step: 0.1, hint: 'Inside bend radius — typically equal to thickness.' },
    ],
  },
  'Edge Flange': {
    title: 'Edge Flange — Sheet Metal Bend',
    blurb: 'Pick an edge on a sheet-metal body and extrude a flange off it. Length sets how far the flange extends; angle sets the bend (90° = perpendicular). The bend allowance is computed from the part\'s K-factor + bend radius. Pre-select the sheet-metal body; choose an edge index for the picked edge.',
    fields: [
      { name: 'edgeIndex',  label: 'Edge index (1-based)', type: 'number', default: 1, min: 1, max: 1000, step: 1, hint: 'Visible-edge order; defaults walk in spine order.' },
      { name: 'length',     label: 'Flange length',  type: 'number', default: 25, unit: 'mm', min: 1,  max: 1000, step: 1 },
      { name: 'angleDeg',   label: 'Bend angle',     type: 'number', default: 90, unit: '°',  min: 0,  max: 180,  step: 1, hint: '0 = co-planar; 90 = perpendicular wall.' },
      { name: 'bendRadius', label: 'Bend radius (override)', type: 'number', default: 0,  unit: 'mm', min: 0,  max: 100,  step: 0.1, hint: '0 = use body\'s recorded bend radius.' },
    ],
  },
  'Flat Pattern': {
    title: 'Flat Pattern — Unfold to Manufacturing Layout',
    blurb: 'Unfold the picked sheet-metal part into its FLAT manufacturing layout (the developed shape sent to the laser cutter). Each bend is unrolled CO-PLANAR with the base, with the developed length = (flange length + bend allowance) via the part\'s K-factor. Result face count = 1 (base) + N (one per flange).',
    fields: [],
  },

  // ─── UX TIER 5b — Sheet Metal additions ───────────────────────────────
  //
  // Four sheet-metal ops that extend the Tier-5a foundation: Hem (fold an
  // edge over itself), Jog (Z-step offset in the sheet), Miter Flange
  // (multi-edge flange with mitered corners), Sketched Bend (bend along a
  // user-drawn line). Each one records its bend(s) on
  // body.metadata.sheetMetal.bends[] so Flat Pattern unfolds them too.
  'Hem': {
    title: 'Hem — Fold an Edge Over Itself',
    blurb: 'Pick a sheet-metal edge and fold it BACK onto the body. Closed = 180° flush; Open = ~165° leaving a small gap; Rolled = smooth curl; Teardrop = rolled with a pointed end. Used in fabrication to remove sharp edges (finger safety) and stiffen the part.',
    fields: [
      { name: 'edgeIndex', label: 'Edge index (1-based)', type: 'number', default: 1, min: 1, max: 1000, step: 1, hint: 'Visible-edge order; defaults walk spine order.' },
      { name: 'hemType', label: 'Hem type', type: 'enum',
        options: ['closed', 'open', 'rolled', 'teardrop'],
        default: 'closed', hint: 'closed=180° flush; open=~165°; rolled=270° curl; teardrop=225° pointed.' },
      { name: 'hemLength', label: 'Hem length', type: 'number', default: 6, unit: 'mm', min: 1, max: 200, step: 0.5, hint: 'How far the hem extends — typically 4× thickness.' },
    ],
  },
  'Jog': {
    title: 'Jog — Stepped Z-Fold in the Sheet',
    blurb: 'Create a stepped offset in the sheet (a Z-fold). The first bend lifts the sheet perpendicular by the jog offset; the second bend flattens it back parallel to the original. Two bends recorded — both with type=jog. Used for connector clearance / standoff between two parallel sheet sections.',
    fields: [
      { name: 'edgeIndex', label: 'Jog-line edge index', type: 'number', default: 1, min: 1, max: 1000, step: 1, hint: 'The edge along which the jog folds.' },
      { name: 'jogOffset', label: 'Jog offset', type: 'number', default: 10, unit: 'mm', min: 0.5, max: 500, step: 0.5, hint: 'Perpendicular step size between the two parallel sheet sections.' },
      { name: 'angleDeg', label: 'Jog angle', type: 'number', default: 90, unit: '°', min: 1, max: 179, step: 1, hint: '90 = perpendicular Z-step; smaller = shallower jog.' },
      { name: 'flangeLength', label: 'Top flange length', type: 'number', default: 20, unit: 'mm', min: 1, max: 500, step: 1, hint: 'Length of the offset top section.' },
    ],
  },
  'Miter Flange': {
    title: 'Miter Flange — Multi-Edge Flange with Mitered Corners',
    blurb: 'Sweep a flange along a sequence of connected edges. Adjacent flange segments meet at MITERED corners (45° bisector trim recorded in metadata for clean joints). The killer feature: a single op grows all four perimeter flanges of a tray / lid / pan in one move. Pick the edge sequence by index; the op walks them in order.',
    fields: [
      { name: 'edge1', label: 'Edge 1 (index)', type: 'number', default: 1,  min: 0, max: 1000, step: 1 },
      { name: 'edge2', label: 'Edge 2 (index)', type: 'number', default: 0,  min: 0, max: 1000, step: 1, hint: '0 = skip; otherwise visible-edge index.' },
      { name: 'edge3', label: 'Edge 3 (index)', type: 'number', default: 0,  min: 0, max: 1000, step: 1, hint: '0 = skip.' },
      { name: 'edge4', label: 'Edge 4 (index)', type: 'number', default: 0,  min: 0, max: 1000, step: 1, hint: '0 = skip.' },
      { name: 'length',   label: 'Flange length', type: 'number', default: 20, unit: 'mm', min: 1, max: 1000, step: 1 },
      { name: 'angleDeg', label: 'Bend angle',    type: 'number', default: 90, unit: '°',  min: 0, max: 180,  step: 1 },
      { name: 'position', label: 'Material position', type: 'enum',
        options: ['outside', 'inside'], default: 'outside',
        hint: 'outside = flange grows outward; inside = flange contained within material.' },
    ],
  },
  'Sketched Bend': {
    title: 'Sketched Bend — Bend Along a User-Drawn Line',
    blurb: 'The most general sheet-metal bend: pick an edge (the bend line) on a flat face and supply the bend angle. The sheet folds along the line by the angle. Position controls whether the bend allowance is laid above, below, or centered on the line (recorded for Flat Pattern).',
    fields: [
      { name: 'edgeIndex', label: 'Bend-line edge index', type: 'number', default: 1, min: 1, max: 1000, step: 1 },
      { name: 'angleDeg',  label: 'Bend angle',           type: 'number', default: 45, unit: '°', min: 0, max: 179, step: 1, hint: '0 = no bend; 90 = perpendicular fold.' },
      { name: 'flangeLength', label: 'Free-side length',  type: 'number', default: 30, unit: 'mm', min: 1, max: 1000, step: 1, hint: 'Length of the bent (free) side.' },
      { name: 'bendPosition', label: 'Bend position', type: 'enum',
        options: ['centered', 'above', 'below'], default: 'centered',
        hint: 'Where the bend allowance is laid relative to the bend line.' },
    ],
  },

  // ─── UX TIER 5c — Sheet Metal corner + sweep extensions ───────────────
  //
  // Two extension ops: Closed Corner closes the gap between two adjacent
  // edge-flanges (overlap | butt 45° miter | underlap); Sweep Flange sweeps
  // a flange profile along an arbitrary (curved / multi-segment) path —
  // the sheet-metal version of swept boss. Each one records to
  // body.metadata.sheetMetal — Closed Corner pushes onto corners[], Sweep
  // Flange pushes onto bends[] with type='sweepFlange'.
  'Closed Corner': {
    title: 'Closed Corner — Close the Gap at a Flange Corner',
    blurb: 'After two adjacent Edge Flanges, a small triangular gap remains at the shared corner. Closed Corner closes it. Overlap = flange A extends over flange B; Butt = both trim to a shared 45° miter; Underlap = flange B extends underneath flange A. Real fabrication operation — the killer follow-on to Edge Flange / Miter Flange.',
    fields: [
      { name: 'cornerType', label: 'Corner type', type: 'enum',
        options: ['overlap', 'butt', 'underlap'], default: 'butt',
        hint: 'overlap = A over B; butt = symmetric 45° miter; underlap = B under A.' },
      { name: 'edgeAGap', label: 'Edge A gap', type: 'number', default: 0, unit: 'mm', min: 0, max: 50, step: 0.1, hint: 'Gap along flange A\'s free edge before the patch begins (0 = flush).' },
      { name: 'edgeBGap', label: 'Edge B gap', type: 'number', default: 0, unit: 'mm', min: 0, max: 50, step: 0.1, hint: 'Gap along flange B\'s free edge before the patch begins (0 = flush).' },
    ],
  },
  'Sweep Flange': {
    title: 'Sweep Flange — Swept Flange Along a Path',
    blurb: 'Sweep a flange profile (thickness × profileWidth rectangle) along an arbitrary 3D path — straight, curved, or multi-segment. Unlike Edge Flange (one straight edge per call), Sweep Flange follows the whole path in one move. Records the flange as a bend with type=\'sweepFlange\' so Flat Pattern still walks it.',
    fields: [
      { name: 'profileWidth', label: 'Flange height', type: 'number', default: 15, unit: 'mm', min: 0.5, max: 500, step: 0.5, hint: 'How tall the swept lip is (perpendicular to the path).' },
      { name: 'pathX1', label: 'Path start X', type: 'number', default: 0,  unit: 'mm', step: 0.5 },
      { name: 'pathY1', label: 'Path start Y', type: 'number', default: 0,  unit: 'mm', step: 0.5 },
      { name: 'pathZ1', label: 'Path start Z', type: 'number', default: 0,  unit: 'mm', step: 0.5 },
      { name: 'pathX2', label: 'Path end X',   type: 'number', default: 50, unit: 'mm', step: 0.5 },
      { name: 'pathY2', label: 'Path end Y',   type: 'number', default: 0,  unit: 'mm', step: 0.5 },
      { name: 'pathZ2', label: 'Path end Z',   type: 'number', default: 0,  unit: 'mm', step: 0.5 },
      { name: 'kFactor', label: 'K-factor (override)', type: 'number', default: 0, min: 0, max: 1, step: 0.05, hint: '0 = use body\'s recorded K-factor.' },
    ],
  },

  // ─── UX TIER 6a — Weldments workbench foundation ──────────────────────
  //
  // Three foundational weldments ops with their param schemas. Structural
  // Member seeds the part + stamps the weldment metadata; Trim/Extend
  // joins members at a clean joint (butt or mitered); End Cap closes the
  // open end of a member.
  'Structural Member': {
    title: 'Structural Member — Weldments Foundation',
    blurb: 'Sweep a STANDARD ISO/ANSI profile (rect tube, square tube, round tube, angle, channel, I-beam) along a 3D path to create a structural member. The body is tagged as a weldment — profile / size / length travel with it so every downstream weldments op can identify it. The path is supplied either via the in-progress 3D sketch or by the start/end points below; the profile is built in the path-start frame.',
    fields: [
      { name: 'profile',  label: 'Profile family', type: 'enum',
        options: ['recttube', 'squaretube', 'roundtube', 'angle', 'channel', 'ibeam'],
        default: 'recttube', hint: 'ISO/ANSI standard profile family.' },
      { name: 'size',     label: 'Profile size',  type: 'string', default: '40x60x3',
        hint: 'Catalogue size label, e.g. 40x60x3 (rect tube), Ø48.3×3.6 (round), 50x50x5 (angle).' },
      { name: 'length',   label: 'Member length', type: 'number', default: 600, unit: 'mm', min: 10, max: 10000, step: 1,
        hint: 'Length along the path (when path start/end are not supplied).' },
      { name: 'startX',   label: 'Start X',       type: 'number', default: 0,   unit: 'mm', step: 1 },
      { name: 'startY',   label: 'Start Y',       type: 'number', default: 0,   unit: 'mm', step: 1 },
      { name: 'startZ',   label: 'Start Z',       type: 'number', default: 0,   unit: 'mm', step: 1 },
      { name: 'endX',     label: 'End X',         type: 'number', default: 0,   unit: 'mm', step: 1 },
      { name: 'endY',     label: 'End Y',         type: 'number', default: 0,   unit: 'mm', step: 1 },
      { name: 'endZ',     label: 'End Z',         type: 'number', default: 600, unit: 'mm', step: 1, hint: 'When (endX,endY,endZ) ≠ (startX,startY,startZ), the path overrides the length field.' },
    ],
  },
  'Trim/Extend Members': {
    title: 'Trim/Extend Members — Weldments Joint',
    blurb: 'Pick 2+ structural-member bodies and trim them at their joint. BUTT mode subtracts each successive member from the first (the first yields to the rest). MITERED mode subtracts a half-space tool from BOTH members at the joint bisector so they meet at a clean mitre. Real boolean trim — face count drops; bodies abut without overlap.',
    fields: [
      { name: 'mode', label: 'Trim mode', type: 'enum',
        options: ['butt', 'mitered'], default: 'mitered',
        hint: 'butt = first yields to the rest; mitered = both yield at the joint bisector.' },
    ],
  },
  'End Cap': {
    title: 'End Cap — Close an Open Member End',
    blurb: 'Pick a weldment member and close one of its open ends with a flat (or thick) cap. The cap is the bounding rectangle of the profile at the picked end, extruded by the cap thickness and fused onto the parent member. Face count rises by ~1 per cap.',
    fields: [
      { name: 'end',       label: 'Which end',  type: 'enum',
        options: ['start', 'end'], default: 'start',
        hint: 'start = the side where the path begins; end = the far side.' },
      { name: 'thickness', label: 'Cap thickness', type: 'number', default: 3, unit: 'mm', min: 0.5, max: 50, step: 0.5,
        hint: 'Cap prism thickness (flat cap = thin; thick cap = chunkier closure).' },
    ],
  },

  // ─── UX TIER 6b — Weldments additions ────────────────────────────────────
  //
  // Gusset + Weld Bead — reinforcement + welder-spec joint geometry on top
  // of the Tier-6a structural members. Both ops take TWO pre-selected
  // weldment-tagged members that share a joint and produce a NEW
  // weldment-tagged child body, while recording the gusset / weld id on
  // both parent members' metadata.weldment.gussets[] / welds[].
  'Gusset': {
    title: 'Gusset — Triangular Reinforcement Plate',
    blurb: 'Pre-select TWO structural members that share a joint endpoint. The gusset is a flat plate (triangular by default; 5-sided polygon optional) sitting in the joint plane, fillet-welded between the two members. Real welded-frame reinforcement: drastically stiffens the corner. Both members record the gusset id in their metadata.',
    fields: [
      { name: 'type',      label: 'Gusset shape',   type: 'enum',
        options: ['triangular', 'polygon'], default: 'triangular',
        hint: 'triangular = 3-sided plate (classic); polygon = 5-sided plate with chopped outer corners.' },
      { name: 'size',      label: 'Leg length',     type: 'number', default: 100, unit: 'mm', min: 10, max: 1000, step: 1,
        hint: 'Length of each gusset leg along the member tangent from the joint.' },
      { name: 'thickness', label: 'Plate thickness', type: 'number', default: 6, unit: 'mm', min: 1, max: 30, step: 0.5,
        hint: 'Gusset plate thickness; typical 6–10 mm for steel weldments.' },
      { name: 'position',  label: 'Plate position', type: 'enum',
        options: ['inner', 'outer'], default: 'inner',
        hint: 'inner = on the joint-bisector side (between the members); outer = opposite side.' },
    ],
  },
  'Weld Bead': {
    title: 'Weld Bead — Real Welder-Spec Joint',
    blurb: 'Pre-select TWO structural members that share a joint. The bead is a small solid (fillet triangle, square rectangle, V-groove triangle, or trapezoidal bevel) swept along the joint corner. Real welder cross-sections — fillet is the canonical right triangle, V-groove for butt welds. Both members record the weld id.',
    fields: [
      { name: 'type',   label: 'Weld type', type: 'enum',
        options: ['fillet', 'square', 'V', 'bevel'], default: 'fillet',
        hint: 'fillet = right triangle (most common); square = rectangle; V = V-groove; bevel = trapezoid.' },
      { name: 'size',   label: 'Leg size',  type: 'number', default: 6, unit: 'mm', min: 1, max: 30, step: 0.5,
        hint: 'Bead cross-section leg dimension; typical 5–10 mm for structural welds.' },
      { name: 'length', label: 'Bead run length', type: 'number', default: 0, unit: 'mm', min: 0, max: 5000, step: 1,
        hint: '0 = auto (min of member length, capped). Otherwise the explicit bead run length.' },
    ],
  },

  // ─── UX TIER 6c — Weldments Cut List ─────────────────────────────────────
  //
  // No-input schema — the Cut List op opens a modal that scans the registry
  // and renders the BOM. Carried here for introspection symmetry (every
  // ribbon tool has a schema row even when the field set is empty).
  'Cut List': {
    title: 'Cut List — Weldments BOM',
    blurb: 'Aggregate every weldment-tagged structural member in the scene by (profile, size, length). Opens the Cut List modal with one row per "cut N pieces of <profile>/<size> at <length> mm" item and Copy CSV / Copy TSV actions for the welder.',
    fields: [],
  },

  // ─── UX TIER 9 — Mold Tools workbench foundation ──────────────────────
  //
  // Three foundational mold-tools ops with their param schemas. Draft
  // Analysis colour-codes faces by draft angle vs the pull direction;
  // Parting Line traces the silhouette curve; Tooling Split partitions
  // the body into core + cavity halves along a planar parting surface.
  // Bodies are tagged via body.metadata.mold; faces carry mold.draft
  // SP-2 attributes so the analysis survives downstream ops.
  'Draft Analysis': {
    title: 'Draft Analysis — Per-face Pull-direction Classification',
    blurb: 'Pre-select a moldable body. Each face is classified by its OUTWARD normal vs the pull direction: positive (faces +pull) → green, negative (faces -pull) → red, vertical/undercut (within tolerance of perpendicular to pull) → yellow. Faces carry a `mold.draft` SP-2 attribute so the result survives downstream ops.',
    fields: [
      { name: 'pullX',       label: 'Pull X',           type: 'number', default: 0, step: 0.1, hint: 'Pull direction X component (world frame).' },
      { name: 'pullY',       label: 'Pull Y',           type: 'number', default: 0, step: 0.1, hint: 'Pull direction Y component.' },
      { name: 'pullZ',       label: 'Pull Z',           type: 'number', default: 1, step: 0.1, hint: 'Pull direction Z component (default +Z = open mold upward).' },
      { name: 'minDraftDeg', label: 'Min draft angle',  type: 'number', default: 3, unit: '°', min: 0, max: 45, step: 0.5,
        hint: 'Green / yellow cutoff. Faces with |angle| < this are flagged as vertical / undercut.' },
    ],
  },
  'Parting Line': {
    title: 'Parting Line — Silhouette Curve on the Body',
    blurb: 'Pre-select a moldable body (or run Draft Analysis first). For every edge of the body the two adjacent faces are checked: an edge lies on the parting line iff its faces have OPPOSITE draft signs (one +, one -), or one is vertical / undercut. Returns the parting curve as a list of edges in the body.',
    fields: [
      { name: 'pullX',       label: 'Pull X',           type: 'number', default: 0, step: 0.1 },
      { name: 'pullY',       label: 'Pull Y',           type: 'number', default: 0, step: 0.1 },
      { name: 'pullZ',       label: 'Pull Z',           type: 'number', default: 1, step: 0.1 },
      { name: 'minDraftDeg', label: 'Min draft angle',  type: 'number', default: 3, unit: '°', min: 0, max: 45, step: 0.5,
        hint: 'Cutoff inherited from Draft Analysis; faces below this are vertical / undercut.' },
    ],
  },
  'Tooling Split': {
    title: 'Tooling Split — Core + Cavity Mold Halves',
    blurb: 'Pre-select a moldable body. Builds a PLANAR parting surface perpendicular to the pull direction at the body centroid (configurable height via partingZ) and partitions the body into TWO halves: CORE (faces +pull) and CAVITY (opposite). Each piece is tagged with mold.half. Uses SP-5\'s partition op.',
    fields: [
      { name: 'pullX',       label: 'Pull X',           type: 'number', default: 0, step: 0.1 },
      { name: 'pullY',       label: 'Pull Y',           type: 'number', default: 0, step: 0.1 },
      { name: 'pullZ',       label: 'Pull Z',           type: 'number', default: 1, step: 0.1 },
      { name: 'partingZ',    label: 'Parting offset',   type: 'number', default: 0, unit: 'mm', step: 0.5,
        hint: 'Signed offset of the parting plane along pull from body centroid. 0 = centroid (SW default).' },
      { name: 'minDraftDeg', label: 'Min draft angle',  type: 'number', default: 3, unit: '°', min: 0, max: 45, step: 0.5 },
    ],
  },

  // ─── UX TIER 9b — Mold Tools focused additions ───────────────────────
  //
  // Two more SW Mold-Tools ops: Undercut Analysis (deeper than draft —
  // flags faces that would lock the part in the mold via face-normal +
  // shadow-ray test) + Shut-Off Surfaces (auto-close through-holes so
  // the part can be cavity-cut by Tooling Split).
  'Undercut Analysis': {
    title: 'Undercut Analysis — Stuck-Face Detection vs Pull',
    blurb: 'Pre-select a moldable body. For each face: sample the normal at the parametric centre; if n·pull < 0 (face -pull) AND a +pull ray from a point on the face hits another face of the body, the face is flagged as UNDERCUT (red — locked in the mold). Faces facing +pull cleanly are good (green); vertical / perpendicular faces are neutral (yellow). Each face gets a `mold.undercut` SP-2 boolean attribute.',
    fields: [
      { name: 'pullX',     label: 'Pull X',     type: 'number', default: 0, step: 0.1, hint: 'Pull direction X component (world frame).' },
      { name: 'pullY',     label: 'Pull Y',     type: 'number', default: 0, step: 0.1, hint: 'Pull direction Y component.' },
      { name: 'pullZ',     label: 'Pull Z',     type: 'number', default: 1, step: 0.1, hint: 'Pull direction Z component (default +Z = open mold upward).' },
      { name: 'threshold', label: 'Threshold',  type: 'number', default: 3, unit: '°', min: 0, max: 45, step: 0.5,
        hint: 'Faces within ±threshold of perpendicular to pull are neutral (yellow). Faces below pull a further test for shadowing.' },
    ],
  },
  'Shut-Off Surfaces': {
    title: 'Shut-Off Surfaces — Close Through-Holes for Cavity Cutting',
    blurb: 'Pre-select a moldable body. Detects closed loops of free edges (through-holes / open shells) and closes every loop ≤ `maxHoleDiameter` with an N-sided patch face via SP-8 autoFillMissingFaces. The result body is watertight — suitable for Tooling Split. Patches are tagged with `mold.shutOff` SP-2 attribute and reported via `metadata.mold.shutOff`.',
    fields: [
      { name: 'maxHoleDiameter', label: 'Max hole diameter', type: 'number', default: 50, unit: 'mm', min: 1, max: 1000, step: 1,
        hint: 'Skip free-edge loops with diameter greater than this. Default 50 mm covers typical cable-entry / vent holes; raise to fill larger openings.' },
      { name: 'tolerance',       label: 'Free-bound tol.',   type: 'number', default: 0.001, unit: 'mm', min: 0.0001, max: 1, step: 0.0001,
        hint: 'ShapeFix_FreeBounds close-tolerance — open-edge endpoints within this are unified into a closed wire.' },
    ],
  },

  // UX Tier 9c — proper ruled Parting Surface op. Extends the parting line
  // outward as a SHEET body that can drive Tooling Split's curved-partition
  // path (replacing the planar default).
  'Parting Surface': {
    title: 'Parting Surface — Ruled Sheet from Parting-Line Edges',
    blurb: 'Pre-select a moldable body (auto-runs Parting Line first if missing). For each parting-line edge, extrudes the edge perpendicular to the pull direction by `margin` mm on BOTH sides (total span = 2 × margin) — producing a ruled SHEET body of lateral strips. Set `extensionMode` to `planar` (default — flat extrusion), `tangent` (extend along surface tangent at the parting line), or `ruled` (single ruled strip between body outline and a bounding ring at margin distance). Result is a sheet body suitable as the `partingSurface` input to Tooling Split.',
    fields: [
      { name: 'pullX',         label: 'Pull X',          type: 'number', default: 0, step: 0.1, hint: 'Pull direction X component (world frame).' },
      { name: 'pullY',         label: 'Pull Y',          type: 'number', default: 0, step: 0.1, hint: 'Pull direction Y component.' },
      { name: 'pullZ',         label: 'Pull Z',          type: 'number', default: 1, step: 0.1, hint: 'Pull direction Z component (default +Z = open mold upward).' },
      { name: 'margin',        label: 'Margin',          type: 'number', default: 20, unit: 'mm', min: 1, max: 500, step: 1,
        hint: 'Half-width of the parting surface — the strip extends `margin` mm on each side of the parting line, totalling 2 × margin across.' },
      { name: 'extensionMode', label: 'Extension mode',  type: 'enum', default: 'planar',
        options: ['planar', 'tangent', 'ruled'],
        hint: 'planar = flat extrusion perpendicular to pull (SW default). tangent = along surface tangent at parting line. ruled = ruled surface between body outline and a planar bounding ring at margin distance.' },
    ],
  },
};

export function getSchemaForTool(toolName) {
  return TOOL_PARAM_SCHEMAS[toolName] ?? null;
}

/** Quick default-values object — handlers fall back to these if dialog is bypassed. */
export function defaultsForTool(toolName) {
  const schema = TOOL_PARAM_SCHEMAS[toolName];
  if (!schema) return {};
  const out = {};
  for (const f of schema.fields) out[f.name] = f.default;
  return out;
}

// ─── Tier-11b — Inline-sketch capability hint ──────────────────────────────
//
// NX-distinctive "sketch-inside-a-dialog" pattern. Tools listed below
// support entering an inline sketch session from inside their PropertyManager
// Dock instead of forcing the user to exit, create a sketch, then re-open
// the tool. The InlineSketchSession overlay in SwUxOverlays.jsx reads this
// set (via INLINE_SKETCH_CAPABLE) so it knows which dock headers should
// render a "Sketch Profile" hook button.
//
// This is a hint, not a new schema field type — the existing 'number' /
// 'enum' types remain unchanged. Adding a 'sketch-profile' synthetic field
// type would force every consumer (dock + floating dialog + planner) to
// special-case it, which is unnecessary: the inline session writes its
// committed profile to `window.__archdiscPlanParams[tool].profile` which
// the Extrude Boss handler ALREADY consumes (Path A, line 1539 of
// ToolExecutionEngine.js).
export const INLINE_SKETCH_CAPABLE = new Set([
  'Extrude Boss',
  'Extrude Cut',
  // UX Tier 11d — unified Extrude (boolean toggle replaces the Boss/Cut split).
  // The dock-inline-sketch session writes its committed profile to
  // window.__archdiscPlanParams['Extrude'].profile which the new handler
  // consumes the same way as the legacy Boss handler's Path A.
  'Extrude',
  'Revolve Boss',
  'Sweep Boss',
  'Loft Boss',
]);

// ─── UX TIER 3A — ADVANCED FEATURES ─────────────────────────────────────────
// Boundary Boss/Cut, Rib, Helix.
// All three are selection + dialog driven. The Boundary Boss accepts a list
// of profile-sketch references (via window.__archdiscBoundaryProfiles +
// __archdiscBoundaryGuides hooks); the Rib reads window.__archdiscRibLine +
// window.__archdiscSelectedBodies; the Helix reads explicit axis/dimension
// inputs from the dialog.

TOOL_PARAM_SCHEMAS['Boundary Boss'] = {
  title: 'Boundary Boss / Cut',
  blurb: 'Loft through N profile sketches + 0+ guide curves. Profiles supplied via __archdiscBoundaryProfiles (array of point arrays); guides via __archdiscBoundaryGuides. SetSmoothing(true) gives G1 tangency between sections. The `role` toggle is informational — Boundary CUT is achieved by a subsequent boolean against the parent body.',
  fields: [
    { name: 'smooth',      label: 'G1 tangency between sections', type: 'enum', default: 'yes', options: ['yes', 'no'], hint: 'SetSmoothing(true) — smooth loft' },
    { name: 'role',        label: 'Role',                          type: 'enum', default: 'boss', options: ['boss', 'cut'], hint: 'Cut variant achieved by boolean subtract against parent body' },
  ],
};

TOOL_PARAM_SCHEMAS['Rib'] = {
  title: 'Rib',
  blurb: 'Parametric thin wall between a sketched LINE and a parent body. The line is supplied via __archdiscRibLine = [{x,y,z}, {x,y,z}] in mm. The parent body is the currently-selected body. The rib block is built then intersected with the body so the rib only fills space inside the body (SW canonical rib pattern).',
  fields: [
    { name: 'thickness',     label: 'Thickness',         type: 'number', default: 3,  unit: 'mm', min: 0.1, max: 100, step: 0.5 },
    { name: 'extrudeHeight', label: 'Extrude height',    type: 'number', default: 20, unit: 'mm', min: 0.5, max: 1000, step: 1, hint: 'how far the rib extrudes along the sketch-plane normal' },
    { name: 'direction',     label: 'Direction',         type: 'enum',   default: 'normal', options: ['normal', 'parallel'], hint: 'normal = perpendicular to sketch plane; parallel = in-plane stiffener' },
  ],
};

TOOL_PARAM_SCHEMAS['Helix'] = {
  title: 'Helix',
  blurb: 'Real 3D helical CURVE (wire body). Constant pitch when pitchStart=pitchEnd; linear taper otherwise. Returns a kind=wire SpineBody whose polyline can drive Sweep Boss. Real helix math: arc length = revs · sqrt(pitch² + (π·D)²).',
  fields: [
    { name: 'diameter',     label: 'Diameter',     type: 'number', default: 20, unit: 'mm', min: 0.5,  max: 5000, step: 0.5 },
    { name: 'pitchStart',   label: 'Start pitch',  type: 'number', default: 4,  unit: 'mm/turn', min: 0.1, max: 1000, step: 0.1 },
    { name: 'pitchEnd',     label: 'End pitch',    type: 'number', default: 4,  unit: 'mm/turn', min: 0.1, max: 1000, step: 0.1, hint: 'set ≠ start pitch for a linearly-tapered (variable) helix' },
    { name: 'revolutions',  label: 'Revolutions',  type: 'number', default: 5,  unit: 'turns', min: 0.25, max: 200, step: 0.25 },
    { name: 'direction',    label: 'Direction',    type: 'enum',   default: 'ccw', options: ['ccw', 'cw'], hint: 'ccw = right-hand helix (standard screw thread); cw = left-hand' },
    { name: 'segmentsPerRev', label: 'Segments per revolution', type: 'number', default: 64, unit: '', min: 8, max: 512, step: 4, hint: 'polyline resolution; higher = smoother helix' },
  ],
};

// ─── UX TIER 4 (focused) — EXTRUDED / REVOLVED SURFACE ──────────────────────
// SW "Extruded Surface" + "Revolved Surface" — sheet-body variants of the
// SP-6 Extrude/Revolve Boss ops. Prism/revolve the WIRE (not a face); no
// caps; result kind='sheet'. Profile points are supplied either via the
// orchestration plan's `profile` param, the live sketch's getSolidProfile
// (auto-built from the active interactive sketch), or the dialog's depth/
// angle defaults (which fall back to a simple rectangle / arc profile).

TOOL_PARAM_SCHEMAS['Extruded Surface'] = {
  title: 'Extruded Surface',
  blurb: 'Sheet-body extrude — sweep the input wire\'s EDGES along a direction (no caps). Result kind=sheet. The profile may be open or closed; supply via active sketch, the orchestration plan\'s `profile` param, or rely on the rectangle-default fallback.',
  fields: [
    { name: 'depth',     label: 'Depth',     type: 'number', default: 40, unit: 'mm', min: 0.1, max: 5000, step: 1 },
    { name: 'dirX',      label: 'Direction X', type: 'number', default: 0,  unit: '',  min: -1, max: 1, step: 0.05, hint: 'unit vector; default (0,0,1) = +Z' },
    { name: 'dirY',      label: 'Direction Y', type: 'number', default: 0,  unit: '',  min: -1, max: 1, step: 0.05 },
    { name: 'dirZ',      label: 'Direction Z', type: 'number', default: 1,  unit: '',  min: -1, max: 1, step: 0.05 },
  ],
};

TOOL_PARAM_SCHEMAS['Revolved Surface'] = {
  title: 'Revolved Surface',
  blurb: 'Sheet-body revolve — sweep the input wire\'s EDGES around an axis (no caps). Result kind=sheet. Profile may be open or closed; axis is supplied as { origin: [x,y,z], direction: [dx,dy,dz] } via the dialog defaults below.',
  fields: [
    { name: 'angle',     label: 'Revolution angle', type: 'number', default: 360, unit: 'deg', min: 1, max: 360, step: 1 },
    { name: 'axisOriginX', label: 'Axis origin X', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
    { name: 'axisOriginY', label: 'Axis origin Y', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
    { name: 'axisOriginZ', label: 'Axis origin Z', type: 'number', default: 0, unit: 'mm', min: -1000, max: 1000, step: 1 },
    { name: 'axisDirX',  label: 'Axis direction X', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.05, hint: 'default (0,0,1) = +Z' },
    { name: 'axisDirY',  label: 'Axis direction Y', type: 'number', default: 0, unit: '', min: -1, max: 1, step: 0.05 },
    { name: 'axisDirZ',  label: 'Axis direction Z', type: 'number', default: 1, unit: '', min: -1, max: 1, step: 0.05 },
  ],
};

/** True iff the tool supports the NX-distinctive dialog-in-dialog sketch
 *  session. Consumers (the InlineSketchSession overlay) read this to
 *  decide whether to render a "Sketch Profile" hook button. */
export function isInlineSketchCapable(toolName) {
  return INLINE_SKETCH_CAPABLE.has(toolName);
}

// ─── UX TIER 10 — PARAMETRIC INFRASTRUCTURE ─────────────────────────────────
// Equation Manager: opens a full-page modal (EquationManager.jsx) where the
// user adds / edits / deletes global variables and expressions. Zero numeric
// inputs in the schema — the dialog itself is the table. The schema is here
// so the planner / orchestration layer can recognise the tool name and the
// handler is selection-independent.
TOOL_PARAM_SCHEMAS['Equation Manager'] = {
  title: 'Equation Manager — Global Variables',
  blurb: 'Open the Equation Manager modal. Define global variables (width, height, holeSpacing…), use them in sketch dimensions via the "=expr" syntax (e.g. =width/4), and watch downstream geometry reflow when a variable changes.',
  fields: [],
};
