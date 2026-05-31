/**
 * Tool documentation registry for the F1 help drawer. Each entry is a
 * compact engineering blurb the user can read mid-task without losing
 * the active tool. Covers the 25 highest-traffic tools; unknown tools
 * fall back to the generic help body.
 *
 * Schema: { summary: string, parameters?: [{name, desc}], tips?: [string] }
 */

export const TOOL_DOCS = {
  // ─── Primitives ────────────────────────────────────────────────────
  'Box': {
    summary: 'Creates a rectangular solid primitive aligned to the world axes.',
    parameters: [
      { name: 'Width (X)',  desc: 'mm along the global X axis' },
      { name: 'Depth (Y)',  desc: 'mm along the global Y axis' },
      { name: 'Height (Z)', desc: 'mm along the global Z axis' },
    ],
    tips: [
      'Box is the most common starting primitive for housings and base plates.',
      'For thin-walled parts (sheet, shell) start with Box then apply Shell.',
    ],
  },
  'Cylinder': {
    summary: 'Creates a right-circular cylinder primitive along Z.',
    parameters: [
      { name: 'Radius', desc: 'mm radius — measured from the axis' },
      { name: 'Height', desc: 'mm height along Z' },
    ],
    tips: [
      'Use small radii (≤2 mm) for ejector pins, fasteners, dowel pins.',
      'Bore-then-subtract is the dominant pattern for holes — start with the host body, draw a Cylinder, then Subtract.',
    ],
  },
  'Sphere': {
    summary: 'Creates a sphere primitive centred at the origin.',
    parameters: [{ name: 'Radius', desc: 'mm' }],
  },
  'Cone': {
    summary: 'Creates a right-circular cone or truncated cone.',
    parameters: [
      { name: 'Bottom radius', desc: 'mm — set equal to top for a cylinder' },
      { name: 'Top radius',    desc: 'mm — set to 0 for a true cone' },
      { name: 'Height',         desc: 'mm along the axis' },
    ],
  },
  'Torus': {
    summary: 'Creates a torus (donut) primitive.',
    parameters: [
      { name: 'Major radius', desc: 'mm — centre-of-tube to centre-of-torus' },
      { name: 'Minor radius', desc: 'mm — tube radius' },
    ],
  },

  // ─── Sketch ────────────────────────────────────────────────────────
  'Line': {
    summary: 'Draws a sketch line between two clicks.',
    tips: ['Hold Shift to constrain to horizontal/vertical/45°.'],
  },
  'Circle': {
    summary: 'Draws a circle by centre + radius.',
    parameters: [{ name: 'Radius', desc: 'mm' }],
  },
  'Rectangle': {
    summary: 'Draws a corner-to-corner rectangle.',
    tips: ['For a centred rectangle use Center Rectangle.'],
  },
  'Polygon': {
    summary: 'Draws a regular N-sided polygon.',
    parameters: [
      { name: 'Sides',   desc: 'integer ≥ 3' },
      { name: 'Radius',  desc: 'mm to vertex or to midpoint of side' },
    ],
  },
  'Dimension': {
    summary: 'Adds a driving dimension between two sketch entities.',
    tips: ['Use parametric expressions: type =myVar to drive from the Equation Manager.'],
  },

  // ─── Features ──────────────────────────────────────────────────────
  'Extrude Boss': {
    summary: 'Extrudes the active sketch into a solid.',
    parameters: [
      { name: 'Depth',     desc: 'mm extrusion distance' },
      { name: 'Direction', desc: 'normal of sketch plane (forward / backward / both)' },
      { name: 'Draft',     desc: 'optional degrees of draft per side' },
    ],
    tips: [
      'For a through-cut, use the negated direction and set Depth slightly larger than the host body.',
      'For drafted ribs and bosses, a 1–3° draft is typical for injection-mould tooling.',
    ],
  },
  'Revolve Boss': {
    summary: 'Revolves the active sketch around an axis to form a solid of revolution.',
    parameters: [
      { name: 'Axis',  desc: 'pick a sketch line or default to the Y axis' },
      { name: 'Angle', desc: 'degrees (0–360)' },
    ],
  },
  'Sweep': {
    summary: 'Sweeps a profile along a path curve.',
    tips: ['Path must be tangent-continuous (G1) at every join for a clean sweep.'],
  },
  'Loft': {
    summary: 'Lofts between two or more cross-section sketches.',
    tips: ['Maintain matching vertex count across cross-sections to avoid twist.'],
  },
  'Fillet': {
    summary: 'Rounds selected edges with a constant-radius blend.',
    parameters: [
      { name: 'Radius', desc: 'mm fillet radius (must be < min adjacent edge length / 2)' },
    ],
    tips: [
      'Pick edges first, then apply Fillet — the radius applies to every selection.',
      'For a smooth chain blend across multiple edges, set Continuity to G2.',
    ],
  },
  'Chamfer': {
    summary: 'Cuts a flat bevel along selected edges.',
    parameters: [
      { name: 'Distance', desc: 'mm from edge along each face' },
      { name: 'Angle',     desc: 'optional asymmetric chamfer angle' },
    ],
  },
  'Shell': {
    summary: 'Converts a solid into a thin-walled hollow shell.',
    parameters: [
      { name: 'Thickness',      desc: 'mm wall thickness' },
      { name: 'Faces to remove', desc: 'optional pick of open-out faces' },
    ],
  },
  'Mirror Feature': {
    summary: 'Mirrors selected features about a plane.',
    parameters: [{ name: 'Plane', desc: 'pick a planar face or one of XY/YZ/ZX' }],
  },
  'Linear Pattern': {
    summary: 'Repeats selected features along a linear direction.',
    parameters: [
      { name: 'Direction', desc: 'pick a linear edge or a global axis' },
      { name: 'Spacing',   desc: 'mm between instances' },
      { name: 'Count',     desc: 'number of instances including the source' },
    ],
  },
  'Circular Pattern': {
    summary: 'Repeats selected features around an axis.',
    parameters: [
      { name: 'Axis',  desc: 'pick a cylindrical face or a global axis' },
      { name: 'Count', desc: 'number of instances around the full circle' },
      { name: 'Angle', desc: 'degrees swept (360 by default)' },
    ],
  },
  'Hole Wizard': {
    summary: 'Adds a parametric drilled / tapped hole feature.',
    parameters: [
      { name: 'Standard', desc: 'ANSI Inch / ANSI Metric / ISO / JIS / DIN' },
      { name: 'Type',     desc: 'Clearance / Tapped / Counterbore / Countersink' },
      { name: 'Size',     desc: 'thread or pin nominal' },
    ],
  },

  // ─── File / Publishing ─────────────────────────────────────────────
  'Save Snapshot': {
    summary: 'Saves the entire project (history + bodies + equations) as a .archdisc.json file.',
    tips: [
      'Snapshots survive across reloads via IndexedDB persistence.',
      'Use Export Project Bundle for a vendor-ready ZIP of per-component STEPs.',
    ],
  },
  'Load Snapshot': {
    summary: 'Restores a previously saved .archdisc.json project file.',
  },
  'Export Project Bundle': {
    summary: 'Packages every body in the scene as its own STEP file plus a composed assembly.step and manifest.json, all zipped for a clean vendor hand-off.',
  },
  'Export 3MF': {
    summary: '3D Manufacturing Format — modern replacement for STL with named bodies, mm units, and slicer-native compatibility (PrusaSlicer, Cura, Bambu Studio).',
  },
  'Export BOM (CSV)': {
    summary: 'Exports a per-body Bill of Materials with material, density, volume, mass, and bounding box. Imports directly into Excel.',
  },
};

export default TOOL_DOCS;
