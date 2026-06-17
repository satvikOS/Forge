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

// Round ALL edges of a finished asset body so machined parts read as
// manufactured (broken edges), not raw boolean blocks. Fillets every edge
// (forge.edgeCount → forge.filletEdges, both flat on the kernel bridge) with a
// small radius; OCCT can throw on contradictory edge sets, so we fall back to
// the un-filleted shape rather than fail the build.
function roundEdges(shape, forge, radius) {
  try {
    // Edge count + fillet live on the namespaced kernel surface
    // (forge.direct.edgeCount / forge.part.filletEdges) — NOT flat. The
    // old flat probe silently no-op'd, so asset edges shipped as raw
    // boolean blocks. Edge ids are 0-based (see RealVariableFilletPanel).
    const edgeCount  = forge?.direct?.edgeCount;
    const filletEdges = forge?.part?.filletEdges;
    if (typeof edgeCount !== 'function' || typeof filletEdges !== 'function') return shape;
    const n = edgeCount(shape);
    if (!n) return shape;
    // Cap the all-edge fillet: OCCT BRepFilletAPI on a dense edge set
    // (bolt-hole circles, gear teeth) can self-intersect and churn for
    // minutes. Above the cap, leave edges crisp rather than risk a hang —
    // simple parts (≤ cap edges) still read as broken-edge / manufactured.
    const EDGE_CAP = 16;
    if (n > EDGE_CAP) return shape;
    const ids = Array.from({ length: n }, (_, i) => i);
    const r = filletEdges(shape, ids, radius);
    return (typeof r === 'number' && r > 0) ? r : shape;
  } catch (_) { return shape; }
}

// Build a closed planar (XY, z=0) profile sketch from a [[x,y], …] point
// list and return the sketch handle the part-feature ops consume. One
// tool call → one profile → one feature, matching the asset-builder
// philosophy (Archie never juggles sketch handles across turns).
function buildProfileSketch(forge, points, { closed = true } = {}) {
  const sk = forge && forge.sketcher;
  if (!sk || typeof sk.createSketch !== 'function') throw new Error('forge.sketcher unavailable');
  if (!Array.isArray(points) || points.length < 2) throw new Error('profile needs ≥2 points');
  const h = sk.createSketch();
  const ids = points.map((p) => sk.addPoint(h, +p[0] || 0, +p[1] || 0));
  for (let i = 0; i < ids.length - 1; i++) sk.addLine(h, ids[i], ids[i + 1]);
  if (closed) sk.addLine(h, ids[ids.length - 1], ids[0]);
  return h;
}

const DEG = (d) => (Number(d) || 0) * Math.PI / 180;

// True hexagonal prism (across-flats = af) via the intersection of three boxes
// rotated 60° — a real hex, not a round approximation. Centred on origin, z∈[0,h].
function hexPrism(forge, af, h) {
  const L = af * 2.4;
  const mk = (ang) => { let b = forge.makeBox(L, af, h); b = forge.translate(b, -L / 2, -af / 2, 0); return ang ? forge.rotate(b, 0, 0, 1, ang) : b; };
  let s = mk(0);
  s = forge.common(s, mk(Math.PI / 3));
  s = forge.common(s, mk(2 * Math.PI / 3));
  return s;
}

// ===================================================================
//   CONTEXT / PATTERN verb helpers (the build123d-style implicit-part API)
// ===================================================================
// The measured dominant defect (ladder_probe) is the model emitting wrong /
// missing fuse/cut HANDLE IDS → disconnected solids. The structural fix is to
// remove handles from the model's surface entirely: a per-sequence `ctx.current`
// holds the implicit "current part", and verbs MUTATE it. The model only ever
// names a primitive + dims + an optional `at` — never a handle. This mirrors
// build123d's implicit current-part + Mode (ADD/SUBTRACT/INTERSECT) + Locations,
// which makes the disconnected-solid failure mode impossible by construction.

// Build one of the four supported primitives from a {primitive, ...dims} arg
// bag, optionally translated to an `at:[x,y,z]` anchor. `bump` overhangs a
// cutter so through-features clear (the corpus convention: +bump on the swept
// dimension, then drop by bump/2 so it pokes out both ends). Returns a handle.
//   box      → dx,dy,dz       (corner-at-origin, like makeBox)
//   cylinder → diameter|radius, depth|height|length
//   cone     → r1,r2,h  (or diameter1/diameter2/depth aliases)
//   sphere   → diameter|radius
function buildPrimitive(forge, a, { bump = 0 } = {}) {
  const prim = String(a.primitive || a.prim || 'box').toLowerCase();
  const num = (...keys) => { for (const k of keys) if (typeof a[k] === 'number') return a[k]; return undefined; };
  let h;
  if (prim === 'box') {
    const dx = num('dx', 'width', 'w') || 10;
    const dy = num('dy', 'depth', 'd') || 10;
    const dz = num('dz', 'height', 'h', 'thickness', 't') || 10;
    h = forge.makeBox(dx, dy, dz + (bump ? bump : 0));
    if (bump) h = forge.translate(h, 0, 0, -bump / 2);
  } else if (prim === 'cylinder' || prim === 'cyl' || prim === 'hole') {
    const dia = num('diameter', 'dia', 'd');
    const r = dia != null ? dia / 2 : (num('radius', 'r') || 5);
    const len = num('depth', 'height', 'h', 'length', 'len', 'thickness', 't') || 10;
    h = forge.makeCylinder(r, len + (bump ? bump : 0));
    if (bump) h = forge.translate(h, 0, 0, -bump / 2);
  } else if (prim === 'cone' || prim === 'frustum') {
    const d1 = num('diameter1', 'd1'); const d2 = num('diameter2', 'd2');
    const r1 = d1 != null ? d1 / 2 : (num('r1', 'radius1') || 5);
    const r2 = d2 != null ? d2 / 2 : (num('r2', 'radius2') || 0);
    const hh = num('h', 'height', 'depth', 'length') || 10;
    h = forge.makeCone(r1, r2, hh + (bump ? bump : 0));
    if (bump) h = forge.translate(h, 0, 0, -bump / 2);
  } else if (prim === 'sphere' || prim === 'ball') {
    const dia = num('diameter', 'dia', 'd');
    const r = dia != null ? dia / 2 : (num('radius', 'r') || 5);
    h = forge.makeSphere(r);
  } else {
    throw new Error(`unknown primitive '${prim}' (use box|cylinder|cone|sphere)`);
  }
  const at = a.at;
  if (Array.isArray(at) && at.length >= 1) {
    h = forge.translate(h, +at[0] || 0, +at[1] || 0, +at[2] || 0);
  }
  return h;
}

// Cap an all-edge fillet/chamfer to a safe edge count (dense edge sets — bolt
// circles, gear teeth — make OCCT BRepFilletAPI self-intersect or hang). Mirrors
// roundEdges' EDGE_CAP guard but for an explicit user radius. Falls back to the
// un-filleted shape rather than failing the build.
function safeFilletAll(forge, shape, radius) {
  try {
    const n = forge?.direct?.edgeCount ? forge.direct.edgeCount(shape) : 0;
    if (!n || n > 16) return shape;
    const ids = Array.from({ length: n }, (_, i) => i);
    const r = forge.part.filletEdges(shape, ids, radius);
    return (typeof r === 'number' && r > 0) ? r : shape;
  } catch (_) { return shape; }
}
function safeChamferAll(forge, shape, distance) {
  try {
    const n = forge?.direct?.edgeCount ? forge.direct.edgeCount(shape) : 0;
    if (!n || n > 16) return shape;
    const ids = Array.from({ length: n }, (_, i) => i);
    const r = forge.part.chamferEdges(shape, ids, distance, -1);
    return (typeof r === 'number' && r > 0) ? r : shape;
  } catch (_) { return shape; }
}

// Require a live current part for the verbs that mutate it.
function requireCurrent(ctx, verb) {
  if (!ctx || typeof ctx.current !== 'number' || ctx.current <= 0) {
    throw new Error(`${verb} needs a current part — call part.begin first`);
  }
  return ctx.current;
}

// Through-cut overhang convention used across the asset builders: +4 mm depth,
// dropped -2 mm, so a cutter pierces both faces of the body it's subtracted from.
const CUT_OVERHANG = 4;

// Deterministic, seedable RNG (mulberry32) — degradation must be
// reproducible per seed so a "weathered" part renders identically across
// runs (and so the corpus/gauntlet can pin a seed).
function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sample N surface points off a body's tessellation — the anchor set for
// dents / blisters / pitting so degradation sits ON the real surface.
function surfaceSamples(forge, shape, n, rng) {
  const m = forge.tessellate(shape, 0.6, 0.7);
  const pos = m.positions; const nv = Math.floor((pos.length || 0) / 3);
  if (!nv) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const vi = Math.floor(rng() * nv);
    out.push([pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]]);
  }
  return out;
}

// Fuse a list of small primitive handles into ONE tool compound. Cutting/
// fusing dents one-at-a-time against the body is O(n²) (each boolean re-
// processes the ever-more-complex body and hangs). Building the tool first
// — N cheap fuses of small disjoint solids — then a SINGLE boolean with the
// body keeps it fast and robust.
function fuseAll(forge, handles) {
  let tool = null;
  for (const h of handles) {
    if (typeof h !== 'number' || h <= 0) continue;
    if (tool == null) { tool = h; continue; }
    const f = forge.fuse(tool, h);
    if (typeof f === 'number' && f > 0) tool = f;
  }
  return tool;
}

// Do-no-harm guard for degradation: a boolean near thin walls / hole rims can
// emit a degenerate solid (NaN tessellation). Verify the result tessellates
// finite; if not, the degradation is dropped and the clean body is returned —
// degradation must never corrupt a part.
function finiteSolid(forge, h) {
  try {
    if (typeof h !== 'number' || h <= 0) return false;
    const m = forge.tessellate(h, 1.0, 0.8);
    const p = m && m.positions;
    if (!p || !p.length) return false;
    for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) return false;
    return true;
  } catch (_) { return false; }
}

// ===================================================================
//   SIMULATION helpers — shared by the FEA / CFD bridge verbs below.
// ===================================================================
// Every native solver (forge.fea.solve*) consumes a *mesh* (built once via
// forge.fea.meshFromBrep) plus node-indexed BC / load lists — NOT a raw shape
// handle. The smoke tests (fea/buckling/thermal/contact/nonlinear/plasticity)
// all locate boundary nodes by the per-node face bitmask `mesh.nodeToFace`,
// where bit b set means "this node lies on face b". The brick-grid mesher uses
// the canonical OCCT box face order:
//   0 = -X   1 = +X   2 = -Y   3 = +Y   4 = -Z   5 = +Z
// These helpers reproduce the smoke-test node-picking so Archie can drive a
// solver from a shape handle + a couple of plain-English face names, never
// touching node ids.
const FACE_BIT = Object.freeze({
  '-x': 0, '+x': 1, '-y': 2, '+y': 3, '-z': 4, '+z': 5,
  nx: 0, px: 1, ny: 2, py: 3, nz: 4, pz: 5,
});
function faceBit(name, fallback) {
  if (typeof name === 'number') return name | 0;
  const k = String(name || '').toLowerCase().trim();
  return FACE_BIT[k] != null ? FACE_BIT[k] : fallback;
}
// All node ids on a given face (by face bit). `mesh.nodeToFace[i]` is a bitmask.
function nodesOnFace(mesh, bit) {
  const out = [];
  for (let i = 0; i < mesh.nodeCount; i++) {
    if (mesh.nodeToFace[i] & (1 << bit)) out.push(i);
  }
  return out;
}
// Node closest to a target XYZ (in metres) — for picking a single probe node.
function nearestNode(mesh, target) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < mesh.nodeCount; i++) {
    const dx = mesh.nodes[3 * i] - target[0];
    const dy = mesh.nodes[3 * i + 1] - target[1];
    const dz = mesh.nodes[3 * i + 2] - target[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
// Mesh AABB (metres) — used to default the load / probe face to the far end and
// to report a deflection probe point.
function meshAabb(mesh) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.nodeCount; i++) {
    for (let k = 0; k < 3; k++) {
      const v = mesh.nodes[3 * i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  return { lo, hi };
}
// Build a fixed (pin all 3 DOF) BC list from every node on the given face.
function pinFaceBcs(mesh, bit) {
  return nodesOnFace(mesh, bit).map((id) => ({ nodeId: id, fx: true, fy: true, fz: true }));
}
// Distribute a total force vector evenly across every node of a face → load
// list in the {nodeId, fx, fy, fz} shape the kernel consumes (SI: Newtons).
function distributeFaceLoad(mesh, bit, force) {
  const ids = nodesOnFace(mesh, bit);
  if (!ids.length) return { loads: [], nodes: [] };
  const n = ids.length;
  const per = [force[0] / n, force[1] / n, force[2] / n];
  return {
    loads: ids.map((id) => ({ nodeId: id, fx: per[0], fy: per[1], fz: per[2] })),
    nodes: ids,
  };
}
// Mesh a shape handle for FEA. The native meshFromBrep targets element edge
// length in METRES (the smoke tests use b/2 ≈ 5 mm on a 10 mm beam). Archie
// supplies meshSize in mm; we convert. Throws on an empty mesh so the failure
// is the real one, not a downstream NaN.
function feaMesh(forge, shape, meshSizeMm) {
  if (!forge.fea || typeof forge.fea.meshFromBrep !== 'function') {
    throw new Error('forge.fea.meshFromBrep unavailable — build the kernel with Forge-12');
  }
  const edgeM = (Number(meshSizeMm) > 0 ? Number(meshSizeMm) : 5) / 1000;
  const mesh = forge.fea.meshFromBrep(shape, edgeM);
  if (!mesh || !mesh.nodeCount || !mesh.elemCount) {
    throw new Error('FEA mesh is empty — shape may be invalid or meshSize too coarse');
  }
  return mesh;
}

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

  // ============================================ CONTEXT (handle-free, build123d-style)
  // The model NEVER emits a handle. A per-sequence `ctx.current` holds the
  // implicit "current part"; each verb mutates it in place. This makes the
  // dominant ladder_probe defect (wrong/missing fuse/cut handle ids →
  // disconnected solids) IMPOSSIBLE: there is no handle to get wrong.
  //
  // API CHOICE: add / subtract / intersect are kept as THREE separate verbs
  // (rather than one part.feature{op}). For an 8B model, a distinct verb name
  // that encodes the boolean is a stronger signal than an `op` enum arg it must
  // also fill correctly — the verb name IS the operation. part.begin opens the
  // body, part.finish closes it (optional edge break). All take {primitive,
  // ...dims, at?} — a primitive + numbers + an optional XYZ anchor, nothing else.
  { name: 'part.begin', discipline: 'part', produces: 'handle',
    description: 'Start a new part from a primitive — the implicit current body. The model passes NO handle; later add/subtract/finish verbs mutate this same body. primitive: box|cylinder|cone|sphere. box uses dx,dy,dz; cylinder uses diameter+depth; sphere uses diameter. at:[x,y,z] offsets the primitive.',
    parameters: { primitive: P('enum', 'box|cylinder|cone|sphere', { required: true }),
                  dx: P('number', 'box x extent mm', {}), dy: P('number', 'box y extent mm', {}), dz: P('number', 'box z/height mm', {}),
                  diameter: P('number', 'cylinder/cone/sphere diameter mm', {}), depth: P('number', 'cylinder/cone height mm', {}),
                  at: P('array', '[x,y,z] placement offset mm (default origin)', { default: null }) },
    run: (a, forge, ctx) => {
      const h = buildPrimitive(forge, a);
      ctx.current = h;
      return { shape: h, current: h, op: 'begin' };
    } },
  { name: 'part.add', discipline: 'part', produces: 'handle',
    description: 'Fuse (union) a primitive onto the current part — no handle needed. Same args as part.begin. Use this to bolt a boss/flange/rib onto the body.',
    parameters: { primitive: P('enum', 'box|cylinder|cone|sphere', { required: true }),
                  dx: P('number', '', {}), dy: P('number', '', {}), dz: P('number', '', {}),
                  diameter: P('number', '', {}), depth: P('number', '', {}),
                  at: P('array', '[x,y,z] placement offset mm', { default: null }) },
    run: (a, forge, ctx) => {
      const cur = requireCurrent(ctx, 'part.add');
      const tool = buildPrimitive(forge, a);
      const f = forge.fuse(cur, tool);
      if (typeof f === 'number' && f > 0) ctx.current = f;
      return { shape: ctx.current, current: ctx.current, op: 'add' };
    } },
  { name: 'part.subtract', discipline: 'part', produces: 'handle',
    description: 'Cut (subtract) a primitive from the current part — no handle needed. Same args as part.begin. Cutters auto-overhang so through-holes/slots clear both faces. Use for holes, bores, pockets, slots.',
    parameters: { primitive: P('enum', 'box|cylinder|cone|sphere', { required: true }),
                  dx: P('number', '', {}), dy: P('number', '', {}), dz: P('number', '', {}),
                  diameter: P('number', '', {}), depth: P('number', '', {}),
                  at: P('array', '[x,y,z] placement offset mm', { default: null }) },
    run: (a, forge, ctx) => {
      const cur = requireCurrent(ctx, 'part.subtract');
      // auto-overhang: bump the swept dimension so the cutter pierces both faces
      const tool = buildPrimitive(forge, a, { bump: CUT_OVERHANG });
      const c = forge.cut(cur, tool);
      if (typeof c === 'number' && c > 0) ctx.current = c;
      return { shape: ctx.current, current: ctx.current, op: 'subtract' };
    } },
  { name: 'part.intersect', discipline: 'part', produces: 'handle',
    description: 'Keep only the overlap (boolean common) of the current part and a primitive — no handle needed. Same args as part.begin.',
    parameters: { primitive: P('enum', 'box|cylinder|cone|sphere', { required: true }),
                  dx: P('number', '', {}), dy: P('number', '', {}), dz: P('number', '', {}),
                  diameter: P('number', '', {}), depth: P('number', '', {}),
                  at: P('array', '[x,y,z] placement offset mm', { default: null }) },
    run: (a, forge, ctx) => {
      const cur = requireCurrent(ctx, 'part.intersect');
      const tool = buildPrimitive(forge, a);
      const c = forge.common(cur, tool);
      if (typeof c === 'number' && c > 0) ctx.current = c;
      return { shape: ctx.current, current: ctx.current, op: 'intersect' };
    } },
  { name: 'part.finish', discipline: 'part', produces: 'handle',
    description: 'Finish the current part (terminal) — optionally break all edges with a fillet (round) and/or chamfer. No handle needed. Returns the final single-body solid.',
    parameters: { fillet: P('number', 'round-all-edges radius mm (optional)', { default: 0 }),
                  chamfer: P('number', 'chamfer-all-edges distance mm (optional)', { default: 0 }) },
    run: (a, forge, ctx) => {
      let cur = requireCurrent(ctx, 'part.finish');
      if (a.fillet && a.fillet > 0) cur = safeFilletAll(forge, cur, a.fillet);
      if (a.chamfer && a.chamfer > 0) cur = safeChamferAll(forge, cur, a.chamfer);
      ctx.current = cur;
      return { shape: cur, current: cur, op: 'finish', terminal: true };
    } },

  // ============================================ PATTERN (place features into ctx.current)
  // Replicated features in ONE call — no manual loop, no per-instance handle.
  // Each builds N cutters/adders, fuses them into a single tool, then applies
  // ONE boolean to ctx.current (the fast O(n) path, not O(n²) body re-processing).
  { name: 'part.bolt-circle', discipline: 'part', produces: 'handle',
    description: 'Cut N holes evenly spaced on a bolt-circle (BCD) into the current part — no handle, no loop. Centred on the Z axis at the given at_z (default through the body).',
    parameters: { count: P('uint', 'number of holes', { required: true }),
                  bcd: P('number', 'bolt-circle diameter mm', { required: true }),
                  diameter: P('number', 'hole diameter mm', { required: true }),
                  depth: P('number', 'hole depth mm (default: through)', { default: 0 }),
                  at_z: P('number', 'z of the hole bottom mm (default 0)', { default: 0 }) },
    run: (a, forge, ctx) => {
      const cur = requireCurrent(ctx, 'part.bolt-circle');
      const n = Math.max(1, a.count | 0), bcr = (a.bcd || 0) / 2, hr = (a.diameter || 6) / 2;
      const depth = (a.depth && a.depth > 0) ? a.depth : 1000; // tall enough to be a through-cut
      const z0 = (a.at_z || 0) - CUT_OVERHANG / 2;
      const tools = [];
      for (let i = 0; i < n; i++) {
        const ang = 2 * Math.PI * i / n;
        let h = forge.makeCylinder(hr, depth + CUT_OVERHANG);
        h = forge.translate(h, bcr * Math.cos(ang), bcr * Math.sin(ang), z0);
        tools.push(h);
      }
      const tool = fuseAll(forge, tools);
      if (tool != null) { const c = forge.cut(cur, tool); if (typeof c === 'number' && c > 0) ctx.current = c; }
      return { shape: ctx.current, current: ctx.current, holes: n, op: 'bolt-circle' };
    } },
  { name: 'part.grid-holes', discipline: 'part', produces: 'handle',
    description: 'Cut an nx×ny grid of holes (pitch dx,dy) into the current part — no handle, no loop. The grid is centred on the origin in XY.',
    parameters: { nx: P('uint', 'columns', { required: true }), ny: P('uint', 'rows', { required: true }),
                  dx: P('number', 'x pitch mm', { required: true }), dy: P('number', 'y pitch mm', { required: true }),
                  diameter: P('number', 'hole diameter mm', { required: true }),
                  depth: P('number', 'hole depth mm (default: through)', { default: 0 }),
                  at_z: P('number', 'z of the hole bottom mm (default 0)', { default: 0 }) },
    run: (a, forge, ctx) => {
      const cur = requireCurrent(ctx, 'part.grid-holes');
      const nx = Math.max(1, a.nx | 0), ny = Math.max(1, a.ny | 0);
      const dx = a.dx || 0, dy = a.dy || 0, hr = (a.diameter || 6) / 2;
      const depth = (a.depth && a.depth > 0) ? a.depth : 1000;
      const z0 = (a.at_z || 0) - CUT_OVERHANG / 2;
      const x0 = -((nx - 1) * dx) / 2, y0 = -((ny - 1) * dy) / 2;
      const tools = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        let h = forge.makeCylinder(hr, depth + CUT_OVERHANG);
        h = forge.translate(h, x0 + i * dx, y0 + j * dy, z0);
        tools.push(h);
      }
      const tool = fuseAll(forge, tools);
      if (tool != null) { const c = forge.cut(cur, tool); if (typeof c === 'number' && c > 0) ctx.current = c; }
      return { shape: ctx.current, current: ctx.current, holes: nx * ny, op: 'grid-holes' };
    } },
  { name: 'part.holes', discipline: 'part', produces: 'handle',
    description: 'Cut holes at explicit XY locations into the current part — no handle, no loop. locations is [[x,y], …].',
    parameters: { locations: P('array', '[[x,y], …] hole centres mm', { required: true }),
                  diameter: P('number', 'hole diameter mm', { required: true }),
                  depth: P('number', 'hole depth mm (default: through)', { default: 0 }),
                  at_z: P('number', 'z of the hole bottom mm (default 0)', { default: 0 }) },
    run: (a, forge, ctx) => {
      const cur = requireCurrent(ctx, 'part.holes');
      const locs = Array.isArray(a.locations) ? a.locations : [];
      const hr = (a.diameter || 6) / 2;
      const depth = (a.depth && a.depth > 0) ? a.depth : 1000;
      const z0 = (a.at_z || 0) - CUT_OVERHANG / 2;
      const tools = [];
      for (const p of locs) {
        let h = forge.makeCylinder(hr, depth + CUT_OVERHANG);
        h = forge.translate(h, +p[0] || 0, +p[1] || 0, z0);
        tools.push(h);
      }
      const tool = fuseAll(forge, tools);
      if (tool != null) { const c = forge.cut(cur, tool); if (typeof c === 'number' && c > 0) ctx.current = c; }
      return { shape: ctx.current, current: ctx.current, holes: locs.length, op: 'holes' };
    } },
  { name: 'part.pattern-feature', discipline: 'part', produces: 'handle',
    description: 'Replicate a primitive feature (linear row or polar ring) and add OR subtract the whole set into the current part in ONE call — no handle, no loop. kind:linear steps by step_x,step_y,step_z; kind:polar places on a bcd (and optional total_angle). The feature size comes from its own dims (box dx,dy,dz; cylinder diameter+depth). op:add fuses, op:subtract cuts (cutters auto-overhang).',
    parameters: { primitive: P('enum', 'box|cylinder|cone|sphere', { required: true }),
                  dx: P('number', 'box x extent mm', {}), dy: P('number', 'box y extent mm', {}), dz: P('number', 'box z/height mm', {}),
                  diameter: P('number', 'cylinder/cone/sphere diameter mm', {}), depth: P('number', 'cylinder/cone height mm', {}),
                  kind: P('enum', 'linear|polar', { required: true }),
                  count: P('uint', 'instance count', { required: true }),
                  step_x: P('number', 'linear x pitch mm (kind=linear)', { default: 0 }),
                  step_y: P('number', 'linear y pitch mm (kind=linear)', { default: 0 }),
                  step_z: P('number', 'linear z pitch mm (kind=linear)', { default: 0 }),
                  bcd: P('number', 'polar bolt-circle diameter mm (kind=polar)', { default: 0 }),
                  total_angle: P('number', 'polar total spread deg (default 360)', { default: 360 }),
                  op: P('enum', 'add|subtract', { default: 'subtract' }) },
    run: (a, forge, ctx) => {
      const cur = requireCurrent(ctx, 'part.pattern-feature');
      const n = Math.max(1, a.count | 0);
      const subtract = String(a.op || 'subtract').toLowerCase() !== 'add';
      const bump = subtract ? CUT_OVERHANG : 0;
      const kind = String(a.kind || 'linear').toLowerCase();
      const tools = [];
      if (kind === 'polar') {
        const bcr = (a.bcd || 0) / 2;
        const span = (a.total_angle != null ? a.total_angle : 360) * Math.PI / 180;
        // 360° → don't double the seam: step = span/n; partial arc → span/(n-1).
        const full = Math.abs(span - 2 * Math.PI) < 1e-6;
        const step = full ? (2 * Math.PI / n) : (n > 1 ? span / (n - 1) : 0);
        for (let i = 0; i < n; i++) {
          const ang = i * step;
          let h = buildPrimitive(forge, a, { bump });
          h = forge.translate(h, bcr * Math.cos(ang), bcr * Math.sin(ang), 0);
          tools.push(h);
        }
      } else {
        // Linear step is SEPARATE from the feature's own size — fall back to
        // dx/dy/dz only when no explicit step_* is given (so a row of boxes that
        // also names dx still pitches sensibly).
        const sx = a.step_x != null ? a.step_x : (a.dx || 0);
        const sy = a.step_y != null ? a.step_y : (a.dy || 0);
        const sz = a.step_z != null ? a.step_z : (a.dz || 0);
        for (let i = 0; i < n; i++) {
          let h = buildPrimitive(forge, a, { bump });
          h = forge.translate(h, i * sx, i * sy, i * sz);
          tools.push(h);
        }
      }
      const tool = fuseAll(forge, tools);
      if (tool != null) {
        const r = subtract ? forge.cut(cur, tool) : forge.fuse(cur, tool);
        if (typeof r === 'number' && r > 0) ctx.current = r;
      }
      return { shape: ctx.current, current: ctx.current, instances: n, op: 'pattern-feature', mode: subtract ? 'subtract' : 'add' };
    } },

  // ===================================================== PARAMETRIC / FREEFORM
  // These reach the OCCT kernel's real feature/surfacing/direct/heal verbs
  // (window.forge.part.* / .surfacing.* / .direct.* / .heal.*) — sweeps,
  // lofts of revolution, NURBS patches, graduated fillets, patterns, draft,
  // shell, face push/pull. This is what lets Archie build CURVED / BLENDED /
  // PATTERNED geometry instead of straight CSG primitive stacks.
  { name: 'part.extrude', discipline: 'part', produces: 'handle',
    description: 'Extrude a closed 2D profile (XY points, mm) by a distance along a direction → prism solid.',
    parameters: { profile: P('array', '[[x,y], …] closed profile points', { required: true }),
                  distance: P('number', 'extrude distance in mm', { required: true }),
                  dir: P('array', '[dx,dy,dz] direction (default +Z)', { default: [0, 0, 1] }) },
    run: ({ profile, distance, dir }, forge) => {
      const sk = buildProfileSketch(forge, profile);
      const d = Float64Array.from(Array.isArray(dir) && dir.length === 3 ? dir : [0, 0, 1]);
      return { shape: forge.part.extrudeProfile(sk, distance, d) };
    } },

  { name: 'part.revolve', discipline: 'part', produces: 'handle',
    description: 'Revolve a closed 2D profile (XY points) around an axis → solid of revolution (vase/dome/turned part). Curved.',
    parameters: { profile: P('array', '[[x,y], …] profile on one side of the axis', { required: true }),
                  axisOrigin: P('array', '[x,y,z] axis point (default origin)', { default: [0, 0, 0] }),
                  axisDir: P('array', '[x,y,z] axis direction (default +Y)', { default: [0, 1, 0] }),
                  angleDeg: P('number', 'revolution angle in degrees', { default: 360 }) },
    run: ({ profile, axisOrigin, axisDir, angleDeg }, forge) => {
      const sk = buildProfileSketch(forge, profile);
      const o = Float64Array.from(Array.isArray(axisOrigin) ? axisOrigin : [0, 0, 0]);
      const a = Float64Array.from(Array.isArray(axisDir) ? axisDir : [0, 1, 0]);
      return { shape: forge.part.revolveProfile(sk, o, a, DEG(angleDeg ?? 360)) };
    } },

  { name: 'part.pipe', discipline: 'part', produces: 'handle',
    description: 'Sweep a circular profile of given radius along a 3D polyline path → watertight curved pipe/tube/duct solid.',
    parameters: { path: P('array', '[[x,y,z], …] ≥2 spine points (mm)', { required: true }),
                  radius: P('number', 'tube radius in mm', { required: true }) },
    run: ({ path, radius }, forge) => {
      if (!Array.isArray(path) || path.length < 2) throw new Error('pipe path needs ≥2 points');
      const flat = new Float64Array(path.length * 3);
      for (let i = 0; i < path.length; i++) { flat[i * 3] = +path[i][0] || 0; flat[i * 3 + 1] = +path[i][1] || 0; flat[i * 3 + 2] = +path[i][2] || 0; }
      return { shape: forge.part.pipeFromPolyline(flat, radius) };
    } },

  { name: 'part.nurbs-surface', discipline: 'part', produces: 'handle',
    description: 'Build a freeform NURBS surface from a control-point grid, optionally thickened into a solid. Freeform/curved.',
    parameters: { grid: P('array', '[[ [x,y,z], … ], … ] rows×cols control grid', { required: true }),
                  uDegree: P('uint', 'U degree (default 3)', { default: 3 }),
                  vDegree: P('uint', 'V degree (default 3)', { default: 3 }),
                  thickness: P('number', 'if >0, thicken the surface into a solid (mm)', { default: 0 }) },
    run: ({ grid, uDegree, vDegree, thickness }, forge) => {
      const face = forge.surfacing.buildPatch(grid, uDegree ?? 3, vDegree ?? 3, null, null);
      if (thickness && thickness > 0) return { shape: forge.part.thickenSurface(face, thickness, 0), face };
      return { shape: face, face };
    } },

  { name: 'part.fillet', discipline: 'part', produces: 'handle',
    description: 'Round edges of a solid with a constant radius. Omit edgeIds to fillet ALL edges (manufactured look).',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  radius: P('number', 'fillet radius in mm', { required: true }),
                  edgeIds: P('array', '0-based edge ids (default: all edges)', { default: null }) },
    run: ({ shape, radius, edgeIds }, forge) => {
      let ids = edgeIds;
      if (!Array.isArray(ids) || ids.length === 0) {
        const n = forge.direct.edgeCount(shape);
        ids = Array.from({ length: n }, (_, i) => i);
      }
      return { shape: forge.part.filletEdges(shape, ids, radius) };
    } },

  { name: 'part.variable-fillet', discipline: 'part', produces: 'handle',
    description: 'Graduated (variable-radius) fillet along one edge, radius interpolated through anchor points.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  edgeId: P('uint', '0-based edge id to fillet', { required: true }),
                  anchors: P('array', '[{u,r}, …] u∈[0,1] position → radius mm', { required: true }) },
    run: ({ shape, edgeId, anchors }, forge) => {
      const a = (anchors || []).map((p) => ({ u: +p.u, r: +p.r }));
      return { shape: forge.part.variableFilletEdge(shape, edgeId, a) };
    } },

  { name: 'part.chamfer', discipline: 'part', produces: 'handle',
    description: 'Chamfer (break) edges of a solid by a distance. Omit edgeIds to chamfer ALL edges.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  distance: P('number', 'chamfer distance in mm', { required: true }),
                  edgeIds: P('array', '0-based edge ids (default: all)', { default: null }) },
    run: ({ shape, distance, edgeIds }, forge) => {
      let ids = edgeIds;
      if (!Array.isArray(ids) || ids.length === 0) {
        const n = forge.direct.edgeCount(shape);
        ids = Array.from({ length: n }, (_, i) => i);
      }
      return { shape: forge.part.chamferEdges(shape, ids, distance, -1) };
    } },

  { name: 'part.shell', discipline: 'part', produces: 'handle',
    description: 'Hollow a solid to a wall thickness, optionally removing faces to open it (faceIds 1-based).',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  thickness: P('number', 'wall thickness in mm', { required: true }),
                  faceIds: P('array', '1-based face ids to remove/open (default none)', { default: [] }) },
    run: ({ shape, thickness, faceIds }, forge) => ({ shape: forge.part.shell(shape, Array.isArray(faceIds) ? faceIds : [], thickness, []) }) },

  { name: 'part.draft-faces', discipline: 'part', produces: 'handle',
    description: 'Apply a draft (taper) angle to faces about a neutral plane — for mould release / cast parts.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  neutralPlane: P('uint', 'neutral plane face id (1-based)', { required: true }),
                  faceIds: P('array', '1-based face ids to draft', { required: true }),
                  angleDeg: P('number', 'draft angle in degrees', { required: true }) },
    run: ({ shape, neutralPlane, faceIds, angleDeg }, forge) => ({ shape: forge.part.draftFaces(shape, neutralPlane, faceIds, DEG(angleDeg)) }) },

  { name: 'part.linear-pattern', discipline: 'part', produces: 'handle',
    description: 'Replicate a solid in a straight row → fused pattern body.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  count: P('uint', 'instance count', { required: true }),
                  dx: P('number', 'x spacing mm', { default: 0 }),
                  dy: P('number', 'y spacing mm', { default: 0 }),
                  dz: P('number', 'z spacing mm', { default: 0 }) },
    run: ({ shape, count, dx, dy, dz }, forge) => ({ shape: forge.part.linearPattern(shape, count, dx ?? 0, dy ?? 0, dz ?? 0) }) },

  { name: 'part.circular-pattern', discipline: 'part', produces: 'handle',
    description: 'Replicate a solid around an axis → radial/ring pattern body.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  count: P('uint', 'instance count', { required: true }),
                  axisOrigin: P('array', '[x,y,z] axis point (default origin)', { default: [0, 0, 0] }),
                  axisDir: P('array', '[x,y,z] axis direction (default +Z)', { default: [0, 0, 1] }),
                  totalAngleDeg: P('number', 'total spread in degrees', { default: 360 }) },
    run: ({ shape, count, axisOrigin, axisDir, totalAngleDeg }, forge) => {
      const o = Float64Array.from(Array.isArray(axisOrigin) ? axisOrigin : [0, 0, 0]);
      const a = Float64Array.from(Array.isArray(axisDir) ? axisDir : [0, 0, 1]);
      return { shape: forge.part.circularPattern(shape, count, o, a, DEG(totalAngleDeg ?? 360)) };
    } },

  { name: 'part.push-pull-face', discipline: 'part', produces: 'handle',
    description: 'Direct-edit: push/pull a single face along its normal by a distance (synchronous tech).',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  faceId: P('uint', '1-based face id', { required: true }),
                  distance: P('number', 'offset in mm (+out / −in)', { required: true }) },
    run: ({ shape, faceId, distance }, forge) => ({ shape: forge.direct.pushPullFace(shape, faceId, distance) }) },

  { name: 'part.continuity-check', discipline: 'part', produces: 'report',
    description: 'Class-A surface analysis (zebra/curvature) of a NURBS face — reports continuity quality (G0/G1/G2).',
    parameters: { face: P('uint', 'face handle', { required: true }),
                  samples: P('uint', 'sample count', { default: 16 }) },
    run: ({ face, samples }, forge) => forge.surfacing.classAAnalyse(face, samples ?? 16) },

  { name: 'part.check-validity', discipline: 'part', produces: 'report',
    description: 'Validate a solid (manifold / self-intersection / small faces) — the coherence gate for a body.',
    parameters: { shape: P('uint', 'shape handle', { required: true }) },
    run: ({ shape }, forge) => forge.heal.checkValidity(shape) },

  // ===================================================== DEGRADATION / WEATHERING
  // Real parts are never perfectly clean: castings pit, edges nick, surfaces
  // corrode, used parts wear asymmetrically. These verbs let Archie PRODUCE
  // that realism on demand (the defect taxonomy as GENERATION, not just
  // recognition) — deterministic per seed. They compose existing kernel
  // booleans, so the output stays a valid OCCT solid.
  { name: 'part.surface-wear', discipline: 'part', produces: 'handle',
    description: 'Carve random dents / nicks / pitting into a solid surface (casting porosity, wear scars, as-found roughness). Asymmetric, seeded.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  count: P('uint', 'number of dents', { default: 18 }),
                  depth: P('number', 'mean dent radius in mm', { default: 1.6 }),
                  seed: P('uint', 'rng seed', { default: 7 }) },
    run: ({ shape, count, depth, seed }, forge) => {
      const rng = mulberry32(seed ?? 7);
      const pts = surfaceSamples(forge, shape, count ?? 18, rng);
      const dents = pts.map(([x, y, z]) => forge.translate(forge.makeSphere((depth ?? 1.6) * (0.55 + rng() * 0.9)), x, y, z));
      const tool = fuseAll(forge, dents);
      if (tool == null) return { shape, dents: 0 };
      const cut = forge.cut(shape, tool);
      const ok = finiteSolid(forge, cut);
      return { shape: ok ? cut : shape, dents: ok ? pts.length : 0, degraded: ok };
    } },

  { name: 'part.surface-deposit', discipline: 'part', produces: 'handle',
    description: 'Fuse random blisters / nodules / weld-spatter onto a surface (corrosion build-up, slag, accreted material). Asymmetric, seeded.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  count: P('uint', 'number of blisters', { default: 14 }),
                  height: P('number', 'mean blister radius in mm', { default: 1.4 }),
                  seed: P('uint', 'rng seed', { default: 11 }) },
    run: ({ shape, count, height, seed }, forge) => {
      const rng = mulberry32(seed ?? 11);
      const pts = surfaceSamples(forge, shape, count ?? 14, rng);
      const blobs = pts.map(([x, y, z]) => forge.translate(forge.makeSphere((height ?? 1.4) * (0.5 + rng() * 1.0)), x, y, z));
      const tool = fuseAll(forge, blobs);
      if (tool == null) return { shape, blisters: 0 };
      const f = forge.fuse(shape, tool);
      const ok = finiteSolid(forge, f);
      return { shape: ok ? f : shape, blisters: ok ? pts.length : 0, degraded: ok };
    } },

  { name: 'part.chipped-edges', discipline: 'part', produces: 'handle',
    description: 'Knock random chips off edges/corners (impact damage, handling wear) by subtracting small jittered boxes near the surface. Asymmetric, seeded.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  count: P('uint', 'number of chips', { default: 10 }),
                  size: P('number', 'mean chip size in mm', { default: 3 }),
                  seed: P('uint', 'rng seed', { default: 23 }) },
    run: ({ shape, count, size, seed }, forge) => {
      const rng = mulberry32(seed ?? 23);
      const pts = surfaceSamples(forge, shape, count ?? 10, rng);
      const chips = pts.map(([x, y, z]) => {
        const s = (size ?? 3) * (0.6 + rng() * 1.0);
        let chip = forge.makeBox(s, s, s);
        chip = forge.rotate(chip, 0, 0, 1, rng() * Math.PI);
        chip = forge.rotate(chip, 1, 0, 0, rng() * Math.PI);
        return forge.translate(chip, x - s / 2, y - s / 2, z - s / 2);
      });
      const tool = fuseAll(forge, chips);
      if (tool == null) return { shape, chips: 0 };
      const cut = forge.cut(shape, tool);
      const ok = finiteSolid(forge, cut);
      return { shape: ok ? cut : shape, chips: ok ? pts.length : 0, degraded: ok };
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

  // ====================================================== FULL PHYSICS SUITE
  // Thin wrappers over the native kernel solvers the preload already exposes
  // (forge.fea.solveBuckling / solveThermal / fatigueLife / solveNonlinearPlastic
  // / solveContact + forge.cfd.solveSteadyNS + forge.assembly.runMotionStudy).
  // Each is self-contained: take a shape handle (or assembly), mesh it via
  // meshFromBrep, locate BC / load nodes by face name, solve, and return ONLY
  // the physics summary (max stress, safety factor, critical load, max temp,
  // fatigue life, peak velocity / pressure, motion trajectory). Archie never
  // touches a node id or a mesh object. SI units throughout (m, N, Pa, kg, K).

  { name: 'simulate.fea-buckling', discipline: 'simulate', produces: 'report',
    description: 'Linear-buckling (eigenvalue) FEA on a shape. Pins one face, applies a compressive load on another, returns the first critical buckling load (N), all load factors, and a buckling safety factor vs the applied load. Use for columns / struts / thin panels.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  material: P('object', '{E, nu, rho} (Pa, -, kg/m³)', { required: true }),
                  fixedFace: P('enum', 'face to clamp: -x|+x|-y|+y|-z|+z', { default: '-x' }),
                  loadFace: P('enum', 'face the compressive load acts on', { default: '+x' }),
                  load: P('number', 'compressive load magnitude (N), pushed into the body along the loadFace inward normal', { default: 1000 }),
                  modes: P('uint', 'number of buckling modes', { default: 3 }),
                  meshSize: P('number', 'target element size in mm', { default: 5 }) },
    run: (a, forge) => {
      if (!forge.fea || typeof forge.fea.solveBuckling !== 'function') {
        throw new Error('forge.fea.solveBuckling unavailable — build the kernel with Forge-31');
      }
      const mesh = feaMesh(forge, a.shape, a.meshSize);
      const fixBit = faceBit(a.fixedFace, 0);
      const loadBit = faceBit(a.loadFace, 1);
      const bcs = pinFaceBcs(mesh, fixBit);
      // Compressive: act along the inward normal of the load face.
      const sign = (loadBit % 2 === 0) ? +1 : -1; // -X face pushed +X (in), +X pushed -X (in)
      const axis = loadBit >> 1; // 0=x,1=y,2=z
      const P_pre = Math.abs(Number(a.load) || 1000);
      const f = [0, 0, 0]; f[axis] = sign * P_pre;
      const { loads } = distributeFaceLoad(mesh, loadBit, f);
      const r = forge.fea.solveBuckling(mesh, a.material, loads, bcs, (a.modes | 0) || 3);
      const lf = Array.from(r.loadFactors || []);
      return {
        op: 'fea-buckling',
        nodes: mesh.nodeCount, elements: mesh.elemCount,
        appliedLoad_N: P_pre,
        firstCriticalLoad_N: r.firstCriticalLoad,
        loadFactors: lf,
        // λ₁ is the multiple of the applied load at which buckling occurs.
        bucklingSafetyFactor: lf.length ? lf[0] : null,
        modesCaptured: r.nModes,
        cpuMs: r.cpuMs,
      };
    } },

  { name: 'simulate.fea-thermal', discipline: 'simulate', produces: 'report',
    description: 'Steady-state thermal conduction FEA on a shape. Holds two faces at fixed temperatures (°C), optional surface convection, returns the temperature range (min/max °C) and mean heat flux (W/m²). Use for heat-sink / bracket / casting thermal checks.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  material: P('object', '{k} thermal conductivity W/(m·K)', { required: true }),
                  hotFace: P('enum', 'face held at hotTemp: -x|+x|-y|+y|-z|+z', { default: '-x' }),
                  coldFace: P('enum', 'face held at coldTemp', { default: '+x' }),
                  hotTemp: P('number', 'hot-face temperature °C', { default: 100 }),
                  coldTemp: P('number', 'cold-face temperature °C', { default: 0 }),
                  meshSize: P('number', 'target element size in mm', { default: 5 }) },
    run: (a, forge) => {
      if (!forge.fea || typeof forge.fea.solveThermal !== 'function') {
        throw new Error('forge.fea.solveThermal unavailable — build the kernel with Forge-12b');
      }
      const mesh = feaMesh(forge, a.shape, a.meshSize);
      const hotIds = nodesOnFace(mesh, faceBit(a.hotFace, 0));
      const coldIds = nodesOnFace(mesh, faceBit(a.coldFace, 1));
      const TH = Number(a.hotTemp != null ? a.hotTemp : 100);
      const TC = Number(a.coldTemp != null ? a.coldTemp : 0);
      const dirichlet = [
        ...hotIds.map((id) => ({ nodeId: id, T: TH })),
        ...coldIds.map((id) => ({ nodeId: id, T: TC })),
      ];
      const r = forge.fea.solveThermal(mesh, a.material, dirichlet, [], []);
      let qSum = 0, qN = 0;
      for (const q of (r.elemFluxMag || [])) { qSum += q; qN++; }
      return {
        op: 'fea-thermal',
        nodes: mesh.nodeCount, elements: mesh.elemCount,
        minT_C: r.minT, maxT_C: r.maxT,
        meanHeatFlux_W_m2: qN ? qSum / qN : 0,
        residual: r.residual,
      };
    } },

  { name: 'simulate.fea-fatigue', discipline: 'simulate', produces: 'report',
    description: 'S-N (Basquin) fatigue-life estimate from a stress amplitude history. Supply the cyclic stress range and an S-N curve; returns fatigue life in cycles (and the governing amplitude). NUMERIC stress-life — does not re-mesh geometry; feed it the peak alternating stress from a static/dynamic run.',
    parameters: { amplitude: P('number', 'alternating stress amplitude (Pa)', { required: true }),
                  mean: P('number', 'mean stress (Pa)', { default: 0 }),
                  cycles: P('uint', 'number of cycles in the supplied history (sampling only)', { default: 200 }),
                  sn: P('object', '{N:[..], S:[..]} S-N curve points (cycles, Pa); default steel HCF curve', { default: null }),
                  ultimateStress: P('number', 'ultimate tensile strength (Pa) for Goodman mean-stress correction', { default: 0 }),
                  meanCorrection: P('enum', 'None|Goodman|Soderberg', { default: 'None' }) },
    run: (a, forge) => {
      if (!forge.fea || typeof forge.fea.fatigueLife !== 'function') {
        throw new Error('forge.fea.fatigueLife unavailable — build the kernel with Forge-12b');
      }
      const amp = Math.abs(Number(a.amplitude) || 0);
      const mean = Number(a.mean) || 0;
      const nCycles = Math.max(1, (a.cycles | 0) || 200);
      const spc = 4; // samples per cycle (peak/valley + 2 intermediate, matches smoke)
      const nSteps = nCycles * spc;
      const hist = new Float64Array(nSteps);
      for (let i = 0; i < nSteps; i++) hist[i] = mean + amp * Math.sin(2 * Math.PI * (i / spc));
      const sn = (a.sn && Array.isArray(a.sn.N) && Array.isArray(a.sn.S))
        ? a.sn
        : { N: [1e3, 1e6], S: [600e6, 200e6] }; // canonical steel HCF curve
      const corrMap = { none: 0, goodman: 1, soderberg: 2 };
      const corr = (forge.fea.MeanStressCorrection
        && forge.fea.MeanStressCorrection[String(a.meanCorrection || 'None')]) != null
        ? forge.fea.MeanStressCorrection[String(a.meanCorrection || 'None')]
        : (corrMap[String(a.meanCorrection || 'none').toLowerCase()] ?? 0);
      const cfg = { sn, meanCorrection: corr, cyclesPerSample: 1.0 };
      if (a.ultimateStress) cfg.ultimateStress = Number(a.ultimateStress);
      const r = forge.fea.fatigueLife(hist, 1, nSteps, cfg);
      return {
        op: 'fea-fatigue',
        amplitude_Pa: amp, mean_Pa: mean,
        lifeCycles: r.cyclesToFailure ? r.cyclesToFailure[0] : r.minLife,
        minLifeCycles: r.minLife,
        maxAmplitudeObserved_Pa: r.maxAmplitude,
        meanCorrection: String(a.meanCorrection || 'None'),
      };
    } },

  { name: 'simulate.fea-nonlinear', discipline: 'simulate', produces: 'report',
    description: 'Elasto-plastic (nonlinear) static FEA with radial-return plasticity. Pins one face, loads another, ramps the load over N steps. Returns max equivalent plastic strain, max residual von Mises (MPa), and whether the part yielded. Use to check permanent set / overload.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  material: P('object', '{E, nu, rho, sigmaY, hardening} (Pa)', { required: true }),
                  fixedFace: P('enum', 'face to clamp: -x|+x|-y|+y|-z|+z', { default: '-x' }),
                  loadFace: P('enum', 'face the load acts on', { default: '+x' }),
                  force: P('array', '[fx,fy,fz] total force on loadFace (N)', { default: [0, -10000, 0] }),
                  loadSteps: P('uint', 'number of load increments', { default: 5 }),
                  meshSize: P('number', 'target element size in mm', { default: 5 }) },
    run: (a, forge) => {
      if (!forge.fea || typeof forge.fea.solveNonlinearPlastic !== 'function') {
        throw new Error('forge.fea.solveNonlinearPlastic unavailable — build the kernel with Forge-31');
      }
      const mesh = feaMesh(forge, a.shape, a.meshSize);
      const bcs = pinFaceBcs(mesh, faceBit(a.fixedFace, 0));
      const F = Array.isArray(a.force) && a.force.length === 3 ? a.force.map(Number) : [0, -10000, 0];
      const { loads } = distributeFaceLoad(mesh, faceBit(a.loadFace, 1), F);
      const r = forge.fea.solveNonlinearPlastic(mesh, a.material, loads, bcs, (a.loadSteps | 0) || 5);
      const epF = r.stepPlasticStrain ? r.stepPlasticStrain[r.stepPlasticStrain.length - 1] : [];
      const sigF = r.stepStress ? r.stepStress[r.stepStress.length - 1] : [];
      let maxEp = 0, maxSig = 0;
      for (let e = 0; e < epF.length; e++) if (epF[e] > maxEp) maxEp = epF[e];
      for (let e = 0; e < sigF.length; e++) if (sigF[e] > maxSig) maxSig = sigF[e];
      return {
        op: 'fea-nonlinear',
        nodes: mesh.nodeCount, elements: mesh.elemCount,
        maxPlasticStrain: maxEp,
        maxVonMises_MPa: maxSig / 1e6,
        yielded: maxEp > 0,
        converged: r.converged,
        stepIterations: Array.from(r.stepIterations || []),
        cpuMs: r.cpuMs,
      };
    } },

  { name: 'simulate.fea-contact', discipline: 'simulate', produces: 'report',
    description: 'Penalty contact FEA between two stacked shapes. Pins the base of shape B, presses shape A onto B with a load, returns max contact pressure (MPa), number of active contact pairs, and the press-in displacement (mm). Use for bearing seats / press-fits / stacked parts.',
    parameters: { shapeA: P('uint', 'upper shape handle (loaded)', { required: true }),
                  shapeB: P('uint', 'lower shape handle (supported)', { required: true }),
                  material: P('object', '{E, nu, rho} (Pa)', { required: true }),
                  load: P('number', 'compressive load on shape A top face (N)', { default: 1000 }),
                  meshSize: P('number', 'target element size in mm', { default: 5 }) },
    run: (a, forge) => {
      if (!forge.fea || typeof forge.fea.solveContact !== 'function') {
        throw new Error('forge.fea.solveContact unavailable — build the kernel with Forge-31');
      }
      const meshA = feaMesh(forge, a.shapeA, a.meshSize);
      const meshB = feaMesh(forge, a.shapeB, a.meshSize);
      // B base = -Z (bit 4) pinned; A top = +Z (bit 5) loaded down; contact at
      // A's -Z (bit 4) against B's +Z (bit 5) — mirrors contact_smoke.js.
      const bcsB = pinFaceBcs(meshB, 4);
      const F = -Math.abs(Number(a.load) || 1000);
      const { loads: loadsA } = distributeFaceLoad(meshA, 5, [0, 0, F]);
      const aBottom = nodesOnFace(meshA, 4);
      const pairs = aBottom.map((id) => ({ nodeA: id, faceB: 5 }));
      // Soft lateral pin on the centroid-most bottom node of A (rigid-body
      // suppression, as the smoke does), leaving its Z free to press in.
      let cx = 0, cy = 0, cz = 0;
      for (const id of aBottom) { cx += meshA.nodes[3 * id]; cy += meshA.nodes[3 * id + 1]; cz += meshA.nodes[3 * id + 2]; }
      const cN = aBottom.length || 1; cx /= cN; cy /= cN; cz /= cN;
      const centerA = nearestNode(meshA, [cx, cy, cz]);
      const bcsA = [{ nodeId: centerA, fx: true, fy: true, fz: false }];
      const r = forge.fea.solveContact(meshA, meshB, a.material, loadsA, [], bcsA, bcsB, pairs, 0);
      let maxP = 0, active = 0;
      for (const p of (r.contactPressure || [])) { if (p > maxP) maxP = p; if (p > 0) active++; }
      const topA = nodesOnFace(meshA, 5);
      let maxUz = 0;
      for (const id of topA) { const uz = r.uA[3 * id + 2]; if (Math.abs(uz) > maxUz) maxUz = Math.abs(uz); }
      return {
        op: 'fea-contact',
        appliedLoad_N: Math.abs(F),
        maxContactPressure_MPa: maxP / 1e6,
        activePairs: active, totalPairs: pairs.length,
        pressInDisplacement_mm: maxUz * 1000,
        iterations: r.iterations, converged: r.converged,
        cpuMs: r.cpuMs,
      };
    } },

  { name: 'simulate.cfd', discipline: 'simulate', produces: 'report',
    description: 'Incompressible steady Navier-Stokes CFD on a box domain (laminar, MAC grid, projection method). One face drives the flow at a given velocity; the rest are no-slip walls. Returns peak velocity (m/s), Reynolds number, pressure range (Pa), and divergence convergence. Honest scope: laminar only, no turbulence model, structured cartesian grid.',
    parameters: { domain: P('array', '[minX,minY,minZ,maxX,maxY,maxZ] domain box (m)', { default: [0, 0, 0, 1, 1, 1] }),
                  grid: P('uint', 'cells per axis (N×N×N)', { default: 32 }),
                  rho: P('number', 'fluid density kg/m³', { default: 1.0 }),
                  viscosity: P('number', 'kinematic viscosity ν (m²/s)', { default: 0.01 }),
                  inletFace: P('enum', 'driven face: -x|+x|-y|+y|-z|+z', { default: '+y' }),
                  velocity: P('array', '[vx,vy,vz] tangential drive velocity on inletFace (m/s)', { default: [1, 0, 0] }),
                  maxIter: P('uint', 'outer projection iterations', { default: 100 }) },
    run: (a, forge) => {
      if (!forge.cfd || typeof forge.cfd.solveSteadyNS !== 'function') {
        throw new Error('forge.cfd.solveSteadyNS unavailable — build the kernel with Forge-12b');
      }
      const dom = Array.isArray(a.domain) && a.domain.length === 6 ? a.domain : [0, 0, 0, 1, 1, 1];
      const N = Math.max(8, (a.grid | 0) || 32);
      const inlet = faceBit(a.inletFace, 3); // default +Y (lid)
      const v = Array.isArray(a.velocity) && a.velocity.length === 3 ? a.velocity.map(Number) : [1, 0, 0];
      const walls = [0, 1, 2, 3, 4, 5].filter((b) => b !== inlet);
      const cfg = {
        domain: Float64Array.from(dom),
        Nx: N, Ny: N, Nz: N,
        rho: Number(a.rho) || 1.0,
        nu: Number(a.viscosity) || 0.01,
        maxIter: (a.maxIter | 0) || 100,
        residualTol: 1e-9,
        walls,
        lid: { faceId: inlet, vx: v[0], vy: v[1], vz: v[2] },
      };
      const r = forge.cfd.solveSteadyNS(cfg);
      let pmin = Infinity, pmax = -Infinity;
      for (const p of (r.p || [])) { if (p < pmin) pmin = p; if (p > pmax) pmax = p; }
      return {
        op: 'cfd',
        grid: `${N}x${N}x${N}`,
        peakVelocity_m_s: r.maxVelocity,
        reynolds: r.reynolds,
        pressureMin_Pa: Number.isFinite(pmin) ? pmin : 0,
        pressureMax_Pa: Number.isFinite(pmax) ? pmax : 0,
        iterations: r.iterations,
        initialResidual: r.initialResidual,
        finalResidual: r.finalResidual,
        cpuMs: r.cpuMs,
      };
    } },

  { name: 'simulate.dynamics-motion', discipline: 'simulate', produces: 'report',
    description: 'Assembly kinematics / motion study. Drives a mate value (the motor) on an already-built mate assembly through a total sweep over N frames, solving the mate network each frame. Returns the per-frame driver value + trajectory of the driven instance (start/end position, path length, convergence). Build the assembly + mates first (assembly.add-instance / assembly.add-mate), then call this.',
    parameters: { motor: P('uint', 'driver instance id (the motorised mate target)', { required: true }),
                  axis: P('uint', 'topology selector on the motor (0=origin|1=axis|2=face)', { default: 0 }),
                  totalAngle: P('number', 'total sweep of the driver value (rad for angular, mm for linear)', { required: true }),
                  steps: P('uint', 'number of frames', { default: 36 }) },
    run: (a, forge) => {
      if (!forge.assembly || typeof forge.assembly.runMotionStudy !== 'function') {
        throw new Error('forge.assembly.runMotionStudy unavailable — build the kernel with Forge-35');
      }
      const steps = Math.max(2, (a.steps | 0) || 36);
      const run = forge.assembly.runMotionStudy(a.motor | 0, (a.axis | 0) || 0, Number(a.totalAngle) || 0, steps);
      const frames = run.frames || [];
      const first = frames[0], last = frames[frames.length - 1];
      // Path length + endpoints of the DRIVEN motor instance across the sweep.
      const key = String(a.motor | 0);
      let pathLen = 0, startPos = null, endPos = null;
      let prev = null;
      const driverValues = [];
      for (const fr of frames) {
        if (typeof fr.value === 'number') driverValues.push(fr.value);
        const t = fr.transforms && fr.transforms[key];
        if (!t) continue;
        const p = [t[3], t[7], t[11]];
        if (!startPos) startPos = p;
        endPos = p;
        if (prev) pathLen += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
        prev = p;
      }
      return {
        op: 'dynamics-motion',
        frames: frames.length,
        allConverged: run.allConverged,
        maxResidual: run.maxResidual,
        driverStart: first ? first.value : null,
        driverEnd: last ? last.value : null,
        driverSwept: (first && last) ? (last.value - first.value) : null,
        startPos, endPos,
        pathLength: pathLen,
      };
    } },

  // 1-D tolerance stack-up (Forge-185 kernel). HONEST SCOPE: this is a
  // *numeric* worst-case + RSS + Monte-Carlo stack on a linear dimension
  // chain — it does NOT read geometry or verify a tolerance against a
  // datum frame. Archie supplies the chain (each link {nominal, plus,
  // minus}); the verb maps to the kernel's {nominal,tolPlus,tolMinus}
  // shape and surfaces the stack nominal/min/max + Cpk. USL/LSL are the
  // assembly spec limits the Cpk is judged against.
  { name: 'simulate.tolerance-stack', discipline: 'simulate', produces: 'report',
    description: '1-D tolerance stack-up on a linear dimension chain. Each link is {nominal, plus, minus} (mm). Returns stack nominal/min/max (worst case), RSS μ/σ, and Cpk vs the assembly spec limits USL/LSL. NUMERIC ONLY — does not read geometry or check a datum frame.',
    parameters: { chain: P('array', '[{nominal, plus, minus, name?, dist?}] linear dimension links (mm); dist 0=normal|1=uniform|2=triangular', { required: true }),
                  USL: P('number', 'upper spec limit on the assembly stack (mm)', { required: true }),
                  LSL: P('number', 'lower spec limit on the assembly stack (mm)', { required: true }),
                  mcSamples: P('uint', 'Monte-Carlo sample count', { default: 10000 }),
                  randomSeed: P('uint', 'Monte-Carlo RNG seed', { default: 42 }) },
    run: ({ chain, USL, LSL, mcSamples, randomSeed }, forge) => {
      if (!forge.tolerance || typeof forge.tolerance.compute !== 'function') {
        throw new Error('forge.tolerance not loaded — build the kernel with Forge-185');
      }
      const links = (Array.isArray(chain) ? chain : []).map((c, i) => ({
        name:     c.name != null ? String(c.name) : `dim${i}`,
        nominal:  +c.nominal || 0,
        // Map the Archie-facing {plus, minus} to the kernel's
        // {tolPlus, tolMinus}; tolMinus is a positive magnitude.
        tolPlus:  Math.abs(+c.plus  || 0),
        tolMinus: Math.abs(+c.minus || 0),
        dist:     (c.dist | 0) || 0,
      }));
      const r = forge.tolerance.compute({
        chain: links,
        USL: +USL, LSL: +LSL,
        mcSamples: (mcSamples | 0) || 10000,
        randomSeed: (randomSeed | 0) || 42,
      });
      return {
        op: 'tolerance-stack',
        links: links.length,
        // Worst-case stack (deterministic): nominal ± Σ|tol|.
        nominal: r.worstCaseNominal,
        min:     r.worstCaseLow,
        max:     r.worstCaseHigh,
        // Statistical (RSS) — the headline Cpk callers ask for.
        rssMu:   r.rssMu,
        rssSigma: r.rssSigma,
        Cp:      r.rssCp,
        Cpk:     r.rssCpk,
        // Monte-Carlo diagnostics.
        mcCpk:   r.mcCpk,
        mcYieldPct: r.mcYieldPct,
        USL: +USL, LSL: +LSL,
        // HONEST: a numeric stack, NOT a geometric tolerance verification.
        note: 'numeric 1-D stack; not a geometric/datum-frame check',
      };
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

  // PMI / MBD annotation (Forge-34 kernel exportStepWithPmi). HONEST
  // SCOPE: this ANNOTATES — it writes datum letters + Feature-Control-
  // Frame strings as an `/* PMI_FCF: … */` ISO-10303-21 comment block into
  // an AP242 STEP file, anchored to faces by {anchorKind, anchorId}. It
  // does NOT verify a tolerance geometrically or build a datum reference
  // frame; an AP242 reader recovers the GD&T text, nothing is checked.
  { name: 'part.annotate-pmi', discipline: 'drawing', produces: 'report',
    description: 'Annotate a shape with PMI / MBD: write datum letters + Feature-Control-Frame (GD&T) strings into an AP242 STEP file as a PMI comment block, anchored to faces. ANNOTATION ONLY — records the GD&T text; does NOT verify tolerances geometrically.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  notes: P('array', '[{text, anchorKind?, anchorId?}] PMI strings, e.g. {text:"|⌖|⌀0.1|A|B|", anchorKind:"face", anchorId:3}', { required: true }),
                  filepath: P('string', 'absolute output .step path the kernel writes to', { required: true }) },
    run: ({ shape, notes, filepath }, forge) => {
      if (!forge.io || typeof forge.io.exportStepWithPmi !== 'function') {
        throw new Error('forge.io.exportStepWithPmi not available — build the kernel with Forge-34');
      }
      const list = (Array.isArray(notes) ? notes : []).map((n) => ({
        text:       String(n.text || ''),
        anchorKind: n.anchorKind != null ? String(n.anchorKind) : '',
        anchorId:   (n.anchorId | 0) || 0,
      }));
      // The kernel writes to an absolute filesystem path. The renderer
      // supplies one from the OS save dialog; headless callers pass a tmp
      // path. We do NOT synthesize one here (no Node fs in the renderer) —
      // surface the real requirement rather than guess a path.
      const fp = filepath && String(filepath).trim();
      if (!fp) {
        throw new Error('part.annotate-pmi: filepath required (absolute .step path the kernel writes to)');
      }
      const ok = forge.io.exportStepWithPmi(shape, fp, list);
      return {
        op: 'annotate-pmi',
        ok: !!ok,
        filepath: fp,
        annotations: list.length,
        // HONEST: text annotation only — not a geometric FCF check.
        note: 'PMI text annotation (datum letters + FCF strings) — not geometrically verified',
      };
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
      return { shape: roundEdges(forge.cut(plate, tool), forge, 1.5) };
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
      return { shape: roundEdges(body, forge, 1.5) };
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
      return { shape: roundEdges(disc, forge, 1.2) };
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
      return { shape: roundEdges(forge.fuse(big, small), forge, 1.0) };
    } },
  { name: 'asset.make-tube', discipline: 'part', produces: 'handle',
    description: 'Hollow tube / pipe: outer cylinder minus a coaxial bore.',
    parameters: { od: P('number', 'outer diameter mm', { default: 50 }), wall: P('number', 'wall thickness mm', { default: 4 }),
                  len: P('number', 'length mm', { default: 80 }) },
    run: (a, forge) => {
      const R = (a.od || 50) / 2, w = a.wall || 4, L = a.len || 80;
      let outer = forge.makeCylinder(R, L);
      let bore = forge.makeCylinder(R - w, L + 4); bore = forge.translate(bore, 0, 0, -2);
      return { shape: roundEdges(forge.cut(outer, bore), forge, 0.8) };
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
      return { shape: roundEdges(body, forge, 1.2) };
    } },
  { name: 'asset.make-spur-gear', discipline: 'part', produces: 'handle',
  description: 'Spur gear: cylinder hub with N radial teeth and centre bore.',
  parameters: { od: P('number', 'outer diameter mm', { default: 80 }), bore: P('number', 'centre bore diameter mm', { default: 20 }),
                thick: P('number', 'thickness mm', { default: 12 }), teeth: P('uint', 'tooth count', { default: 20 }),
                tooth_h: P('number', 'tooth height mm', { default: 8 }), tooth_w: P('number', 'tooth width mm', { default: 6 }) },
  run: (a, forge) => {
    const R = (a.od || 80) / 2, br = (a.bore || 20) / 2, t = a.thick || 12, n = a.teeth || 20;
    const th = a.tooth_h || 8, tw = a.tooth_w || 6;
    const hub_r = R - th;
    let hub = forge.makeCylinder(hub_r, t);
    let cb = forge.makeCylinder(br, t + 4); cb = forge.translate(cb, 0, 0, -2); hub = forge.cut(hub, cb);
    for (let i = 0; i < n; i++) {
      const ang = 2 * Math.PI * i / n;
      const cx = hub_r * Math.cos(ang), cy = hub_r * Math.sin(ang);
      let tooth = forge.makeBox(tw, th, t);
      tooth = forge.translate(tooth, -tw / 2, 0, 0);
      tooth = forge.translate(tooth, cx, cy, 0);
      hub = forge.fuse(hub, tooth);
    }
    return { shape: roundEdges(hub, forge, 0.6) };
  } },
  { name: 'asset.make-washer', discipline: 'part', produces: 'handle',
  description: 'Washer: thin annular disc with outer diameter and centre hole.',
  parameters: { od: P('number', 'outer diameter mm', { default: 25 }), id: P('number', 'inner hole diameter mm', { default: 10 }),
                thick: P('number', 'thickness mm', { default: 2 }) },
  run: (a, forge) => {
    const R = (a.od || 25) / 2, r = (a.id || 10) / 2, t = a.thick || 2;
    let disc = forge.makeCylinder(R, t);
    let bore = forge.makeCylinder(r, t + 4); bore = forge.translate(bore, 0, 0, -2);
    return { shape: roundEdges(forge.cut(disc, bore), forge, 0.4) };
  } },
  { name: 'asset.make-bushing', discipline: 'part', produces: 'handle',
  description: 'Bushing: hollow tube with a radial flange at one end.',
  parameters: { id: P('number', 'inner bore diameter mm', { default: 12 }), od: P('number', 'outer diameter mm', { default: 30 }),
                len: P('number', 'bushing length mm', { default: 25 }), flange_w: P('number', 'flange width mm', { default: 4 }),
                flange_od: P('number', 'flange outer diameter mm', { default: 40 }) },
  run: (a, forge) => {
    const ir = (a.id || 12) / 2, R = (a.od || 30) / 2, L = a.len || 25, fw = a.flange_w || 4, fr = (a.flange_od || 40) / 2;
    let tube = forge.makeCylinder(R, L);
    let bore = forge.makeCylinder(ir, L + 4); bore = forge.translate(bore, 0, 0, -2); tube = forge.cut(tube, bore);
    let flange = forge.makeCylinder(fr, fw);
    flange = forge.translate(flange, 0, 0, L - fw);
    let body = forge.fuse(tube, flange);
    let inner_bore = forge.makeCylinder(ir, fw + 4); inner_bore = forge.translate(inner_bore, 0, 0, L - fw - 2);
    return { shape: roundEdges(forge.cut(body, inner_bore), forge, 0.8) };
  } },
  { name: 'asset.make-pulley', discipline: 'part', produces: 'handle',
  description: 'Pulley: cylinder with two rim flanges, centre bore, and V-groove cut.',
  parameters: { od: P('number', 'outer diameter mm', { default: 100 }), bore: P('number', 'centre bore diameter mm', { default: 20 }),
                width: P('number', 'pulley width mm', { default: 30 }), rim_h: P('number', 'rim flange height mm', { default: 5 }),
                groove_w: P('number', 'V-groove width mm', { default: 15 }), groove_d: P('number', 'V-groove depth mm', { default: 4 }) },
  run: (a, forge) => {
    const R = (a.od || 100) / 2, br = (a.bore || 20) / 2, W = a.width || 30, rh = a.rim_h || 5;
    const gw = a.groove_w || 15, gd = a.groove_d || 4;
    let core = forge.makeCylinder(R, W);
    let cb = forge.makeCylinder(br, W + 4); cb = forge.translate(cb, 0, 0, -2); core = forge.cut(core, cb);
    let rim1 = forge.makeCylinder(R + 2, rh);
    rim1 = forge.translate(rim1, 0, 0, -rh);
    let rim2 = forge.makeCylinder(R + 2, rh);
    rim2 = forge.translate(rim2, 0, 0, W);
    let body = forge.fuse(core, forge.fuse(rim1, rim2));
    let groove = forge.makeCone(gw / 2 + gd / 2, gw / 2 - gd / 2, gd);
    groove = forge.translate(groove, 0, 0, W / 2 - gd / 2);
    return { shape: roundEdges(forge.cut(body, groove), forge, 0.9) };
  } },
  { name: 'asset.make-u-channel', discipline: 'part', produces: 'handle',
  description: 'U-channel: rectangular channel formed by subtracting inner box from outer box.',
  parameters: { len: P('number', 'length mm', { default: 100 }), width: P('number', 'outer width mm', { default: 50 }),
                height: P('number', 'height mm', { default: 40 }), thick: P('number', 'wall thickness mm', { default: 4 }) },
  run: (a, forge) => {
    const L = a.len || 100, W = a.width || 50, H = a.height || 40, t = a.thick || 4;
    let outer = forge.makeBox(L, W, H);
    let inner = forge.makeBox(L - 2 * t, W - 2 * t, H - t);
    inner = forge.translate(inner, t, t, t);
    return { shape: roundEdges(forge.cut(outer, inner), forge, 1.0) };
  } },
  { name: 'asset.make-keyed-shaft', discipline: 'part', produces: 'handle',
  description: 'Keyed shaft: cylinder with a rectangular keyway slot cut radially.',
  parameters: { diameter: P('number', 'shaft diameter mm', { default: 30 }), length: P('number', 'shaft length mm', { default: 80 }),
                key_w: P('number', 'keyway width mm', { default: 8 }), key_d: P('number', 'keyway depth mm', { default: 4 }),
                key_len: P('number', 'keyway length mm', { default: 40 }) },
  run: (a, forge) => {
    const R = (a.diameter || 30) / 2, L = a.length || 80, kw = a.key_w || 8, kd = a.key_d || 4, kl = a.key_len || 40;
    let shaft = forge.makeCylinder(R, L);
    let keyway = forge.makeBox(kw, kd, kl);
    keyway = forge.translate(keyway, -kw / 2, R - kd, (L - kl) / 2);
    return { shape: roundEdges(forge.cut(shaft, keyway), forge, 0.6) };
  } },
  { name: 'asset.make-pipe-tee', discipline: 'part', produces: 'handle',
  description: 'Pipe tee: two perpendicular hollow tubes fused at a junction.',
  parameters: { od: P('number', 'outer diameter mm', { default: 30 }), wall: P('number', 'wall thickness mm', { default: 3 }),
                main_len: P('number', 'main arm length mm', { default: 80 }), branch_len: P('number', 'branch length mm', { default: 60 }) },
  run: (a, forge) => {
    const R = (a.od || 30) / 2, w = a.wall || 3, Lm = a.main_len || 80, Lb = a.branch_len || 60;
    const r = R - w;
    let main = forge.makeCylinder(R, Lm);
    let main_bore = forge.makeCylinder(r, Lm + 4); main_bore = forge.translate(main_bore, 0, 0, -2);
    main = forge.cut(main, main_bore);
    let branch = forge.makeCylinder(R, Lb);
    branch = forge.rotate(branch, 1, 0, 0, Math.PI / 2);
    branch = forge.translate(branch, 0, 0, Lm / 2);
    let branch_bore = forge.makeCylinder(r, Lb + 4);
    branch_bore = forge.rotate(branch_bore, 1, 0, 0, Math.PI / 2);
    branch_bore = forge.translate(branch_bore, 0, 0, Lm / 2);
    let body = forge.fuse(main, branch);
    return { shape: roundEdges(forge.cut(body, forge.cut(main_bore, branch_bore)), forge, 0.7) };
  } },
  { name: 'asset.make-end-cap', discipline: 'part', produces: 'handle',
  description: 'End cap: hollow cup formed by cutting a coaxial bore from the top of a cylinder.',
  parameters: { od: P('number', 'outer diameter mm', { default: 50 }), id: P('number', 'inner hole diameter mm', { default: 40 }),
                height: P('number', 'height mm', { default: 25 }), wall: P('number', 'wall thickness mm', { default: 3 }) },
  run: (a, forge) => {
    const R = (a.od || 50) / 2, r = (a.id || 40) / 2, H = a.height || 25, w = a.wall || 3;
    let cup = forge.makeCylinder(R, H);
    let bore = forge.makeCylinder(r, H - w + 2);
    bore = forge.translate(bore, 0, 0, w - 2);
    return { shape: roundEdges(forge.cut(cup, bore), forge, 0.8) };
  } },

  // ── standard-part vocabulary tier (#58) — recognizable hardware ──
  { name: 'asset.make-hex-nut', discipline: 'part', produces: 'handle',
    description: 'Hex nut: true hexagonal prism with a threaded-bore hole (ISO-style).',
    parameters: { af: P('number', 'across-flats mm', { default: 13 }), thick: P('number', 'thickness mm', { default: 6.5 }), bore: P('number', 'bore (thread) diameter mm', { default: 8 }) },
    run: (a, forge) => {
      const af = a.af || 13, t = a.thick || 6.5, br = (a.bore || 8) / 2;
      let nut = hexPrism(forge, af, t);
      let bore = forge.makeCylinder(br, t + 4); bore = forge.translate(bore, 0, 0, -2);
      return { shape: roundEdges(forge.cut(nut, bore), forge, 0.5) };
    } },
  { name: 'asset.make-hex-bolt', discipline: 'part', produces: 'handle',
    description: 'Hex-head bolt: hexagonal head + cylindrical shank.',
    parameters: { af: P('number', 'head across-flats mm', { default: 13 }), head_h: P('number', 'head height mm', { default: 5.5 }), shank_d: P('number', 'shank diameter mm', { default: 8 }), length: P('number', 'shank length mm', { default: 40 }) },
    run: (a, forge) => {
      const af = a.af || 13, hh = a.head_h || 5.5, sr = (a.shank_d || 8) / 2, L = a.length || 40;
      let head = hexPrism(forge, af, hh);
      let shank = forge.makeCylinder(sr, L); shank = forge.translate(shank, 0, 0, -L);
      return { shape: roundEdges(forge.fuse(head, shank), forge, 0.4) };
    } },
  { name: 'asset.make-socket-screw', discipline: 'part', produces: 'handle',
    description: 'Socket-head cap screw: cylindrical head with a hex socket + shank.',
    parameters: { head_d: P('number', 'head diameter mm', { default: 13 }), head_h: P('number', 'head height mm', { default: 8 }), shank_d: P('number', 'shank diameter mm', { default: 8 }), length: P('number', 'shank length mm', { default: 30 }) },
    run: (a, forge) => {
      const hr = (a.head_d || 13) / 2, hh = a.head_h || 8, sr = (a.shank_d || 8) / 2, L = a.length || 30;
      let head = forge.makeCylinder(hr, hh);
      let sock = hexPrism(forge, hr * 0.95, hh); sock = forge.translate(sock, 0, 0, hh * 0.35);
      head = forge.cut(head, sock);
      let shank = forge.makeCylinder(sr, L); shank = forge.translate(shank, 0, 0, -L);
      return { shape: roundEdges(forge.fuse(head, shank), forge, 0.4) };
    } },
  { name: 'asset.make-hex-standoff', discipline: 'part', produces: 'handle',
    description: 'Hex standoff / spacer: hexagonal prism with a through-bore.',
    parameters: { af: P('number', 'across-flats mm', { default: 10 }), length: P('number', 'length mm', { default: 25 }), bore: P('number', 'bore diameter mm', { default: 4.5 }) },
    run: (a, forge) => {
      const af = a.af || 10, L = a.length || 25, br = (a.bore || 4.5) / 2;
      let body = hexPrism(forge, af, L);
      let bore = forge.makeCylinder(br, L + 4); bore = forge.translate(bore, 0, 0, -2);
      return { shape: roundEdges(forge.cut(body, bore), forge, 0.3) };
    } },
  { name: 'asset.make-ball-bearing', discipline: 'part', produces: 'handle',
    description: 'Deep-groove ball bearing: outer ring + inner ring + a ring of balls.',
    parameters: { od: P('number', 'outer diameter mm', { default: 42 }), id: P('number', 'bore diameter mm', { default: 20 }), width: P('number', 'width mm', { default: 12 }), balls: P('uint', 'ball count', { default: 9 }) },
    run: (a, forge) => {
      const R = (a.od || 42) / 2, ir = (a.id || 20) / 2, W = a.width || 12, n = a.balls || 9;
      const raceR = (R + ir) / 2, ballR = (R - ir) * 0.22;
      let outer = forge.makeCylinder(R, W); let ob = forge.makeCylinder(raceR + ballR * 0.7, W + 4); ob = forge.translate(ob, 0, 0, -2); outer = forge.cut(outer, ob);
      let inner = forge.makeCylinder(raceR - ballR * 0.7, W); let ib = forge.makeCylinder(ir, W + 4); ib = forge.translate(ib, 0, 0, -2); inner = forge.cut(inner, ib);
      let body = forge.fuse(outer, inner);
      for (let i = 0; i < n; i++) { const ang = 2 * Math.PI * i / n; let ball = forge.makeSphere(ballR); ball = forge.translate(ball, raceR * Math.cos(ang), raceR * Math.sin(ang), W / 2); body = forge.fuse(body, ball); }
      return { shape: body };
    } },
  { name: 'asset.make-tslot-extrusion', discipline: 'part', produces: 'handle',
    description: 'Aluminium T-slot extrusion: square profile with a T-slot channel on each face + centre bore.',
    parameters: { size: P('number', 'profile size mm (e.g. 20)', { default: 20 }), length: P('number', 'length mm', { default: 120 }), slot: P('number', 'slot width mm', { default: 6 }) },
    run: (a, forge) => {
      const s = a.size || 20, L = a.length || 120, sw = a.slot || 6, h = s / 2;
      let body = forge.makeBox(s, s, L); body = forge.translate(body, -h, -h, 0);
      let cb = forge.makeCylinder(sw * 0.45, L + 4); cb = forge.translate(cb, 0, 0, -2); body = forge.cut(body, cb);
      const slotL = L + 4;
      for (let f = 0; f < 4; f++) {
        const ang = f * Math.PI / 2;
        let mouth = forge.makeBox(sw, s, slotL); mouth = forge.translate(mouth, -sw / 2, h - sw, -2);
        let cav = forge.makeBox(sw * 1.7, sw * 1.2, slotL); cav = forge.translate(cav, -sw * 0.85, h - sw * 2.0, -2);
        let cut = forge.fuse(mouth, cav);
        if (ang) cut = forge.rotate(cut, 0, 0, 1, ang);
        body = forge.cut(body, cut);
      }
      return { shape: roundEdges(body, forge, 0.6) };
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
  // Per-sequence context for the handle-free CONTEXT/PATTERN verbs (part.begin/
  // add/subtract/intersect/finish + the pattern verbs). `ctx.current` is the
  // implicit "current part" handle the build123d-style API mutates. Non-context
  // verbs receive ctx as a 3rd arg and simply ignore it → fully backward compatible.
  const ctx = opts.ctx || { current: null };
  try {
    const result = await Promise.resolve(spec.run(args, forge, ctx));
    return { ok: true, tool: name, args, produces: spec.produces, result, current: ctx.current };
  } catch (e) {
    return { ok: false, tool: name, args, error: e.message || String(e) };
  }
}

/** Keys under `result` that may carry a kernel handle, in scoring priority. */
const HANDLE_KEYS = [
  'shape', 'sketchId', 'instanceId', 'mateId', 'face',
  'pointId', 'lineId', 'circleId', 'constraintId',
];

/**
 * Replay an ordered list of Archie tool_calls against a supplied `forge`,
 * threading nothing implicitly (handles are referenced by int in each
 * call's own arguments, exactly as the corpus encodes them). Stateless and
 * side-effect-free beyond the kernel handle registry that `forge` owns.
 *
 * @param {Array<{name:string, arguments?:object, args?:object}>} calls
 * @param {object} forge  injected kernel facade (raw kernel or headless factory)
 * @param {object} [ctx]  per-sequence implicit "current part" context for the
 *   handle-free CONTEXT/PATTERN verbs. Defaults to a fresh `{current:null}`.
 *   Threaded as the 3rd arg to every `spec.run(args, forge, ctx)`; only the
 *   context verbs read/write it, so legacy explicit-handle rows are unaffected.
 * @returns {Promise<{handles:number[], lastHandle:?number, current:?number,
 *                     errors:Array<{index,tool,error}>, dispatched:object[]}>}
 *   - `handles`: every body handle produced, in order
 *   - `lastHandle`: last SOLID body handle (`result.shape` > 0) — the final
 *     body to score; booleans/transforms/features return fresh handles that
 *     supersede their inputs, so this lands on the terminal body.
 *   - `current`: `ctx.current` — the terminal body of a CONTEXT sequence
 *     (part.begin…part.finish). The scorer should prefer `current ?? lastHandle`.
 */
export async function dispatchSequence(calls, forge, ctx = { current: null }) {
  const handles = [];
  const errors = [];
  const dispatched = [];
  let lastHandle = null;

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const res = await dispatchToolCall(
      { name: call.name, arguments: call.arguments || call.args || {} },
      { forge, ctx },
    );
    dispatched.push(res);

    if (!res.ok) { errors.push({ index: i, tool: call.name, error: res.error }); continue; }
    if (res.produces !== 'handle') continue; // skip report/mesh/gcode verbs

    const r = res.result || {};
    if (typeof r.shape === 'number' && r.shape > 0) {
      handles.push(r.shape);
      lastHandle = r.shape; // last produced solid wins
    } else {
      for (const k of HANDLE_KEYS) {
        if (typeof r[k] === 'number' && r[k] > 0) { handles.push(r[k]); break; }
      }
    }
  }
  // ctx.current is the authoritative terminal body for a CONTEXT sequence; for
  // pure explicit-handle sequences it stays null and the scorer falls back to
  // lastHandle. Mirror ctx.current into lastHandle when set so existing callers
  // that only read lastHandle still terminate on the right body.
  if (typeof ctx.current === 'number' && ctx.current > 0) {
    if (!handles.includes(ctx.current)) handles.push(ctx.current);
    lastHandle = ctx.current;
  }
  return { handles, lastHandle, current: ctx.current ?? null, errors, dispatched };
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
