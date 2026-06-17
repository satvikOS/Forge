#!/usr/bin/env node
/**
 * ForgeCADScore — headless, dependency-free geometry-truth scorer for ArchDisc Forge.
 *
 * Implements the CADGenBench "CAD Score":
 *   cad_score = gate * (0.4*shape + 0.4*interface + 0.2*topology)   [generation fixtures]
 *
 *   gate      — hard binary validity (closed && manifold && oriented && !self-intersect
 *               && no bad faces) on the final body, via kernel heal.checkValidity.
 *   shape     — mean of { volume-IoU proxy, bbox match, surface-F1 (Chamfer @0.5mm) }.
 *   interface — keep-in / keep-out "jig" test on named features (holes/bosses/slots),
 *               point-in-solid by ray-parity on the tessellation. (assembly / GD&T axis)
 *   topology  — Betti numbers (b0 = connected components via union-find on shared verts;
 *               b1,b2 via Euler characteristic per component) matched multiplicatively.
 *
 *   dimension-L1 — relative L1 error on every numeric the prompt/fixture names vs emitted args.
 *               (reported as a separate diagnostic axis; not folded into cad_score.)
 *
 * HEADLESS STRATEGY (per the preload API map): the native kernel
 * forge-kernel/build/Release/forge-kernel.node loads cleanly in plain Node and
 * exposes every method the bridge calls with identical names/arity. We therefore
 * acquire forge via a *minimal headless factory* that wraps the raw kernel and
 * overlays the single `surfacing.buildPatch` nested-grid → {uCount,vCount,xyz}
 * shim (the one place electron/preload.js changes argument shape). No Electron,
 * no extra deps. If the kernel fails to load we fall back to documenting that
 * Electron would be required — but the scorer logic is fully exercised against
 * the injected forge regardless.
 *
 * FRESH-KERNEL ISOLATION: the native kernel's handle counter is process-global
 * and monotonic (no reset API). The corpus encodes handles as "count up from 1
 * in creation order", so a multi-call row (`part.cut{a:1,b:3}`) is only faithful
 * when its sequence starts from a *clean* counter. We therefore replay every
 * sequence in a FRESH CHILD `node` process (this same file, `--worker`), which
 * builds + gates + measures + scores against an injected gt and returns JSON.
 * Single-call asset rows are handle-independent, but multi-call composition rows
 * and corruptions that drop a boolean require this isolation.
 *
 * USAGE:
 *   node forge-kernel/test/cadscore_harness.mjs                 # self-label + discrimination proof + scorecard
 *   node forge-kernel/test/cadscore_harness.mjs --fixtures p.json  # score a saved fixtures file
 *   node forge-kernel/test/cadscore_harness.mjs --write-fixtures p.json  # self-label and save
 *   node forge-kernel/test/cadscore_harness.mjs --model         # (stub) POST prompts to localhost:8080
 *
 * Dependency-free: pure Node builtins + the native kernel only. No browser globals.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import http from 'http';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO = path.resolve(__dirname, '..', '..');          // /Users/.../archdisc-Mech
const KERNEL_PATH = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const BRIDGE_PATH = path.resolve(REPO, 'frontend', 'src', 'ai', 'ForgeToolBridge.js');
const MODELS_FORGE = '/Users/account_clawteam1/archdisc-Models/data/forge';

// ───────────────────────────────────────────────────────────────────────────
//  Canonical SYSTEM string (4822-char sha256 `2be3ee94…`) — for the --model path.
//  LOCKSTEP: byte-identical to ForgeRunner.HERMES_FORGE_SYSTEM and
//  synth_defect_injection.SYSTEM. Any drift reintroduces the base-model
//  regression — keep all three in sync (verify with `--sha`, below).
// ───────────────────────────────────────────────────────────────────────────
const CANONICAL_SYSTEM =
  'You are Archie. Drive ArchDisc Forge via the kernel tool registry.\n' +
  '\n' +
  'Output exactly this shape:\n' +
  '  <plan>{"goal":"<noun>","discipline":"<part|sketch|assembly|drawing|manufacture|simulate>"}</plan>\n' +
  '  <tool_call>{"name":"<tool.id>","arguments":{...}}</tool_call>\n' +
  '  ...one call per step...\n' +
  '\n' +
  'Tool ids (use these, nothing else):\n' +
  '  part.make-box, part.make-cylinder, part.make-sphere, part.make-cone, part.make-torus,\n' +
  '  part.fuse, part.cut, part.common, part.translate, part.rotate, part.mass-properties, part.tessellate,\n' +
  '  sketch.create, sketch.add-point, sketch.add-line, sketch.add-circle, sketch.add-constraint, sketch.solve,\n' +
  '  assembly.add-instance, assembly.add-mate, assembly.set-fixed, assembly.solve, assembly.query-aabb,\n' +
  '  drawing.project,\n' +
  '  manufacture.cam-profile, manufacture.cam-pocket, manufacture.cam-drill, manufacture.gcode,\n' +
  '  simulate.fea-static, simulate.fea-modal, simulate.fea-dynamic.\n' +
  'Context build — the DEFAULT way to compose a part with an extra named feature. Build into the CURRENT body; the model NEVER names a handle:\n' +
  '  part.begin{primitive,dx,dy,dz|diameter,depth,at?} opens the current body from one primitive (box|cylinder|cone|sphere; at:[x,y,z] offsets it),\n' +
  '  part.add{primitive,…,at?} fuses a primitive ON (bosses/flanges/ribs/standoffs/fins), part.subtract{primitive,…,at?} cuts one OFF (holes/bores/pockets/slots; cutters auto-overhang through),\n' +
  '  part.intersect{primitive,…,at?} keeps the overlap, part.finish{fillet?,chamfer?} closes the body and breaks all edges LAST.\n' +
  'Build into the CURRENT body with part.add/part.subtract — never name a handle. Centre the base part on the origin so the pattern verbs line up.\n' +
  'Pattern features — repeated features (bolt circles, grids, fins) use ONE pattern verb, never N manual cuts:\n' +
  '  part.bolt-circle{count,bcd,diameter,depth?,at_z?} cuts N holes on a Z-axis bolt circle, part.grid-holes{nx,ny,dx,dy,diameter,depth?,at_z?} cuts an origin-centred grid,\n' +
  '  part.holes{locations,diameter,depth?,at_z?} cuts holes at explicit [[x,y],…], part.pattern-feature{primitive,…,kind,count,step_x,step_y,step_z|bcd,total_angle?,op} replicates a feature (kind:linear|polar, op:add|subtract).\n' +
  'Parametric / freeform features — PREFER these for CURVED, BLENDED or PATTERNED geometry instead of stacking boxes:\n' +
  '  part.extrude{profile,distance,dir}, part.revolve{profile,axisOrigin,axisDir,angleDeg} (vases/turned parts),\n' +
  '  part.pipe{path,radius} (curved pipe/duct along a 3D polyline), part.nurbs-surface{grid,uDegree,vDegree,thickness} (freeform),\n' +
  '  part.fillet{shape,radius,edgeIds?} (round edges; omit edgeIds = all), part.variable-fillet{shape,edgeId,anchors:[{u,r}]},\n' +
  '  part.chamfer{shape,distance,edgeIds?}, part.shell{shape,thickness,faceIds?}, part.draft-faces{shape,neutralPlane,faceIds,angleDeg},\n' +
  '  part.linear-pattern{shape,count,dx,dy,dz}, part.circular-pattern{shape,count,axisOrigin,axisDir,totalAngleDeg},\n' +
  '  part.push-pull-face{shape,faceId,distance}, part.continuity-check{face}, part.check-validity{shape}.\n' +
  'Profiles are [[x,y],…] closed point lists (mm). Real parts are seldom all-straight: use fillets, draft and revolves.\n' +
  'A whole standard part = ONE asset.make-* call; a part with an extra named feature = a context build. Fillets/chamfers go via part.finish LAST.\n' +
  'Degradation / weathering — when the request implies a used / cast / aged / as-found / worn part, apply ONE on the finished body:\n' +
  '  part.surface-wear{shape,count,depth,seed} (pitting/dents), part.surface-deposit{shape,count,height,seed} (corrosion blisters),\n' +
  '  part.chipped-edges{shape,count,size,seed} (impact/handling chips). Precision/aerospace/new parts stay clean (skip these).\n' +
  'Parametric assets — PREFER one of these when the request matches a whole part (one call builds it):\n' +
  '  asset.make-bored-plate{dx,dy,dz,bore}, asset.make-l-bracket{len,width,thick,wall,hole},\n' +
  '  asset.make-flange{od,thick,bore,bolts,bolt_d,bcd}, asset.make-stepped-shaft{d1,h1,d2,h2},\n' +
  '  asset.make-tube{od,wall,len}, asset.make-gusset-bracket{len,base_w,wall,thick,hole},\n' +
  '  asset.make-spur-gear{od,bore,thick}, asset.make-washer{od,id,thick}, asset.make-bushing{id,od,len},\n' +
  '  asset.make-pulley{od,bore,width}, asset.make-u-channel{len,width,height}, asset.make-keyed-shaft{diameter,length},\n' +
  '  asset.make-pipe-tee{od,wall}, asset.make-end-cap{od,id,height},\n' +
  '  asset.make-hex-nut{af,thick,bore}, asset.make-hex-bolt{af,head_h,shank_d,length}, asset.make-socket-screw{head_d,head_h,shank_d,length},\n' +
  '  asset.make-hex-standoff{af,length,bore}, asset.make-ball-bearing{od,id,width,balls}, asset.make-tslot-extrusion{size,length,slot}.\n' +
  'Body handles count up from 1 in creation order; pass them as "shape".\n' +
  'Materials are {E,nu,rho} in MPa / mm / tonne: steel {"E":210000,"nu":0.3,"rho":7.85e-9},\n' +
  'aluminium {"E":70000,"nu":0.33,"rho":2.7e-9}.\n' +
  'Dimensions are millimetres. No prose outside the tags. No <think> block.';
  'Dimensions are millimetres. No prose outside the tags. No <think> block.';

// ───────────────────────────────────────────────────────────────────────────
//  Headless forge acquisition
// ───────────────────────────────────────────────────────────────────────────
function makeHeadlessForge(kernelPath = KERNEL_PATH) {
  const kernel = require(kernelPath);
  // Only surfacing.buildPatch differs from preload: accept nested [[[x,y,z]…]…]
  // grid and flatten to {uCount,vCount,xyz}, exactly as electron/preload.js does.
  const surfacing = kernel.surfacing
    ? Object.assign(Object.create(null), kernel.surfacing, {
        buildPatch(gridOrSpec, uDeg, vDeg, uK, vK) {
          let spec = gridOrSpec;
          if (Array.isArray(gridOrSpec)) {
            const rows = gridOrSpec.length;
            const cols = Array.isArray(gridOrSpec[0]) ? gridOrSpec[0].length : 0;
            const xyz = new Float64Array(rows * cols * 3);
            let i = 0;
            for (let r = 0; r < rows; r++)
              for (let c = 0; c < cols; c++) {
                const p = gridOrSpec[r][c] || [0, 0, 0];
                xyz[i++] = p[0]; xyz[i++] = p[1]; xyz[i++] = p[2];
              }
            spec = { uCount: rows, vCount: cols, xyz };
          }
          return kernel.surfacing.buildPatch(spec, uDeg ?? 3, vDeg ?? 3, uK ?? null, vK ?? null);
        },
      })
    : null;

  return new Proxy(kernel, {
    get(t, p) {
      if (p === 'surfacing') return surfacing;
      if (p === 'isReady') return () => true;
      if (p === 'loadError') return () => null;
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
//  Geometry primitives (dependency-free)
// ───────────────────────────────────────────────────────────────────────────

/** Tessellate a handle → { positions:Float32Array, indices:Uint32Array, faceIds } */
function tess(forge, h) {
  return forge.tessellate(h, 0.1, 0.5);
}

/** Axis-aligned bounding box from a tessellation. */
function bboxOf(t) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  const P = t.positions;
  for (let i = 0; i < P.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = P[i + a];
      if (v < mn[a]) mn[a] = v;
      if (v > mx[a]) mx[a] = v;
    }
  }
  return { min: mn, max: mx };
}

/** Per-triangle area sum (mm²) and a uniform area-weighted point sampler. */
function triAreas(t) {
  const P = t.positions, I = t.indices;
  const n = I.length / 3;
  const areas = new Float64Array(n);
  let total = 0;
  for (let f = 0; f < n; f++) {
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    const ar = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    areas[f] = ar;
    total += ar;
  }
  return { areas, total };
}

// Deterministic PRNG so sampling/scores are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Area-weighted uniform point cloud on a tessellated surface. */
function samplePoints(t, n, seed = 1234) {
  const { areas, total } = triAreas(t);
  // cumulative
  const cdf = new Float64Array(areas.length);
  let acc = 0;
  for (let i = 0; i < areas.length; i++) { acc += areas[i]; cdf[i] = acc; }
  const rng = mulberry32(seed);
  const P = t.positions, I = t.indices;
  const out = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    const r = rng() * total;
    // binary search the triangle
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < r) lo = m + 1; else hi = m; }
    const f = lo;
    let u = rng(), v = rng();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
    for (let d = 0; d < 3; d++) {
      out[k * 3 + d] = P[a + d] + u * (P[b + d] - P[a + d]) + v * (P[c + d] - P[a + d]);
    }
  }
  return out;
}

/** Build a uniform-grid spatial hash for nearest-neighbour queries on a cloud. */
function buildGrid(cloud, cell) {
  const map = new Map();
  const key = (ix, iy, iz) => ix + ',' + iy + ',' + iz;
  for (let i = 0; i < cloud.length; i += 3) {
    const ix = Math.floor(cloud[i] / cell);
    const iy = Math.floor(cloud[i + 1] / cell);
    const iz = Math.floor(cloud[i + 2] / cell);
    const k = key(ix, iy, iz);
    let arr = map.get(k); if (!arr) { arr = []; map.set(k, arr); }
    arr.push(i);
  }
  return { map, cell, key };
}

/** Nearest-neighbour distance from point (px,py,pz) to a gridded cloud. */
function nnDist(px, py, pz, cloud, grid) {
  const { map, cell, key } = grid;
  const ix = Math.floor(px / cell), iy = Math.floor(py / cell), iz = Math.floor(pz / cell);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const arr = map.get(key(ix + dx, iy + dy, iz + dz));
        if (!arr) continue;
        for (const j of arr) {
          const ex = cloud[j] - px, ey = cloud[j + 1] - py, ez = cloud[j + 2] - pz;
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 < best) best = d2;
        }
      }
  return Math.sqrt(best);
}

/**
 * Bidirectional, area-weighted Chamfer surface-F1 @ tau mm.
 * precision = fraction of A-samples within tau of B; recall = fraction of
 * B-samples within tau of A. F1 is their harmonic mean. F1≈1 ⇒ surfaces coincide.
 *
 * The match threshold has a 0.5 mm floor (the CADGenBench convention — small,
 * precise features) but scales up to ~2.5× the inter-sample spacing for large
 * parts, so two clouds drawn from the *same* surface score ≈1.0 instead of being
 * penalised by discretisation noise (a 150 mm plate sampled at N points has
 * ~1 mm point spacing — a fixed 0.5 mm tol would mark identical surfaces wrong).
 */
function surfaceF1(tA, tB, n = 8000, tauFloor = 0.5) {
  const ca = samplePoints(tA, n, 11);
  const cb = samplePoints(tB, n, 23);
  const areaA = triAreas(tA).total;
  const spacing = Math.sqrt(Math.max(areaA, 1) / n);
  const tau = Math.max(tauFloor, 2.5 * spacing);
  const cell = Math.max(tau * 2, 1.0);
  const gA = buildGrid(ca, cell);
  const gB = buildGrid(cb, cell);
  let hitA = 0, hitB = 0;
  for (let i = 0; i < ca.length; i += 3)
    if (nnDist(ca[i], ca[i + 1], ca[i + 2], cb, gB) <= tau) hitA++;
  for (let i = 0; i < cb.length; i += 3)
    if (nnDist(cb[i], cb[i + 1], cb[i + 2], ca, gA) <= tau) hitB++;
  const precision = hitA / (ca.length / 3);
  const recall = hitB / (cb.length / 3);
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Ray-parity point-in-solid test against a tessellation (Möller–Trumbore).
 * The ray direction is a generic, non-axis-aligned unit vector so it never
 * grazes axis-aligned faces or hits shared edges of cylindrical tessellations
 * tangentially (which would miscount parity on bores/cylinders).
 */
const RAY_DIR = (() => {
  const v = [0.573218, 0.371099, 0.731021];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
})();
function pointInSolid(px, py, pz, t) {
  const P = t.positions, I = t.indices;
  const o = [px, py, pz];
  const d = RAY_DIR;
  let count = 0;
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    const v0x = P[a], v0y = P[a + 1], v0z = P[a + 2];
    const e1 = [P[b] - v0x, P[b + 1] - v0y, P[b + 2] - v0z];
    const e2 = [P[c] - v0x, P[c + 1] - v0y, P[c + 2] - v0z];
    const px_ = d[1] * e2[2] - d[2] * e2[1];
    const py_ = d[2] * e2[0] - d[0] * e2[2];
    const pz_ = d[0] * e2[1] - d[1] * e2[0];
    const det = e1[0] * px_ + e1[1] * py_ + e1[2] * pz_;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tx = o[0] - v0x, ty = o[1] - v0y, tz = o[2] - v0z;
    const u = (tx * px_ + ty * py_ + tz * pz_) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1[2] - tz * e1[1];
    const qy = tz * e1[0] - tx * e1[2];
    const qz = tx * e1[1] - ty * e1[0];
    const vv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (vv < 0 || u + vv > 1) continue;
    const tt = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv;
    if (tt > 1e-9) count++;
  }
  return (count & 1) === 1;
}

// ───────────────────────────────────────────────────────────────────────────
//  Topology: Betti numbers from a tessellation
// ───────────────────────────────────────────────────────────────────────────
/**
 * b0 = connected components (union-find on vertices welded by position).
 * Per component, Euler χ = V - E + F  ⇒ for a closed orientable 2-manifold,
 *   χ = 2 - 2g  ⇒ genus g = (2 - χ)/2.
 *   b0 (component): 1, b1 = 2g, b2 = 1.
 * Total Betti = sum over components.
 */
function bettiNumbers(t) {
  const P = t.positions, I = t.indices;
  const nVraw = P.length / 3;
  // Weld vertices by quantised position so shared edges/faces merge.
  const q = 1e-4;
  const keyOf = (i) =>
    Math.round(P[i * 3] / q) + ',' + Math.round(P[i * 3 + 1] / q) + ',' + Math.round(P[i * 3 + 2] / q);
  const weld = new Map();
  const rep = new Int32Array(nVraw);
  let nV = 0;
  for (let i = 0; i < nVraw; i++) {
    const k = keyOf(i);
    let id = weld.get(k);
    if (id === undefined) { id = nV++; weld.set(k, id); }
    rep[i] = id;
  }
  // Union-find over welded vertices via triangle edges.
  const parent = new Int32Array(nV);
  for (let i = 0; i < nV; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };

  const nF = I.length / 3;
  const edgeSet = new Set();
  const edgeKey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
  for (let f = 0; f < nF; f++) {
    const a = rep[I[f * 3]], b = rep[I[f * 3 + 1]], c = rep[I[f * 3 + 2]];
    uni(a, b); uni(b, c); uni(c, a);
    edgeSet.add(edgeKey(a, b));
    edgeSet.add(edgeKey(b, c));
    edgeSet.add(edgeKey(c, a));
  }
  // Per-component tallies.
  const comp = new Map(); // root → {V:Set, E:Set, F:int}
  const compOf = (id) => find(id);
  const usedV = new Set();
  for (let i = 0; i < nV; i++) usedV.add(i);
  const cV = new Map();
  for (const v of usedV) { const r = compOf(v); cV.set(r, (cV.get(r) || 0) + 1); }
  const cE = new Map();
  for (const e of edgeSet) {
    const [a] = e.split(':');
    const r = compOf(Number(a));
    cE.set(r, (cE.get(r) || 0) + 1);
  }
  const cF = new Map();
  for (let f = 0; f < nF; f++) {
    const r = compOf(rep[I[f * 3]]);
    cF.set(r, (cF.get(r) || 0) + 1);
  }
  let b0 = 0, b1 = 0, b2 = 0;
  for (const [r, V] of cV) {
    const E = cE.get(r) || 0;
    const F = cF.get(r) || 0;
    const chi = V - E + F;
    const genus = Math.max(0, Math.round((2 - chi) / 2));
    b0 += 1;
    b1 += 2 * genus;
    b2 += 1; // closed solid component encloses one void
    comp.set(r, { V, E, F, chi, genus });
  }
  return { b0, b1, b2 };
}

// ───────────────────────────────────────────────────────────────────────────
//  Validity gate
// ───────────────────────────────────────────────────────────────────────────
function arrLen(x) {
  if (x == null) return 0;
  if (Array.isArray(x)) return x.length;
  if (typeof x.length === 'number') return x.length;
  if (typeof x === 'object') return Object.keys(x).length;
  return 0;
}

function checkValid(forge, h) {
  const v = forge.heal.checkValidity(h);
  const badF = arrLen(v.badFaces);
  const badE = arrLen(v.badEdges);
  const valid = !!v.isClosed && !!v.isManifold && !!v.isOriented &&
    !v.hasSelfIntersect && badF === 0;
  return { valid, raw: v, badFaces: badF, badEdges: badE };
}

/** STEP round-trip: export to a tmp .step, re-import, re-check validity. */
function stepRoundTrip(forge, h) {
  let tmp;
  try {
    tmp = path.join(os.tmpdir(), `fcs_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}.step`);
    // Suppress OCCT transfer chatter on stdout during export.
    const ok = forge.io.exportStep(h, tmp);
    if (!ok || !fs.existsSync(tmp)) return { ok: false, reason: 'export failed' };
    const h2 = forge.io.importStep(tmp);
    if (typeof h2 !== 'number' || h2 <= 0) return { ok: false, reason: 'import returned no handle' };
    const re = checkValid(forge, h2);
    return { ok: re.valid, reimportHandle: h2 };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  } finally {
    if (tmp && fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Scoring axes
// ───────────────────────────────────────────────────────────────────────────
function scoreShape(forge, h, gt) {
  const mp = forge.massProps(h);
  const t = tess(forge, h);
  const bb = bboxOf(t);

  // (1) volume-IoU proxy
  const vol = Math.max(mp.volume, 0);
  const gv = Math.max(gt.volume, 0);
  const volScore = (vol === 0 && gv === 0) ? 1 : 1 - Math.abs(vol - gv) / Math.max(vol, gv, 1e-9);

  // (2) bbox match: per-axis size IoU on extents, averaged
  let bboxScore = 0;
  for (let a = 0; a < 3; a++) {
    const lo1 = bb.min[a], hi1 = bb.max[a];
    const lo2 = gt.bbox.min[a], hi2 = gt.bbox.max[a];
    const inter = Math.max(0, Math.min(hi1, hi2) - Math.max(lo1, lo2));
    const uni = Math.max(hi1, hi2) - Math.min(lo1, lo2);
    bboxScore += uni > 1e-9 ? inter / uni : 1;
  }
  bboxScore /= 3;

  // (3) surface-F1 (Chamfer, 0.5mm floor scaled by sample spacing) vs gt tessellation
  let f1 = 1;
  if (gt._tess) f1 = surfaceF1(t, gt._tess, 8000, 0.5);

  const shape = (volScore + bboxScore + f1) / 3;
  return { shape, volScore, bboxScore, surfaceF1: f1, vol, bbox: bb };
}

/**
 * Interface jig: each feature { kind:'hole'|'boss'|'slot', center:[x,y,z], r, axis, keepIn[], keepOut[] }.
 * keepIn  points must be cavity (hole/slot) or solid (boss);
 * keepOut points must be the opposite (i.e. the part must NOT intrude there).
 * Score per feature = worst of (keepIn pass-rate, keepOut pass-rate); averaged over features.
 */
function scoreInterface(forge, h, features) {
  if (!features || features.length === 0) return { interface: 1, perFeature: [] };
  const t = tess(forge, h);
  const perFeature = [];
  let sum = 0;
  for (const ft of features) {
    const wantInsideForKeepIn = ft.kind === 'boss'; // boss keep-in = solid; hole/slot keep-in = cavity
    let inPass = 0, inTot = 0, outPass = 0, outTot = 0;
    for (const p of ft.keepIn || []) {
      inTot++;
      const inside = pointInSolid(p[0], p[1], p[2], t);
      if (inside === wantInsideForKeepIn) inPass++;
    }
    for (const p of ft.keepOut || []) {
      outTot++;
      const inside = pointInSolid(p[0], p[1], p[2], t);
      // keep-out: the part must respect this region → opposite of keep-in expectation
      if (inside === !wantInsideForKeepIn) outPass++;
    }
    const inRate = inTot ? inPass / inTot : 1;
    const outRate = outTot ? outPass / outTot : 1;
    const fscore = Math.min(inRate, outRate);
    perFeature.push({ kind: ft.kind, inRate, outRate, score: fscore });
    sum += fscore;
  }
  return { interface: sum / features.length, perFeature };
}

/** Multiplicative Betti match with partial-credit falloff (1 / (1+|Δ|)). */
function scoreTopology(forge, h, gtBetti) {
  const b = bettiNumbers(tess(forge, h));
  const credit = (got, want) => 1 / (1 + Math.abs(got - want));
  const c0 = credit(b.b0, gtBetti.b0);
  const c1 = credit(b.b1, gtBetti.b1);
  const c2 = credit(b.b2, gtBetti.b2);
  return { topology: c0 * c1 * c2, betti: b, c0, c1, c2 };
}

/** Dimension-L1: mean relative error over named dims (gt vs emitted args). */
function scoreDimensionL1(emittedDims, gtDims) {
  const keys = Object.keys(gtDims);
  if (keys.length === 0) return { dimL1: 1, perDim: {} };
  const perDim = {};
  let sumErr = 0, n = 0;
  for (const k of keys) {
    const want = gtDims[k];
    const got = emittedDims[k];
    if (typeof want !== 'number') continue;
    n++;
    if (typeof got !== 'number') { perDim[k] = { want, got: null, relErr: 1 }; sumErr += 1; continue; }
    const relErr = Math.min(1, Math.abs(got - want) / Math.max(Math.abs(want), 1e-9));
    perDim[k] = { want, got, relErr };
    sumErr += relErr;
  }
  const meanErr = n ? sumErr / n : 0;
  return { dimL1: 1 - meanErr, perDim };
}

// ───────────────────────────────────────────────────────────────────────────
//  Corpus parsing + self-labeling
// ───────────────────────────────────────────────────────────────────────────
const PLAN_RE = /<plan>(\{[\s\S]*?\})<\/plan>/;
const TC_RE = /<tool_call>(\{[\s\S]*?\})<\/tool_call>/g;

function parseRow(line) {
  const row = JSON.parse(line);
  const by = {};
  for (const m of row.messages) by[m.role] = m.content;
  const asst = by.assistant || '';
  const planM = PLAN_RE.exec(asst);
  const calls = [];
  let m;
  TC_RE.lastIndex = 0;
  while ((m = TC_RE.exec(asst)) !== null) calls.push(JSON.parse(m[1]));
  return {
    system: by.system,
    user: by.user,
    plan: planM ? JSON.parse(planM[1]) : null,
    calls,
    meta: row.meta || {},
  };
}

/** Collect named dims from the ordered calls' arguments (the exact build numbers). */
function dimsFromCalls(calls) {
  const out = {};
  for (const c of calls) {
    const a = c.arguments || {};
    for (const [k, v] of Object.entries(a)) {
      if (typeof v === 'number') {
        // prefix with the verb so repeated keys across calls don't collide
        const key = `${c.name.split('.').pop()}.${k}`;
        out[key] = v;
      }
    }
  }
  return out;
}

/** Read the first row matching a predicate from a corpus dir (valid, then train). */
function findRow(dir, predicate) {
  for (const split of ['valid.jsonl', 'train.jsonl']) {
    const fp = path.join(MODELS_FORGE, dir, split);
    if (!fs.existsSync(fp)) continue;
    const lines = fs.readFileSync(fp, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed;
      try { parsed = parseRow(line); } catch { continue; }
      if (predicate(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * Self-label a fixture: replay its tool_calls once in a FRESH kernel child,
 * snapshot ground-truth geometry. The corpus IS the ground truth.
 */
function selfLabel(name, dir, predicate, interfaceBuilder, dirs = [dir]) {
  let row = null;
  for (const d of dirs) { row = findRow(d, predicate); if (row) { dir = d; break; } }
  if (!row) throw new Error(`no corpus row found for fixture '${name}' in [${dirs.join(', ')}]`);
  const res = runJobInChild({ op: 'label', calls: row.calls });
  if (!res.ok) throw new Error(`fixture '${name}' label failed: ${res.error}`);
  const gt = res.gt;
  const features = interfaceBuilder
    ? interfaceBuilder(row, { bbox: gt.bbox, com: gt.com })
    : [];
  return { name, dir, prompt: row.user, calls: row.calls, gt, features };
}

/** Rehydrate a saved fixture's gt tessellation for scoring. */
function hydrateGt(fx) {
  const gt = fx.gt;
  if (gt.tessSnapshot) {
    gt._tess = {
      positions: Float32Array.from(gt.tessSnapshot.positions),
      indices: Uint32Array.from(gt.tessSnapshot.indices),
    };
  }
  return gt;
}

// ───────────────────────────────────────────────────────────────────────────
//  Interface feature builders (the GD&T / mating-jig per fixture)
// ───────────────────────────────────────────────────────────────────────────
// Points are sampled relative to known feature geometry so a CORRECT part passes
// and a part with the feature missing/misplaced/wrong-size fails.

function ringPoints(cx, cy, z, radius, n = 8) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a), z]);
  }
  return pts;
}

const INTERFACE_BUILDERS = {
  // bored-plate: central bore must be empty; surrounding plate must be solid.
  boredPlate: (row, { bbox }) => {
    const a = row.calls[0].arguments;
    const cx = a.dx / 2, cy = a.dy / 2, z = a.dz / 2;
    const r = a.bore / 2;
    return [{
      kind: 'hole', center: [cx, cy, z], r,
      // keep-in: points well inside the bore must be cavity
      keepIn: ringPoints(cx, cy, z, r * 0.4, 6).concat([[cx, cy, z]]),
      // keep-out: the bore must NOT eat the plate body just outside it
      keepOut: ringPoints(cx, cy, z, r + Math.min(a.dx, a.dy) * 0.18, 8),
    }];
  },
  // flange: central bore empty + bolt circle holes empty + disk solid between holes.
  flange: (row) => {
    const a = row.calls[0].arguments;
    const z = a.thick / 2;
    const boreR = a.bore / 2;
    const bcdR = a.bcd / 2;
    const boltR = a.bolt_d / 2;
    const feats = [{
      kind: 'hole', center: [0, 0, z], r: boreR,
      keepIn: ringPoints(0, 0, z, boreR * 0.4, 6).concat([[0, 0, z]]),
      keepOut: ringPoints(0, 0, z, (boreR + bcdR) / 2, 8), // solid annulus between bore and BCD
    }];
    // bolt holes
    for (let i = 0; i < a.bolts; i++) {
      const ang = (2 * Math.PI * i) / a.bolts;
      const bx = bcdR * Math.cos(ang), by = bcdR * Math.sin(ang);
      feats.push({
        kind: 'hole', center: [bx, by, z], r: boltR,
        keepIn: [[bx, by, z]], // bolt-hole centre must be cavity
        keepOut: [
          [bx + boltR + 3, by, z],
          [bx - boltR - 3, by, z],
        ].filter((p) => Math.hypot(p[0], p[1]) < a.od / 2 - 0.5), // adjacent disk must be solid
      });
    }
    return feats;
  },
  // tube: hollow bore along Z must be empty; wall must be solid.
  tube: (row, { bbox }) => {
    const a = row.calls[0].arguments;
    const z = (bbox.min[2] + bbox.max[2]) / 2;
    const innerR = a.od / 2 - a.wall;
    const wallMidR = a.od / 2 - a.wall / 2;
    return [{
      kind: 'hole', center: [0, 0, z], r: innerR,
      keepIn: ringPoints(0, 0, z, innerR * 0.5, 6).concat([[0, 0, z]]),
      keepOut: ringPoints(0, 0, z, wallMidR, 8), // mid-wall must be solid
    }];
  },
  // washer: like a tube but thin — bore empty, ring solid.
  washer: (row, { bbox }) => {
    const a = row.calls[0].arguments;
    const z = (bbox.min[2] + bbox.max[2]) / 2;
    const innerR = a.id / 2;
    const ringMidR = (a.id / 2 + a.od / 2) / 2;
    return [{
      kind: 'hole', center: [0, 0, z], r: innerR,
      keepIn: ringPoints(0, 0, z, innerR * 0.5, 6).concat([[0, 0, z]]),
      keepOut: ringPoints(0, 0, z, ringMidR, 8),
    }];
  },
  // composition plate-with-hole: hole through middle empty, plate solid around it.
  plateHole: (row, { bbox }) => {
    const box = row.calls.find((c) => c.name === 'part.make-box').arguments;
    const cyl = row.calls.find((c) => c.name === 'part.make-cylinder').arguments;
    const cx = box.dx / 2, cy = box.dy / 2, z = box.dz / 2;
    const r = cyl.radius;
    return [{
      kind: 'hole', center: [cx, cy, z], r,
      keepIn: ringPoints(cx, cy, z, r * 0.4, 6).concat([[cx, cy, z]]),
      keepOut: ringPoints(cx, cy, z, r + Math.min(box.dx, box.dy) * 0.2, 8),
    }];
  },
  // stepped-shaft: solid body — boss test on the upper (smaller-Ø) section.
  // keep-in: the small-step axis must be solid material.
  // keep-out: the annulus that is AIR around the small step (between d2/2 and d1/2)
  //   — a part that loses the step (d2:=d1) fills this region and fails keep-out.
  steppedShaft: (row, { bbox }) => {
    const a = row.calls[0].arguments;
    const zTop = bbox.max[2] - a.h2 / 2; // mid of the upper (smaller) section
    const midAnnulusR = (a.d2 / 2 + a.d1 / 2) / 2; // halfway between small and large radius
    return [{
      kind: 'boss', center: [0, 0, zTop], r: a.d2 / 2,
      keepIn: [[0, 0, zTop], [a.d2 / 4, 0, zTop], [-a.d2 / 4, 0, zTop]],
      keepOut: ringPoints(0, 0, zTop, midAnnulusR, 8), // air around the small step
    }];
  },
};

// ───────────────────────────────────────────────────────────────────────────
//  Fixture registry (≥6 diverse part types, each a DIFFERENT prompt)
// ───────────────────────────────────────────────────────────────────────────
const FIXTURE_SPECS = [
  { name: 'bored-plate', dir: 'assets',
    pred: (r) => r.calls.length === 1 && r.calls[0].name === 'asset.make-bored-plate',
    iface: INTERFACE_BUILDERS.boredPlate },
  { name: 'flange-6bolt', dir: 'assets',
    pred: (r) => r.calls[0].name === 'asset.make-flange' && (r.calls[0].arguments.bolts >= 4),
    iface: INTERFACE_BUILDERS.flange },
  { name: 'l-bracket', dir: 'composition',
    pred: (r) => r.calls[0].name === 'part.make-box' && r.calls.some((c) => c.name === 'part.fuse') &&
      r.calls.filter((c) => c.name === 'part.cut').length >= 2 && /l.?bracket/i.test(r.user),
    iface: null },
  { name: 'stepped-shaft', dir: 'assets',
    pred: (r) => r.calls.length === 1 && r.calls[0].name === 'asset.make-stepped-shaft',
    iface: INTERFACE_BUILDERS.steppedShaft },
  { name: 'tube-housing', dir: 'assets',
    pred: (r) => r.calls.length === 1 && r.calls[0].name === 'asset.make-tube',
    iface: INTERFACE_BUILDERS.tube },
  { name: 'hex-bolt', dir: 'standard_parts', dirs: ['standard_parts'],
    pred: (r) => r.calls.length === 1 && r.calls[0].name === 'asset.make-hex-bolt',
    iface: null },
  { name: 'plate-bolt-hole', dir: 'composition',
    pred: (r) => r.calls.map((c) => c.name).join(',') === 'part.make-box,part.make-cylinder,part.translate,part.cut',
    iface: INTERFACE_BUILDERS.plateHole },
  { name: 'washer', dir: 'degradation', dirs: ['degradation', 'parametric'],
    pred: (r) => r.calls.length === 1 && r.calls[0].name === 'asset.make-washer',
    iface: INTERFACE_BUILDERS.washer },
];

// ───────────────────────────────────────────────────────────────────────────
//  Corruptions (for the discrimination proof) — produce a clearly-worse part.
// ───────────────────────────────────────────────────────────────────────────
function corruptCalls(fx) {
  const calls = JSON.parse(JSON.stringify(fx.calls));
  const desc = [];
  // Strategy varies by fixture so the proof hits interface + dimension axes.
  const head = calls[0];
  const verb = head.name;

  if (verb === 'asset.make-bored-plate') {
    head.arguments.bore = head.arguments.bore * 3; // bore 3x → interface keep-out fails, dims drift
    desc.push('bore ×3');
  } else if (verb === 'asset.make-flange') {
    // Move the bolt circle inward and enlarge the bore: every bolt hole lands off
    // its snapshot position (keep-in points read solid) and the bore eats the
    // annulus → the interface jig collapses. (Note: bolts:0 would no-op because the
    // builder defaults `bolts || 6`, so we perturb geometry that the builder honours.)
    head.arguments.bcd = head.arguments.bcd * 0.55;
    head.arguments.bore = head.arguments.bore * 2.2;
    desc.push('bcd ×0.55, bore ×2.2');
  } else if (verb === 'asset.make-stepped-shaft') {
    head.arguments.d2 = head.arguments.d1; // small step becomes full diameter → wrong shape
    desc.push('d2:=d1 (lose the step)');
  } else if (verb === 'asset.make-tube') {
    head.arguments.wall = head.arguments.od / 2 - 0.5; // nearly fill the bore → keep-in fails
    desc.push('wall→solid (bore gone)');
  } else if (verb === 'asset.make-washer') {
    head.arguments.id = head.arguments.od - 2; // bore swells to nearly OD → wrong shape + interface
    desc.push('id→od-2');
  } else if (verb === 'asset.make-hex-bolt') {
    head.arguments.length = head.arguments.length * 3; // dimension blow-up
    desc.push('length ×3');
  } else if (fx.name === 'plate-bolt-hole') {
    // drop the final cut → the hole disappears (interface + shape regress)
    const idx = calls.findIndex((c) => c.name === 'part.cut');
    if (idx >= 0) { calls.splice(idx, 1); desc.push('drop final cut (hole)'); }
  } else if (fx.name === 'l-bracket') {
    // drop both hole cuts → bracket has no fixing holes (shape + topology regress)
    for (let i = calls.length - 1; i >= 0; i--) if (calls[i].name === 'part.cut') calls.splice(i, 1);
    // also remove the now-dangling cylinders/translates feeding those cuts
    desc.push('drop both fixing-hole cuts');
  } else {
    // generic: 2.5x a key numeric dimension
    for (const [k, v] of Object.entries(head.arguments)) {
      if (typeof v === 'number') { head.arguments[k] = v * 2.5; desc.push(`${k} ×2.5`); break; }
    }
  }
  return { calls, desc: desc.join(', ') };
}

// ───────────────────────────────────────────────────────────────────────────
//  Full scorer over a built body + a fixture's ground truth
// ───────────────────────────────────────────────────────────────────────────
function scoreBody(forge, lastHandle, fx, emittedCalls) {
  const gt = hydrateGt(fx);

  // GATE
  const gate = checkValid(forge, lastHandle);
  const stepRt = stepRoundTrip(forge, lastHandle);

  if (!gate.valid) {
    return {
      cad_score: 0, gate: 0, validity: gate.raw, stepRoundTripOk: stepRt.ok,
      shape: 0, interface: 0, topology: 0, dimL1: 0,
      detail: { reason: 'validity gate failed' },
    };
  }

  // SHAPE
  const sh = scoreShape(forge, lastHandle, gt);
  // INTERFACE
  const itf = scoreInterface(forge, lastHandle, fx.features);
  // TOPOLOGY
  const tp = scoreTopology(forge, lastHandle, gt.betti);
  // DIMENSION-L1
  const emittedDims = dimsFromCalls(emittedCalls);
  const dl = scoreDimensionL1(emittedDims, gt.dims);

  const cad = 1 * (0.4 * sh.shape + 0.4 * itf.interface + 0.2 * tp.topology);
  return {
    cad_score: cad, gate: 1, validity: gate.raw, stepRoundTripOk: stepRt.ok,
    shape: sh.shape, interface: itf.interface, topology: tp.topology, dimL1: dl.dimL1,
    detail: { shape: sh, interface: itf, topology: tp, dim: dl },
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Output formatting
// ───────────────────────────────────────────────────────────────────────────
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }
function fmt(x) { return (typeof x === 'number') ? x.toFixed(3) : String(x); }

function printScorecard(title, rows) {
  console.log(`\n${title}`);
  const header = ['fixture', 'gate', 'valid', 'stepRT', 'shape', 'iface', 'topo', 'dimL1', 'CAD'];
  const widths = [20, 5, 6, 7, 7, 7, 7, 7, 7];
  console.log(header.map((h, i) => pad(h, widths[i])).join(''));
  console.log('-'.repeat(widths.reduce((a, b) => a + b, 0)));
  for (const r of rows) {
    console.log([
      pad(r.name, widths[0]),
      pad(r.gate, widths[1]),
      pad(r.gate ? (r.validityValid ? 'Y' : 'N') : '-', widths[2]),
      pad(r.stepRoundTripOk ? 'Y' : 'N', widths[3]),
      pad(fmt(r.shape), widths[4]),
      pad(fmt(r.interface), widths[5]),
      pad(fmt(r.topology), widths[6]),
      pad(fmt(r.dimL1), widths[7]),
      pad(fmt(r.cad_score), widths[8]),
    ].join(''));
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  --model mode (stub but wired): POST a prompt to localhost:8080
// ───────────────────────────────────────────────────────────────────────────
function postToModel(systemStr, userStr, { host = '127.0.0.1', port = 8080, maxTokens = 640, adapter = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = {
      messages: [
        { role: 'system', content: systemStr },
        { role: 'user', content: userStr },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    };
    if (adapter) payload.adapters = adapter;   // per-request LoRA routing (mlx_lm.server)
    const body = JSON.stringify(payload);
    const req = http.request(
      { host, port, path: '/v1/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 60000 },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            resolve(j.choices?.[0]?.message?.content ?? '');
          } catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('model request timed out')); });
    req.write(body);
    req.end();
  });
}

function callsFromAssistant(text) {
  const calls = [];
  let m;
  TC_RE.lastIndex = 0;
  while ((m = TC_RE.exec(text)) !== null) {
    try { calls.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
  }
  return calls;
}

// ───────────────────────────────────────────────────────────────────────────
//  Fresh-kernel child orchestration
//
//  Each job runs in its own `node --worker` child so the kernel handle counter
//  starts at 1 (matching the corpus's 1-based "count up from creation order").
//  Job shapes:
//    { op:'label', calls, features? }           → snapshot gt {volume,bbox,betti,dims,tess,features}
//    { op:'score', calls, emittedCalls?, gt, features } → full CAD scorecard for a build
//  Result is written as JSON to --out so OCCT stdout chatter never corrupts it.
// ───────────────────────────────────────────────────────────────────────────
function runJobInChild(job) {
  const jobFile = path.join(os.tmpdir(), `fcs_job_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}.json`);
  const outFile = jobFile.replace('.json', '.out.json');
  fs.writeFileSync(jobFile, JSON.stringify(job));
  try {
    const r = spawnSync(process.execPath, [__filename, '--worker', '--job', jobFile, '--out', outFile], {
      stdio: ['ignore', 'ignore', 'inherit'], // discard worker stdout (OCCT chatter); keep stderr for warnings
      timeout: 120000,
    });
    if (r.status !== 0 && !fs.existsSync(outFile)) {
      return { ok: false, error: `worker exited ${r.status}${r.signal ? ' (' + r.signal + ')' : ''}` };
    }
    if (!fs.existsSync(outFile)) return { ok: false, error: 'worker produced no output' };
    return JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    for (const f of [jobFile, outFile]) if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  }
}

/** Worker entrypoint: build in a fresh kernel and emit JSON for one job. */
async function runWorker(jobFile, outFile) {
  const forge = makeHeadlessForge();
  const { dispatchSequence } = await import(BRIDGE_PATH);
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  let result;
  try {
    if (job.op === 'label') {
      const { lastHandle, errors } = await dispatchSequence(job.calls, forge);
      if (!lastHandle) { result = { ok: false, error: 'no solid body', errors }; }
      else {
        const mp = forge.massProps(lastHandle);
        const t = tess(forge, lastHandle);
        const bb = bboxOf(t);
        const betti = bettiNumbers(t);
        const valid = checkValid(forge, lastHandle).valid;
        result = {
          ok: true, errors,
          gt: {
            volume: mp.volume, area: mp.area, com: mp.centerOfMass,
            bbox: bb, betti, bodyCount: betti.b0, valid, dims: dimsFromCalls(job.calls),
            tessSnapshot: { positions: Array.from(t.positions), indices: Array.from(t.indices) },
          },
        };
      }
    } else if (job.op === 'score') {
      const { lastHandle, errors } = await dispatchSequence(job.calls, forge);
      if (!lastHandle) { result = { ok: false, error: 'no solid body', errors, score: zeroScore('no body') }; }
      else {
        const fx = { gt: job.gt, features: job.features || [] };
        const s = scoreBody(forge, lastHandle, fx, job.emittedCalls || job.calls);
        result = { ok: true, errors, score: s };
      }
    } else {
      result = { ok: false, error: `unknown op '${job.op}'` };
    }
  } catch (e) {
    result = { ok: false, error: e.stack || String(e) };
  }
  fs.writeFileSync(outFile, JSON.stringify(result));
}

function zeroScore(reason) {
  return {
    cad_score: 0, gate: 0, validity: null, stepRoundTripOk: false,
    shape: 0, interface: 0, topology: 0, dimL1: 0, detail: { reason },
  };
}

function rowFromScore(name, s) {
  return {
    name, ...s,
    validityValid: s.gate && s.validity ? (s.validity.isClosed && s.validity.isManifold) : false,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Main
// ───────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const has = (flag) => argv.includes(flag);

  // ── --sha: print the SHA-256 of the canonical SYSTEM here and (best-effort)
  //    the live HERMES_FORGE_SYSTEM in ForgeRunner.js, asserting byte-match.
  //    This is the lockstep check: all three SYSTEM copies must share one SHA. ──
  if (has('--sha')) {
    const crypto = await import('crypto');
    const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    const local = sha(CANONICAL_SYSTEM);
    console.log(`cadscore_harness.mjs  CANONICAL_SYSTEM   len=${CANONICAL_SYSTEM.length}  sha256=${local}`);
    let hermes = null;
    try {
      const frPath = path.resolve(REPO, 'frontend', 'src', 'ai', 'ForgeRunner.js');
      const src = fs.readFileSync(frPath, 'utf8');
      const m = src.match(/const HERMES_FORGE_SYSTEM\s*=\s*\n`([\s\S]*?)`;/);
      hermes = m ? m[1] : null;
    } catch { /* best-effort */ }
    if (hermes != null) {
      const h = sha(hermes);
      console.log(`ForgeRunner.js        HERMES_FORGE_SYSTEM len=${hermes.length}  sha256=${h}`);
      const ok = h === local;
      console.log(`LOCKSTEP (cadscore === ForgeRunner): ${ok ? 'MATCH ✓' : 'MISMATCH ✗'}`);
      if (!ok) process.exit(7);
    } else {
      console.log('ForgeRunner.js        HERMES_FORGE_SYSTEM not found (could not read source)');
    }
    return;
  }

  // Probe that the kernel loads headless (a fresh child does the real builds).
  try {
    const forge = makeHeadlessForge();
    const b = forge.makeBox(1, 1, 1);
    if (typeof b !== 'number') throw new Error('makeBox did not return a handle');
  } catch (e) {
    console.error('[fatal] could not load the native kernel headless:', e.message);
    console.error('        The scorer requires forge-kernel/build/Release/forge-kernel.node.');
    console.error('        If the .node is missing/ABI-mismatched, an Electron host would be');
    console.error('        required to supply window.forge; the scorer would then accept it via');
    console.error('        an injected forge object (same API). Aborting.');
    process.exit(2);
  }
  console.log('Headless kernel loaded OK (plain require + buildPatch shim; no Electron).');

  // ── --fixtures: load a saved fixtures file and score replay + corrupted ──
  let fixtures;
  const fixturesArg = arg('--fixtures');
  if (fixturesArg) {
    fixtures = JSON.parse(fs.readFileSync(fixturesArg, 'utf8'));
    console.log(`Loaded ${fixtures.length} fixtures from ${fixturesArg}`);
  } else {
    // ── self-label from the corpus (each row replayed in a fresh kernel child) ──
    console.log('Self-labeling fixtures from the Forge training corpus (corpus = ground truth)…');
    if (!fs.existsSync(MODELS_FORGE)) {
      console.error(`[fatal] corpus dir not found: ${MODELS_FORGE}`);
      console.error('        Use --fixtures <path> with a pre-built fixtures file instead.');
      process.exit(3);
    }
    fixtures = [];
    for (const spec of FIXTURE_SPECS) {
      try {
        const fx = selfLabel(spec.name, spec.dir, spec.pred, spec.iface, spec.dirs || [spec.dir]);
        fixtures.push(fx);
        const g = fx.gt;
        console.log(`  + ${pad(spec.name, 18)} vol=${pad(g.volume.toFixed(0), 8)} ` +
          `betti=(${g.betti.b0},${g.betti.b1},${g.betti.b2}) feats=${fx.features.length}  "${fx.prompt.slice(0, 50)}"`);
      } catch (e) {
        console.error(`  ! skipped ${spec.name}: ${e.message}`);
      }
    }
    if (fixtures.length === 0) { console.error('[fatal] no fixtures self-labeled.'); process.exit(4); }

    const writeArg = arg('--write-fixtures');
    if (writeArg) {
      fs.writeFileSync(writeArg, JSON.stringify(fixtures, null, 0));
      console.log(`\nWrote ${fixtures.length} fixtures → ${writeArg}`);
    }
  }

  // helper: score a sequence of calls (built in a fresh kernel child) against a fixture's gt
  const scoreInChild = (fx, calls, emittedCalls) => {
    const res = runJobInChild({
      op: 'score', calls, emittedCalls: emittedCalls || calls,
      gt: fx.gt, features: fx.features || [],
    });
    if (!res.ok) return rowFromScore(fx.name, res.score || zeroScore(res.error || 'child failed'));
    return rowFromScore(fx.name, res.score);
  };

  // ── --model: POST each fixture's prompt to localhost:8080, score the result ──
  if (has('--model')) {
    const adapter = arg('--adapter');
    console.log(`\n--model: POSTing prompts to localhost:8080 with the canonical SYSTEM ${adapter ? `(adapter=${adapter})` : '(default adapter)'} …`);
    const rows = [];
    for (const fx of fixtures) {
      let calls;
      try {
        const text = await postToModel(CANONICAL_SYSTEM, fx.prompt, { adapter });
        calls = callsFromAssistant(text);
        if (calls.length === 0) throw new Error('no <tool_call> blocks in model output');
      } catch (e) {
        console.error(`  ! ${fx.name}: model request failed (${e.message}) — is serve up on :8080?`);
        rows.push(rowFromScore(fx.name, zeroScore(e.message)));
        continue;
      }
      rows.push(scoreInChild(fx, calls, calls));
    }
    printScorecard('=== MODEL SCORECARD (localhost:8080) ===', rows);
    return;
  }

  // ── DISCRIMINATION PROOF: replay (own calls) vs corrupted ──
  console.log('\nRunning discrimination proof: replay (own tool_calls) vs corrupted variant …');
  const replayRows = [];
  const corruptRows = [];
  const corruptDesc = {};

  for (const fx of fixtures) {
    // (a) replay the fixture's OWN calls → should score ≈1.0
    replayRows.push(scoreInChild(fx, fx.calls, fx.calls));
    // (b) corrupted variant → should score clearly LOWER (esp. interface + dimL1)
    const { calls: cc, desc } = corruptCalls(fx);
    corruptDesc[fx.name] = desc;
    corruptRows.push(scoreInChild(fx, cc, cc));
  }

  printScorecard('=== REPLAY SCORECARD (fixture\'s own tool_calls — expect CAD ≈ 1.0) ===', replayRows);
  printScorecard('=== CORRUPTED SCORECARD (perturbed — expect CAD clearly LOWER) ===', corruptRows);

  console.log('\nCorruptions applied:');
  for (const fx of fixtures) console.log(`  ${pad(fx.name, 18)} ${corruptDesc[fx.name]}`);

  // ── Discrimination verdict ──
  console.log('\n=== DISCRIMINATION VERDICT ===');
  let allReplayHigh = true, allCorruptLower = true;
  const margins = [];
  for (let i = 0; i < fixtures.length; i++) {
    const rp = replayRows[i].cad_score;
    const cp = corruptRows[i].cad_score;
    const margin = rp - cp;
    margins.push(margin);
    const replayHigh = rp >= 0.85;
    const lower = cp < rp - 0.10; // clearly lower
    if (!replayHigh) allReplayHigh = false;
    if (!lower) allCorruptLower = false;
    console.log(`  ${pad(fixtures[i].name, 18)} replay=${fmt(rp)} corrupted=${fmt(cp)} ` +
      `Δ=${fmt(margin)} ${replayHigh ? '' : '[REPLAY<0.85] '}${lower ? '' : '[NOT CLEARLY LOWER]'}`);
  }
  const meanReplay = replayRows.reduce((a, r) => a + r.cad_score, 0) / replayRows.length;
  const meanCorrupt = corruptRows.reduce((a, r) => a + r.cad_score, 0) / corruptRows.length;
  console.log(`\n  mean replay CAD    = ${fmt(meanReplay)}`);
  console.log(`  mean corrupted CAD = ${fmt(meanCorrupt)}`);
  console.log(`  mean margin        = ${fmt(meanReplay - meanCorrupt)}`);
  console.log(`\n  DISCRIMINATION ${(allReplayHigh && allCorruptLower) ? 'PROVEN ✓' : 'INCOMPLETE ✗'} ` +
    `(replay≈1.0: ${allReplayHigh ? 'yes' : 'NO'}, corrupted clearly lower: ${allCorruptLower ? 'yes' : 'NO'})`);
}

// Reusable labeler surface (for forge-kernel/test/label_rows.mjs and other tools).
// Exporting named function DECLARATIONS does not change the CLI behavior below.
export { makeHeadlessForge, tess, bboxOf, bettiNumbers, checkValid, dimsFromCalls, parseRow, runJobInChild,
         postToModel, callsFromAssistant, CANONICAL_SYSTEM };

// Entry: worker vs orchestrator. Only fires when this file is the program entry
// point — when imported as a module (e.g. by label_rows.mjs) nothing auto-runs.
const _argv = process.argv.slice(2);
const _isEntry = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (_argv.includes('--worker')) {
  const jobFile = _argv[_argv.indexOf('--job') + 1];
  const outFile = _argv[_argv.indexOf('--out') + 1];
  runWorker(jobFile, outFile).catch((e) => {
    try { fs.writeFileSync(outFile, JSON.stringify({ ok: false, error: e.stack || String(e) })); } catch { /* ignore */ }
    process.exit(1);
  });
} else if (_isEntry) {
  main().catch((e) => { console.error('[harness error]', e.stack || e); process.exit(1); });
}
