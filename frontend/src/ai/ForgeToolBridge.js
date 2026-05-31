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
