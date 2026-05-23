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

  // ─── SOLID PRIMITIVES ────────────────────────────────────────────────────
  'Box': {
    title: 'Box — Solid Primitive',
    blurb: 'Create an axis-aligned box. Defaults: 40×40×40 mm.',
    fields: [
      { name: 'dx', label: 'Width (X)',  type: 'number', default: 40, unit: 'mm', min: 0.1, max: 1000, step: 1 },
      { name: 'dy', label: 'Depth (Y)',  type: 'number', default: 40, unit: 'mm', min: 0.1, max: 1000, step: 1 },
      { name: 'dz', label: 'Height (Z)', type: 'number', default: 40, unit: 'mm', min: 0.1, max: 1000, step: 1 },
    ],
  },

  'Cylinder': {
    title: 'Cylinder — Solid Primitive',
    blurb: 'Create a cylinder along +Z. Defaults: r=20 mm, h=40 mm.',
    fields: [
      { name: 'radius', label: 'Radius', type: 'number', default: 20, unit: 'mm', min: 0.1, max: 1000, step: 1 },
      { name: 'height', label: 'Height', type: 'number', default: 40, unit: 'mm', min: 0.1, max: 1000, step: 1 },
    ],
  },

  'Sphere': {
    title: 'Sphere — Solid Primitive',
    blurb: 'Create a sphere centred at the origin. Default: r=25 mm.',
    fields: [
      { name: 'radius', label: 'Radius', type: 'number', default: 25, unit: 'mm', min: 0.1, max: 1000, step: 1 },
    ],
  },

  'Cone': {
    title: 'Cone — Solid Primitive',
    blurb: 'Create a truncated cone along +Z. Defaults: r1=25 mm, r2=8 mm, h=45 mm.',
    fields: [
      { name: 'radius1', label: 'Base radius (r1)', type: 'number', default: 25, unit: 'mm', min: 0,   max: 1000, step: 1 },
      { name: 'radius2', label: 'Top radius (r2)',  type: 'number', default: 8,  unit: 'mm', min: 0,   max: 1000, step: 1, hint: '0 = sharp apex' },
      { name: 'height',  label: 'Height',           type: 'number', default: 45, unit: 'mm', min: 0.1, max: 1000, step: 1 },
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
  'Revolve Boss': {
    title: 'Revolve Boss — Inputs',
    blurb: 'Revolve a (radius,height) profile 360°. Defaults: stepped shaft.',
    fields: [
      { name: 'revolveSegs', label: 'Revolution segments', type: 'number', default: 64, unit: '', min: 8, max: 256, step: 8 },
    ],
  },
  'Linear Pattern': {
    title: 'Linear Pattern — Inputs',
    blurb: 'N copies of a seed body along an axis. Defaults: 4× Ø6×15 mm @ 20 mm.',
    fields: [
      { name: 'count',      label: 'Count',       type: 'number', default: 4,  unit: '',  min: 1, max: 200, step: 1 },
      { name: 'spacing',    label: 'Spacing',     type: 'number', default: 20, unit: 'mm', min: 0.1, max: 5000, step: 1 },
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
