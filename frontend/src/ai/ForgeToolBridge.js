/**
 * ForgeToolBridge — the contract between the local Archie model fleet
 * (~/archdisc-Models) and ArchDisc Forge's native kernel.
 *
 * Archie issues `<tool_call>{"name":"<id>","arguments":{...}}</tool_call>`
 * per its tool-call schema (see ~/archdisc-Models/prompts/archie_schema.md).
 * This bridge:
 *   1. Maintains the canonical list of tools — one entry per native
 *      capability, each with the schema fields Archie's LoRAs were
 *      trained on: `name`, `description`, `parameters`.
 *   2. Dispatches a parsed tool_call to the right `forge.*` native
 *      invocation through `window.forge` (Electron preload).
 *   3. Surfaces results in the Archie tool_response format so the
 *      Planner can read scene deltas and reason about next steps.
 *
 * Discipline taxonomy mirrors `~/archdisc-Models/adapters/archie/mech/`:
 *   sketch / part / assembly / simulate / manufacture / drawing.
 *
 * Tools are intentionally name-spaced per discipline so the
 * adapter loader can ship a discipline-scoped subset of the registry
 * in the system prompt (matching Studio's 8-discipline pattern).
 */

import { getForge } from '../kernel/forge/index.js';

// ===================================================================
//                              tool registry
// ===================================================================

/**
 * Every tool spec has:
 *   name         — globally unique id used in tool_call.name.
 *   discipline   — sketch | part | assembly | simulate | manufacture | drawing.
 *   description  — one-line natural language, surfaces in Archie's system prompt.
 *   parameters   — {key: {type, description, required?, default?}}.
 *   run          — async (args) => result. result is JSON-serialisable.
 *   produces     — symbolic kind of artefact (handle | mesh | report | gcode | svg).
 *
 * The `forge` argument to each `run` is the live `window.forge` proxy.
 */
function P(type, description, opts = {}) {
  return { type, description, required: !!opts.required, default: opts.default };
}

export const FORGE_TOOLS = [
  // ============================================================ SKETCH
  { name: 'sketch.create', discipline: 'sketch', produces: 'handle',
    description: 'Create an empty 2D sketch; returns the sketch handle.',
    parameters: {},
    run: (_args, forge) => ({ sketchId: forge.sketcher.createSketch() }) },

  { name: 'sketch.add-point', discipline: 'sketch', produces: 'handle',
    description: 'Add a point to a sketch. Returns the parameter id.',
    parameters: { sketchId: P('uint', 'sketch handle', { required: true }),
                  x: P('number', 'x coordinate', { required: true }),
                  y: P('number', 'y coordinate', { required: true }) },
    run: ({ sketchId, x, y }, forge) => ({ pointId: forge.sketcher.addPoint(sketchId, x, y) }) },

  { name: 'sketch.add-line', discipline: 'sketch', produces: 'handle',
    description: 'Connect two existing sketch points with a line.',
    parameters: { sketchId: P('uint', 'sketch handle', { required: true }),
                  p0: P('uint', 'first point id', { required: true }),
                  p1: P('uint', 'second point id', { required: true }) },
    run: ({ sketchId, p0, p1 }, forge) => ({ lineId: forge.sketcher.addLine(sketchId, p0, p1) }) },

  { name: 'sketch.add-circle', discipline: 'sketch', produces: 'handle',
    description: 'Add a circle centred at a point with given radius.',
    parameters: { sketchId: P('uint', 'sketch handle', { required: true }),
                  center: P('uint', 'centre point id', { required: true }),
                  radius: P('number', 'radius in mm', { required: true }) },
    run: ({ sketchId, center, radius }, forge) => ({ circleId: forge.sketcher.addCircle(sketchId, center, radius) }) },

  { name: 'sketch.add-constraint', discipline: 'sketch', produces: 'handle',
    description: 'Add a geometric/dimensional constraint to the sketch.',
    parameters: { sketchId: P('uint', 'sketch handle', { required: true }),
                  kind: P('enum',
                    'Coincident|Parallel|Perpendicular|Distance|Horizontal|Vertical|PointOnLine|PointOnCircle|Equal|Tangent',
                    { required: true }),
                  refs: P('array', 'entity ids the constraint applies to', { required: true }),
                  value: P('number', 'distance/angle value (Distance/Angle only)', { default: 0 }) },
    run: ({ sketchId, kind, refs, value }, forge) => {
      const kindId = forge.sketcher.kinds[kind] ?? Number(kind);
      return { constraintId: forge.sketcher.addConstraint(sketchId, kindId, refs, value) };
    } },

  { name: 'sketch.solve', discipline: 'sketch', produces: 'report',
    description: 'Run the planegcs solver on the sketch. Reports status, DOF, iterations.',
    parameters: { sketchId: P('uint', 'sketch handle', { required: true }) },
    run: ({ sketchId }, forge) => forge.sketcher.solve(sketchId) },

  // ============================================================ PART
  { name: 'part.make-box', discipline: 'part', produces: 'handle',
    description: 'Create an axis-aligned box body of size dx × dy × dz mm at the origin.',
    parameters: { dx: P('number', 'x extent in mm', { required: true }),
                  dy: P('number', 'y extent in mm', { required: true }),
                  dz: P('number', 'z extent in mm', { required: true }) },
    run: ({ dx, dy, dz }, forge) => ({ shape: forge.makeBox(dx, dy, dz) }) },

  { name: 'part.make-cylinder', discipline: 'part', produces: 'handle',
    description: 'Cylinder of given radius and height along +Z, centred on origin.',
    parameters: { radius: P('number', 'radius in mm', { required: true }),
                  height: P('number', 'height in mm', { required: true }) },
    run: ({ radius, height }, forge) => ({ shape: forge.makeCylinder(radius, height) }) },

  { name: 'part.make-sphere', discipline: 'part', produces: 'handle',
    description: 'Sphere of given radius centred on origin.',
    parameters: { radius: P('number', 'radius in mm', { required: true }) },
    run: ({ radius }, forge) => ({ shape: forge.makeSphere(radius) }) },

  { name: 'part.make-cone', discipline: 'part', produces: 'handle',
    description: 'Frustum of given lower and upper radii and height along +Z.',
    parameters: { r1: P('number', 'lower radius in mm', { required: true }),
                  r2: P('number', 'upper radius in mm', { required: true }),
                  h:  P('number', 'height in mm',       { required: true }) },
    run: ({ r1, r2, h }, forge) => ({ shape: forge.makeCone(r1, r2, h) }) },

  { name: 'part.make-torus', discipline: 'part', produces: 'handle',
    description: 'Torus with given major and minor radii, axis along +Z.',
    parameters: { major: P('number', 'major radius in mm', { required: true }),
                  minor: P('number', 'minor radius in mm', { required: true }) },
    run: ({ major, minor }, forge) => ({ shape: forge.makeTorus(major, minor) }) },

  { name: 'part.fuse', discipline: 'part', produces: 'handle',
    description: 'Boolean union of two shape handles.',
    parameters: { a: P('uint', 'first shape handle',  { required: true }),
                  b: P('uint', 'second shape handle', { required: true }) },
    run: ({ a, b }, forge) => ({ shape: forge.fuse(a, b) }) },

  { name: 'part.cut', discipline: 'part', produces: 'handle',
    description: 'Boolean subtract: a − b.',
    parameters: { a: P('uint', 'minuend shape',    { required: true }),
                  b: P('uint', 'subtrahend shape', { required: true }) },
    run: ({ a, b }, forge) => ({ shape: forge.cut(a, b) }) },

  { name: 'part.common', discipline: 'part', produces: 'handle',
    description: 'Boolean intersect: a ∩ b.',
    parameters: { a: P('uint', 'first shape',  { required: true }),
                  b: P('uint', 'second shape', { required: true }) },
    run: ({ a, b }, forge) => ({ shape: forge.common(a, b) }) },

  { name: 'part.translate', discipline: 'part', produces: 'handle',
    description: 'Translate a shape by (dx, dy, dz) mm and return a new handle.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  dx: P('number', '', { required: true }),
                  dy: P('number', '', { required: true }),
                  dz: P('number', '', { required: true }) },
    run: ({ shape, dx, dy, dz }, forge) => ({ shape: forge.translate(shape, dx, dy, dz) }) },

  { name: 'part.rotate', discipline: 'part', produces: 'handle',
    description: 'Rotate a shape around an axis through the origin by angle (radians).',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  ax: P('number', '', { required: true }),
                  ay: P('number', '', { required: true }),
                  az: P('number', '', { required: true }),
                  angle: P('number', 'angle in radians', { required: true }) },
    run: ({ shape, ax, ay, az, angle }, forge) => ({ shape: forge.rotate(shape, ax, ay, az, angle) }) },

  { name: 'part.mass-properties', discipline: 'part', produces: 'report',
    description: 'Volume + surface area + centre of mass for a body.',
    parameters: { shape: P('uint', 'shape handle', { required: true }) },
    run: ({ shape }, forge) => forge.massProps(shape) },

  { name: 'part.tessellate', discipline: 'part', produces: 'mesh',
    description: 'Generate a render-ready triangle mesh for a body.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  linearTol: P('number', 'mesh chord deflection in mm', { default: 0.1 }),
                  angularTol: P('number', 'angular tolerance in radians', { default: 0.5 }) },
    run: ({ shape, linearTol, angularTol }, forge) => {
      const m = forge.tessellate(shape, linearTol, angularTol);
      return { triangleCount: m.triangleCount, vertexCount: m.positions.length / 3 };
    } },

  // ============================================================ ASSEMBLY
  { name: 'assembly.add-instance', discipline: 'assembly', produces: 'handle',
    description: 'Place a shape into the assembly at a 4×4 transform.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  transform: P('array', '16-element row-major transform', { required: true }) },
    run: ({ shape, transform }, forge) => {
      const m = transform instanceof Float64Array ? transform : Float64Array.from(transform);
      return { instanceId: forge.addInstance(shape, m) };
    } },

  { name: 'assembly.add-mate', discipline: 'assembly', produces: 'handle',
    description: 'Add a mate constraint between two instances.',
    parameters: { kind: P('enum',
                    'Coincident|Concentric|Parallel|Perpendicular|Distance|Angle|Tangent|Fixed',
                    { required: true }),
                  instA: P('uint', 'first instance id', { required: true }),
                  topoA: P('uint', '0=origin|1=axis|2=face|3=secondary-axis', { default: 0 }),
                  instB: P('uint', 'second instance id', { required: true }),
                  topoB: P('uint', 'topology selector', { default: 0 }),
                  value: P('number', 'distance/angle value', { default: 0 }) },
    run: ({ kind, instA, topoA, instB, topoB, value }, forge) => {
      const kindId = forge.assembly.MateKind[kind] ?? Number(kind);
      return { mateId: forge.assembly.addMate(kindId, instA, topoA ?? 0, instB, topoB ?? 0, value ?? 0) };
    } },

  { name: 'assembly.solve', discipline: 'assembly', produces: 'report',
    description: 'Run the mate solver. Reports convergence, iteration count, residual.',
    parameters: {},
    run: (_args, forge) => forge.assembly.solve() },

  { name: 'assembly.set-fixed', discipline: 'assembly', produces: 'report',
    description: 'Pin/unpin an instance from the solver variable set.',
    parameters: { instance: P('uint', 'instance id', { required: true }),
                  fixed:    P('boolean', '', { required: true }) },
    run: ({ instance, fixed }, forge) => {
      forge.assembly.setFixed(instance, fixed);
      return { ok: true };
    } },

  { name: 'assembly.query-aabb', discipline: 'assembly', produces: 'report',
    description: 'Spatial query: list instance ids whose AABB intersects a world-space box.',
    parameters: { box: P('array', '[minX,minY,minZ,maxX,maxY,maxZ]', { required: true }) },
    run: ({ box }, forge) => {
      const a = box instanceof Float64Array ? box : Float64Array.from(box);
      const hits = forge.queryAABB(a);
      return { hitCount: hits.length, hits: Array.from(hits.slice(0, 256)) };
    } },

  // ============================================================ SIMULATE
  { name: 'simulate.fea-static', discipline: 'simulate', produces: 'report',
    description: 'Linear-static FEA on a shape. Returns tip deflection + max von Mises.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  material: P('object', '{E, nu, rho}', { required: true }),
                  loads: P('array', '[{nodeId, fx, fy, fz}, ...]', { default: [] }),
                  pressureLoads: P('array', '[{faceId, pressure}, ...]', { default: [] }),
                  bcs: P('array', '[{nodeId, fx, fy, fz}] pinned DOFs', { default: [] }),
                  meshSize: P('number', 'target element size in mm', { default: 5 }) },
    run: (args, forge) => {
      if (!forge.fea || !forge.fea.runStatic) {
        throw new Error('forge.fea not yet loaded — build the kernel with Forge-12');
      }
      return forge.fea.runStatic(args);
    } },

  { name: 'simulate.fea-modal', discipline: 'simulate', produces: 'report',
    description: 'Modal analysis. Returns the first N natural frequencies (Hz).',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  material: P('object', '{E, nu, rho}', { required: true }),
                  bcs: P('array', 'pinned-node BC list', { default: [] }),
                  modes: P('uint', 'number of modes', { default: 6 }),
                  meshSize: P('number', 'target element size in mm', { default: 5 }) },
    run: (args, forge) => {
      if (!forge.fea || !forge.fea.runModal) {
        throw new Error('forge.fea not yet loaded — build the kernel with Forge-12');
      }
      return forge.fea.runModal(args);
    } },

  { name: 'simulate.fea-dynamic', discipline: 'simulate', produces: 'report',
    description: 'Transient implicit Newmark-β dynamics. Returns tip-displacement history + envelope.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  material: P('object', '{E, nu, rho}', { required: true }),
                  loads: P('array', 'nodal load list', { default: [] }),
                  bcs: P('array', 'pinned-node BC list', { default: [] }),
                  tEnd: P('number', 'simulation duration in seconds', { required: true }),
                  dt: P('number', 'time step in seconds', { required: true }),
                  rayleighAlpha: P('number', 'mass-proportional damping', { default: 0 }),
                  rayleighBeta: P('number', 'stiffness-proportional damping', { default: 0 }),
                  meshSize: P('number', 'target element size in mm', { default: 5 }) },
    run: (args, forge) => {
      if (!forge.fea || !forge.fea.runDynamic) {
        throw new Error('forge.fea not yet loaded — build the kernel with Forge-12');
      }
      return forge.fea.runDynamic(args);
    } },

  // ============================================================ MANUFACTURE
  { name: 'manufacture.cam-profile', discipline: 'manufacture', produces: 'report',
    description: 'Generate a 2.5D contour-profile toolpath around a face.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  face: P('uint', 'face id (0 = first +Z planar face)', { default: 0 }),
                  tool: P('object', '{name, diameter, flutes, type}', { required: true }),
                  cutParams: P('object', '{feedXY, feedZ, spindleRPM, stepdown}', { required: true }),
                  zTop: P('number', 'top of cut', { required: true }),
                  zBottom: P('number', 'bottom of cut', { required: true }) },
    run: (args, forge) => {
      if (!forge.cam || !forge.cam.profile) throw new Error('forge.cam not yet loaded — Forge-13');
      return forge.cam.profile(args);
    } },

  { name: 'manufacture.cam-pocket', discipline: 'manufacture', produces: 'report',
    description: '2.5D pocketing toolpath with zigzag fill.',
    parameters: { shape: P('uint', '', { required: true }),
                  face: P('uint', '', { default: 0 }),
                  tool: P('object', '', { required: true }),
                  cutParams: P('object', '', { required: true }),
                  zTop: P('number', '', { required: true }),
                  zBottom: P('number', '', { required: true }) },
    run: (args, forge) => {
      if (!forge.cam || !forge.cam.pocket) throw new Error('forge.cam not yet loaded — Forge-13');
      return forge.cam.pocket(args);
    } },

  { name: 'manufacture.cam-drill', discipline: 'manufacture', produces: 'report',
    description: 'Drill cycle through a list of hole centres.',
    parameters: { shape: P('uint', '', { required: true }),
                  holes: P('array', '[[x,y,z], ...]', { required: true }),
                  bit: P('object', 'drill bit spec', { required: true }),
                  cutParams: P('object', '', { required: true }),
                  zTop: P('number', '', { required: true }),
                  zBottom: P('number', '', { required: true }),
                  peck: P('boolean', 'use peck cycle', { default: true }) },
    run: (args, forge) => {
      if (!forge.cam || !forge.cam.drill) throw new Error('forge.cam not yet loaded — Forge-13');
      return forge.cam.drill(args);
    } },

  { name: 'manufacture.gcode', discipline: 'manufacture', produces: 'gcode',
    description: 'Post-process a toolpath into G-code for a CNC dialect.',
    parameters: { toolpath: P('object', 'toolpath handle/spec', { required: true }),
                  dialect: P('enum', 'Fanuc|Haas|LinuxCNC|Grbl', { default: 'Fanuc' }),
                  safeZ: P('number', 'rapid clearance in mm', { default: 5 }) },
    run: (args, forge) => {
      if (!forge.cam || !forge.cam.gcode) throw new Error('forge.cam not yet loaded — Forge-13');
      return forge.cam.gcode(args);
    } },

  // ============================================================ DRAWING
  { name: 'drawing.project', discipline: 'drawing', produces: 'report',
    description: 'HLR projection of a shape to 2D polylines for a drawing view.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  view: P('enum', 'front|top|right|iso|<dx,dy,dz>', { default: 'front' }) },
    run: ({ shape, view }, forge) => {
      const direction = Array.isArray(view) || view instanceof Float64Array
        ? (view instanceof Float64Array ? view : Float64Array.from(view))
        : view;
      const r = forge.drawings.projectShape(shape, direction);
      return { visibleCount: r.visibleCount, hiddenCount: r.hiddenCount, outlineCount: r.outlineCount };
    } },

  // ============================================================ ASSETS
  // Parametric asset builders — capability-roadmap pillar 1 (blockout →
  // detailed). Each composes its features in DETERMINISTIC kernel code
  // (one run() → one fused/cut final handle), so Archie emits ONE tool
  // call and gets a correct, clean, single-body part — instead of a
  // stochastic pile of primitives. Conventions: box corner-at-origin
  // [0,d]; cylinder radial-centre origin, z∈[0,h]; cut(a,b)=a−b; through-
  // cutters overhang ±2 mm. All dims mm.
  { name: 'asset.make-bored-plate', discipline: 'part', produces: 'handle',
    description: 'Rectangular plate with a centred through-bore.',
    parameters: { dx: P('number', 'width mm', { default: 120 }), dy: P('number', 'depth mm', { default: 80 }),
                  dz: P('number', 'thickness mm', { default: 14 }), bore: P('number', 'bore diameter mm', { default: 25 }) },
    run: (a, forge) => {
      const dx = a.dx || 120, dy = a.dy || 80, dz = a.dz || 14, bore = a.bore || 25;
      let plate = forge.makeBox(dx, dy, dz);
      let tool = forge.makeCylinder(bore / 2, dz + 4);
      tool = forge.translate(tool, dx / 2, dy / 2, -2);
      return { shape: forge.cut(plate, tool) };
    } },
  { name: 'asset.make-l-bracket', discipline: 'part', produces: 'handle',
    description: 'L-bracket: foot + perpendicular wall fused into an L, with two bolt holes in the foot.',
    parameters: { len: P('number', 'length mm', { default: 60 }), width: P('number', 'foot width mm', { default: 40 }),
                  thick: P('number', 'wall thickness mm', { default: 6 }), wall: P('number', 'upstand height mm', { default: 50 }),
                  hole: P('number', 'hole diameter mm', { default: 8 }) },
    run: (a, forge) => {
      const L = a.len || 60, W = a.width || 40, t = a.thick || 6, H = a.wall || 50, hd = (a.hole || 8) / 2;
      let foot = forge.makeBox(L, W, t);
      let wall = forge.makeBox(L, t, H);              // rises at the y=0 edge
      let body = forge.fuse(foot, wall);
      for (const hx of [L * 0.5 - L * 0.22, L * 0.5 + L * 0.22]) {
        let h = forge.makeCylinder(hd, t + 4);
        h = forge.translate(h, hx, W * 0.6, -2);
        body = forge.cut(body, h);
      }
      return { shape: body };
    } },
  { name: 'asset.make-flange', discipline: 'part', produces: 'handle',
    description: 'Round flange: disc + centre bore + N bolt holes on a bolt circle.',
    parameters: { od: P('number', 'outer diameter mm', { default: 80 }), thick: P('number', 'thickness mm', { default: 10 }),
                  bore: P('number', 'centre bore diameter mm', { default: 25 }), bolts: P('uint', 'bolt count', { default: 6 }),
                  bolt_d: P('number', 'bolt hole diameter mm', { default: 8 }), bcd: P('number', 'bolt circle diameter mm', { default: 60 }) },
    run: (a, forge) => {
      const R = (a.od || 80) / 2, t = a.thick || 10, br = (a.bore || 25) / 2, n = a.bolts || 6, bhr = (a.bolt_d || 8) / 2, bcr = (a.bcd || 60) / 2;
      let disc = forge.makeCylinder(R, t);
      let cb = forge.makeCylinder(br, t + 4); cb = forge.translate(cb, 0, 0, -2); disc = forge.cut(disc, cb);
      for (let i = 0; i < n; i++) {
        const ang = 2 * Math.PI * i / n;
        let h = forge.makeCylinder(bhr, t + 4);
        h = forge.translate(h, bcr * Math.cos(ang), bcr * Math.sin(ang), -2);
        disc = forge.cut(disc, h);
      }
      return { shape: disc };
    } },
  { name: 'asset.make-stepped-shaft', discipline: 'part', produces: 'handle',
    description: 'Two-diameter shaft: a large section with a smaller coaxial section on top, fused.',
    parameters: { d1: P('number', 'lower diameter mm', { default: 40 }), h1: P('number', 'lower length mm', { default: 60 }),
                  d2: P('number', 'upper diameter mm', { default: 24 }), h2: P('number', 'upper length mm', { default: 40 }) },
    run: (a, forge) => {
      const d1 = a.d1 || 40, h1 = a.h1 || 60, d2 = a.d2 || 24, h2 = a.h2 || 40;
      let big = forge.makeCylinder(d1 / 2, h1);
      let small = forge.makeCylinder(d2 / 2, h2);
      small = forge.translate(small, 0, 0, h1);
      return { shape: forge.fuse(big, small) };
    } },
  { name: 'asset.make-tube', discipline: 'part', produces: 'handle',
    description: 'Hollow tube / pipe: outer cylinder minus a coaxial bore.',
    parameters: { od: P('number', 'outer diameter mm', { default: 50 }), wall: P('number', 'wall thickness mm', { default: 4 }),
                  len: P('number', 'length mm', { default: 80 }) },
    run: (a, forge) => {
      const R = (a.od || 50) / 2, w = a.wall || 4, L = a.len || 80;
      let outer = forge.makeCylinder(R, L);
      let bore = forge.makeCylinder(R - w, L + 4); bore = forge.translate(bore, 0, 0, -2);
      return { shape: forge.cut(outer, bore) };
    } },
  { name: 'asset.make-gusset-bracket', discipline: 'part', produces: 'handle',
    description: 'Mounting bracket: base plate + vertical web + a triangular-ish gusset rib, with holes in the base.',
    parameters: { len: P('number', 'length mm', { default: 80 }), base_w: P('number', 'base width mm', { default: 60 }),
                  wall: P('number', 'web height mm', { default: 70 }), thick: P('number', 'thickness mm', { default: 8 }),
                  hole: P('number', 'hole diameter mm', { default: 9 }) },
    run: (a, forge) => {
      const L = a.len || 80, W = a.base_w || 60, H = a.wall || 70, t = a.thick || 8, hd = (a.hole || 9) / 2;
      let base = forge.makeBox(L, W, t);
      let web = forge.makeBox(L, t, H);
      let body = forge.fuse(base, web);
      // gusset rib down the centre, between web and base (a stepped box brace)
      let rib = forge.makeBox(t, W * 0.5, H * 0.5);
      rib = forge.translate(rib, L / 2 - t / 2, t, t);
      body = forge.fuse(body, rib);
      for (const hx of [L * 0.28, L * 0.72]) {
        let h = forge.makeCylinder(hd, t + 4);
        h = forge.translate(h, hx, W * 0.62, -2);
        body = forge.cut(body, h);
      }
      return { shape: body };
    } },
];

// ===================================================================
//                          dispatch + validation
// ===================================================================

const BY_NAME = new Map(FORGE_TOOLS.map((t) => [t.name, t]));

/** Discipline → list of tool specs (for the Archie system-prompt slice). */
export function toolsForDiscipline(d) {
  return FORGE_TOOLS.filter((t) => t.discipline === d);
}

export function getToolSpec(name) { return BY_NAME.get(name) || null; }

/** Validate that an Archie tool_call's arguments match the spec. */
export function validateArguments(spec, args = {}) {
  if (!spec) return { ok: false, error: 'unknown tool' };
  for (const [k, p] of Object.entries(spec.parameters)) {
    if (p.required && (args[k] === undefined || args[k] === null)) {
      return { ok: false, error: `missing required arg '${k}'` };
    }
  }
  return { ok: true };
}

/**
 * Dispatch a parsed Archie tool_call. Returns the tool_response payload
 * (already JSON-serialisable). On failure, returns `{ ok: false, error }`
 * so the model can recover on the next turn (the platform's hard-
 * negative-with-correction pattern relies on this shape).
 */
export async function dispatchToolCall({ name, arguments: args }, opts = {}) {
  const spec = BY_NAME.get(name);
  if (!spec) return { ok: false, tool: name, args, error: `unknown tool id '${name}'` };
  const val = validateArguments(spec, args);
  if (!val.ok) return { ok: false, tool: name, args, error: val.error };
  const forge = opts.forge || getForge();
  try {
    const result = await Promise.resolve(spec.run(args, forge));
    return { ok: true, tool: name, args, produces: spec.produces, result };
  } catch (e) {
    return { ok: false, tool: name, args, error: e.message || String(e) };
  }
}

/**
 * Build the JSON `<tools>` array Archie's system prompt expects for a
 * given discipline. Strips the `run` function — the model only sees
 * names + descriptions + parameter shapes.
 */
export function systemPromptTools(discipline) {
  const tools = discipline ? toolsForDiscipline(discipline) : FORGE_TOOLS;
  return tools.map(({ name, description, parameters }) => {
    const params = {};
    for (const [k, p] of Object.entries(parameters)) {
      params[k] = { type: p.type, description: p.description, required: p.required, default: p.default };
    }
    return { name, description, parameters: params };
  });
}
