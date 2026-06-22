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
import { exportRobot } from '../forge-v4/io/robotExport.js';
import { exportArchival, verifyArchival } from '../forge-v4/io/archivalExport.js';
import { ecadImportBoard, ecadExportBoard, routeHarness as ecadRouteHarness } from '../forge-v4/ecad/ecadBridge.js';
import {
  indexVault, findSimilar, findDuplicates, retrieveThenEdit,
} from '../forge-v4/pdm/partRetrieval.js';
import { listItems } from '../forge-v4/pdmStore.js';
import {
  commit as vcsCommit, branch as vcsBranch, merge as vcsMerge,
  mergeBranches as vcsMergeBranches, diff as vcsDiff,
  whereUsed as vcsWhereUsed, impact as vcsImpact,
} from '../forge-v4/pdm/versionControl.js';
import {
  generateDrawing, regenerateDrawing,
  setForgeKernel as setAutoDrawingKernel,
} from '../forge-v4/drawing/autoDrawing.js';
import {
  captureRationale as rtCapture, queryRationale as rtQuery,
  listRationale as rtList, rationaleFromOp as rtFromOp,
} from '../forge-v4/rationale/designRationale.js';
import {
  trainSurrogate, predictSurrogate,
} from '../forge-v4/ml/surrogate.js';
import {
  mbdCompleteness, prePlmRelease,
} from '../forge-v4/plm/prerelease.js';

// Node `fs` resolver — ESM-safe. In the Electron renderer (nodeIntegration) a
// global `require` is injected, so the JS exporters fall back to it; but in a
// plain node-ESM context (node --test) `require` is undefined. We then load the
// `node:fs` builtin (the same pattern GitLfsBackend.js / FilesystemPartStore.js
// already use in this frontend) so file-writing verbs are testable outside
// Electron. Returns null in the browser — callers use forge.io / forge.dialog.
let _nodeFs = null;
function nodeFsSync() {
  if (_nodeFs) return _nodeFs;
  try {
    if (typeof require === 'function') { _nodeFs = require('fs'); return _nodeFs; }
  } catch (_) { /* fall through to dynamic import */ }
  return null; // synchronous path unavailable; use ensureNodeFs() to preload
}
// Preloads node:fs for the node-ESM (test) path. Resolves to fs or null.
async function ensureNodeFs() {
  if (_nodeFs) return _nodeFs;
  const sync = nodeFsSync();
  if (sync) return sync;
  try {
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
    if (isNode) { _nodeFs = (await import('node:fs')).default; }
  } catch (_) { /* not in node — stays null */ }
  return _nodeFs;
}

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

// Round/break ALL edges of a body for an explicit user radius. Returns the
// new handle and, critically, a truthful `applied` flag so part.finish never
// SILENTLY drops the edge break.
//
// History: the old version capped at edgeCount > 16 and returned the UNchanged
// shape with no flag — so finish{fillet} on an 18-edge body (box+boss+bore)
// reported ok/terminal yet shipped raw boolean blocks. The cap existed because
// a single all-edge BRepFilletAPI pass on a dense edge set (bolt circles, gear
// teeth) can self-intersect and fail. The real fix is to attempt the fillet
// for ANY edge count and, when OCCT can't take the whole set at once, fall back
// to an edge-by-edge pass (each edge filleted independently and re-applied),
// only skipping the individual edges OCCT genuinely rejects. The caller learns
// what happened via { handle, applied, edgesTotal, edgesDone }.
// Greedily build the largest edge id set that the kernel op accepts in ONE
// pass against the ORIGINAL body, then apply it. Edge ids re-enumerate after
// every fillet/chamfer, so we must never iterate ids against a mutating
// handle (that skips most edges — the bug that made the naive per-edge
// fallback round only ~4/27 edges). Testing each candidate against the
// stable original body, then a single final pass, rounds essentially every
// compatible edge (e.g. 26/27 — only OCCT-incompatible seam edges drop).
function greedyEdgeOp(forge, shape, applyIds /* (ids) => newHandle|0 */) {
  const n = forge?.direct?.edgeCount ? forge.direct.edgeCount(shape) : 0;
  if (!n) return { handle: shape, applied: false, edgesTotal: 0, edgesDone: 0 };
  const tryIds = (ids) => {
    try { const r = applyIds(ids); return (typeof r === 'number' && r > 0) ? r : 0; }
    catch (_) { return 0; }
  };
  // Fast path: every edge in one pass.
  const all = Array.from({ length: n }, (_, i) => i);
  const whole = tryIds(all);
  if (whole) return { handle: whole, applied: true, edgesTotal: n, edgesDone: n };
  // Robust path: greedily accumulate the compatible-edge subset (all tests on
  // the ORIGINAL body, never a mutated handle), then apply the kept set once.
  const keep = [];
  for (let i = 0; i < n; i++) {
    if (tryIds([...keep, i])) keep.push(i);
  }
  if (!keep.length) return { handle: shape, applied: false, edgesTotal: n, edgesDone: 0 };
  const final = tryIds(keep);
  return final
    ? { handle: final, applied: true, edgesTotal: n, edgesDone: keep.length }
    : { handle: shape, applied: false, edgesTotal: n, edgesDone: 0 };
}
function filletAllEdges(forge, shape, radius) {
  return greedyEdgeOp(forge, shape, (ids) => forge.part.filletEdges(shape, ids, radius));
}
function chamferAllEdges(forge, shape, distance) {
  return greedyEdgeOp(forge, shape, (ids) => forge.part.chamferEdges(shape, ids, distance, -1));
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
//   MULTIBODY-DYNAMICS helpers (the rigorous inertial DAE solver)
// ===================================================================
// forge.simulate.multibodyDynamics(cfg) integrates the constrained Newton-Euler
// equations of motion (HHT-α + Baumgarte) — the REAL dynamics solver, validated
// closed-form (pendulum 0.016 %, rotor 0.00 %). UNLIKE the FEA verbs it does NOT
// consume a mesh or a shape handle: each body is an inertial point (mass +
// inertia tensor + initial COM pose/velocity). The bodies/constraints are the
// ASSEMBLY: the corpus + Archie describe them as the moving members of the
// motion study (a rotor spinning under torque, a pendulum/linkage swinging under
// gravity), mirroring how simulate.dynamics-motion reads the mate assembly.
//
// `inertia` is a row-major 3×3 about the COM (kg·m²). When Archie supplies only
// a mass + a coarse size, we estimate a solid-box inertia so a study is still
// physically sane. When a `shape` handle is given we derive mass = ρ·V (massProps
// volume is in mm³ → m³) and a box-AABB inertia, so a study can be hung off a
// built part with one number (density). SI throughout (kg, m, N, rad).

// Solid-cuboid inertia about the COM (kg·m²) for a box of full extents
// (ax,ay,az) metres and mass m. Diagonal — Ixx=m(ay²+az²)/12 etc.
function boxInertia(m, ax, ay, az) {
  const Ixx = m * (ay * ay + az * az) / 12;
  const Iyy = m * (ax * ax + az * az) / 12;
  const Izz = m * (ax * ax + ay * ay) / 12;
  return [Ixx, 0, 0, 0, Iyy, 0, 0, 0, Izz];
}

// Coerce one Archie-supplied body bag into the kernel MbdBody shape. Accepts an
// explicit inertia[9], OR a mass + {size:[ax,ay,az] m} solid-box estimate, OR a
// shape handle + density (kg/m³) → mass = ρ·V, box-AABB inertia. Position /
// velocities default to rest at the origin. Returns the kernel-ready object.
function mbdBody(forge, b) {
  const out = {};
  // --- mass + inertia ---
  let mass = (typeof b.mass === 'number' && b.mass > 0) ? b.mass : null;
  let inertia = (Array.isArray(b.inertia) && b.inertia.length === 9)
    ? b.inertia.map(Number) : null;
  // Size in metres for a box inertia estimate; or derive from a shape handle.
  let size = Array.isArray(b.size) && b.size.length === 3 ? b.size.map(Number) : null;
  if ((mass == null || inertia == null) && typeof b.shape === 'number' && b.shape > 0
      && typeof forge.massProps === 'function') {
    const mp = forge.massProps(b.shape);
    const Vm3 = (Number(mp.volume) || 0) / 1e9;          // mm³ → m³
    const rho = (typeof b.density === 'number' && b.density > 0) ? b.density : 7850; // steel
    if (mass == null && Vm3 > 0) mass = rho * Vm3;
    if (!size && typeof forge.tessellate === 'function') {
      // AABB of the body (mm) → metre extents for the box-inertia estimate.
      try {
        const mesh = forge.tessellate(b.shape, 1.0, 0.8);
        const p = mesh.positions || [];
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < p.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            const v = p[i + k];
            if (v < lo[k]) lo[k] = v;
            if (v > hi[k]) hi[k] = v;
          }
        }
        if (Number.isFinite(lo[0])) size = [(hi[0] - lo[0]) / 1000, (hi[1] - lo[1]) / 1000, (hi[2] - lo[2]) / 1000];
      } catch (_) { /* leave size null → identity inertia fallback below */ }
    }
  }
  if (mass == null) mass = 1.0;
  if (inertia == null) {
    inertia = size ? boxInertia(mass, size[0] || 0.1, size[1] || 0.1, size[2] || 0.1)
                   : null; // null → kernel defaults to identity inertia
  }
  out.mass = mass;
  if (inertia) out.inertia = inertia;
  const v3 = (k, d = [0, 0, 0]) => (Array.isArray(b[k]) && b[k].length === 3 ? b[k].map(Number) : d);
  out.position    = v3('position');
  out.orientation = v3('orientation');
  out.linVel      = v3('linVel');
  out.angVel      = v3('angVel');
  return out;
}

// Coerce one constraint bag → kernel MbdConstraint. kind is ballJoint|axisLock|
// distance (the three the kernel supports). Defaults pin bodyA's local origin to
// a world anchor (BallJoint), the Z axis (AxisLock), or value-separation
// (Distance).
function mbdConstraint(c) {
  const kindRaw = String(c.kind || 'ballJoint').toLowerCase();
  let kind = 'ballJoint';
  if (kindRaw.startsWith('axis')) kind = 'axisLock';
  else if (kindRaw.startsWith('dist')) kind = 'distance';
  const v3 = (k, d) => (Array.isArray(c[k]) && c[k].length === 3 ? c[k].map(Number) : d);
  const out = {
    kind,
    bodyA: (c.bodyA | 0) || 0,
    bodyB: (c.bodyB | 0) || 0,
    pointA: v3('pointA', [0, 0, 0]),
    pointB: v3('pointB', [0, 0, 0]),
    anchor: v3('anchor', [0, 0, 0]),
    axis:   v3('axis',   [0, 0, 1]),
  };
  if (typeof c.value === 'number') out.value = c.value;
  return out;
}

// Build the canonical bodies+constraints+loads for a named study so Archie can
// run a motion study with a couple of plain numbers (mirrors how the FEA verbs
// let Archie name a face + a force instead of node lists). Returns {bodies,
// constraints, loads, gravity} all SI. The pendulum / rotor presets are exactly
// the closed-form-validated benchmark cases (pendulum 0.016 %, rotor 0.00 %).
//   pendulum — point mass `mass` on a rod `length` m, pinned at the origin by a
//              BallJoint, swinging under gravity from `angleDeg` off vertical.
//   rotor    — disk (mass, radius m) spun about +Z by a constant `torque` N·m,
//              its spin axis locked by an AxisLock; reports the spin-up.
function mbdStudy(study, a) {
  const g = Array.isArray(a.gravity) && a.gravity.length === 3 ? a.gravity.map(Number) : null;
  if (study === 'rotor') {
    const m = (typeof a.mass === 'number' && a.mass > 0) ? a.mass : 2.0;
    const R = (typeof a.radius === 'number' && a.radius > 0) ? a.radius : 0.1;
    const Iz = 0.5 * m * R * R;                       // solid-disk polar inertia
    const torque = (typeof a.torque === 'number') ? a.torque : 1.0;
    return {
      bodies: [{ mass: m, inertia: [Iz, 0, 0, 0, Iz, 0, 0, 0, Iz] }],
      constraints: [
        { kind: 'ballJoint', bodyA: 0, pointA: [0, 0, 0], anchor: [0, 0, 0] },
        { kind: 'axisLock',  bodyA: 0, axis: [0, 0, 1] },
      ],
      loads: [{ body: 0, torque: [0, 0, torque] }],
      gravity: g || [0, 0, 0],
    };
  }
  // default: pendulum
  const m = (typeof a.mass === 'number' && a.mass > 0) ? a.mass : 1.0;
  const L = (typeof a.length === 'number' && a.length > 0) ? a.length : 1.0;
  const th = DEG(typeof a.angleDeg === 'number' ? a.angleDeg : 30);
  // Bob hangs at -Z from the pivot; start it `th` off the −Z vertical (about +Y).
  const pos = [L * Math.sin(th), 0, -L * Math.cos(th)];
  // BallJoint pins the bob's COM-relative pivot point back to the world origin.
  return {
    bodies: [{ mass: m, position: pos, inertia: [1e-4, 0, 0, 0, 1e-4, 0, 0, 0, 1e-4] }],
    constraints: [
      { kind: 'ballJoint', bodyA: 0, pointA: [-pos[0], -pos[1], -pos[2]], anchor: [0, 0, 0] },
    ],
    loads: [],
    gravity: g || [0, 0, -9.81],
  };
}

// Finite-ness guard for the returned samples — the headless verify + the UI
// animation both need every sample component to be a real number.
function mbdSamplesFinite(samples) {
  if (!Array.isArray(samples) || !samples.length) return false;
  for (const s of samples) {
    if (!Number.isFinite(s.t)) return false;
    for (const arr of [s.position, s.orientation, s.linVel, s.angVel]) {
      if (!Array.isArray(arr)) return false;
      for (const v of arr) for (const x of v) if (!Number.isFinite(x)) return false;
    }
    if (!Number.isFinite(s.constraintResidual) || !Number.isFinite(s.energy)) return false;
  }
  return true;
}

// ===================================================================
//   GD&T / PMI helpers (assembly-context conditioning — task #72)
// ===================================================================
// HONEST SCOPE (verified against forge-kernel.node 2026-06-18): the ONLY
// native PMI-capable kernel op is `io.exportStepWithPmi(handle, path, notes[])`
// where each note is a PmiNote {text, anchorKind, anchorId}. There is NO native
// `gdt`/`datum`/`pmi` namespace, NO datum store, and NO geometric FCF/position
// evaluator on the kernel handle path. So the gdt.* verbs below AUTHOR GD&T:
// they compose ASME Y14.5 datum + Feature-Control-Frame strings (including ones
// that REFERENCE A MATING PART's datum) and attach them as PMI to an AP242 STEP
// file via that one bound op. They do NOT geometrically verify a tolerance.
//
// ASME Y14.5 geometric-characteristic symbols (Unicode). The string form a real
// FCF takes is  |<sym>|<Ø?><tol><modifier?>|<datum>|<datum>|…  — exactly what
// the PmiNote.text field carries and what the gdt_relative corpus already emits.
const GDT_SYMBOL = {
  position: '⌖',        // ⌖  positional
  concentricity: '◎',   // ◎  concentricity / coaxiality
  symmetry: '⌯',        // ⌯  symmetry
  flatness: '⏥',        // ⏥  flatness
  straightness: '—',    // —  straightness
  circularity: '○',     // ○  circularity / roundness
  cylindricity: '⌭',    // ⌭  cylindricity
  perpendicularity: '⟂',// ⟂  perpendicularity
  parallelism: '∥',     // ∥  parallelism
  angularity: '∠',      // ∠  angularity
  profileLine: '⌒',     // ⌒  profile of a line
  profileSurface: '⌓',  // ⌓  profile of a surface
  runout: '↗',          // ↗  circular runout
  totalRunout: '↗↗', // ↗↗ total runout
};
// Material-condition modifiers appended to the tolerance value.
const GDT_MODIFIER = { mmc: 'Ⓜ', lmc: 'Ⓛ', rfs: '' }; // Ⓜ / Ⓛ / (none)

function gdtCharSymbol(characteristic) {
  const key = String(characteristic || 'position')
    .replace(/[^a-z]/gi, '').toLowerCase();
  const alias = {
    pos: 'position', truepos: 'position', truepositon: 'position',
    conc: 'concentricity', coax: 'concentricity', coaxiality: 'concentricity',
    perp: 'perpendicularity', para: 'parallelism', parallel: 'parallelism',
    flat: 'flatness', round: 'circularity', roundness: 'circularity',
    cyl: 'cylindricity', sym: 'symmetry', ang: 'angularity',
    runOut: 'runout', total: 'totalRunout', profile: 'profileSurface',
  };
  const k = GDT_SYMBOL[key] ? key : (alias[key] || key);
  return { key: k, sym: GDT_SYMBOL[k] || GDT_SYMBOL.position };
}

// Build one ASME Y14.5 Feature-Control-Frame string. `datums` is the ordered
// list of datum-reference letters (primary, secondary, tertiary) — for an
// ASSEMBLY-CONTEXT tolerance these are the MATING PART's datum letters, so the
// authored FCF reads "position of THIS feature wrt the mating part's datum A".
function buildFcf({ characteristic, tolerance, diametral = false, modifier = 'rfs', datums = [] }) {
  const { sym } = gdtCharSymbol(characteristic);
  const tol = Number(tolerance);
  const dia = diametral ? 'Ø' : '';                 // Ø for cylindrical zones
  const mod = GDT_MODIFIER[String(modifier).toLowerCase()] || '';
  const tolField = `${dia}${Number.isFinite(tol) ? tol : 0}${mod}`;
  const refs = (Array.isArray(datums) ? datums : [datums])
    .filter((d) => d != null && String(d).trim() !== '')
    .map((d) => String(d).trim().toUpperCase());
  return `|${sym}|${tolField}|${refs.join('|')}${refs.length ? '|' : ''}`;
}

// The PMI note list lives on the per-sequence ctx (like ctx.current for the
// context-build verbs) so a build can author several datums + FCFs across
// turns, then flush once. Returns the live array, creating it on first use.
function gdtNotes(ctx) {
  if (!ctx) return [];
  if (!Array.isArray(ctx.gdt)) ctx.gdt = [];
  return ctx.gdt;
}

// Flush accumulated PMI notes to an AP242 STEP file via the one bound kernel op.
// `shape` is the body the GD&T annotates (the part the datums/FCFs sit on).
// Returns { ok, filepath, annotations } or throws if the op isn't built.
function flushPmi(forge, shape, filepath, notes) {
  if (!forge.io || typeof forge.io.exportStepWithPmi !== 'function') {
    throw new Error('forge.io.exportStepWithPmi not available — build the kernel with Forge-34');
  }
  if (!(typeof shape === 'number' && shape > 0)) {
    throw new Error('a valid shape handle is required to write PMI');
  }
  const fp = filepath && String(filepath).trim();
  if (!fp) throw new Error('filepath required (absolute .step path the kernel writes to)');
  const list = notes.map((n) => ({
    text: String(n.text || ''),
    anchorKind: n.anchorKind != null ? String(n.anchorKind) : '',
    anchorId: (n.anchorId | 0) || 0,
  }));
  // PmiNote signature is POSITIONAL: exportStepWithPmi(handle, path, notes[]).
  const ok = forge.io.exportStepWithPmi(shape, fp, list);
  return { ok: !!ok, filepath: fp, annotations: list.length };
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

// ── PDM part-retrieval vault index (Task #33) ──────────────────────────────
// Build the fingerprint index from the live PDM vault (pdmStore.listItems())
// joined to the scene's body registry (window.__forgeBodies) by matching the
// item's partNumber/name to a body label/name. The index is cached and rebuilt
// only when the (item-count, body-count) signature changes — fingerprinting
// every body on every call would be wasteful on a large vault.
let _pdmIndexCache = null;
let _pdmIndexSig = '';

function buildPdmVaultIndex(forge) {
  const bodies = (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies))
    ? window.__forgeBodies : [];
  // Join PDM items → bodies by name/label/partNumber. A vault item with no
  // matching scene body is skipped (it has no geometry to fingerprint here);
  // a body with no PDM item is still indexed under its own label so the scene
  // is searchable even before parts are checked into the vault.
  let items = [];
  try { items = listItems(); } catch { items = []; }
  const byKey = new Map();
  for (const b of bodies) {
    const key = String(b.label || b.name || b.id || '').toLowerCase();
    if (key) byKey.set(key, b);
  }
  const parts = [];
  const seen = new Set();
  for (const it of items) {
    const cands = [it.partNumber, it.name].map((s) => String(s || '').toLowerCase());
    const body = cands.map((c) => byKey.get(c)).find(Boolean);
    if (body && Number.isInteger(body.handle)) {
      parts.push({ itemId: it.id, partNumber: it.partNumber, name: it.name, handle: body.handle });
      seen.add(body.id);
    }
  }
  // Add un-vaulted scene bodies so the live scene is always searchable.
  for (const b of bodies) {
    if (seen.has(b.id) || !Number.isInteger(b.handle)) continue;
    parts.push({ itemId: null, partNumber: b.label || b.name || String(b.id),
                 name: b.name || b.label || String(b.id), handle: b.handle });
  }
  const sig = `${items.length}:${bodies.length}:${parts.map((p) => p.handle).join(',')}`;
  if (_pdmIndexCache && _pdmIndexSig === sig) return _pdmIndexCache;
  _pdmIndexCache = indexVault(parts, forge);
  _pdmIndexSig = sig;
  return _pdmIndexCache;
}

/** Strip a vault `part` of its (large) cached descriptor for a JSON response. */
function partSummary(part) {
  if (!part) return null;
  return { itemId: part.itemId ?? null, partNumber: part.partNumber, name: part.name };
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
      const out = { op: 'finish', terminal: true };
      if (a.fillet && a.fillet > 0) {
        const r = filletAllEdges(forge, cur, a.fillet);
        cur = r.handle;
        out.fillet = { applied: r.applied, edgesTotal: r.edgesTotal, edgesDone: r.edgesDone };
        if (!r.applied) out.warning = `fillet ${a.fillet}mm could not be applied to any of ${r.edgesTotal} edges`;
      }
      if (a.chamfer && a.chamfer > 0) {
        const r = chamferAllEdges(forge, cur, a.chamfer);
        cur = r.handle;
        out.chamfer = { applied: r.applied, edgesTotal: r.edgesTotal, edgesDone: r.edgesDone };
        if (!r.applied) out.warning = `chamfer ${a.chamfer}mm could not be applied to any of ${r.edgesTotal} edges`;
      }
      ctx.current = cur;
      return { shape: cur, current: cur, ...out };
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
      const o = Array.isArray(axisOrigin) ? axisOrigin.map(Number) : [0, 0, 0];
      let d = Array.isArray(axisDir) ? axisDir.map(Number) : [0, 1, 0];
      const L = Math.hypot(d[0], d[1], d[2]) || 1;
      d = [d[0] / L, d[1] / L, d[2] / L];
      const ang = DEG(angleDeg ?? 360);
      // The sketcher builds the profile wire flat in the world XY plane (z=0).
      // revolveProfile only yields a SOLID when the axis is COPLANAR with that
      // profile plane (i.e. the axis lies in XY → z-component ≈ 0). When the
      // axis has a Z component (the natural vase/turned-part call: XY profile +
      // Z axis), the flat profile sweeps into a degenerate SHEET (V=0). Fix:
      // revolve canonically about +Y at the origin (always coplanar → real
      // solid), then rigid-map +Y onto the requested axis and translate to the
      // requested origin. For an in-plane axis we keep the direct path so the
      // existing offset-profile usage is byte-for-byte unchanged.
      const inPlane = Math.abs(d[2]) < 1e-6;
      if (inPlane) {
        const sk = buildProfileSketch(forge, profile);
        return { shape: forge.part.revolveProfile(sk, Float64Array.from(o), Float64Array.from(d), ang) };
      }
      const sk = buildProfileSketch(forge, profile);
      let h = forge.part.revolveProfile(sk, new Float64Array([0, 0, 0]), new Float64Array([0, 1, 0]), ang);
      // Rotate +Y → d about (Y × d) by acos(Y·d).
      const dot = d[1]; // [0,1,0]·d
      if (dot < 1 - 1e-9) {
        let cx = 1 * d[2] - 0 * d[1];   // Y×d, Y=[0,1,0]
        let cy = 0 * d[0] - 0 * d[2];
        let cz = 0 * d[1] - 1 * d[0];
        const cl = Math.hypot(cx, cy, cz);
        if (cl < 1e-9) { cx = 1; cy = 0; cz = 0; } // antiparallel → 180° about X
        else { cx /= cl; cy /= cl; cz /= cl; }
        const ang2 = Math.acos(Math.max(-1, Math.min(1, dot)));
        h = forge.rotate(h, cx, cy, cz, ang2);
      }
      if (o[0] || o[1] || o[2]) h = forge.translate(h, o[0], o[1], o[2]);
      return { shape: h };
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

  { name: 'part.loft', discipline: 'part', produces: 'handle',
    description: 'Loft (skin) a solid through ≥2 closed cross-sections stacked along Z → blended transition body (adapter, transition duct, hull, bottle). Each section is a closed [[x,y], …] profile placed at its own z. Sections are listed bottom-to-top.',
    parameters: { sections: P('array', '[{z, profile:[[x,y], …]}, …] ≥2 closed cross-sections (bottom→top)', { required: true }),
                  ruled: P('bool', 'straight rulings between sections (no smoothing)', { default: false }),
                  closed: P('bool', 'close the loft back to the first section (looped)', { default: false }) },
    run: ({ sections, ruled, closed }, forge) => {
      if (!Array.isArray(sections) || sections.length < 2) {
        throw new Error('part.loft needs ≥2 sections, each {z, profile:[[x,y],…]}');
      }
      // The sketcher can only build wires at z=0, so we build each section as a
      // world-positioned 3D polyline WIRE (profileWire) at its own z, then skin
      // them with loftguide.loft. This is what makes the loft a real SOLID
      // (a coplanar all-z=0 loft collapses to a flat sheet, V=0).
      const wires = sections.map((s, i) => {
        const prof = s && Array.isArray(s.profile) ? s.profile : (Array.isArray(s) ? s : null);
        if (!prof || prof.length < 3) throw new Error(`part.loft section ${i} needs a closed profile of ≥3 [x,y] points`);
        const z = s && typeof s.z === 'number' ? s.z : (typeof s.at_z === 'number' ? s.at_z : i * 10);
        const flat = new Float64Array(prof.length * 3);
        for (let j = 0; j < prof.length; j++) { flat[j * 3] = +prof[j][0] || 0; flat[j * 3 + 1] = +prof[j][1] || 0; flat[j * 3 + 2] = z; }
        return forge.part.profileWire(flat, true);
      });
      return { shape: forge.loftguide.loft(wires, [], true, !!ruled), op: 'loft', closed: !!closed };
    } },

  { name: 'part.sweep', discipline: 'part', produces: 'handle',
    description: 'Sweep a closed 2D profile along a 3D path polyline → constant-section swept solid (gasket, extruded rail, handle, channel, trim). The profile is carried perpendicular to the path. Use part.pipe for a simple round tube.',
    parameters: { profile: P('array', '[[x,y], …] closed cross-section (in the plane ⟂ to the path start)', { required: true }),
                  path: P('array', '[[x,y,z], …] ≥2 spine points (mm)', { required: true }) },
    run: ({ profile, path }, forge) => {
      if (!Array.isArray(profile) || profile.length < 3) throw new Error('part.sweep profile needs ≥3 [x,y] points');
      if (!Array.isArray(path) || path.length < 2) throw new Error('part.sweep path needs ≥2 [x,y,z] points');
      const pf = new Float64Array(profile.length * 2);
      for (let i = 0; i < profile.length; i++) { pf[i * 2] = +profile[i][0] || 0; pf[i * 2 + 1] = +profile[i][1] || 0; }
      const pa = new Float64Array(path.length * 3);
      for (let i = 0; i < path.length; i++) { pa[i * 3] = +path[i][0] || 0; pa[i * 3 + 1] = +path[i][1] || 0; pa[i * 3 + 2] = +path[i][2] || 0; }
      return { shape: forge.part.sweepPolyline(pf, pa), op: 'sweep' };
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
    run: ({ shape, neutralPlane, faceIds, angleDeg }, forge) => {
      // The kernel's draftFaces wants the neutral plane as an object
      // {origin, normal}; the model (and this spec) supply it as a face id.
      // The old code passed the raw uint straight through → kernel threw
      // "neutralPlane must be {origin, normal}" for every call. Resolve the
      // face id to its centroid + outward normal via direct.inferFeature
      // (1-based face ids — clamp a 0 to 1). Pass an object plane straight
      // through unchanged so both shapes are accepted.
      let plane = neutralPlane;
      if (!plane || typeof plane !== 'object') {
        let fid = Number(neutralPlane) | 0;
        if (fid < 1) fid = 1; // kernel face ids are 1-based
        const fi = forge.direct.inferFeature(shape, fid);
        plane = { origin: Float64Array.from(fi.centroid), normal: Float64Array.from(fi.normal) };
      } else {
        // normalise array-likes into Float64Array for the kernel binding
        plane = {
          origin: Float64Array.from(plane.origin || [0, 0, 0]),
          normal: Float64Array.from(plane.normal || [0, 0, 1]),
        };
      }
      return { shape: forge.part.draftFaces(shape, plane, faceIds, DEG(angleDeg)) };
    } },

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

  // ===================================================== HEALING / REPAIR
  // Reach the OCCT shape-healing pipeline (window.forge.heal.*) — the kernel
  // methods exist (binding.cpp HealSew/Simplify/AutoFill/AutoRepair/Harmonize),
  // but were never declared as Archie-dispatchable verbs (only checkValidity
  // was). These let Archie repair imported / boolean-corrupted bodies: sew open
  // shells closed, simplify redundant topology, cap missing faces, fix self-
  // intersections, and re-orient face normals. Each returns the healed body
  // handle as `shape` so the sequence threading / scorer lands on it.
  { name: 'heal.sew', discipline: 'part', produces: 'handle',
    description: 'Sew adjacent faces/shells of a shape into a watertight solid within a tolerance (close small open edges from a boolean/import). Returns the sewn body handle + a before/after report (closed, faces, open edges).',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  tolerance: P('number', 'sewing tolerance in mm', { default: 1e-3 }) },
    run: ({ shape, tolerance }, forge) => {
      if (!forge.heal || typeof forge.heal.sewShape !== 'function') {
        throw new Error('forge.heal.sewShape unavailable — build the kernel with Forge-23');
      }
      const r = forge.heal.sewShape(shape, tolerance > 0 ? tolerance : 1e-3);
      if (!r || !(r.handle > 0)) throw new Error('heal.sew: sewShape returned no handle');
      return { shape: r.handle, op: 'heal-sew', report: r.report };
    } },

  { name: 'heal.simplify', discipline: 'part', produces: 'handle',
    description: 'Simplify redundant topology of a shape — unify coplanar faces / collinear edges (and optionally concatenate B-splines). Returns the simplified body handle + face/edge counts before & after. Use to clean up over-tessellated imports / boolean debris.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  unifyFaces: P('boolean', 'merge coplanar faces', { default: true }),
                  unifyEdges: P('boolean', 'merge collinear edges', { default: true }),
                  concatBSplines: P('boolean', 'concatenate adjacent B-spline edges', { default: false }) },
    run: ({ shape, unifyFaces, unifyEdges, concatBSplines }, forge) => {
      if (!forge.heal || typeof forge.heal.simplifyShape !== 'function') {
        throw new Error('forge.heal.simplifyShape unavailable — build the kernel with Forge-23');
      }
      const r = forge.heal.simplifyShape(shape, {
        unifyFaces: unifyFaces !== false,
        unifyEdges: unifyEdges !== false,
        concatBSplines: !!concatBSplines,
      });
      if (!r || !(r.handle > 0)) throw new Error('heal.simplify: simplifyShape returned no handle');
      return { shape: r.handle, op: 'heal-simplify',
        facesBefore: r.facesBefore, facesAfter: r.facesAfter,
        edgesBefore: r.edgesBefore, edgesAfter: r.edgesAfter };
    } },

  { name: 'heal.auto-fill', discipline: 'part', produces: 'handle',
    description: 'Cap missing faces on an open shell — reconstruct the surface over open boundaries to recover a closed solid. Returns the filled body handle + a report (faces added, closed after). Use after deleting a face / on an open imported shell.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  tolerance: P('number', 'fill tolerance in mm', { default: 1e-3 }) },
    run: ({ shape, tolerance }, forge) => {
      if (!forge.heal || typeof forge.heal.autoFillMissingFaces !== 'function') {
        throw new Error('forge.heal.autoFillMissingFaces unavailable — build the kernel with Forge-23');
      }
      const r = forge.heal.autoFillMissingFaces(shape, tolerance > 0 ? tolerance : 1e-3);
      if (!r || !(r.handle > 0)) throw new Error('heal.auto-fill: autoFillMissingFaces returned no handle');
      return { shape: r.handle, op: 'heal-auto-fill', report: r.report };
    } },

  { name: 'heal.auto-repair', discipline: 'part', produces: 'handle',
    description: 'Run the full OCCT auto-repair pass on a shape: fix tolerances, self-intersections, small faces, orientation, and bad wires. Returns the repaired body handle + a report of which fixers fired. Use as a catch-all coherence pass on a suspect / imported body.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  tolerance: P('number', 'repair tolerance in mm', { default: 1e-3 }) },
    run: ({ shape, tolerance }, forge) => {
      if (!forge.heal || typeof forge.heal.autoRepairSelfIntersection !== 'function') {
        throw new Error('forge.heal.autoRepairSelfIntersection unavailable — build the kernel with Forge-23');
      }
      const r = forge.heal.autoRepairSelfIntersection(shape, tolerance > 0 ? tolerance : 1e-3);
      if (!r || !(r.handle > 0)) throw new Error('heal.auto-repair: autoRepairSelfIntersection returned no handle');
      return { shape: r.handle, op: 'heal-auto-repair', report: r.report };
    } },

  { name: 'heal.harmonize-normals', discipline: 'part', produces: 'handle',
    description: 'Re-orient all face normals of a shape to point consistently outward (fix inverted/inconsistent normals from an import or stitch). Returns the re-oriented body handle.',
    parameters: { shape: P('uint', 'shape handle', { required: true }) },
    run: ({ shape }, forge) => {
      if (!forge.heal || typeof forge.heal.harmonizeNormals !== 'function') {
        throw new Error('forge.heal.harmonizeNormals unavailable — build the kernel with Forge-23');
      }
      const h = forge.heal.harmonizeNormals(shape);
      if (!(h > 0)) throw new Error('heal.harmonize-normals: harmonizeNormals returned no handle');
      return { shape: h, op: 'heal-harmonize-normals' };
    } },

  // Validity check under the heal.* namespace. The same capability already
  // ships as `part.check-validity`, but the Archie corpus / kernel name is
  // `forge.heal.checkValidity`, so this exposes it under the matching `heal.`
  // verb id (a `heal.check-validity` tool_call previously errored as unknown).
  // Returns isClosed / isManifold / isOriented + bad face/edge ids.
  { name: 'heal.check-validity', discipline: 'part', produces: 'report',
    description: 'Validate a solid (closed / manifold / oriented; bad faces & edges) — the coherence gate for a body. Alias of part.check-validity under the heal.* namespace.',
    parameters: { shape: P('uint', 'shape handle', { required: true }) },
    run: ({ shape }, forge) => {
      if (!forge.heal || typeof forge.heal.checkValidity !== 'function') {
        throw new Error('forge.heal.checkValidity unavailable — build the kernel with Forge-23');
      }
      const v = forge.heal.checkValidity(shape);
      return { op: 'heal-check-validity',
        isClosed: v.isClosed, isManifold: v.isManifold, isOriented: v.isOriented,
        hasSelfIntersect: v.hasSelfIntersect, hasNonManifoldEdge: v.hasNonManifoldEdge,
        badFaces: v.badFaces, badEdges: v.badEdges };
    } },

  // Kernel-name alias for forge.massProps. The same capability already ships as
  // `part.mass-properties`; this exposes it under the bare kernel verb name the
  // Archie corpus also emits, so a `massProps` tool_call dispatches instead of
  // erroring as an unknown tool. Returns volume (mm³), surface area (mm²) and
  // centre of mass [x,y,z] (mm).
  { name: 'massProps', discipline: 'part', produces: 'report',
    description: 'Mass properties of a body: volume (mm³), surface area (mm²), and centre of mass [x,y,z] (mm). Alias of part.mass-properties.',
    parameters: { shape: P('uint', 'shape handle', { required: true }) },
    run: ({ shape }, forge) => {
      if (typeof forge.massProps !== 'function') {
        throw new Error('forge.massProps unavailable — kernel not loaded');
      }
      return forge.massProps(shape);
    } },

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
    description: 'Linear-static FEA on a shape. Meshes the body, applies nodal loads + pinned BCs, returns max von Mises (Pa), peak displacement (m) and the solver residual. Loads/BCs may be given as explicit nodeId lists OR left empty to clamp fixedFace and push loadFace.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  material: P('object', '{E, nu, rho} (Pa, -, kg/m³)', { required: true }),
                  loads: P('array', '[{nodeId, fx, fy, fz}, ...] nodal forces (N); empty → distribute `force` over loadFace', { default: [] }),
                  pressureLoads: P('array', '[{faceId, pressure}, ...]', { default: [] }),
                  bcs: P('array', '[{nodeId, fx, fy, fz}] pinned DOFs; empty → pin fixedFace', { default: [] }),
                  fixedFace: P('enum', 'face to clamp when bcs empty: -x|+x|-y|+y|-z|+z', { default: '-x' }),
                  loadFace: P('enum', 'face to load when loads empty', { default: '+x' }),
                  force: P('array', '[fx,fy,fz] total force on loadFace (N) when loads empty', { default: [0, 0, -100] }),
                  meshSize: P('number', 'target element size in mm', { default: 5 }) },
    run: (a, forge) => {
      if (!forge.fea || typeof forge.fea.solveStatic !== 'function') {
        throw new Error('forge.fea.solveStatic unavailable — build the kernel with Forge-12');
      }
      const mesh = feaMesh(forge, a.shape, a.meshSize);
      const bcs = (Array.isArray(a.bcs) && a.bcs.length)
        ? a.bcs
        : pinFaceBcs(mesh, faceBit(a.fixedFace, 0));
      let loads = Array.isArray(a.loads) ? a.loads : [];
      if (!loads.length) {
        const f = Array.isArray(a.force) && a.force.length === 3 ? a.force : [0, 0, -100];
        loads = distributeFaceLoad(mesh, faceBit(a.loadFace, 1), f).loads;
      }
      const pres = Array.isArray(a.pressureLoads) ? a.pressureLoads : [];
      const r = forge.fea.solveStatic(mesh, a.material, loads, pres, bcs);
      // Peak nodal displacement magnitude from the DOF vector u (3 per node).
      const u = r.u || [];
      let maxDisp = 0;
      for (let i = 0; i < mesh.nodeCount; i++) {
        const dx = u[3 * i] || 0, dy = u[3 * i + 1] || 0, dz = u[3 * i + 2] || 0;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > maxDisp) maxDisp = d;
      }
      return {
        op: 'fea-static',
        nodes: mesh.nodeCount, elements: mesh.elemCount,
        maxVonMises_Pa: r.maxVonMises,
        maxVonMises_MPa: r.maxVonMises / 1e6,
        maxAtElem: r.maxAtElem,
        maxDisplacement_m: maxDisp,
        residual: r.residual,
      };
    } },

  { name: 'simulate.fea-modal', discipline: 'simulate', produces: 'report',
    description: 'Modal analysis. Meshes the body, pins fixedFace (or an explicit bcs list), returns the first N natural frequencies (Hz). Kernel eigenvalues are ω² (rad²/s²); f = √λ / 2π.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  material: P('object', '{E, nu, rho} (Pa, -, kg/m³)', { required: true }),
                  bcs: P('array', 'pinned-node BC list; empty → pin fixedFace', { default: [] }),
                  fixedFace: P('enum', 'face to clamp when bcs empty: -x|+x|-y|+y|-z|+z', { default: '-x' }),
                  modes: P('uint', 'number of modes', { default: 6 }),
                  meshSize: P('number', 'target element size in mm', { default: 5 }) },
    run: (a, forge) => {
      if (!forge.fea || typeof forge.fea.solveModal !== 'function') {
        throw new Error('forge.fea.solveModal unavailable — build the kernel with Forge-12');
      }
      const mesh = feaMesh(forge, a.shape, a.meshSize);
      const bcs = (Array.isArray(a.bcs) && a.bcs.length)
        ? a.bcs
        : pinFaceBcs(mesh, faceBit(a.fixedFace, 0));
      const nModes = (a.modes | 0) || 6;
      const r = forge.fea.solveModal(mesh, a.material, bcs, nModes);
      const eig = Array.from(r.eigenvalues || []);
      // Eigenvalues are ω² (rad²/s²). f = √λ / 2π. Guard tiny negatives.
      const frequenciesHz = eig.map((l) => (l > 0 ? Math.sqrt(l) / (2 * Math.PI) : 0));
      return {
        op: 'fea-modal',
        nodes: mesh.nodeCount, elements: mesh.elemCount,
        modesCaptured: r.nModes,
        eigenvalues: eig,
        frequenciesHz,
      };
    } },

  { name: 'simulate.fea-dynamic', discipline: 'simulate', produces: 'report',
    description: 'Transient implicit Newmark-β dynamics. Meshes the body, pins fixedFace, applies a nodal load (or distributes `force` over loadFace), integrates 0→tEnd at dt. Returns the peak von Mises envelope (Pa), peak displacement (m) and step count.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  material: P('object', '{E, nu, rho} (Pa, -, kg/m³)', { required: true }),
                  loads: P('array', '[{nodeId, fx, fy, fz}] nodal forces (N); empty → distribute `force` over loadFace', { default: [] }),
                  bcs: P('array', 'pinned-node BC list; empty → pin fixedFace', { default: [] }),
                  fixedFace: P('enum', 'face to clamp when bcs empty: -x|+x|-y|+y|-z|+z', { default: '-x' }),
                  loadFace: P('enum', 'face to load when loads empty', { default: '+x' }),
                  force: P('array', '[fx,fy,fz] total force on loadFace (N) when loads empty', { default: [0, 0, -100] }),
                  tEnd: P('number', 'simulation duration in seconds', { required: true }),
                  dt: P('number', 'time step in seconds', { required: true }),
                  rayleighAlpha: P('number', 'mass-proportional damping', { default: 0 }),
                  rayleighBeta: P('number', 'stiffness-proportional damping', { default: 0 }),
                  meshSize: P('number', 'target element size in mm', { default: 5 }) },
    run: (a, forge) => {
      if (!forge.fea || typeof forge.fea.solveDynamic !== 'function') {
        throw new Error('forge.fea.solveDynamic unavailable — build the kernel with Forge-12');
      }
      const mesh = feaMesh(forge, a.shape, a.meshSize);
      const bcs = (Array.isArray(a.bcs) && a.bcs.length)
        ? a.bcs
        : pinFaceBcs(mesh, faceBit(a.fixedFace, 0));
      let loads = Array.isArray(a.loads) ? a.loads : [];
      if (!loads.length) {
        const f = Array.isArray(a.force) && a.force.length === 3 ? a.force : [0, 0, -100];
        loads = distributeFaceLoad(mesh, faceBit(a.loadFace, 1), f).loads;
      }
      const tEnd = Number(a.tEnd);
      const dt = Number(a.dt);
      if (!(tEnd > 0) || !(dt > 0)) {
        throw new Error('simulate.fea-dynamic: tEnd and dt must be positive seconds');
      }
      const r = forge.fea.solveDynamic(
        mesh, a.material, loads, bcs, tEnd, dt,
        Number(a.rayleighAlpha) || 0, Number(a.rayleighBeta) || 0);
      const envelope = Array.from(r.maxStressEnvelope || []);
      const peakVonMises = envelope.length ? Math.max(...envelope) : 0;
      // Peak nodal displacement magnitude across every captured step.
      let maxDisp = 0;
      for (const step of (r.displacements || [])) {
        for (let i = 0; i < mesh.nodeCount; i++) {
          const dx = step[3 * i] || 0, dy = step[3 * i + 1] || 0, dz = step[3 * i + 2] || 0;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > maxDisp) maxDisp = d;
        }
      }
      return {
        op: 'fea-dynamic',
        nodes: mesh.nodeCount, elements: mesh.elemCount,
        steps: r.stepCount,
        tEnd_s: tEnd, dt_s: dt,
        peakVonMises_Pa: peakVonMises,
        peakVonMises_MPa: peakVonMises / 1e6,
        maxDisplacement_m: maxDisp,
        cpuMs: r.cpuMs,
      };
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

  // RIGOROUS multibody dynamics — the constrained inertial DAE solver
  // (forge.simulate.multibodyDynamics; HHT-α + Baumgarte; closed-form validated:
  // pendulum 0.016 %, rotor 0.00 %). This SUPERSEDES the kinematic
  // dynamics-motion: it time-marches Newton-Euler equations of motion with real
  // mass + inertia, so it captures spin-up under torque, free swing under
  // gravity, and conserves energy on the constraint manifold. Each moving member
  // of the assembly is one inertial body; mates become ballJoint/axisLock/
  // distance constraints. The verb returns the per-step samples (position /
  // orientation / linVel / angVel per body) so the UI thread can ANIMATE the
  // in-motion result, plus the drift + stability diagnostics.
  { name: 'simulate.multibody-dynamics', discipline: 'simulate', produces: 'report',
    description: 'Rigorous constrained multibody dynamics (HHT-α + Baumgarte) — the REAL inertial motion solver (validated: pendulum 0.016%, rotor 0.00%). Time-marches Newton-Euler EOM with mass + inertia, so it captures a rotor spinning UP under torque or a pendulum/linkage swinging under gravity. Two ways to drive it: (1) a `study` preset — study:"rotor"{mass,radius,torque} spins a disk about +Z under a constant torque; study:"pendulum"{mass,length,angleDeg} swings a bob from angleDeg off vertical under gravity. (2) explicit `bodies` (each {mass,inertia?[9],position?,orientation?,linVel?,angVel?} SI; or {shape,density} to derive mass=ρ·V + box inertia from a built body), `constraints` ([{kind:ballJoint|axisLock|distance,bodyA,bodyB?,pointA?,pointB?,anchor?,axis?,value?}]), `loads` ([{body,force?,torque?}]), and `gravity` [gx,gy,gz]. Returns per-step samples (position/orientation/linVel/angVel per body) for animation + maxConstraintDrift, energyDrift, stepsTaken, stable. SI throughout (kg, m, N, N·m, rad). Build the assembly bodies first, then run this.',
    parameters: { study: P('enum', 'preset motion study: rotor|pendulum (omit to specify bodies/constraints/loads explicitly)', { default: null }),
                  bodies: P('array', '[{mass,inertia?,position?,orientation?,linVel?,angVel?}] OR [{shape,density}] inertial bodies (SI). Ignored when `study` is set.', { default: [] }),
                  constraints: P('array', '[{kind:ballJoint|axisLock|distance, bodyA, bodyB?, pointA?, pointB?, anchor?, axis?, value?}] mate constraints', { default: [] }),
                  loads: P('array', '[{body, force?[3], torque?[3]}] constant world-frame loads (N, N·m)', { default: [] }),
                  gravity: P('array', '[gx,gy,gz] uniform gravity m/s² (default [0,0,-9.81] for pendulum, none for rotor)', { default: null }),
                  // study presets:
                  mass: P('number', 'preset body mass (kg)', {}),
                  radius: P('number', 'rotor disk radius (m)', {}),
                  torque: P('number', 'rotor drive torque about +Z (N·m)', {}),
                  length: P('number', 'pendulum rod length (m)', {}),
                  angleDeg: P('number', 'pendulum start angle off vertical (deg)', {}),
                  // integrator config:
                  dt: P('number', 'time step (s)', { default: 1e-3 }),
                  steps: P('uint', 'number of steps', { default: 1000 }),
                  alpha: P('number', 'HHT-α numerical damping (∈[-1/3,0])', { default: -0.05 }),
                  baumgarteOmega: P('number', 'Baumgarte stabilisation frequency (rad/s)', { default: 20 }),
                  baumgarteZeta: P('number', 'Baumgarte damping ratio', { default: 1 }),
                  sampleStride: P('uint', 'record every Nth step (keeps the returned trajectory compact)', { default: 0 }) },
    run: (a, forge, ctx) => {
      if (!forge.simulate || typeof forge.simulate.multibodyDynamics !== 'function') {
        throw new Error('forge.simulate.multibodyDynamics unavailable — build the kernel with the multibody solver (Push-36 MultibodyDynamics)');
      }
      // Resolve the bodies/constraints/loads/gravity — either from a study preset
      // or from explicit Archie-supplied lists. A study preset wins.
      let bodies, constraints, loads, gravity;
      const study = a.study ? String(a.study).toLowerCase() : null;
      if (study === 'rotor' || study === 'pendulum') {
        const s = mbdStudy(study, a);
        bodies = s.bodies; constraints = s.constraints; loads = s.loads; gravity = s.gravity;
      } else {
        let raw = Array.isArray(a.bodies) ? a.bodies : [];
        // Default to the current ctx part as a single body if Archie supplied none
        // (one built body → a one-body study, e.g. a free-fall / torque sanity run).
        if (!raw.length && ctx && typeof ctx.current === 'number' && ctx.current > 0) {
          raw = [{ shape: ctx.current }];
        }
        bodies = raw.map((b) => mbdBody(forge, b || {}));
        constraints = (Array.isArray(a.constraints) ? a.constraints : []).map(mbdConstraint);
        loads = (Array.isArray(a.loads) ? a.loads : []).map((l) => ({
          body: (l.body | 0) || 0,
          force:  Array.isArray(l.force)  && l.force.length  === 3 ? l.force.map(Number)  : [0, 0, 0],
          torque: Array.isArray(l.torque) && l.torque.length === 3 ? l.torque.map(Number) : [0, 0, 0],
        }));
        gravity = Array.isArray(a.gravity) && a.gravity.length === 3 ? a.gravity.map(Number) : [0, 0, 0];
      }
      if (!bodies.length) {
        throw new Error('simulate.multibody-dynamics: need at least one body (give `study`, a `bodies` list, or build a part first)');
      }
      // A default sampleStride keeps the trajectory compact when many steps are
      // requested (≈ 60 samples) so the animation payload stays light.
      const nSteps = Math.max(1, (a.steps | 0) || 1000);
      const stride = (a.sampleStride | 0) > 0 ? (a.sampleStride | 0) : Math.max(1, Math.floor(nSteps / 60));
      const cfg = {
        bodies,
        constraints,
        loads,
        gravity,
        dt: Number(a.dt) > 0 ? Number(a.dt) : 1e-3,
        steps: nSteps,
        alpha: typeof a.alpha === 'number' ? a.alpha : -0.05,
        baumgarteOmega: typeof a.baumgarteOmega === 'number' ? a.baumgarteOmega : 20,
        baumgarteZeta: typeof a.baumgarteZeta === 'number' ? a.baumgarteZeta : 1,
        sampleStride: stride,
      };
      const r = forge.simulate.multibodyDynamics(cfg);
      const samples = Array.isArray(r.samples) ? r.samples : [];
      const finite = mbdSamplesFinite(samples);
      const first = samples[0], last = samples[samples.length - 1];
      return {
        op: 'multibody-dynamics',
        study: study || 'explicit',
        bodyCount: bodies.length,
        constraintCount: constraints.length,
        steps: nSteps,
        sampleStride: stride,
        sampleCount: samples.length,
        stable: !!r.stable && finite,
        maxConstraintDrift: r.maxConstraintDrift,
        energyDrift: r.energyDrift,
        stepsTaken: r.stepsTaken,
        energyStart: first ? first.energy : null,
        energyEnd: last ? last.energy : null,
        finalConstraintResidual: last ? last.constraintResidual : null,
        // Full per-step trajectory for the UI thread to animate the in-motion
        // result (position/orientation/linVel/angVel per body, per sample).
        samples,
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
    run: ({ shape, face, tool, cutParams, zTop, zBottom, leadIn }, forge) => {
      if (!forge.cam || !forge.cam.profile) throw new Error('forge.cam not yet loaded — Forge-13');
      // Kernel signature is POSITIONAL: profile(shape, faceId, tool, cutParams,
      // zTop, zBottom, leadIn). Passing a single object made OCCT reject arg0
      // ('expected handle (uint32) at arg 0'). A null/undefined face → kAutoFaceId
      // (first +Z planar face); an explicit id (incl. 0) is honoured.
      const faceId = (face == null) ? forge.cam.kAutoFaceId : (face >>> 0);
      const tp = forge.cam.profile(shape, faceId, tool, cutParams, +zTop, +zBottom, +leadIn || 0);
      return { op: 'cam-profile', moveCount: tp.moveCount, cycleTimeSec: tp.cycleTimeSec,
               estCuttingMm: tp.estCuttingMm, toolId: tp.toolId, toolpath: tp };
    } },

  { name: 'manufacture.cam-pocket', discipline: 'manufacture', produces: 'report',
    description: '2.5D pocketing toolpath with zigzag fill.',
    parameters: { shape: P('uint', '', { required: true }),
                  face: P('uint', '', { default: 0 }),
                  tool: P('object', '', { required: true }),
                  cutParams: P('object', '', { required: true }),
                  zTop: P('number', '', { required: true }),
                  zBottom: P('number', '', { required: true }) },
    run: ({ shape, face, tool, cutParams, zTop, zBottom }, forge) => {
      if (!forge.cam || !forge.cam.pocket) throw new Error('forge.cam not yet loaded — Forge-13');
      // POSITIONAL: pocket(shape, faceId, tool, cutParams, zTop, zBottom). The
      // old single-object call hit OCCT 'expected handle (uint32) at arg 0'.
      const faceId = (face == null) ? forge.cam.kAutoFaceId : (face >>> 0);
      const tp = forge.cam.pocket(shape, faceId, tool, cutParams, +zTop, +zBottom);
      return { op: 'cam-pocket', moveCount: tp.moveCount, cycleTimeSec: tp.cycleTimeSec,
               estCuttingMm: tp.estCuttingMm, toolId: tp.toolId, toolpath: tp };
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
    run: ({ shape, holes, bit, cutParams, zTop, zBottom, peck }, forge) => {
      if (!forge.cam || !forge.cam.drill) throw new Error('forge.cam not yet loaded — Forge-13');
      // POSITIONAL: drill(shape, holes, bit, cutParams, zTop, zBottom, peck). The
      // old single-object call hit OCCT 'expected handle (uint32) at arg 0'.
      const tp = forge.cam.drill(shape, holes, bit, cutParams, +zTop, +zBottom, peck !== false);
      return { op: 'cam-drill', moveCount: tp.moveCount, cycleTimeSec: tp.cycleTimeSec,
               estCuttingMm: tp.estCuttingMm, toolId: tp.toolId, holes: (holes || []).length, toolpath: tp };
    } },

  { name: 'manufacture.gcode', discipline: 'manufacture', produces: 'gcode',
    description: 'Post-process a toolpath into G-code for a CNC dialect.',
    parameters: { toolpath: P('object', 'toolpath handle/spec', { required: true }),
                  dialect: P('enum', 'Fanuc|Haas|LinuxCNC|Grbl', { default: 'Fanuc' }),
                  safeZ: P('number', 'rapid clearance in mm', { default: 5 }) },
    run: ({ toolpath, dialect, safeZ }, forge) => {
      if (!forge.cam || !forge.cam.gcode) throw new Error('forge.cam not yet loaded — Forge-13');
      // forge.cam.gcode is a NAMESPACE OBJECT ({toGcode, Dialect}), not a callable.
      // The old `forge.cam.gcode(args)` threw 'forge.cam.gcode is not a function'.
      // Correct call is gcode.toGcode(toolpath, dialect, safeZ). The toolpath is
      // the raw kernel toolpath object surfaced by the cam-* verbs under `.toolpath`
      // (a bare toolpath is also accepted).
      if (typeof forge.cam.gcode.toGcode !== 'function') {
        throw new Error('forge.cam.gcode.toGcode unavailable — build the kernel with Forge-13');
      }
      const tp = (toolpath && toolpath.toolpath) ? toolpath.toolpath : toolpath;
      const text = forge.cam.gcode.toGcode(tp, dialect || 'Fanuc', safeZ == null ? 5 : +safeZ);
      return { op: 'gcode', dialect: dialect || 'Fanuc', safeZ: safeZ == null ? 5 : +safeZ,
               bytes: text.length, gcode: text };
    } },

  // ============================================================ IO / IMPORT
  // Import an external CAD file (STEP / STL / BREP / IGES) into a live kernel
  // body and surface its handle so downstream feature/boolean verbs can
  // operate on it. The kernel exposes forge.io.import{Step,Stl,Brep,Iges};
  // there was previously NO import verb on the bridge at all (only the
  // exportStepWithPmi path under part.annotate-pmi). Format is auto-detected
  // from the path extension unless an explicit `format` is given.
  { name: 'io.import', discipline: 'part', produces: 'handle',
    description: 'Import an external CAD file (STEP/STL/BREP/IGES) into the kernel and return its body handle. Format is inferred from the file extension (.step/.stp, .stl, .brep/.brp, .iges/.igs) unless `format` overrides it.',
    parameters: { filepath: P('string', 'absolute path to the CAD file on disk', { required: true }),
                  format: P('enum', 'step|stl|brep|iges (default: inferred from extension)', { default: null }) },
    run: ({ filepath, format }, forge) => {
      if (!forge.io) throw new Error('forge.io unavailable — build the kernel with Forge-21');
      const fp = String(filepath || '');
      if (!fp) throw new Error('io.import requires an absolute filepath');
      // Resolve format: explicit arg wins, else infer from extension.
      let fmt = (format ? String(format) : '').toLowerCase();
      if (!fmt) {
        const ext = (fp.split('.').pop() || '').toLowerCase();
        fmt = ({ step: 'step', stp: 'step', stl: 'stl', brep: 'brep', brp: 'brep',
                 iges: 'iges', igs: 'iges' })[ext] || '';
      }
      const fn = ({ step: 'importStep', stl: 'importStl', brep: 'importBrep', iges: 'importIges' })[fmt];
      if (!fn) throw new Error(`io.import: unsupported/unknown format '${fmt || '(none)'}' for ${fp}`);
      if (typeof forge.io[fn] !== 'function') {
        throw new Error(`forge.io.${fn} unavailable — build the kernel with Forge-21/34`);
      }
      const shape = forge.io[fn](fp);
      if (!(typeof shape === 'number' && shape > 0)) {
        throw new Error(`io.import: ${fn} returned no handle for ${fp}`);
      }
      return { op: 'import', format: fmt, filepath: fp, shape };
    } },

  // Export a kernel body to a STEP (AP242) file. The kernel writes the file
  // to an absolute path (the renderer supplies one from the OS save dialog;
  // headless callers pass a tmp path). We do NOT synthesize a path — surface
  // the real requirement instead of guessing. (For PMI/GD&T-annotated STEP,
  // use part.annotate-pmi which routes through exportStepWithPmi.)
  { name: 'io.export-step', discipline: 'part', produces: 'report',
    description: 'Export a shape to a STEP (ISO-10303 AP242) file at an absolute path. Exact B-Rep — round-trips volume/area. Returns the written path. For GD&T/PMI annotations use part.annotate-pmi instead.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  filepath: P('string', 'absolute output .step/.stp path the kernel writes to', { required: true }) },
    run: ({ shape, filepath }, forge) => {
      if (!forge.io || typeof forge.io.exportStep !== 'function') {
        throw new Error('forge.io.exportStep unavailable — build the kernel with Forge-21');
      }
      if (!(typeof shape === 'number' && shape > 0)) {
        throw new Error('io.export-step: a valid shape handle is required');
      }
      const fp = filepath && String(filepath).trim();
      if (!fp) {
        throw new Error('io.export-step: filepath required (absolute .step path the kernel writes to)');
      }
      const ok = forge.io.exportStep(shape, fp);
      if (!ok) throw new Error(`io.export-step: kernel failed to write STEP to ${fp}`);
      return { op: 'export-step', ok: true, format: 'step', filepath: fp };
    } },

  // Export a kernel body to an STL mesh file (binary by default). Tessellation
  // tolerances are in mm (linear) and radians (angular), matching exportStl.
  { name: 'io.export-stl', discipline: 'part', produces: 'report',
    description: 'Export a shape to an STL mesh file at an absolute path. Tessellates the body (linearTol mm / angularTol rad) and writes binary STL by default (set binary:false for ASCII). Returns the written path.',
    parameters: { shape: P('uint', 'shape handle', { required: true }),
                  filepath: P('string', 'absolute output .stl path the kernel writes to', { required: true }),
                  linearTol: P('number', 'linear deflection tolerance (mm)', { default: 0.1 }),
                  angularTol: P('number', 'angular deflection tolerance (rad)', { default: 0.5 }),
                  binary: P('boolean', 'write binary STL (false → ASCII)', { default: true }) },
    run: ({ shape, filepath, linearTol, angularTol, binary }, forge) => {
      if (!forge.io || typeof forge.io.exportStl !== 'function') {
        throw new Error('forge.io.exportStl unavailable — build the kernel with Forge-21');
      }
      if (!(typeof shape === 'number' && shape > 0)) {
        throw new Error('io.export-stl: a valid shape handle is required');
      }
      const fp = filepath && String(filepath).trim();
      if (!fp) {
        throw new Error('io.export-stl: filepath required (absolute .stl path the kernel writes to)');
      }
      const lin = Number(linearTol) > 0 ? Number(linearTol) : 0.1;
      const ang = Number(angularTol) > 0 ? Number(angularTol) : 0.5;
      // exportStl(handle, path, linTol, angTol, ascii) — ascii = !binary.
      const ascii = binary === false;
      const ok = forge.io.exportStl(shape, fp, lin, ang, ascii);
      if (!ok) throw new Error(`io.export-stl: kernel failed to write STL to ${fp}`);
      return {
        op: 'export-stl', ok: true, format: 'stl', filepath: fp,
        linearTol_mm: lin, angularTol_rad: ang, binary: !ascii,
      };
    } },

  // Task #30 — export the active ASSEMBLY to a robot description (URDF/SDF/
  // USD/MJCF). Per-link inertia/COM/mass come from the kernel mass-props
  // (forge.massProps) about the link COM frame, in SI; collision geometry is an
  // automatic per-link CONVEX HULL (forge.native.convexHull3D) DISTINCT from the
  // full visual mesh; Forge mates map to revolute/prismatic/fixed/continuous
  // joints with axis + limits; and closed chains (four-bars / parallel
  // mechanisms) are preserved — spanning tree + loop closures (SDF extra joint,
  // MJCF <equality><connect>, USD loop joint, URDF <gazebo> block), never
  // silently dropped. `assembly` is a Forge Assembly (parts[]/mates[]) or a
  // normalized spec; meshes + hulls are produced via the kernel binding.
  { name: 'io.export-robot', discipline: 'part', produces: 'file',
    description: 'Export the assembly to a robot description (urdf|sdf|usd|mjcf). Kernel-computed COM-frame inertia, separate convex-hull collision vs full visual mesh, mate→joint mapping with limits, and closed-chain loop closures. Writes the document + per-link _visual/_collision .stl sidecars next to filepath.',
    parameters: { assembly: P('object', 'Forge Assembly (parts[]/mates[]) or normalized robot spec', { required: true }),
                  format: P('enum', 'urdf|sdf|usd|mjcf', { default: 'urdf' }),
                  density: P('number', 'material density kg/m³ (used when a link has no explicit mass)', { default: 1000 }),
                  decimate: P('boolean', 'decimate the visual mesh (LOD1)', { default: false }),
                  baseLink: P('string', 'id/name of the root/base link (default: a fixed link)', { default: null }),
                  filepath: P('string', 'absolute output path for the description document', { required: true }) },
    run: ({ assembly, format, density, decimate, baseLink, filepath }, forge) => {
      const fp = filepath && String(filepath).trim();
      if (!fp) throw new Error('io.export-robot: filepath required (absolute output path)');
      if (!assembly || typeof assembly !== 'object') {
        throw new Error('io.export-robot: an assembly (parts[]/mates[]) or normalized spec is required');
      }
      const fmt = (format || 'urdf').toLowerCase();
      const { text, meshFiles } = exportRobot(assembly, {
        format: fmt, density, decimate, baseLink, forge, withMeshFiles: true,
      });
      // Write the document + sidecar meshes. Prefer the Electron bridge
      // (forge.dialog.writeBlob) used by the other JS exporters; fall back to a
      // kernel text writer or Node fs (Electron-main / test). No new deps.
      const dir = fp.replace(/[^/\\]*$/, '');
      const written = [];
      const writeText = (path, content) => {
        if (forge && forge.io && typeof forge.io.writeTextFile === 'function') {
          forge.io.writeTextFile(path, content);
        } else if (forge && forge.dialog && typeof forge.dialog.writeBlob === 'function') {
          forge.dialog.writeBlob(path, content);
        } else if (typeof require === 'function') {
          // eslint-disable-next-line global-require
          require('fs').writeFileSync(path, content);
        } else {
          throw new Error('io.export-robot: no file-writer available (forge.dialog.writeBlob / fs)');
        }
        written.push(path);
      };
      writeText(fp, text);
      for (const [name, content] of Object.entries(meshFiles)) writeText(dir + name, content);
      return { op: 'export-robot', ok: true, format: fmt, filepath: fp,
               meshFiles: Object.keys(meshFiles).map(n => dir + n), written };
    } },

  // LOTAR / AP242 LONG-TERM ARCHIVAL (Task #40) — the 50-year aerospace /
  // defense archival + certification / traceability gate (EN 9300 / OAIS
  // ISO 14721). Writes the AP242 STEP container (geometry + semantic PMI +
  // product structure) PLUS validation properties (per-body kernel
  // volume/area/centroid/bbox + assembly structure hash) so a future reader can
  // RE-COMPUTE them and prove the geometry did not drift; OAIS info-package
  // metadata + a retention-aware audit trail + a whole-package fixity digest.
  { name: 'io.export-archival', discipline: 'part', produces: 'file',
    description: 'LOTAR/AP242 long-term-archival export (EN 9300 / OAIS ISO 14721). Writes an AP242 STEP container with semantic PMI + product structure PLUS validation properties (per-body kernel volume/area/centroid/bbox + assembly structure hash) + OAIS info-package metadata + retention-aware audit trail + a whole-package fixity digest, so a future reader can re-compute and prove the geometry did not drift.',
    parameters: { partOrAssembly: P('object', 'body {id,name,handle} or Assembly(parts[]/mates[])', { required: true }),
                  retention: P('object', '{years,classification,disposition}', { default: null }),
                  provenance: P('object', '{agent,organization,why,software}', { default: null }),
                  filepath: P('string', 'absolute output path for the .step container', { required: true }) },
    run: (args, forge) => {
      const fp = args.filepath && String(args.filepath).trim();
      if (!fp) throw new Error('io.export-archival: filepath required (absolute output path)');
      if (!args.partOrAssembly || typeof args.partOrAssembly !== 'object') {
        throw new Error('io.export-archival: a body {id,name,handle} or Assembly (parts[]/mates[]) is required');
      }
      const pkg = exportArchival(args.partOrAssembly, {
        retention: args.retention || undefined,
        provenance: args.provenance || undefined,
        forge,
      });
      // Write the AP242 container + the OAIS Archival Information Package
      // (validation properties + metadata + audit + fixity) as a sidecar. Prefer
      // the kernel/Electron writers used by the other JS exporters; fall back to
      // Node fs (Electron-main / test). No new deps.
      const writeText = (path, content) => {
        if (forge && forge.io && typeof forge.io.writeTextFile === 'function') {
          forge.io.writeTextFile(path, content);
        } else if (forge && forge.dialog && typeof forge.dialog.writeBlob === 'function') {
          forge.dialog.writeBlob(path, content);
        } else if (typeof require === 'function') {
          // eslint-disable-next-line global-require
          require('fs').writeFileSync(path, content);
        } else {
          throw new Error('io.export-archival: no file-writer available (forge.dialog.writeBlob / fs)');
        }
      };
      writeText(fp, pkg.ap242);
      const aip = {
        formatVersion: pkg.formatVersion,
        conformance: pkg.conformance,
        validationProperties: pkg.validationProperties,
        oaisMetadata: pkg.oaisMetadata,
        retention: pkg.retention,
        auditTrail: pkg.auditTrail,
        fixity: pkg.fixity,
      };
      writeText(`${fp}.aip.json`, JSON.stringify(aip, null, 2));
      return { op: 'export-archival', ok: true, filepath: fp,
               aip: `${fp}.aip.json`,
               fixity: pkg.fixity.packageDigest,
               bodyCount: pkg.validationProperties.bodies.length,
               structureHash: pkg.validationProperties.structureHash,
               conformance: pkg.conformance.lotar };
    } },

  { name: 'io.verify-archival', discipline: 'part', produces: 'report',
    description: 'Verify a LOTAR archive: re-import the AP242 + re-compute the validation properties + check the fixity digest. Reports {valid, mismatches[]}; a tampered checksum or perturbed geometry is DETECTED.',
    parameters: { archive: P('object', 'ArchivePackage from io.export-archival (the in-memory package, or {ap242, validationProperties, oaisMetadata, retention, conformance, fixity})', { required: true }) },
    run: (args, forge) => {
      const a = args.archive;
      if (!a || typeof a !== 'object') {
        throw new Error('io.verify-archival: an ArchivePackage object is required');
      }
      return { op: 'verify-archival', ...verifyArchival(a, { forge }) };
    } },

  // ============================================================ ECAD ↔ MCAD
  // ECAD↔MCAD BRIDGE + 3D WIRING-HARNESS ROUTING (Task #36). Bidirectional
  // board exchange in the published IDF 3.0 interchange (.emn): import lifts a
  // board (outline + keepouts + drilled holes + component placements) into a
  // 3D MCAD assembly (extruded board slab + a placed/rotated solid per part);
  // export recovers a spec-conformant .emn from that assembly so MCAD→ECAD→MCAD
  // round-trips placements within tolerance. The harness router returns an
  // arc-length-true 3D centerline (straight=‖B−A‖, circular=r·θ, Catmull-Rom
  // spline, or free-hanging catenary L=2a·sinh(d/2a)) — the LENGTH feedback the
  // cut-list / cost model depend on. Delegates routing to the Forge-168
  // harnessRouter; IDF is hand-written ASCII (no new deps).
  { name: 'ecad.import-board', discipline: 'part', produces: 'report',
    description: 'Import an IDF 3.0 .emn board (outline, route/place keepouts, drilled holes, component placements) and LIFT it into a 3D MCAD assembly: an extruded board slab + one placed/rotated solid per component at its package height/side. Returns the parsed board + a normalized assembly (links[]) that feeds io.export-robot / io.export-archival.',
    parameters: { emnText: P('string', 'IDF 3.0 .emn file contents (or pass filepath)', { default: null }),
                  filepath: P('string', 'absolute path to a .emn to read (alternative to emnText)', { default: null }),
                  empText: P('string', 'optional IDF 3.0 .emp library (package outlines/heights for the lift)', { default: null }),
                  units: P('enum', 'MM|THOU (informational; the .emn header is authoritative)', { default: 'MM' }) },
    run: async (args, forge) => {
      let emn = args.emnText && String(args.emnText);
      if (!emn && args.filepath) {
        const fp = String(args.filepath).trim();
        if (forge && forge.io && typeof forge.io.readTextFile === 'function') {
          emn = forge.io.readTextFile(fp);
        } else {
          const fs = await ensureNodeFs();
          if (!fs) throw new Error('ecad.import-board: no file-reader available (forge.io.readTextFile / fs)');
          emn = fs.readFileSync(fp, 'utf8');
        }
      }
      if (!emn) throw new Error('ecad.import-board: emnText or filepath required');
      const { board, assembly, counts } = ecadImportBoard(emn, { empText: args.empText || undefined, forge });
      return { op: 'import-board', ok: true, board, assembly, counts };
    } },

  { name: 'ecad.export-board', discipline: 'part', produces: 'file',
    description: 'Write a spec-conformant IDF 3.0 .emn board file (.HEADER/.BOARD_OUTLINE/.ROUTE_KEEPOUT/.PLACE_KEEPOUT/.DRILLED_HOLES/.PLACEMENT) carrying the outline, keepouts, drilled holes and component placements. Accepts a normalized board spec OR an MCAD assembly from ecad.import-board (placements recovered from the lifted bodies). Round-trips losslessly with ecad.import-board.',
    parameters: { board: P('object', 'normalized board spec {outline,holes,keepouts,components} OR an MCAD assembly {links[]/parts[]} from ecad.import-board', { required: true }),
                  units: P('enum', 'MM|THOU', { default: 'MM' }),
                  filepath: P('string', 'absolute output path for the .emn', { required: true }) },
    run: async (args, forge) => {
      const fp = args.filepath && String(args.filepath).trim();
      if (!fp) throw new Error('ecad.export-board: filepath required (absolute output path)');
      if (!args.board || typeof args.board !== 'object') {
        throw new Error('ecad.export-board: a board spec or MCAD assembly is required');
      }
      const emn = ecadExportBoard(args.board, { units: args.units, forge });
      // File-writer cascade — same as io.export-robot/io.export-archival, but
      // node:fs is loaded via ensureNodeFs() so the verb is testable in ESM.
      const nfs = await ensureNodeFs();
      const writeText = (path, content) => {
        if (forge && forge.io && typeof forge.io.writeTextFile === 'function') {
          forge.io.writeTextFile(path, content);
        } else if (forge && forge.dialog && typeof forge.dialog.writeBlob === 'function') {
          forge.dialog.writeBlob(path, content);
        } else if (nfs) {
          nfs.writeFileSync(path, content);
        } else {
          throw new Error('ecad.export-board: no file-writer available (forge.dialog.writeBlob / fs)');
        }
      };
      writeText(fp, emn);
      const counts = {
        outlinePoints: (args.board.outline || []).length,
        components: (args.board.components || args.board.links || args.board.parts || []).length,
      };
      return { op: 'export-board', ok: true, filepath: fp, counts };
    } },

  { name: 'ecad.route-harness', discipline: 'part', produces: 'report',
    description: 'Route a 3D wiring harness through waypoints (mm) and return the centerline, per-segment lengths and total arc-length LENGTH. mode=linear (Σ chords) | spline (centripetal Catmull-Rom) | catenary (free-hanging, L=2a·sinh(d/2a), a=H/w). A straight run gives ‖B−A‖, a circular arc gives r·θ. Bundle radius is explicit or derived from the cable library OD. Delegates spline math to the Forge-168 harness router.',
    parameters: { waypoints: P('array', 'ordered [[x,y,z],…] route waypoints in mm (≥2)', { required: true }),
                  mode: P('enum', 'linear|spline|catenary', { default: 'linear' }),
                  bundleRadius: P('number', 'bundle radius (mm); default derived from cableId or 2 mm', { default: null }),
                  cableId: P('string', 'cable id (cableLibrary) to derive bundle radius + min-bend radius', { default: null }),
                  anchorTension: P('number', 'catenary horizontal tension H (N)', { default: 50 }),
                  weightPerLength: P('number', 'catenary weight per length w (N/m)', { default: 1 }) },
    run: (args) => {
      if (!Array.isArray(args.waypoints) || args.waypoints.length < 2) {
        throw new Error('ecad.route-harness: waypoints[] (≥2 points in mm) is required');
      }
      const opts = { mode: args.mode || 'linear' };
      if (args.bundleRadius != null) opts.bundleRadius = args.bundleRadius;
      if (args.cableId) opts.cableId = args.cableId;
      if (args.anchorTension != null) opts.anchorTension = args.anchorTension;
      if (args.weightPerLength != null) opts.weightPerLength = args.weightPerLength;
      const r = ecadRouteHarness(args.waypoints, opts);
      return { op: 'route-harness', ok: true, mode: r.mode, length: r.length,
               length_m: r.length_m, bundleRadius: r.bundleRadius,
               minBendRadius: r.minBendRadius, requiredBendRadius: r.requiredBendRadius,
               segments: r.segments, centerline: r.centerline };
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

  // AUTO-2D-DRAWING (Task #27). Generate a full Y14.5 sheet — standard
  // front/top/right/iso HLR views + auto dimensions (overall W/H/D from
  // the projected bbox + hole Ø/pitch from detected circles) + GD&T from
  // the part's semantic PMI — and return the SVG artifact. Because every
  // view + dimension is RE-DERIVED from the live geometry, a parameter
  // change reflows the whole drawing (the killer "drawings stay manual"
  // gap, closed). Sections / detail / broken views + balloons exist in
  // Drawings.js but are NOT auto-placed yet — flagged follow-ups.
  { name: 'drawing.generate', discipline: 'drawing', produces: 'file',
    description: 'Generate a full Y14.5 2D drawing sheet (standard front/top/right/iso HLR views + auto dimensions + GD&T from PMI) for a part and return the SVG artifact. Regenerates from current geometry, so a parameter change reflows the views + dimension values.',
    parameters: {
      shape:      P('uint',    'part shape handle', { required: true }),
      bodyId:     P('string',  'body id for PMI lookup', { default: null }),
      projection: P('enum',    'third-angle|first-angle', { default: 'third-angle' }),
      sheet:      P('enum',    'A4|A3|A2|A1|A0|A|B|C|D|E', { default: 'A3' }),
      orientation: P('enum',   'landscape|portrait', { default: 'landscape' }),
      pmi:        P('boolean', 'place GD&T from PMI', { default: true }),
      title:      P('string',  'title-block label', { default: null }),
      dxf:        P('boolean', 'also emit a DXF artifact', { default: false }),
    },
    run: ({ shape, bodyId, projection, sheet, orientation, pmi, title, dxf }, forge) => {
      // Align the drawing engine's kernel with the dispatched `forge` so a
      // headless replay (or a test) projects against the same registry.
      setAutoDrawingKernel(forge);
      const d = generateDrawing(
        { shape, bodyId: bodyId ?? null, title: title ?? undefined },
        { projection: projection || 'third-angle', sheet: sheet || 'A3',
          orientation: orientation || 'landscape', pmi: pmi !== false, dxf: !!dxf },
      );
      return {
        op: 'drawing-generate',
        views: d.views.length,
        dimensions: d.dimensions.length,
        gdt: d.gdt.length,
        sheet: sheet || 'A3',
        projection: d.projection,
        scale: d.scale,
        svgLength: d.svg.length,
        dxfLength: d.dxf ? d.dxf.length : 0,
        // The actual sheet artifact (SVG) is returned for the renderer /
        // Archie to write to disk or display.
        svg: d.svg,
        dxf: d.dxf || null,
      };
    } },

  // Parametric regenerate (Task #27 recipe path + Task #45 (E) arbitrary
  // part). Two modes:
  //   1) RECIPE   — rebuild the part handle from its {kind,params} recipe
  //      with `changes` applied, then regenerate the drawing.
  //   2) ARBITRARY — pass a live `shape` handle (any geometry, no recipe);
  //      the whole sheet — views, dims, sections, details, balloons — reflows
  //      from the new geometry. `sections`/`details`/`assembly` carry the
  //      sheet composition so the SAME composition re-emits against the new
  //      part. Proves the dimension VALUES re-derive from geometry, not a
  //      stale manual sheet (ISO 129-1 — dims track the model).
  { name: 'drawing.regenerate', discipline: 'drawing', produces: 'file',
    description: 'Regenerate a part\'s 2D drawing parametrically. Either rebuild from a {kind, params} recipe with `changes` applied, OR re-derive from a live `shape` handle (arbitrary changed part). Views + dimension VALUES + sections + details + balloons all reflow from the new geometry.',
    parameters: {
      kind:    P('enum',   'box|cylinder|plate-hole (recipe mode)', { default: null }),
      params:  P('object', 'base recipe params, e.g. {dx,dy,dz,holeR}', { default: null }),
      changes: P('object', 'param overrides, e.g. {dx:120}', { default: {} }),
      shape:   P('uint',   'live changed shape handle (arbitrary-part mode)', { default: null }),
      bodyId:  P('string', 'body id for PMI lookup', { default: null }),
      sheet:   P('enum',   'A4|A3|A2|A1|A0|A|B|C|D|E', { default: 'A3' }),
      pmi:     P('boolean','place GD&T from PMI', { default: true }),
      sections: P('array', 'section specs [{plane:{origin,normal},parentDir?,direction?}]', { default: null }),
      details: P('array',  'detail specs [{sourceDir,center:[x,y],radius,scale?}]', { default: null }),
      assembly: P('array', 'BOM/balloon instances [{partNumber,qty?,anchor?,view?}]', { default: null }),
      dxf:     P('boolean','also emit a DXF artifact', { default: false }),
    },
    run: ({ kind, params, changes, shape, bodyId, sheet, pmi, sections, details, assembly, dxf }, forge) => {
      setAutoDrawingKernel(forge);
      const opts = {
        sheet: sheet || 'A3', pmi: pmi !== false, dxf: !!dxf,
        ...(Array.isArray(sections) ? { sections } : {}),
        ...(Array.isArray(details) ? { details } : {}),
        ...(Array.isArray(assembly) ? { assembly } : {}),
      };
      let d;
      if (kind) {
        // Recipe mode.
        d = regenerateDrawing(
          { shape: null, bodyId: bodyId ?? null, kind, params: params || {} },
          changes || {}, opts,
        );
      } else if (shape != null) {
        // Arbitrary-part mode — live handle, no recipe.
        d = regenerateDrawing({ shape, bodyId: bodyId ?? null }, {}, opts);
      } else {
        throw new Error('drawing.regenerate: provide either {kind, params} or a live `shape` handle');
      }
      return {
        op: 'drawing-regenerate',
        mode: kind ? 'recipe' : 'arbitrary',
        kind: kind || null,
        changes: changes || {},
        views: d.views.length,
        dimensions: d.dimensions.length,
        gdt: d.gdt.length,
        sections: d.sections.length,
        details: d.details.length,
        balloons: d.balloons.length,
        bom: d.bom.length,
        sheet: sheet || 'A3',
        svgLength: d.svg.length,
        // Echo the reflowed dimension values so a caller can confirm the
        // change propagated without parsing the SVG.
        dimValues: d.dimensions.map((x) => ({ label: x.label, value: x.value, text: x.text })),
        svg: d.svg,
        dxf: d.dxf || null,
      };
    } },

  // Task #45 (A) — SECTION VIEW. Cut a part with a plane and place a real
  // planar-section view (ISO 128-50 hatching: uniform spacing scaled to the
  // sectioned area; distinct angles per body in a multi-body cut) with the
  // ASME Y14.2 'SECTION A-A' cutting-plane callout on the parent view.
  { name: 'drawing.section-view', discipline: 'drawing', produces: 'file',
    description: 'Generate a 2D drawing with an auto-placed SECTION view: a real planar cut + ISO 128-50 hatching (uniform area-scaled spacing; distinct angles per body in a multi-body cut) + the ASME Y14.2 cutting-plane line and SECTION A-A label on the parent view.',
    parameters: {
      shape:       P('uint',   'part shape handle', { required: true }),
      origin:      P('array',  'cutting-plane origin [x,y,z]', { required: true }),
      normal:      P('array',  'cutting-plane normal [x,y,z]', { required: true }),
      direction:   P('enum',   'section projection direction front|top|right', { default: 'front' }),
      parentDir:   P('enum',   'view to draw the cutting-plane line on', { default: 'front' }),
      bodies:      P('array',  'multi-body section: [shapeHandle,…] for distinct hatch angles', { default: null }),
      hatchSpacing: P('number','override hatch spacing in mm', { default: null }),
      hatchAngle:  P('number', 'override base hatch angle in deg', { default: null }),
      bodyId:      P('string', 'body id for PMI lookup', { default: null }),
      sheet:       P('enum',   'A4|A3|A2|A1|A0|A|B|C|D|E', { default: 'A3' }),
      pmi:         P('boolean','place GD&T from PMI', { default: false }),
    },
    run: ({ shape, origin, normal, direction, parentDir, bodies, hatchSpacing, hatchAngle, bodyId, sheet, pmi }, forge) => {
      setAutoDrawingKernel(forge);
      const sectionSpec = {
        plane: { origin, normal },
        direction: direction || 'front',
        parentDir: parentDir || 'front',
      };
      if (hatchSpacing != null) sectionSpec.hatchSpacing = hatchSpacing;
      if (hatchAngle != null) sectionSpec.hatchAngle = hatchAngle;
      if (Array.isArray(bodies) && bodies.length) {
        sectionSpec.bodies = bodies.map((h) => ({ shape: h }));
      }
      const d = generateDrawing(
        { shape, bodyId: bodyId ?? null },
        { sheet: sheet || 'A3', pmi: !!pmi, sections: [sectionSpec] },
      );
      const sec = d.sections[0] || null;
      return {
        op: 'drawing-section',
        sectionLetter: sec ? sec.letter : null,
        label: sec ? sec.label : null,
        parentDir: sec ? sec.parentDir : (parentDir || 'front'),
        // Per-body hatch report: { body, angleDeg, spacing, count }.
        hatch: sec ? sec.hatch : [],
        views: d.views.length,
        sheet: sheet || 'A3',
        svgLength: d.svg.length,
        svg: d.svg,
      };
    } },

  // Task #45 (B) — DETAIL VIEW. Draw a dashed focus circle + letter callout
  // on a source view and emit an enlarged 'DETAIL A SCALE 2:1' view per
  // ASME Y14.3.
  { name: 'drawing.detail-view', discipline: 'drawing', produces: 'file',
    description: 'Generate a 2D drawing with an auto-placed DETAIL view: a dashed focus circle + letter callout on the source view, plus an enlarged "DETAIL A (2:1)" view at the labeled scale (ASME Y14.3).',
    parameters: {
      shape:     P('uint',   'part shape handle', { required: true }),
      sourceDir: P('enum',   'source view the detail circle is drawn on front|top|right', { default: 'front' }),
      center:    P('array',  'focus-circle centre [x,y] in the source view local coords', { required: true }),
      radius:    P('number', 'focus-circle radius (model mm)', { required: true }),
      scale:     P('number', 'enlargement factor, e.g. 2 for 2:1', { default: 2 }),
      bodyId:    P('string', 'body id for PMI lookup', { default: null }),
      sheet:     P('enum',   'A4|A3|A2|A1|A0|A|B|C|D|E', { default: 'A3' }),
      pmi:       P('boolean','place GD&T from PMI', { default: false }),
    },
    run: ({ shape, sourceDir, center, radius, scale, bodyId, sheet, pmi }, forge) => {
      setAutoDrawingKernel(forge);
      const d = generateDrawing(
        { shape, bodyId: bodyId ?? null },
        { sheet: sheet || 'A3', pmi: !!pmi,
          details: [{ sourceDir: sourceDir || 'front', center, radius, scale: scale || 2 }] },
      );
      const det = d.details[0] || null;
      return {
        op: 'drawing-detail',
        detailLetter: det ? det.letter : null,
        label: det ? det.label : null,
        sourceDir: det ? det.sourceDir : (sourceDir || 'front'),
        scale: det ? det.scale : (scale || 2),
        views: d.views.length,
        sheet: sheet || 'A3',
        svgLength: d.svg.length,
        svg: d.svg,
      };
    } },

  // Task #45 (D) — BALLOON ↔ BOM. Build a BOM (ASME Y14.34) from an
  // assembly instance list and place item-numbered balloons 1:1 with the
  // BOM rows, each with a leader to a part instance.
  { name: 'drawing.balloon-bom', discipline: 'drawing', produces: 'file',
    description: 'Generate an assembly drawing with a BOM table (ASME Y14.34) and item-numbered balloons mapped 1:1 to the BOM rows, each with a leader line to a part instance.',
    parameters: {
      shape:    P('uint',  'assembly shape handle (for the views)', { required: true }),
      assembly: P('array', 'instances [{partNumber,qty?,description?,anchor?:[x,y,z],view?}]', { required: true }),
      bodyId:   P('string','body id for PMI lookup', { default: null }),
      sheet:    P('enum',  'A4|A3|A2|A1|A0|A|B|C|D|E', { default: 'A3' }),
    },
    run: ({ shape, assembly, bodyId, sheet }, forge) => {
      setAutoDrawingKernel(forge);
      const d = generateDrawing(
        { shape, bodyId: bodyId ?? null },
        { sheet: sheet || 'A3', pmi: false, assembly: assembly || [] },
      );
      return {
        op: 'drawing-bom',
        rows: d.bom,
        balloons: d.balloons.map((b) => ({ item: b.item, partNumber: b.partNumber, view: b.view })),
        // Confirm the 1:1 invariant in the response.
        itemNumbers: d.bom.map((r) => r.item),
        balloonNumbers: d.balloons.map((b) => b.item),
        views: d.views.length,
        sheet: sheet || 'A3',
        svgLength: d.svg.length,
        svg: d.svg,
      };
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

  // ====================================================== GD&T (assembly-context)
  // Semantic GD&T verbs (task #72). The flat `part.annotate-pmi` makes Archie
  // hand-author raw FCF strings ("|⌖|Ø0.1|A|") + pick anchor ids — error-prone
  // and opaque to the assembly-context conditioning. These verbs let Archie
  // declare INTENT (datum on a face; a positional/concentricity/perpendicularity
  // tolerance of a feature RELATIVE TO A MATING PART's datum) and the bridge
  // composes the correct ASME Y14.5 FCF, accumulating PMI notes on the per-
  // sequence ctx. A final gdt.write-step (or any verb given `filepath`) flushes
  // them through the ONE bound op, io.exportStepWithPmi.
  //
  // HONEST SCOPE: these AUTHOR/ATTACH GD&T as AP242 PMI; the kernel has NO
  // geometric FCF evaluator on the native-handle path, so a position/concentric
  // tolerance is RECORDED relative to the mate datum, NOT geometrically verified.

  { name: 'gdt.datum', discipline: 'drawing', produces: 'report',
    description: 'Declare a GD&T datum (a reference letter A/B/C…) on a face of THIS part — the seating face, bore axis, or mating surface other tolerances reference. Accumulates a PMI note; pass `filepath` to also write the AP242 STEP now. ANNOTATION ONLY (no geometric datum frame is solved).',
    parameters: { shape: P('uint', 'shape handle the datum sits on', { required: true }),
                  letter: P('string', 'datum letter, e.g. "A" (primary), "B", "C"', { required: true }),
                  anchorId: P('uint', 'face id the datum labels (0 = first face)', { default: 0 }),
                  feature: P('string', 'human label for the datum feature, e.g. "seating face" / "bore axis"', { default: '' }),
                  filepath: P('string', 'optional absolute .step path to flush all accumulated PMI now', { default: null }) },
    run: ({ shape, letter, anchorId, feature, filepath }, forge, ctx) => {
      const L = String(letter || 'A').trim().toUpperCase().slice(0, 2);
      const note = { text: `DATUM ${L}${feature ? ` (${feature})` : ''}`, anchorKind: 'face', anchorId: (anchorId | 0) || 0 };
      const notes = gdtNotes(ctx); notes.push(note);
      let flushed = null;
      if (filepath) flushed = flushPmi(forge, shape, filepath, notes);
      return { op: 'gdt-datum', datum: L, fcf: note.text, anchorId: note.anchorId,
               pending: notes.length, written: flushed,
               note: 'datum label authored as AP242 PMI — not a solved datum reference frame' };
    } },

  { name: 'gdt.feature-control-frame', discipline: 'drawing', produces: 'report',
    description: 'Apply a GD&T Feature-Control-Frame to a feature of THIS part: a geometric characteristic (position|concentricity|perpendicularity|parallelism|flatness|cylindricity|runout|profile|…), a tolerance value (mm), an optional Ø zone + material modifier (MMC/LMC), and an ORDERED list of datum reference letters. For an assembly fit, the datums are the MATING PART\'s datums. Accumulates a PMI note; pass `filepath` to write now. ANNOTATION ONLY — records the FCF, does not verify it geometrically.',
    parameters: { shape: P('uint', 'shape handle the FCF sits on', { required: true }),
                  characteristic: P('enum', 'position|concentricity|perpendicularity|parallelism|flatness|cylindricity|circularity|symmetry|angularity|runout|totalRunout|profileSurface|profileLine|straightness', { required: true }),
                  tolerance: P('number', 'tolerance zone value in mm', { required: true }),
                  diametral: P('boolean', 'Ø (cylindrical) tolerance zone — true for hole/shaft position', { default: false }),
                  modifier: P('enum', 'rfs|mmc|lmc material condition modifier', { default: 'rfs' }),
                  datums: P('array', 'ordered datum letters [primary, secondary, tertiary], e.g. ["A","B"]', { default: [] }),
                  anchorId: P('uint', 'face id the FCF labels (the toleranced feature)', { default: 0 }),
                  filepath: P('string', 'optional absolute .step path to flush all accumulated PMI now', { default: null }) },
    run: ({ shape, characteristic, tolerance, diametral, modifier, datums, anchorId, filepath }, forge, ctx) => {
      const fcf = buildFcf({ characteristic, tolerance, diametral: !!diametral, modifier, datums });
      const note = { text: fcf, anchorKind: 'face', anchorId: (anchorId | 0) || 0 };
      const notes = gdtNotes(ctx); notes.push(note);
      let flushed = null;
      if (filepath) flushed = flushPmi(forge, shape, filepath, notes);
      return { op: 'gdt-fcf', characteristic: gdtCharSymbol(characteristic).key, fcf,
               datums: (Array.isArray(datums) ? datums : [datums]).filter(Boolean).map((d) => String(d).toUpperCase()),
               anchorId: note.anchorId, pending: notes.length, written: flushed,
               note: 'FCF authored as AP242 PMI — not geometrically verified' };
    } },

  // ASSEMBLY-CONTEXT GD&T — the headline of task #72. Position a bolt hole / pilot
  // bore of THIS part relative to a MATING PART's datum (e.g. "position Ø0.1 of
  // the bolt hole relative to datum A on the mating flange"). `relativeTo` names
  // the mating body (its handle or name as it appears in <viewport_state>); the
  // datum letter is the one the mating part carries. The authored FCF reads the
  // toleranced feature of THIS part against the MATE's datum reference frame.
  { name: 'gdt.position-relative-to-mate', discipline: 'drawing', produces: 'report',
    description: 'Assembly-context positional tolerance: apply a true-position (⌖) FCF to a hole/bore/feature of THIS part, located RELATIVE TO A MATING PART\'s datum(s). Use when a bolt hole must line up with the mating flange\'s pattern, or a pilot bore with the mating boss. `relativeTo` is the mating body (handle/name from <viewport_state>); `datums` are the mating part\'s datum letters. Accumulates a PMI note; pass `filepath` to write now. ANNOTATION ONLY — not geometrically verified.',
    parameters: { shape: P('uint', 'THIS part\'s shape handle (the feature being toleranced sits on it)', { required: true }),
                  feature: P('string', 'the toleranced feature, e.g. "bolt hole" / "pilot bore"', { default: 'hole' }),
                  tolerance: P('number', 'positional tolerance value in mm (the Ø zone)', { required: true }),
                  relativeTo: P('string', 'the MATING body it locates against (handle or name from <viewport_state>)', { required: true }),
                  datums: P('array', 'the MATING part\'s ordered datum letters, e.g. ["A","B"] (A=mating seating face/axis)', { required: true }),
                  modifier: P('enum', 'rfs|mmc|lmc — MMC is the usual call for clearance bolt patterns', { default: 'mmc' }),
                  anchorId: P('uint', 'face id of the toleranced feature on THIS part', { default: 0 }),
                  filepath: P('string', 'optional absolute .step path to flush all accumulated PMI now', { default: null }) },
    run: ({ shape, feature, tolerance, relativeTo, datums, modifier, anchorId, filepath }, forge, ctx) => {
      const refs = (Array.isArray(datums) ? datums : [datums]).filter(Boolean).map((d) => String(d).trim().toUpperCase());
      if (!refs.length) throw new Error('gdt.position-relative-to-mate: at least one mating datum letter is required');
      // True position is always a diametral (Ø) zone for a round feature.
      const fcf = buildFcf({ characteristic: 'position', tolerance, diametral: true, modifier, datums: refs });
      const note = { text: fcf, anchorKind: 'face', anchorId: (anchorId | 0) || 0 };
      const notes = gdtNotes(ctx); notes.push(note);
      let flushed = null;
      if (filepath) flushed = flushPmi(forge, shape, filepath, notes);
      return { op: 'gdt-position-rel', feature: String(feature || 'hole'), fcf,
               relativeTo: String(relativeTo), datums: refs, anchorId: note.anchorId,
               pending: notes.length, written: flushed,
               note: `position of "${feature}" authored relative to mating datum ${refs.join('-')} (${relativeTo}) — PMI only, not geometrically verified` };
    } },

  { name: 'gdt.concentric-to-mate', discipline: 'drawing', produces: 'report',
    description: 'Assembly-context coaxiality: apply a concentricity (◎) or runout (↗) FCF to a bore/shaft of THIS part RELATIVE TO A MATING PART\'s axis datum (e.g. a pulley bore concentric to the mating shaft\'s axis A). `relativeTo` is the mating body; `datums` are its axis-datum letters. Accumulates a PMI note; pass `filepath` to write now. ANNOTATION ONLY.',
    parameters: { shape: P('uint', 'THIS part\'s shape handle (the bore/shaft sits on it)', { required: true }),
                  feature: P('string', 'the toleranced feature, e.g. "bore" / "outer journal"', { default: 'bore' }),
                  control: P('enum', 'concentricity|runout|totalRunout', { default: 'concentricity' }),
                  tolerance: P('number', 'tolerance value in mm', { required: true }),
                  relativeTo: P('string', 'the MATING body it is coaxial to (handle or name from <viewport_state>)', { required: true }),
                  datums: P('array', 'the MATING part\'s axis datum letter(s), e.g. ["A"]', { required: true }),
                  anchorId: P('uint', 'face id of the toleranced feature on THIS part', { default: 0 }),
                  filepath: P('string', 'optional absolute .step path to flush all accumulated PMI now', { default: null }) },
    run: ({ shape, feature, control, tolerance, relativeTo, datums, anchorId, filepath }, forge, ctx) => {
      const refs = (Array.isArray(datums) ? datums : [datums]).filter(Boolean).map((d) => String(d).trim().toUpperCase());
      if (!refs.length) throw new Error('gdt.concentric-to-mate: at least one mating axis-datum letter is required');
      // Concentricity/runout zones are diametral about the datum axis.
      const fcf = buildFcf({ characteristic: control || 'concentricity', tolerance, diametral: true, modifier: 'rfs', datums: refs });
      const note = { text: fcf, anchorKind: 'face', anchorId: (anchorId | 0) || 0 };
      const notes = gdtNotes(ctx); notes.push(note);
      let flushed = null;
      if (filepath) flushed = flushPmi(forge, shape, filepath, notes);
      return { op: 'gdt-concentric-rel', feature: String(feature || 'bore'),
               control: gdtCharSymbol(control || 'concentricity').key, fcf,
               relativeTo: String(relativeTo), datums: refs, anchorId: note.anchorId,
               pending: notes.length, written: flushed,
               note: `coaxiality of "${feature}" authored relative to mating axis datum ${refs.join('-')} (${relativeTo}) — PMI only, not geometrically verified` };
    } },

  { name: 'gdt.write-step', discipline: 'drawing', produces: 'report',
    description: 'Flush all GD&T notes accumulated by prior gdt.* verbs (datums + FCFs) onto a body and write the AP242 STEP file. Call this LAST after declaring datums + FCFs. Routes through the one bound kernel op io.exportStepWithPmi.',
    parameters: { shape: P('uint', 'shape handle the PMI annotates', { required: true }),
                  filepath: P('string', 'absolute output .step path the kernel writes to', { required: true }),
                  extraNotes: P('array', 'optional extra [{text, anchorKind?, anchorId?}] PMI notes to append', { default: [] }) },
    run: ({ shape, filepath, extraNotes }, forge, ctx) => {
      const notes = gdtNotes(ctx).slice();
      for (const n of (Array.isArray(extraNotes) ? extraNotes : [])) {
        notes.push({ text: String(n.text || ''), anchorKind: n.anchorKind != null ? String(n.anchorKind) : '', anchorId: (n.anchorId | 0) || 0 });
      }
      if (!notes.length) throw new Error('gdt.write-step: no GD&T notes accumulated — call gdt.datum / gdt.feature-control-frame first (or pass extraNotes)');
      const flushed = flushPmi(forge, shape, filepath, notes);
      // Clear the accumulator so a subsequent unrelated build starts clean.
      if (ctx) ctx.gdt = [];
      return { op: 'gdt-write-step', ...flushed, fcfs: notes.map((n) => n.text),
               note: 'GD&T written as AP242 PMI text — not geometrically verified' };
    } },

  // Bridged assembly-context op (was bound-not-bridged): pairwise solid-intersection
  // check across placed instances. Directly relevant to mating parts — confirms a
  // designed mate does NOT interfere before GD&T is applied. Real boolean volume.
  { name: 'assembly.detect-interference', discipline: 'assembly', produces: 'report',
    description: 'Detect interference (overlapping solid volume) between placed assembly instances — the real OCCT boolean-common check, deduplicated + sorted. Returns the interfering instance pairs and the volume of intersection (mm³). Use to verify a designed mate/fit before annotating it with GD&T.',
    parameters: { instances: P('array', 'instance ids to check, e.g. [1,2,3]', { required: true }),
                  tolerance: P('number', 'AABB inflation in mm — near-misses within this are also evaluated', { default: 0 }) },
    run: ({ instances, tolerance }, forge) => {
      if (!forge.assembly || typeof forge.assembly.detectInterference !== 'function') {
        throw new Error('forge.assembly.detectInterference unavailable — build the kernel with Forge-35');
      }
      const ids = (Array.isArray(instances) ? instances : []).map((x) => x >>> 0);
      if (ids.length < 2) throw new Error('assembly.detect-interference: at least two instance ids are required');
      const pairs = forge.assembly.detectInterference(ids, Number(tolerance) > 0 ? Number(tolerance) : 0);
      const list = Array.from(pairs || []).map((p) => ({ instA: p.instA, instB: p.instB, volume: p.volume }));
      return { op: 'detect-interference', checked: ids.length, interferingPairs: list.length, pairs: list,
               clear: list.length === 0 };
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

  // ============================================================ PDM RETRIEVAL
  // Geometry-based part retrieval over the PDM vault (Task #33). The 80/20
  // reality: ~80 % of engineering REUSES/adapts an existing part, and a 40k-part
  // vault hides 8-12k duplicates. These verbs let Archie search the vault by
  // SHAPE (pose- & scale-invariant fingerprint) before generating anything.
  { name: 'pdm.find-similar', discipline: 'part', produces: 'report',
    description: 'Find the parts in the PDM vault most geometrically similar to a query body, by a pose- and scale-invariant shape fingerprint (D2 distribution + moment/aspect invariants). Returns the top-k ranked matches with a similarity score (≈1.0 = an identical/transformed copy) PLUS a retrieve-then-edit hand-off to the closest match. Use BEFORE modelling a new part — reuse beats regenerate.',
    parameters: { shape: P('uint', 'query body handle to search the vault with', { required: true }),
                  k: P('uint', 'number of matches to return', { default: 5 }) },
    run: ({ shape, k }, forge) => {
      if (!Number.isInteger(shape)) throw new Error('pdm.find-similar: a valid query shape handle is required');
      const index = buildPdmVaultIndex(forge);
      if (index.entries.length === 0) {
        return { op: 'find-similar', matches: [], query: shape,
                 note: 'PDM vault is empty / no scene bodies to fingerprint' };
      }
      const kk = Math.max(1, Math.min(Number(k) || 5, index.entries.length));
      const matches = findSimilar({ handle: shape }, kk, index, forge)
        .map((m) => ({ ...partSummary(m.part), score: Number(m.score.toFixed(4)),
                       distance: Number(m.distance.toFixed(4)) }));
      // The retrieve-then-edit hand-off to the closest match (descriptor only —
      // ForgeToolBridge does NOT invoke the editor; cad.edit-step consumes this).
      const rte = retrieveThenEdit({ handle: shape }, index, forge);
      return { op: 'find-similar', query: shape, matches,
               editHandoff: rte.editHandoff ? {
                 verb: rte.editHandoff.verb,
                 sourceItem: partSummary(rte.editHandoff.sourceItem),
                 similarity: Number((rte.editHandoff.similarity || 0).toFixed(4)),
                 queryDelta: rte.editHandoff.queryDelta,
                 note: rte.editHandoff.note,
               } : null };
    } },

  { name: 'pdm.find-duplicates', discipline: 'part', produces: 'report',
    description: 'Scan the PDM vault for near-duplicate parts: pairs whose shape fingerprints fall below a near-duplicate distance threshold, each CONFIRMED with a tighter geometric check (volume/area within tolerance AND the CADGenBench shape_similarity metric). Surfaces the duplicate debt a real 40k-part vault accumulates so it can be consolidated.',
    parameters: { threshold: P('number', 'near-duplicate descriptor-distance threshold (smaller = stricter)', { default: 0 }),
                  confirm: P('boolean', 'run the tighter geometric confirm on candidates', { default: true }) },
    run: ({ threshold, confirm }, forge) => {
      const index = buildPdmVaultIndex(forge);
      if (index.entries.length < 2) {
        return { op: 'find-duplicates', pairs: [], note: 'need ≥2 fingerprinted parts to compare' };
      }
      const opts = { forge, confirm: confirm !== false };
      if (Number(threshold) > 0) opts.threshold = Number(threshold);
      const pairs = findDuplicates(index, opts).map((d) => ({
        a: partSummary(d.a), b: partSummary(d.b),
        distance: Number(d.distance.toFixed(4)),
        confirmed: !!d.confirmed,
        shapeSimilarity: d.shapeSimilarity == null ? null : Number(d.shapeSimilarity.toFixed(4)),
      }));
      return { op: 'find-duplicates', count: pairs.length,
               confirmedCount: pairs.filter((p) => p.confirmed).length, pairs };
    } },

  // ============================================================ PDM VERSION CONTROL
  // Local-first "git-for-CAD" (Task #32) — a content-addressed version graph over
  // the vault: lock-free branch + 3-way merge of the parametric recipe, a 3D
  // change-diff (recipe diff + real kernel geom delta), and where-used/impact.
  // Solves the #1 MCAD gripe (version chaos) without six-figure PLM. Engine:
  // forge-v4/pdm/versionControl.js.
  { name: 'pdm.commit', discipline: 'part', produces: 'report',
    description: 'Commit an immutable, content-addressed snapshot of a part (its parametric recipe {kind, params, features} + PMI) onto a branch of the version graph. Lock-free; identical content on the same parent dedupes. Returns the version id (a content hash) and the new branch HEAD. Use to checkpoint a design so it can be branched, merged, and diffed.',
    parameters: { itemId: P('string', 'PDM item id this version belongs to', { required: true }),
                  recipe: P('object', 'the parametric recipe { kind, params:{}, features:[] }', { required: true }),
                  pmi: P('array', 'semantic PMI annotations [] (optional)', { default: [] }),
                  branch: P('string', 'branch name to advance (default: current branch / main)', { default: null }),
                  message: P('string', 'commit message', { default: '' }) },
    run: ({ itemId, recipe, pmi, branch, message }) => {
      const versionId = vcsCommit({ itemId, recipe, pmi: pmi || [],
        branch: branch || undefined, message: message || '' });
      return { op: 'commit', versionId, itemId,
               branch: branch || undefined, head: versionId };
    } },

  { name: 'pdm.branch', discipline: 'part', produces: 'report',
    description: 'Create a named branch of a part at a given version (lock-free — multiple branches share history, so two people can edit the same part in parallel with no check-out blocking). Defaults to branching from the current branch HEAD. Returns the branch name + its head version.',
    parameters: { name: P('string', 'new branch name', { required: true }),
                  fromVersion: P('string', 'version id to branch from (default: current HEAD)', { default: null }) },
    run: ({ name, fromVersion }) => {
      const b = vcsBranch(name, fromVersion || undefined);
      return { op: 'branch', branch: b.name, head: b.head };
    } },

  { name: 'pdm.merge', discipline: 'part', produces: 'report',
    description: 'Three-way merge two versions/branches of a part. Auto-merges all non-conflicting changes (different params / different features); SURFACES conflicts (same param/feature changed differently) carrying both the ours and theirs values so they can be resolved — an edit is NEVER silently lost. If only ours+theirs are given, the merge base (lowest common ancestor) is found automatically. Returns the merged recipe + a conflicts[] list.',
    parameters: { ours: P('string', 'our version id (or branch name)', { required: true }),
                  theirs: P('string', 'their version id (or branch name)', { required: true }),
                  base: P('string', 'explicit merge-base version id (default: auto LCA)', { default: null }) },
    run: ({ ours, theirs, base }) => {
      const res = base
        ? vcsMerge(base, ours, theirs)
        : vcsMergeBranches(ours, theirs);
      return { op: 'merge', merged: res.merged, conflicts: res.conflicts,
               conflictCount: res.conflicts.length,
               base: res.base ?? base ?? null, ours: res.ours ?? ours, theirs: res.theirs ?? theirs };
    } },

  { name: 'pdm.diff', discipline: 'part', produces: 'report',
    description: 'Change-diff between two part versions: a structured, human-readable recipeDiff (params/features/PMI added · removed · modified, with from→to values) PLUS a 3D geomDelta computed from the REAL kernel (volume / area / bbox-diagonal change, and mass if a density is given) by rebuilding both recipes. Not a binary blob compare. geomDelta is null only when no kernel handle is resolvable (the text recipeDiff still returns).',
    parameters: { a: P('string', 'version A id (or an inline snapshot object)', { required: true }),
                  b: P('string', 'version B id (or an inline snapshot object)', { required: true }),
                  density: P('number', 'material density kg/m³ for the mass delta (optional)', { default: null }) },
    run: ({ a, b, density }, forge) => {
      setAutoDrawingKernel(forge); // align the rebuild kernel for the geom delta
      const opts = density ? { density: Number(density) } : {};
      const d = vcsDiff(a, b, forge, opts);
      return { op: 'diff', recipeDiff: d.recipeDiff, geomDelta: d.geomDelta,
               geomDeltaAvailable: d.geomDeltaAvailable };
    } },

  { name: 'pdm.where-used', discipline: 'part', produces: 'report',
    description: 'Where-used + impact analysis for a part: which assemblies/parents reference it (direct, or transitive up the BOM graph) and the downstream impact — every parent assembly that would need rebuild / revalidation if the part changes (transitive closure, deduped). Use before changing a shared part to see the blast radius.',
    parameters: { itemId: P('string', 'PDM item id to analyse', { required: true }),
                  transitive: P('boolean', 'walk all ancestors (default: direct parents only)', { default: false }) },
    run: ({ itemId, transitive }) => {
      const parents = vcsWhereUsed(itemId, { transitive: !!transitive });
      const affected = vcsImpact(itemId); // always the full rebuild closure
      return { op: 'where-used', itemId, transitive: !!transitive,
               parents, impact: affected, impactCount: affected.length };
    } },

  // ============================================================ DESIGN RATIONALE
  // In-model design-rationale / knowledge capture (Task #39). The most
  // under-served PLM capability: the geometry/dimensions/tolerances are captured
  // but the WHY is not — when a senior leaves, the reasoning behind every
  // non-obvious decision walks out and is rediscovered at cost. These verbs make
  // the "why" a first-class, PERSISTENT artefact keyed by the stable feature id
  // (`fid ?? id`) so it survives rebuild. Engine: forge-v4/rationale/designRationale.js.
  { name: 'rationale.capture', discipline: 'part', produces: 'report',
    description: 'Capture the DESIGN RATIONALE (the "why") for a feature of a part: its intent, the driving requirement, the binding constraint, the alternatives that were considered and rejected (with reasons), and provenance (who/when/source). Keyed by the PERSISTENT feature id (the recipe feature\'s fid/id, NOT a volatile index) so the rationale survives rebuild and param edits. Use featureId "__part__" for a whole-part why. This is the explicit path; rationale supplied alongside a build op is auto-captured as a byproduct of building.',
    parameters: { partId: P('string', 'PDM item id this part belongs to', { required: true }),
                  featureId: P('string', 'persistent feature id (recipe feature fid/id); use "__part__" for a whole-part rationale', { required: true }),
                  intent: P('string', 'the design goal this feature serves', { default: '' }),
                  drivingRequirement: P('string', 'the requirement that forced it (e.g. a req id "R-12")', { default: '' }),
                  constraint: P('string', 'the binding constraint (e.g. "4 mm — moldflow short-shot limit")', { default: '' }),
                  rejected: P('array', 'alternatives considered & rejected: [string] or [{alternative, reason}]', { default: [] }),
                  provenance: P('object', 'provenance { who, when, source } (who/when default to archie/now)', { default: {} }),
                  links: P('object', 'links { requirements:[], tests:[] } into the req/test world', { default: {} }),
                  feature: P('object', 'the recipe feature snapshot { fid, op, params } so the NL query can resolve it', { default: null }) },
    run: ({ partId, featureId, intent, drivingRequirement, constraint, rejected, provenance, links, feature }) => {
      const rec = rtCapture(partId, featureId, {
        intent, drivingRequirement, constraint,
        rejected, provenance: provenance || {}, links: links || {}, feature,
      });
      return { op: 'rationale.capture', partId, featureId: rec.featureId, record: rec };
    } },

  { name: 'rationale.query', discipline: 'part', produces: 'report',
    description: 'Answer a natural-language "why" question about a part ("why is this wall 4mm?") by resolving the referenced feature (by param value, op/param name, or text) and returning its captured intent + driving requirement + binding constraint + the rejected alternative + provenance. Deterministic resolver over the stored rationale; returns { found:false } honestly when nothing matches (an LLM NL layer is a noted enhancement).',
    parameters: { partId: P('string', 'PDM item id of the part to query', { required: true }),
                  question: P('string', 'the natural-language why question', { required: true }) },
    run: ({ partId, question }) => {
      const ans = rtQuery(partId, question);
      return { op: 'rationale.query', partId, ...ans };
    } },

  { name: 'rationale.list', discipline: 'part', produces: 'report',
    description: 'List every captured design-rationale record for a part (including any flagged orphaned because their feature was removed by a rebuild). Returns the records keyed by persistent feature id.',
    parameters: { partId: P('string', 'PDM item id of the part', { required: true }) },
    run: ({ partId }) => {
      const records = rtList(partId);
      return { op: 'rationale.list', partId, count: records.length,
               orphanedCount: records.filter((r) => r.orphaned).length, records };
    } },

  // ============================================================ AUTO-MBD + PLM RELEASE
  // AUTO Model-Based-Definition completeness + autonomous pre-manufacturing PLM
  // release gate (Task #19). PURE ORCHESTRATORS over the shipped engines —
  // forge-v4/plm/prerelease.js calls the REAL asmeY145Rules validator + PMI
  // registry + tolerance kernel + partRetrieval duplicate scan + autoDrawing +
  // archivalExport export/verify + designRationale, folds them into an ASME
  // Y14.41-2019 / ISO 16792 completeness check and an ECO/ECN-style release gate.
  { name: 'plm.mbd-check', discipline: 'part', produces: 'report',
    description: 'AUTO Model-Based-Definition completeness check per ASME Y14.41-2019 / ISO 16792. Walks the part\'s PMI (the registry) + features and reports every way the digital data set is INCOMPLETE: a malformed Feature Control Frame (judged by the REAL ASME Y14.5-2018 validator — datum precedence, Ø-on-axis, material-modifier legality, datum-letter validity), a characteristic that requires a datum reference frame but carries none, a DANGLING datum reference (a letter not defined on the part), an un-toleranced critical feature (hole / driving dimension), and missing material / surface-finish / units+precision. Returns { complete, missing:[{feature, reason, kind}] }. NOT a numeric stub — it runs validateFrames over the part\'s actual stored PMI.',
    parameters: { shape: P('uint', 'kernel shape handle (for the hole/dimension feature probe)', { default: null }),
                  bodyId: P('string', 'body id keying the part\'s PMI in the registry', { required: true }),
                  id: P('string', 'part / PDM item id', { default: null }),
                  material: P('string', 'material assigned to the part', { default: null }),
                  surfaceFinish: P('object', 'surface-texture/finish spec (if not carried as a PMI finish annotation)', { default: null }),
                  units: P('string', 'data-set units (e.g. "mm")', { default: null }),
                  precision: P('uint', 'default decimal precision of the data set', { default: null }),
                  criticalFeatures: P('array', 'explicit critical features [{id, kind?, covered?}] that must be toleranced', { default: [] }),
                  datums: P('array', 'datum letters DEFINED on the part [string] (for dangling-datum detection)', { default: [] }) },
    run: (args, forge) => {
      setAutoDrawingKernel(forge);
      const res = mbdCompleteness({
        shape: args.shape ?? null, bodyId: args.bodyId, id: args.id ?? args.bodyId,
        material: args.material, surfaceFinish: args.surfaceFinish,
        units: args.units, precision: args.precision,
        criticalFeatures: args.criticalFeatures || [], datums: args.datums || [],
      }, { forge });
      return { op: 'mbd-check', standard: 'ASME Y14.41-2019 / ISO 16792', ...res };
    } },

  { name: 'plm.pre-release', discipline: 'part', produces: 'report',
    description: 'Autonomous PRE-MANUFACTURING PLM release gate (ECO/ECN semantics). Orchestrates ALL release gates by invoking the REAL shipped engines and collecting every result (never short-circuits): geometry-valid (forge.heal.checkValidity / OCCT), MBD-complete (plm.mbd-check → ASME Y14.41 / Y14.5 validator), tolerance RSS-valid (forge.tolerance.compute — surfaces the RSS-validity warning), no-unresolved-duplicates (partRetrieval.findDuplicates), drawing-generated (autoDrawing.generateDrawing — ≥3 views + dimensions), archival-built-and-verified (archivalExport export+verify — EN 9300 / ISO 14721 / AP242 fixity), rationale-present (designRationale), plus an advisory DFM pass. Returns { releasable, gates:[{name,pass,detail}], blockers:[{gate,reason}] }. releasable = every BLOCKING gate passes.',
    parameters: { assembly: P('object', 'assembly { name?, parts:[{shape?, bodyId, id, name?, material?, surfaceFinish?, units?, precision?, criticalFeatures?, datums?, tolChain?, tolSpec?}], mates? }', { required: true }),
                  retention: P('object', 'LOTAR retention {years, classification, disposition}', { default: null }),
                  provenance: P('object', 'provenance {agent, organization, why, software}', { default: null }),
                  minCpk: P('number', 'minimum acceptable RSS Cpk for the tolerance gate', { default: 1.0 }),
                  requireRationale: P('boolean', 'whether the rationale-present gate blocks (default true)', { default: true }),
                  drawing: P('object', 'drawing options forwarded to autoDrawing.generateDrawing', { default: null }) },
    run: (args, forge) => {
      setAutoDrawingKernel(forge);
      const res = prePlmRelease(args.assembly, {
        forge,
        retention: args.retention || undefined,
        provenance: args.provenance || undefined,
        minCpk: args.minCpk,
        requireRationale: args.requireRationale !== false,
        drawing: args.drawing || undefined,
      });
      return { op: 'pre-release', ...res };
    } },

  // ============================================================ ML SURROGATE / ROM
  // Trainable ML surrogate / reduced-order model (Task #29) fitted on Forge's
  // OWN validated Monte-Carlo tolerance solver (forge-v4/monteCarloMath.js).
  // The surrogate replaces the expensive 100k-trial solver with a cheap GP
  // evaluation while shipping HONEST, data-derived predictive error bounds: the
  // posterior std is the exact GP closed-form (widens away from the data and
  // out-of-domain), hyperparameters are picked by leave-one-out CV, and the
  // (1−α) interval is CALIBRATED against a held-out set so its stated coverage
  // is a MEASURED number. Kernel-free — these verbs ignore `forge`.
  { name: 'ml.surrogate-train', discipline: 'simulate', produces: 'report',
    description: 'Train an ML surrogate / reduced-order model on Forge\'s OWN validated Monte-Carlo tolerance solver. Latin-Hypercube samples the design box, runs the REAL solver as ground truth at each point, fits a Gaussian-process (squared-exponential, ARD) interpolant, and returns the model PLUS honest predictive error bounds: leave-one-out CV RMSE, held-out validation RMSE, and the empirically-MEASURED interval coverage. NOT a black box — the bounds are validated against the real solver. Pass the returned model to ml.surrogate-predict to evaluate many designs cheaply.',
    parameters: {
      chain: P('array', '[{nominal, plus, minus, dist?}] base tolerance chain (mm); dist "normal"|"uniform"', { required: true }),
      designVars: P('array', 'which link tolerances to vary: [{ index, lo, hi }] (mm). Defines the surrogate input space.', { required: true }),
      USL: P('number', 'assembly upper spec limit (mm)', { required: true }),
      LSL: P('number', 'assembly lower spec limit (mm)', { required: true }),
      qoi: P('enum', 'quantity to surrogate: cpk|yieldPct', { default: 'cpk' }),
      nSamples: P('uint', 'training design points (Latin-Hypercube)', { default: 60 }),
      nVal: P('uint', 'held-out validation points (for RMSE + coverage calibration)', { default: 24 }),
      nTrials: P('uint', 'Monte-Carlo trials per ground-truth solver evaluation', { default: 100000 }),
      confidence: P('number', 'target two-sided interval coverage (e.g. 0.95)', { default: 0.95 }),
      seed: P('uint', 'master RNG seed (deterministic ground truth + DOE)', { default: 12345 }) },
    run: (args) => {
      const model = trainSurrogate(args);
      // Return the full (serialisable) model so the predict verb can consume it,
      // plus the transparent accuracy report up top.
      return { op: 'ml.surrogate-train', ...model.report, model };
    } },

  { name: 'ml.surrogate-predict', discipline: 'simulate', produces: 'report',
    description: 'Predict the QoI at a design point using a trained Forge surrogate (from ml.surrogate-train), returning the predicted value AND a REAL predictive uncertainty: the GP posterior standard error, a calibrated (1−α) interval [lo,hi], the inDomain flag (false = extrapolation beyond the sampled box) and the extrapolation factor. The error bound WIDENS out-of-domain — it never stays flat. Also echoes the model\'s validated RMSE + empirical coverage so the caller sees the real accuracy.',
    parameters: {
      model: P('object', 'trained surrogate model object returned by ml.surrogate-train', { required: true }),
      x: P('array', 'design vector (the varied tolerances, mm) in the same order as designVars', { required: true }) },
    run: (args) => {
      const r = predictSurrogate(args.model, args.x);
      return { op: 'ml.surrogate-predict', ...r };
    } },

  // ════════════════════════════════════════════════════════════════════════
  // forge::native engines (Task #46) — the in-house, pure-C++20 unified-kernel
  // analysis engines, bound into forge-kernel.node and exposed at
  // window.forge.native.* via the preload `native:` block. Each handler calls
  // the REAL bound native op (no stub); ok=false + reason is surfaced honestly.
  // ════════════════════════════════════════════════════════════════════════

  // -- tolstack ----------------------------------------------------------
  { name: 'sim.tolerance-stack', discipline: 'simulate', produces: 'result',
    description: 'Analyze a 1D dimension-chain tolerance stack with all three industry methods at once (worst-case, RSS-statistical, Monte-Carlo) and the honest RSS-validity verdict. Each contributor has {nominal, plusTol, minusTol, sensitivity (∂gap/∂dim, ±1 for a simple add/subtract), dist}. Returns wcNominal/wcMin/wcMax/wcTol, rssMean/rssSigma/rssYield/cp/cpk, mcMean/mcSigma/mcYield, and rssValid+authoritativeMc (Monte-Carlo becomes the truth when RSS assumptions break). Calls forge.native.tolstackAnalyze.',
    parameters: {
      contributors: P('array', 'array of {nominal, plusTol, minusTol, sensitivity, dist:NORMAL|UNIFORM|TRIANGULAR}', { required: true }),
      LSL: P('number', 'lower spec limit on the gap', { required: true }),
      USL: P('number', 'upper spec limit on the gap', { required: true }),
      k: P('number', 'k-sigma for tol→sigma & limits (default 3)', { default: 3 }),
      mcSamples: P('number', 'Monte-Carlo sample count (default 200000)', { default: 200000 }),
      cltMinContributors: P('number', 'fewer contributors than this ⇒ rssValid=false (default 4)', { default: 4 }) },
    run: (a, forge) => {
      const r = forge.native.tolstackAnalyze({
        contributors: a.contributors, LSL: a.LSL, USL: a.USL,
        k: a.k ?? 3, mcSamples: a.mcSamples ?? 200000,
        cltMinContributors: a.cltMinContributors ?? 4,
      });
      return { op: 'sim.tolerance-stack', ...r };
    } },

  // -- vvuq --------------------------------------------------------------
  { name: 'sim.mesh-convergence', discipline: 'simulate', produces: 'result',
    description: 'Classify a mesh-convergence study (≥3 refinement levels of a monitored quantity) via Richardson extrapolation / GCI: CONVERGING (with the extrapolated value + observed order p + a GCI error bar), DIVERGING_SINGULAR (the peak keeps rising because the mesh is refining a stress singularity — not a real number), OSCILLATORY, or INSUFFICIENT. levels = [{h, value}, ...], finest last. Calls forge.native.vvuqConvergence.',
    parameters: {
      levels: P('array', 'array of {h (representative mesh size), value (monitored quantity)}, ≥3, finest last', { required: true }),
      safetyFactor: P('number', 'GCI factor of safety Fs (Roache 1.25 default)', { default: 1.25 }) },
    run: (a, forge) => {
      const r = forge.native.vvuqConvergence(a.levels, a.safetyFactor ?? 1.25);
      return { op: 'sim.mesh-convergence', ...r };
    } },
  { name: 'sim.energy-audit', discipline: 'simulate', produces: 'result',
    description: 'Energy-ratio credibility audit for an explicit-dynamics run: hourglass/artificial strain energy as a fraction of internal energy (RED>10%, the formulation is faking stiffness), kinetic/internal ratio (quasi-static abuse), and contact-stabilization energy. Returns a RED/AMBER/GREEN level WITH reasons — never a bare number. Calls forge.native.vvuqEnergyAudit.',
    parameters: {
      internalEnergy: P('number', 'internal energy IE (J)', { required: true }),
      hourglassEnergy: P('number', 'artificial / hourglass strain energy (J)', { required: true }),
      kineticEnergy: P('number', 'kinetic energy KE (J)', { default: 0 }),
      contactStabEnergy: P('number', 'contact-stabilization energy (J)', { default: 0 }),
      quasiStatic: P('boolean', 'is this a quasi-static run? (KE should be tiny)', { default: true }) },
    run: (a, forge) => {
      const r = forge.native.vvuqEnergyAudit({
        internalEnergy: a.internalEnergy, hourglassEnergy: a.hourglassEnergy,
        kineticEnergy: a.kineticEnergy ?? 0, contactStabEnergy: a.contactStabEnergy ?? 0,
        quasiStatic: a.quasiStatic ?? true,
      });
      return { op: 'sim.energy-audit', ...r };
    } },

  // -- materials ---------------------------------------------------------
  { name: 'material.query', discipline: 'simulate', produces: 'result',
    description: 'Query the process-aware ANISOTROPIC material database for the effective stiffness/strength along a load direction, WITH a scatter band and an honest confidence flag (HIGH = measured principal axis; MEDIUM = off-axis tensor-rotation prediction; LOW = not in DB, coupon test recommended). Captures the FDM Z-direction knockdown / CFRP fibre-axis anisotropy a single isotropic E/σ hides. Calls forge.native.materialsQuery.',
    parameters: {
      material: P('enum', 'ABS|PLA|CFRP_UD_T700|Ti6Al4V', { required: true }),
      process: P('enum', 'FDM_FFF|LPBF|WROUGHT|PREPREG_AUTOCLAVE', { required: true }),
      buildOrient: P('enum', 'XY_INPLANE|Z_BUILD|ANGLE_45|NA', { default: 'NA' }),
      postProcess: P('enum', 'NONE|AS_BUILT|HIP|ANNEAL|NA', { default: 'AS_BUILT' }),
      loadDir: P('array', '[x,y,z] load direction in the material frame', { required: true }),
      k: P('number', 'scatter-band multiplier (2σ≈95%, default 2)', { default: 2 }) },
    run: (a, forge) => {
      const r = forge.native.materialsQuery({
        material: a.material, process: a.process,
        buildOrient: a.buildOrient ?? 'NA', postProcess: a.postProcess ?? 'AS_BUILT',
        loadDir: a.loadDir, k: a.k ?? 2,
      });
      return { op: 'material.query', ...r };
    } },

  // -- am ----------------------------------------------------------------
  { name: 'sim.am-warp', discipline: 'simulate', produces: 'result',
    description: 'Predict the LPBF additive-build residual distortion (inherent-strain method) of a tetrahedral part: assemble the linear-elastic stiffness from the process-aware material DB, apply the CALIBRATED eigenstrain as an equivalent nodal load, clamp the build-plate nodes, and solve for the warp field + a residual-stress proxy. Returns per-node displacement, maxWarp/rmsWarp, maxVonMises, and the calibrated honesty flag. nodes/tets are flat arrays. Calls forge.native.amWarp.',
    parameters: {
      nodes: P('array', 'flat node coords [x,y,z,...] in metres, build frame', { required: true }),
      tets: P('array', 'flat tet node indices [i,j,k,l,...] (length %4)', { required: true }),
      material: P('object', '{material,process,buildOrient,postProcess} material key', { required: true }),
      inherent: P('object', '{exx,eyy,ezz,eyz,exz,exy,calibrated} calibrated eigenstrain', { required: true }),
      orientation: P('array', 'build→part 3x3 direction cosines (row-major 9), default identity', { default: null }),
      plateZ: P('number', 'build-plate plane z; nodes at/below are clamped (default 0)', { default: 0 }) },
    run: (a, forge) => {
      const r = forge.native.amWarp({
        nodes: a.nodes, tets: a.tets, material: a.material, inherent: a.inherent,
        orientation: a.orientation ?? [1,0,0, 0,1,0, 0,0,1], plateZ: a.plateZ ?? 0,
      });
      return { op: 'sim.am-warp', ...r };
    } },

  // -- composites --------------------------------------------------------
  { name: 'sim.composite-clt', discipline: 'simulate', produces: 'result',
    description: 'Classical Lamination Theory for a composite layup: assemble the ABD stiffness matrices through-thickness about the midplane and derive the effective laminate engineering constants Ex/Ey/Gxy/nuxy. Reports symmetric (the key B==0 verdict for a symmetric layup) and balanced flags. Each ply carries its own orthotropic lamina constants {E1,E2,G12,nu12} + thickness + angle (degrees). Calls forge.native.compositesClt.',
    parameters: {
      plies: P('array', 'bottom→top array of {E1,E2,G12,nu12 (Pa), thickness (m), angleDeg}', { required: true }) },
    run: (a, forge) => {
      const r = forge.native.compositesClt({ plies: a.plies });
      return { op: 'sim.composite-clt', ...r };
    } },

  // -- surfit ------------------------------------------------------------
  { name: 'kernel.surface-fit', discipline: 'part', produces: 'result',
    description: 'Fit a single editable NURBS / B-spline surface patch to a 3D point cloud by alternating least-squares on the control net with closest-point re-parameterization. Reports the bidirectional Chamfer distance plus RMS / max point-to-surface residuals (a noisy cloud SMOOTHS — Chamfer ~ noise level, not 0, which is correct). Degenerate / under-determined input → ok=false + reason, never a fabricated surface. points is a flat [x,y,z,...] cloud. Calls forge.native.surfitFit.',
    parameters: {
      points: P('array', 'flat point cloud [x,y,z,...] (length %3)', { required: true }),
      degreeU: P('number', 'spline degree in U (default 3)', { default: 3 }),
      degreeV: P('number', 'spline degree in V (default 3)', { default: 3 }),
      nU: P('number', 'control-net size in U (default 6)', { default: 6 }),
      nV: P('number', 'control-net size in V (default 6)', { default: 6 }),
      maxIters: P('number', 'reparam↔refit iterations (default 20)', { default: 20 }) },
    run: (a, forge) => {
      const r = forge.native.surfitFit(a.points, {
        degreeU: a.degreeU ?? 3, degreeV: a.degreeV ?? 3,
        nU: a.nU ?? 6, nV: a.nV ?? 6, maxIters: a.maxIters ?? 20,
      });
      return { op: 'kernel.surface-fit', ...r };
    } },

  // -- cam ---------------------------------------------------------------
  { name: 'cam.material-removal', discipline: 'manufacture', produces: 'result',
    description: 'Verify a CAM toolpath GEOMETRICALLY by swept-volume material removal: sweep the tool solid (flat-end / ball-end / toroidal-corner endmill, by cornerRadius) along every cutting segment and subtract it from the stock block, reporting the removed volume, the stock volume before cutting, and the voxel resolution actually used (the discretisation behind the number, never hidden). The removed volume converges to the analytic answer as spacing→0. Bad stock / spacing≤0 / empty path → ok=false (honest). Calls forge.native.camRemoveMaterial.',
    parameters: {
      stock: P('object', '{lo:[x,y,z], hi:[x,y,z]} axis-aligned stock block (mm)', { required: true }),
      tool: P('object', '{radius, length, cornerRadius} — cornerRadius 0=flat, =radius=ball-end', { required: true }),
      path: P('array', 'toolpath [{p:[x,y,z], rapid}] — rapids cut nothing', { required: true }),
      spacing: P('number', 'cubic voxel edge length (mm); smaller = more accurate + slower', { required: true }) },
    run: (a, forge) => {
      const r = forge.native.camRemoveMaterial({
        stock: a.stock, tool: a.tool, path: a.path, spacing: a.spacing,
      });
      return { op: 'cam.material-removal', ...r };
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
    // AUTO-CAPTURE design rationale (Task #39): if a build op (any verb other
    // than the explicit rationale.* verbs) carries a rationale/intent/constraint
    // alongside it, the "why" is attached to the produced feature automatically —
    // a byproduct of building, not a separate manual step. partId comes from the
    // op args or the per-sequence ctx.partId an Archie build binds. No rationale
    // payload → no-op, so every legacy call is unaffected.
    if (!name.startsWith('rationale.')) {
      const partId = args.partId ?? ctx.partId;
      if (partId) {
        try { rtFromOp(args, result || {}, { partId }); } catch { /* rationale capture is best-effort, never fails a build */ }
      }
    }
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
