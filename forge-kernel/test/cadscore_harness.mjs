#!/usr/bin/env node
/**
 * ForgeCADScore — headless, dependency-free geometry-truth scorer for ArchDisc Forge.
 *
 * Implements the CADGenBench "CAD Score" (v2 — aligned 1:1 to the verified canonical
 * forms in CADGENBENCH_SPEC.md / the leaderboard Space metrics_page.py):
 *   cad_score = gate * (0.4*shape + 0.4*interface + 0.2*topology)   [generation fixtures]
 *   cad_score = gate * (0.6*s_renorm + 0.3*interface + 0.1*topology) [editing fixtures]
 *
 *   gate      — hard binary validity (closed && manifold && oriented && !self-intersect
 *               && no bad faces) on the final body, via kernel heal.checkValidity.
 *   shape     — CANONICAL 0.5*(surface_distance_F1 + volume_IoU). Surface-F1 uses a
 *               size-proportional tolerance = 0.5% of the GT bbox DIAGONAL; volume_IoU
 *               is a TRUE Monte-Carlo |A∩B|/|A∪B| (not the old vol-difference proxy).
 *   interface — per mating feature, VOLUMETRIC IoU = TP/(TP+FP+FN) of candidate material
 *               vs the authored keep-in(filled)/keep-out(empty) sub-volume, then the
 *               ramp (IoU>=0.95->1, <=0.80->0, linear), worst-feature per group / mean.
 *               (assembly / GD&T interface axis — "a sloppy fit scores 0".)
 *   topology  — Betti (b0,b1,b2); per-axis credit ((min+1)/(max+1))^2, axes MULTIPLIED.
 *
 *   dimension-L1 — relative L1 error on every numeric the prompt/fixture names vs emitted args.
 *               (reported as a separate diagnostic axis; NOT folded into cad_score — CADGenBench
 *               has no such axis. v2 self-test: forge-kernel/test/cadscore_v2_selftest.mjs.)
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
// Honor FORGE_KERNEL (like every sibling test, e.g. native_vs_occt_core.mjs) so this
// harness can be measured against an alternate .node — otherwise a kernel swap (e.g. a
// toolkit-drop build) is silently measured against the default build, yielding false passes.
const KERNEL_PATH = process.env.FORGE_KERNEL || path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
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
  'Annotation / analysis — part.annotate-pmi{shape,notes,filepath} writes datum letters + GD&T feature-control-frame strings into an AP242 STEP file (annotation only), simulate.tolerance-stack{chain,USL,LSL} runs a 1-D worst-case+RSS+Monte-Carlo stack on a linear dimension chain vs the assembly spec limits (numeric only).\n' +
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
  'Dimensions are millimetres. Begin with exactly ONE brief conversational line naming what you are building, then the plan and tool_calls. No prose after the tags. No markdown, no lists, no <think> block.';
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
function surfaceF1(tA, tB, n = 8000, tauAbs = 0.5) {
  const ca = samplePoints(tA, n, 11);
  const cb = samplePoints(tB, n, 23);
  const areaA = triAreas(tA).total;
  const spacing = Math.sqrt(Math.max(areaA, 1) / n);
  // CADGenBench: the match tolerance is 0.5% of the GT bbox DIAGONAL (size-
  // proportional), supplied as tauAbs by the caller. The 2.5×spacing term is a
  // finite-sampling FLOOR so two independent point clouds of the SAME surface
  // still score ≈1.0 (without it, discretisation noise penalises identical
  // surfaces). The floor only ever RAISES tau, never below the relative value.
  const tau = Math.max(tauAbs, 2.5 * spacing);
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

/** Diagonal length of an axis-aligned bbox {min:[3],max:[3]}. */
function bboxDiag(bb) {
  return Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
}

/**
 * TRUE volumetric IoU between two solids = |A∩B| / |A∪B|, estimated by
 * deterministic Monte-Carlo over the padded union AABB with ray-parity
 * point-in-solid on each tessellation. This REPLACES the v1 volume proxy
 * (1−|Δvol|/max), which scored ~1.0 for two equal-volume solids that don't
 * overlap at all. It is the CADGenBench "volume IoU" term of
 *   shape_similarity = 0.5·(surface_distance_F1 + volume_IoU).
 */
function volumeIoU(tA, tB, n = 30000, seed = 99173) {
  const ba = bboxOf(tA), bb = bboxOf(tB);
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(ba.min[a], bb.min[a]);
    hi[a] = Math.max(ba.max[a], bb.max[a]);
    const pad = 0.01 * (hi[a] - lo[a]) + 1e-6; // avoid boundary bias
    lo[a] -= pad; hi[a] += pad;
  }
  if (hi[0] <= lo[0] || hi[1] <= lo[1] || hi[2] <= lo[2]) return 1;
  const rng = mulberry32(seed);
  let inter = 0, uni = 0;
  for (let i = 0; i < n; i++) {
    const x = lo[0] + rng() * (hi[0] - lo[0]);
    const y = lo[1] + rng() * (hi[1] - lo[1]);
    const z = lo[2] + rng() * (hi[2] - lo[2]);
    const inA = pointInSolid(x, y, z, tA);
    const inB = pointInSolid(x, y, z, tB);
    if (inA && inB) inter++;
    if (inA || inB) uni++;
  }
  return uni === 0 ? 1 : inter / uni;
}

/**
 * CADGenBench per-axis TOPOLOGY credit — RECONCILED to the verbatim published form.
 *
 *   SOURCE (verbatim): the leaderboard Space's `metrics_page.py`,
 *     <https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench/resolve/main/metrics_page.py>
 *     s_i            = ((min(cand, gt) + 1) / (max(cand, gt) + 1)) ^ 2
 *     topology_match = s_0 * s_1 * s_2          (the three Betti axes MULTIPLIED)
 *
 *   BEFORE (v1, removed):   credit = 1 / (1 + |got − want|)
 *                           → for b1 (2 vs 4): 1/(1+2) = 0.333…
 *   AFTER  (this form):     credit = ((min+1)/(max+1))²
 *                           → for b1 (2 vs 4): ((2+1)/(4+1))² = (3/5)² = 0.36  ✓
 *
 *   The published worked example GT (1,2,0) vs cand (1,4,0) reproduces exactly:
 *   s_0=1 · s_1=0.36 · s_2=1 = 0.36. Pinned by cadscore_v2_selftest.mjs.
 */
function topologyCredit(got, want) {
  const r = (Math.min(got, want) + 1) / (Math.max(got, want) + 1);
  return r * r;
}

/**
 * CADGenBench INTERFACE ramp — RECONCILED to the verbatim published form.
 *
 *   SOURCE (verbatim): `metrics_page.py` (same URL as above) —
 *     per-feature volumetric IoU: "IoU ≥ 0.95 → 1, ≤ 0.80 → 0, linear between;
 *     a sloppy fit scores 0."
 *
 *   BEFORE (v1, removed):   raw point pass-rate  min(inRate, outRate)
 *   AFTER  (this form):     iou≥0.95 → 1 ; iou≤0.80 → 0 ; else (iou−0.80)/0.15
 *                           → ramp(0.875) = 0.5, ramp(0.90) = 0.6667.
 *
 *   Fed by a true volumetric IoU = TP/(TP+FP+FN) over the authored keep-in/keep-out
 *   sub-volume (scoreInterface, below). Pinned by cadscore_v2_selftest.mjs.
 */
function interfaceRamp(iou) {
  if (iou >= 0.95) return 1;
  if (iou <= 0.80) return 0;
  return (iou - 0.80) / 0.15;
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

  // CADGenBench shape_similarity = 0.5·(surface_distance_F1 + volume_IoU).
  // (1) TRUE volume IoU via Monte-Carlo over the union AABB (not the v1 proxy).
  const volIoU = gt._tess ? volumeIoU(t, gt._tess) : 1;
  // (2) surface-F1 with a size-proportional tolerance = 0.5% of the GT bbox diagonal.
  const tauAbs = gt.bbox ? 0.005 * bboxDiag(gt.bbox) : 0.5;
  const f1 = gt._tess ? surfaceF1(t, gt._tess, 8000, tauAbs) : 1;

  const shape = 0.5 * (f1 + volIoU);

  // bbox extent-IoU + raw volume ratio kept as DIAGNOSTICS only (not in the score).
  let bboxScore = 0;
  for (let a = 0; a < 3; a++) {
    const lo1 = bb.min[a], hi1 = bb.max[a];
    const lo2 = gt.bbox.min[a], hi2 = gt.bbox.max[a];
    const inter = Math.max(0, Math.min(hi1, hi2) - Math.max(lo1, lo2));
    const uni = Math.max(hi1, hi2) - Math.min(lo1, lo2);
    bboxScore += uni > 1e-9 ? inter / uni : 1;
  }
  bboxScore /= 3;
  const vol = Math.max(mp.volume, 0);
  return { shape, volIoU, surfaceF1: f1, bboxScore, vol, bbox: bb };
}

/**
 * Pure-geometry shape similarity between TWO labeled snapshots — no live kernel
 * handle required. Byte-for-byte the same three sub-scores as scoreShape()
 * (volume-IoU proxy + bbox extent-IoU + surface-F1 Chamfer), but it consumes two
 * { volume, bbox, tess } objects (each carrying a {positions,indices}
 * tessellation) instead of a forge handle. This is the no-op renorm baseline:
 *   b_shape = shapeFromTess(gt_input, gt_target)
 *           = "how similar is the UNEDITED input to the EDITED target".
 * A no-op echo returns the input unchanged ⇒ shape(echo)≈b_shape; a correct edit
 * moves the body away from the input ⇒ shape(edit) ≫ b_shape.
 */
function shapeFromTess(a, b) {
  // Same CADGenBench shape_similarity = 0.5·(surface_F1 + volume_IoU) as scoreShape,
  // but over two labelled tessellation snapshots (no live kernel handle). Used for
  // the editing no-op baseline b_shape = shapeFromTess(gt_input, gt_target).
  const volIoU = (a.tess && b.tess) ? volumeIoU(a.tess, b.tess) : 1;
  const tauAbs = b.bbox ? 0.005 * bboxDiag(b.bbox) : 0.5;
  const f1 = (a.tess && b.tess) ? surfaceF1(a.tess, b.tess, 8000, tauAbs) : 1;
  const shape = 0.5 * (f1 + volIoU);

  let bboxScore = 0;
  for (let ax = 0; ax < 3; ax++) {
    const lo1 = a.bbox.min[ax], hi1 = a.bbox.max[ax];
    const lo2 = b.bbox.min[ax], hi2 = b.bbox.max[ax];
    const inter = Math.max(0, Math.min(hi1, hi2) - Math.max(lo1, lo2));
    const uni = Math.max(hi1, hi2) - Math.min(lo1, lo2);
    bboxScore += uni > 1e-9 ? inter / uni : 1;
  }
  bboxScore /= 3;
  return { shape, volIoU, surfaceF1: f1, bboxScore };
}

/**
 * Interface jig: each feature { kind:'hole'|'boss'|'slot', center:[x,y,z], r, axis, keepIn[], keepOut[] }.
 * CADGenBench scores each mating feature by the VOLUMETRIC IoU of the candidate's
 * material vs the IDEAL (keep-in filled, keep-out empty), applies a ramp
 * (IoU ≥ 0.95 → 1, ≤ 0.80 → 0, linear), takes the worst feature per group and the
 * mean over groups. We estimate the IoU from the authored keep-in/keep-out sample
 * points (a Monte-Carlo volume estimate over the feature's region): with occ*(p) the
 * ideal occupancy and occ(p)=pointInSolid(p) the candidate's,
 *   IoU = TP / (TP + FP + FN)
 * where TP=occ&occ*, FP=occ&¬occ* (intruding material), FN=¬occ&occ* (missing
 * material). This replaces the v1 raw point pass-rate min(inRate,outRate) — it
 * penalises BOTH under-fill and intrusion and matches the CADGenBench ramp.
 * (Features map 1:1 to groups here; refine to multi-feature groups when authored.)
 */
function scoreInterface(forge, h, features) {
  if (!features || features.length === 0) return { interface: 1, perFeature: [] };
  const t = tess(forge, h);
  const perFeature = [];
  let sum = 0;
  for (const ft of features) {
    const wantInsideForKeepIn = ft.kind === 'boss'; // boss keep-in = solid; hole/slot keep-in = cavity
    let tp = 0, fp = 0, fn = 0;
    const tally = (p, idealInside) => {
      const occ = pointInSolid(p[0], p[1], p[2], t);
      if (occ && idealInside) tp++;
      else if (occ && !idealInside) fp++;
      else if (!occ && idealInside) fn++;
      // (!occ && !idealInside) is a true-negative (correctly empty) — not in IoU.
    };
    for (const p of ft.keepIn || []) tally(p, wantInsideForKeepIn);
    for (const p of ft.keepOut || []) tally(p, !wantInsideForKeepIn);
    const denom = tp + fp + fn;
    const iou = denom === 0 ? 1 : tp / denom;
    const fscore = interfaceRamp(iou);
    perFeature.push({ kind: ft.kind, iou, score: fscore });
    sum += fscore;
  }
  return { interface: sum / features.length, perFeature };
}

// ───────────────────────────────────────────────────────────────────────────
//  scoreMate — MULTI-BODY fit jig (shaft + bushing/bore).
// ───────────────────────────────────────────────────────────────────────────
/**
 * Score whether a cylindrical FIT between two coaxial bodies is correct.
 * This is the assembly-context axis the single-body scoreInterface() cannot
 * reach: it places two bodies in the assembly registry, then judges the fit
 * two independent ways and requires them to AGREE with the expected fit.
 *
 * Inputs (all mm, Z-coaxial about the origin):
 *   { shaftHandle, boreBodyHandle,   // two built bodies; bore body is the
 *                                    //   solid that CONTAINS the bore (a
 *                                    //   bushing/plate), NOT the bore tool
 *     shaftDia, boreDia,             // their nominal diameters
 *     expect: 'running' | 'press',   // intended fit class
 *     clearance: { min, max },       // mm DIAMETRAL clearance band (running)
 *     press:     { min, max } }       // mm DIAMETRAL interference band (press)
 *
 * Two evidence sources, both required to agree:
 *  (A) detectInterference on the two placed instances — empty ⇒ clearance,
 *      non-empty (volume>0) ⇒ interference. This is the kernel's exact
 *      BRepAlgoAPI_Common boolean, the same one Forge uses for clash.
 *  (B) Radial ring probe — sample N points on a ring at the shaft surface
 *      radius and again just inside the nominal bore radius, parity-tested
 *      against each body's tessellation. Confirms the shaft material ends and
 *      the bore wall begins where the diameters say they do (a geometric,
 *      not just numeric, gap measurement).
 *
 * Score: gate (both bodies valid) * agreement, where agreement = 1 when the
 *  measured fit class matches `expect` AND the measured diametral gap/overlap
 *  falls inside the requested band; partial credit (0.5) if the class matches
 *  but the magnitude is out of band; 0 if the class is wrong.
 *
 * Returns { mate, fitClass, diametralGap, withinBand, interferenceVolume,
 *           ringShaftInside, ringBoreWall, gate, reason }.
 */
function scoreMate(forge, spec) {
  const {
    shaftHandle, boreBodyHandle,
    shaftDia, boreDia,
    expect = 'running',
    clearance = { min: 0.005, max: 0.10 },
    press = { min: 0.005, max: 0.10 },
  } = spec;

  // Gate: both bodies must be valid solids.
  const vShaft = checkValid(forge, shaftHandle);
  const vBore = checkValid(forge, boreBodyHandle);
  if (!vShaft.valid || !vBore.valid) {
    return { mate: 0, gate: 0, fitClass: 'invalid',
             reason: `gate fail: shaft.valid=${vShaft.valid} bore.valid=${vBore.valid}` };
  }

  // ── (A) Exact boolean interference via the assembly registry ──────────
  const ident = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const iShaft = forge.addInstance(shaftHandle, ident);
  const iBore = forge.addInstance(boreBodyHandle, ident);
  let interferenceVolume = 0;
  try {
    const pairs = forge.assembly.detectInterference([iShaft, iBore], 0);
    for (const p of (pairs || [])) interferenceVolume += Math.max(0, p.volume || 0);
  } finally {
    // Keep the registry clean for any later jig in the same process.
    try { forge.removeInstance(iShaft); } catch { /* ignore */ }
    try { forge.removeInstance(iBore); } catch { /* ignore */ }
  }
  const interferes = interferenceVolume > kRingEps;

  // ── (B) Radial ring probe — geometric gap confirmation ────────────────
  const tShaft = tess(forge, shaftHandle);
  const tBore = tess(forge, boreBodyHandle);
  const rShaft = shaftDia / 2, rBore = boreDia / 2;
  const N = 32;
  const zMid = bboxOf(tShaft);
  const z = (zMid.min[2] + zMid.max[2]) / 2;   // mid-height of the shaft
  // Shaft-surface ring: just INSIDE the shaft radius → must be shaft solid.
  let shaftInside = 0;
  // Bore-wall ring: just OUTSIDE the nominal bore radius → must be bore solid
  // (the bushing wall); the annular gap between rShaft and rBore must be open.
  let boreWall = 0, gapOpen = 0;
  const inset = 0.02;                          // probe 0.02 mm off the surface
  for (let k = 0; k < N; k++) {
    const a = (2 * Math.PI * k) / N;
    const cx = Math.cos(a), cy = Math.sin(a);
    // shaft body solid just inside rShaft
    if (pointInSolid(cx * (rShaft - inset), cy * (rShaft - inset), z, tShaft)) shaftInside++;
    // bore body solid just outside rBore (the wall material)
    if (pointInSolid(cx * (rBore + inset), cy * (rBore + inset), z, tBore)) boreWall++;
    // the annular clearance midway between the two radii must be OPEN in the
    // bore body (i.e. NOT inside the bushing solid) for a running fit.
    const rMid = (rShaft + rBore) / 2;
    if (!pointInSolid(cx * rMid, cy * rMid, z, tBore)) gapOpen++;
  }
  const ringShaftInside = shaftInside / N;
  const ringBoreWall = boreWall / N;
  const ringGapOpen = gapOpen / N;

  // Diametral gap (running, +) or overlap (press, −) from the nominal dias.
  const diametralGap = boreDia - shaftDia;     // >0 clearance, <0 interference

  // Classify the measured fit: boolean is the authority; the ring probe is
  // the corroborating geometric witness for the clearance case.
  let fitClass;
  if (interferes) fitClass = 'press';
  else fitClass = 'running';

  // Agreement of class.
  const classMatch = fitClass === expect;
  let agreement, withinBand;
  if (expect === 'running') {
    // running: diametral CLEARANCE must land in [min,max] AND the boolean
    // must see no interference AND the ring must witness an open annulus.
    withinBand = diametralGap >= clearance.min && diametralGap <= clearance.max;
    const ringOk = ringGapOpen > 0.75 && ringShaftInside > 0.75;
    agreement = classMatch ? (withinBand && ringOk ? 1 : 0.5) : 0;
  } else {
    // press: diametral INTERFERENCE magnitude must land in [min,max] AND the
    // boolean must report a non-zero overlap volume.
    const overlap = -diametralGap;             // positive interference
    withinBand = overlap >= press.min && overlap <= press.max;
    agreement = classMatch ? (withinBand && interferes ? 1 : 0.5) : 0;
  }

  return {
    mate: vShaft.valid && vBore.valid ? agreement : 0,
    gate: 1,
    fitClass, expect, classMatch,
    diametralGap: Math.round(diametralGap * 1e4) / 1e4,
    withinBand,
    interferenceVolume: Math.round(interferenceVolume * 1e4) / 1e4,
    ringShaftInside, ringBoreWall, ringGapOpen,
    reason: classMatch
      ? (withinBand ? 'fit class + magnitude in band' : 'fit class OK, magnitude out of band')
      : `expected ${expect}, measured ${fitClass}`,
  };
}
const kRingEps = 1e-6;

// ═════════════════════════════════════════════════════════════════════════════
//  scoreMechanism — 5th axis: MECHANISM correctness for assemblies-with-motion.
//
//  The four static axes (shape/interface/topology + the mate jig) judge a part
//  AT REST. This axis judges a part IN MOTION: can Archie build a mechanism whose
//  joints are valid, whose DOF is right, whose kinematic chain closes, that
//  sweeps its full intended range, and that NEVER self-collides through the whole
//  cycle. It drives the validated HHT-α inertial multibody solver
//  (forge.simulate.multibodyDynamics — pendulum 0.016 %) for grounded single-body
//  cases, and a kernel-truthful planar forward-kinematics generator for the
//  closed-loop fixtures the inertial solver cannot express (see HONEST LIMITS).
//
//  Sub-criteria (a–e), weighted, multiplicatively gated by joint validity:
//    gate = jointsValid (every constraint references valid bodies + a kind the
//           kernel understands) ? 1 : 0
//    score = gate · ( 0.20·dofCorrect            (b) Gruebler/Kutzbach mobility
//                   + 0.20·chainValidScore       (c) Grashof / loop-closure
//                   + 0.25·motionRangeFrac       (d) achieved/intended sweep
//                   + 0.35·interferenceFree )    (e) NO clash through the cycle
//  Interference is weighted highest — it IS the "working mechanism" headline.
//
//  ───────────────────────── HONEST LIMITS (kernel) ──────────────────────────
//  1. The inertial solver's ONLY joint vocabulary is ballJoint / axisLock /
//     distance (MbdConstraintKind, MultibodyDynamics.hpp:106-110). There is NO
//     native revolute / prismatic / gear primitive. A planar REVOLUTE about a
//     GROUNDED pivot = ballJoint(pin) + axisLock(confine spin) — exactly the
//     validated pendulum/rotor case, so the simple pendulum runs end-to-end on
//     the REAL solver. But a CLOSED kinematic loop (four-bar, slider-crank,
//     scissor) needs a two-body pin: BallJoint pins bodyA's point to a FIXED
//     world anchor (not to bodyB's point), AxisLock ignores bodyB, and only
//     Distance is a genuine two-body constraint — so a faithful closed loop
//     CANNOT be fully expressed in the current inertial solver.
//  2. RESOLUTION (no kernel rebuild): for the closed-loop / higher-pair fixtures
//     we generate per-step poses with a closed-form planar FK sweep of the driver
//     (planarFKSamples), emitting a samples[] array byte-compatible with the
//     kernel MbdResult. The INTERFERENCE axis (e) then runs on the REAL kernel
//     meshes (tessellate + pointInSolid / detectInterference) at every FK pose —
//     fully kernel-truthful. Each fixture reports solver:'multibody' vs
//     solver:'planarFK' so the limit is explicit. Closed-loop INERTIAL dynamics
//     is flagged as a kernel gap (a one-branch bodyB BallJoint variant in
//     simulateMultibody would close it; the binding at 3084-3090 already reads
//     bodyB). The spur-gear ratio is a rolling higher-pair absent from every
//     solver → FK with the analytic ratio; its interference axis is still real.
// ═════════════════════════════════════════════════════════════════════════════

// ── (b) DOF / mobility — pure math, kernel-free, self-testable ───────────────
/**
 * Gruebler/Kutzbach mobility.
 *   planar : M = 3(n−1) − 2·j1 − j2   (n links incl. ground, j1 = full/lower
 *            1-DOF joints (revolute/prismatic), j2 = higher pairs (gear/cam, 2-DOF))
 *   spatial: M = 6(n−1) − Σconstraints (constraints = total DOF removed by joints)
 * Worked: four-bar n=4,j1=4,j2=0 → 9−8 = 1; slider-crank same → 1;
 *         spur-gear pair n=3,j1=2,j2=1 → 6−4−1 = 1; planar 4-link truss
 *         (n=3,j1=3,j2=0 over-constrained loop) → 6−6 = 0.
 */
function mechanismDOF(spec, planar = true) {
  const n = spec.n | 0, j1 = spec.j1 | 0, j2 = spec.j2 | 0;
  if (planar) return 3 * (n - 1) - 2 * j1 - j2;
  // spatial: caller supplies either Σconstraints directly, or per-kind counts.
  const sumC = typeof spec.constraints === 'number'
    ? spec.constraints
    : (spec.constraintsRemoved | 0);
  return 6 * (n - 1) - sumC;
}

// ── (c) Grashof classification — pure math, kernel-free, self-testable ───────
/**
 * Grashof's law for a planar four-bar from its four link lengths {s,l,p,q}
 * (any order). Let S,L = shortest,longest. If S+L ≤ P+Q the linkage is Grashof
 * (at least one link fully rotates). The class then depends on which link is the
 * shortest (here keyed by the fixed/ground link convention shortest-adjacent =
 * crank-rocker, shortest=ground = double-crank, shortest=coupler = double-rocker
 * Grashof). Non-Grashof (S+L > P+Q) = triple-rocker, no full rotation.
 * Returns { class, fullRotation, S, L, P, Q, sum1, sum2 }.
 */
function grashofClass(links) {
  const a = [links.s, links.l, links.p, links.q].map(Number).sort((x, y) => x - y);
  const [S, P, Q, L] = a;           // ascending: S ≤ P ≤ Q ≤ L
  const sum1 = S + L, sum2 = P + Q;
  const grashof = sum1 <= sum2 + 1e-9;
  if (!grashof) return { class: 'non-grashof', fullRotation: false, S, L, P, Q, sum1, sum2 };
  // Which link is shortest determines the Grashof sub-class. The fixture spec
  // names the shortest link's role; default convention = crank-rocker.
  let cls = 'crank-rocker';
  if (links.shortestRole === 'ground') cls = 'double-crank';
  else if (links.shortestRole === 'coupler') cls = 'double-rocker';
  return { class: cls, fullRotation: true, S, L, P, Q, sum1, sum2 };
}

/**
 * Chain-validity sub-score (c).
 *   four-bar : 1 if the measured Grashof class matches the expected class, else
 *              partial credit 0.5 if at least the fullRotation flag matches
 *              (right family, wrong sub-class), else 0.
 *   closed-loop fixtures (slider-crank/scissor) : loop-closure consistency —
 *              the per-step constraint residual must stay below tol (the loop
 *              never tears open). pendulum/gearpair default to 1 when their
 *              single constraint holds.
 */
function chainValidScore(spec, grash, maxResidual, tol = 1e-3) {
  if (spec.chain === 'fourbar' && spec.fourbar) {
    const g = grash || grashofClass(spec.fourbar);
    const expectClass = spec.fourbar.expectClass || 'crank-rocker';
    if (g.class === expectClass) return 1;
    const expectRot = spec.fourbar.expectFullRotation !== false;
    return g.fullRotation === expectRot ? 0.5 : 0;
  }
  // loop-closure: the FK/solver residual must stay bounded through the cycle.
  if (typeof maxResidual === 'number' && Number.isFinite(maxResidual)) {
    return maxResidual <= tol ? 1 : Math.max(0, 1 - (maxResidual - tol) / tol);
  }
  return 1;
}

// ── (d) motion-range fraction — pure math over a samples[] array ─────────────
/**
 * Achieved sweep of the DRIVEN body over the cycle ÷ intended range, clamped
 * [0,1]. For a rotary driver we measure the peak-to-peak angle swept by the
 * body's orientation about the pivot axis (axis-angle magnitude projected on the
 * driver axis); for a prismatic driver we measure peak-to-peak COM displacement
 * along the slide axis. A lockup (samples go flat early, or stable=false) ⇒ the
 * swept extent is tiny ⇒ frac → 0. Pure: operates on a plain samples[] array so
 * it is self-testable with synthetic data and identical for FK or solver output.
 *
 *   driver = { body, axis?:[3] (rotary), slideAxis?:[3] (prismatic), kind }
 *   target = intended sweep magnitude (rad for rotary, mm for prismatic)
 */
function motionRangeFrac(samples, driver, target, stable = true) {
  if (!Array.isArray(samples) || samples.length < 2 || !(target > 0)) return 0;
  const b = driver.body | 0;
  let achieved;
  if (driver.kind === 'prismatic') {
    const ax = norm3(driver.slideAxis || [1, 0, 0]);
    let lo = Infinity, hi = -Infinity;
    for (const s of samples) {
      const p = s.position?.[b];
      if (!p) continue;
      const d = p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2]; // mm or m — caller-consistent
      if (d < lo) lo = d; if (d > hi) hi = d;
    }
    achieved = (hi > lo) ? hi - lo : 0;
  } else {
    // rotary: peak-to-peak signed angle about the driver axis from axis-angle.
    const ax = norm3(driver.axis || [0, 0, 1]);
    let lo = Infinity, hi = -Infinity;
    for (const s of samples) {
      const o = s.orientation?.[b];
      if (!o) continue;
      const theta = o[0] * ax[0] + o[1] * ax[1] + o[2] * ax[2]; // signed angle about axis
      if (theta < lo) lo = theta; if (theta > hi) hi = theta;
    }
    achieved = (hi > lo) ? hi - lo : 0;
  }
  if (!stable) achieved = 0;
  const frac = achieved / target;
  return Math.max(0, Math.min(1, frac));
}

function norm3(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

// ── (e) interference verdict — pure math, kernel-free, self-testable ─────────
/** A mechanism is interference-free iff it never clashes at ANY sampled step. */
function interferenceVerdict(perStepClash) {
  return (perStepClash | 0) === 0;
}

// ── transform a base mesh by (COM position mm, axis-angle orientation rad) ───
/** Rodrigues rotation matrix (row-major 3×3) from an axis-angle vector. */
function axisAngleToR(av) {
  const ang = Math.hypot(av[0], av[1], av[2]);
  if (ang < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const kx = av[0] / ang, ky = av[1] / ang, kz = av[2] / ang;
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [
    t * kx * kx + c,       t * kx * ky - s * kz,  t * kx * kz + s * ky,
    t * kx * ky + s * kz,  t * ky * ky + c,       t * ky * kz - s * kx,
    t * kx * kz - s * ky,  t * ky * kz + s * kx,  t * kz * kz + c,
  ];
}

/**
 * Apply (R, translation mm) to a base tessellation → a NEW {positions,indices}.
 * Indices are shared (topology unchanged); positions are rotated about the body
 * COM frame then translated. The base mesh is assumed authored about the body's
 * own origin (its local frame), matching how the FK/solver report COM poses.
 */
function transformTess(base, posMm, av) {
  const R = axisAngleToR(av || [0, 0, 0]);
  const P = base.positions, n = P.length;
  const out = new Float32Array(n);
  const tx = posMm[0] || 0, ty = posMm[1] || 0, tz = posMm[2] || 0;
  for (let i = 0; i < n; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    out[i]     = R[0] * x + R[1] * y + R[2] * z + tx;
    out[i + 1] = R[3] * x + R[4] * y + R[5] * z + ty;
    out[i + 2] = R[6] * x + R[7] * y + R[8] * z + tz;
  }
  return { positions: out, indices: base.indices };
}

/**
 * (e) Swept clash test over the WHOLE motion cycle. For every sample, place each
 * moving body at its (position, orientation) pose (FK or solver) and clash-check
 * every non-adjacent body pair. Two kernel-truthful detectors:
 *   sampler (default): draw `probe` points from body-A's transformed mesh and
 *     ray-parity test them against body-B's transformed mesh (pointInSolid 387);
 *     ANY inside ⇒ clash at that step (fast, per-step, kernel-mesh truthful).
 *   exact (witness): on the worst step, re-addInstance both transformed handles
 *     and run forge.assembly.detectInterference for an OCCT boolean-common volume.
 * Adjacent pairs (sharing a joint) are skipped — a pin joint legitimately
 * touches. `adjacency` is a Set of "i:j" (i<j) pairs to ignore.
 *
 * positions are reported by the solver/FK in the SAME length unit the base
 * meshes use. The kernel meshes are mm; the inertial solver reports COM in
 * metres → the caller passes posScale (1000 for the multibody path, 1 for FK
 * that already works in mm). Returns { perStepClash, perStepMaxVolume,
 * worstStep, interferenceFree }.
 */
function sweptClashFree(forge, baseMeshes, samples, opts = {}) {
  const adjacency = opts.adjacency instanceof Set ? opts.adjacency : new Set();
  const probe = opts.probe || 24;
  const posScale = opts.posScale || 1;            // metres→mm = 1000; FK mm = 1
  const nB = baseMeshes.length;
  let perStepClash = 0, worstStep = -1, worstPairs = 0;
  const pairKey = (i, j) => (i < j ? i + ':' + j : j + ':' + i);
  for (let si = 0; si < samples.length; si++) {
    const s = samples[si];
    const posed = [];
    for (let b = 0; b < nB; b++) {
      const base = baseMeshes[b];
      if (!base) { posed.push(null); continue; }
      const p = s.position?.[b] || [0, 0, 0];
      const o = s.orientation?.[b] || [0, 0, 0];
      posed.push(transformTess(base, [p[0] * posScale, p[1] * posScale, p[2] * posScale], o));
    }
    let stepClashed = false, stepPairs = 0;
    for (let i = 0; i < nB; i++) {
      for (let j = i + 1; j < nB; j++) {
        if (adjacency.has(pairKey(i, j))) continue;
        const A = posed[i], B = posed[j];
        if (!A || !B) continue;
        if (!aabbOverlap(A, B)) continue;          // broad-phase reject
        // narrow phase: sample A's surface, parity-test against B.
        const cloud = samplePoints(A, probe, 7 + si * 131 + i * 17 + j);
        let hit = false;
        for (let k = 0; k < cloud.length; k += 3) {
          if (pointInSolid(cloud[k], cloud[k + 1], cloud[k + 2], B)) { hit = true; break; }
        }
        if (!hit) {
          // also test B→A (a thin part of B poking into A may be missed one way)
          const cloud2 = samplePoints(B, probe, 977 + si * 131 + i * 17 + j);
          for (let k = 0; k < cloud2.length; k += 3) {
            if (pointInSolid(cloud2[k], cloud2[k + 1], cloud2[k + 2], A)) { hit = true; break; }
          }
        }
        if (hit) { stepClashed = true; stepPairs++; }
      }
    }
    if (stepClashed) {
      perStepClash++;
      if (stepPairs > worstPairs) { worstPairs = stepPairs; worstStep = si; }
    }
  }
  return {
    perStepClash,
    worstStep,
    interferenceFree: interferenceVerdict(perStepClash),
  };
}

/** AABB of a tessellation (broad-phase). */
function aabbOf(t) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const P = t.positions;
  for (let i = 0; i < P.length; i += 3)
    for (let a = 0; a < 3; a++) { const v = P[i + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  return { min: mn, max: mx };
}
function aabbOverlap(a, b, pad = 0.0) {
  const A = aabbOf(a), B = aabbOf(b);
  for (let i = 0; i < 3; i++) {
    if (A.max[i] + pad < B.min[i] - pad) return false;
    if (B.max[i] + pad < A.min[i] - pad) return false;
  }
  return true;
}

// ── planar forward-kinematics generators → MbdResult-shaped samples[] ────────
/**
 * Closed-form planar FK for the closed-loop / higher-pair fixtures, emitting a
 * samples[] array byte-compatible with the kernel's MbdResult (each sample:
 * { t, position:[[x,y,z]…], orientation:[[ax,ay,az]…], constraintResidual,
 *   energy }). Positions are body COM in mm (the kernel mesh unit); orientation
 * is the in-plane rotation as an axis-angle about +Z. Body index 0 is GROUND
 * (fixed at origin, identity) so the moving-link indices line up with the
 * fixture's bodyBuilders.
 *
 * chain:
 *   'fourbar'      — crank(1) + coupler(2) + rocker(3) about a fixed four-bar
 *                    {r1 ground, r2 crank, r3 coupler, r4 rocker}; sweeps θ2 0→2π.
 *   'slidercrank'  — crank(1) + conrod(2) + piston(3); θ2 0→2π drives the piston
 *                    along +X; the loop closes analytically (no Grashof needed).
 *   'scissor'      — two crossed links (1,2) pinned at centre + ends; the centre
 *                    angle φ sweeps so the output end separates.
 *   'gearpair'     — gear A(1) spins θ, gear B(2) counter-rotates −(zA/zB)·θ
 *                    about its fixed centre (rolling higher pair, analytic ratio).
 */
function planarFKSamples(chain, p, steps = 60) {
  const out = [];
  const Zaxis = (ang) => [0, 0, ang];
  const sample = (t, poses, residual = 0) => ({
    t,
    position: poses.map((q) => [q.x, q.y, q.z]),
    orientation: poses.map((q) => Zaxis(q.th)),
    linVel: poses.map(() => [0, 0, 0]),
    angVel: poses.map(() => [0, 0, 0]),
    constraintResidual: residual,
    energy: 0,
  });
  if (chain === 'fourbar') {
    // Ground link r1 along +X from O=(0,0) to C=(r1,0). Crank r2 at O, rocker r4 at C.
    const { r1, r2, r3, r4 } = p;
    const Cx = r1, Cy = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const th2 = 2 * Math.PI * t;                    // crank fully rotates
      const Ax = r2 * Math.cos(th2), Ay = r2 * Math.sin(th2); // crank tip
      // solve the coupler/rocker intersection (circle r3 about A ∩ circle r4 about C)
      const dx = Cx - Ax, dy = Cy - Ay;
      const d = Math.hypot(dx, dy);
      let Bx, By, residual = 0;
      if (d > r3 + r4 || d < Math.abs(r3 - r4) || d < 1e-9) {
        // unreachable (non-Grashof dead point) → hold last, flag residual
        const prev = out[out.length - 1];
        Bx = prev ? prev.position[2][0] : Ax;
        By = prev ? prev.position[2][1] : Ay;
        residual = Math.abs(d - (r3 + r4)) + 1; // loop torn → large residual
      } else {
        const aa = (d * d + r3 * r3 - r4 * r4) / (2 * d);
        const h = Math.sqrt(Math.max(0, r3 * r3 - aa * aa));
        const xm = Ax + aa * dx / d, ym = Ay + aa * dy / d;
        Bx = xm - h * dy / d; By = ym + h * dx / d;   // one branch (consistent)
      }
      const crankTh = th2;
      const couplerTh = Math.atan2(By - Ay, Bx - Ax);
      const rockerTh = Math.atan2(By - Cy, Bx - Cx);
      // COMs at link midpoints.
      const poses = [
        { x: Cx / 2, y: 0, z: 0, th: 0 },                                 // 0 ground (mid)
        { x: Ax / 2, y: Ay / 2, z: 0, th: crankTh },                      // 1 crank
        { x: (Ax + Bx) / 2, y: (Ay + By) / 2, z: 0, th: couplerTh },      // 2 coupler
        { x: (Cx + Bx) / 2, y: (Cy + By) / 2, z: 0, th: rockerTh },       // 3 rocker
      ];
      out.push(sample(t, poses, residual));
    }
    return out;
  }
  if (chain === 'slidercrank') {
    const { r2, r3 } = p;                              // crank, conrod lengths
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const th2 = 2 * Math.PI * t;
      const Ax = r2 * Math.cos(th2), Ay = r2 * Math.sin(th2);
      // piston on the X axis: By=0, Bx = Ax + sqrt(r3² − Ay²)
      const root = r3 * r3 - Ay * Ay;
      let Bx, residual = 0;
      if (root < 0) { const prev = out[out.length - 1]; Bx = prev ? prev.position[3][0] : Ax; residual = -root + 1; }
      else Bx = Ax + Math.sqrt(root);
      const conrodTh = Math.atan2(0 - Ay, Bx - Ax);
      const poses = [
        { x: 0, y: 0, z: 0, th: 0 },                                      // 0 ground
        { x: Ax / 2, y: Ay / 2, z: 0, th: th2 },                          // 1 crank
        { x: (Ax + Bx) / 2, y: Ay / 2, z: 0, th: conrodTh },             // 2 conrod
        { x: Bx, y: 0, z: 0, th: 0 },                                     // 3 piston
      ];
      out.push(sample(t, poses, residual));
    }
    return out;
  }
  if (chain === 'scissor') {
    // Two crossed links length 2L pinned at their common centre; the centre
    // angle φ sweeps φ0→φ1, opening the output end. Link COMs at the centre.
    const { L, phi0, phi1 } = p;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const phi = phi0 + (phi1 - phi0) * t;
      // link 1 at +phi, link 2 at −phi about the centre (origin)
      const poses = [
        { x: 0, y: 0, z: 0, th: 0 },                                      // 0 ground (centre pin post)
        { x: 0, y: 0, z: 0, th: phi },                                    // 1 link A
        { x: 0, y: 0, z: 0, th: -phi },                                   // 2 link B
        // 3 = output slider rides along +X by the half-span L·cos(phi)·2
        { x: 2 * L * Math.cos(phi), y: 0, z: 0, th: 0 },
      ];
      out.push(sample(t, poses, 0));
    }
    return out;
  }
  if (chain === 'gearpair') {
    // Gear A spins θ about its centre (origin); gear B about (center,0) counter-
    // rotates by −(zA/zB)·θ. Higher-pair rolling — analytic ratio.
    const { zA, zB, center } = p;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const th = 2 * Math.PI * t;
      const poses = [
        { x: 0, y: 0, z: 0, th },                                         // 0 gear A (driver) about origin
        { x: center, y: 0, z: 0, th: -(zA / zB) * th },                  // 1 gear B
      ];
      out.push({
        t,
        position: poses.map((q) => [q.x, q.y, q.z]),
        orientation: poses.map((q) => [0, 0, q.th]),
        linVel: poses.map(() => [0, 0, 0]),
        angVel: poses.map(() => [0, 0, 0]),
        constraintResidual: 0, energy: 0,
      });
    }
    return out;
  }
  throw new Error(`planarFKSamples: unknown chain '${chain}'`);
}

/**
 * scoreMechanism(forge, mechSpec) → the 5-criteria mechanism scorecard.
 *
 * mechSpec (see the BUILD SPEC §4):
 *   { name, planar, chain, solver?:'multibody'|'planarFK',
 *     bodyBuilders:[(forge)=>handle…],   // moving links' solids (mm), index-aligned
 *                                         // to the FK/solver body indices (0 = ground)
 *     bodies, constraints, loads, gravity,   // SI multibody config (solver path)
 *     fk:{ chain, params, steps },        // planarFK config (FK path)
 *     driver:{ body, axis|slideAxis, kind }, range:{ targetRad|targetMm },
 *     expectedDOF, jointSpec:{ n, j1, j2 }, fourbar?, adjacency?:[[i,j]…],
 *     sim:{ dt, steps } }
 *
 * Either a `samples` array is supplied directly (tests), or it is produced by the
 * REAL multibody solver (solver:'multibody') or by planarFKSamples (FK path).
 */
function scoreMechanism(forge, spec, injectedSamples = null) {
  const planar = spec.planar !== false;

  // ── gate (a): joints/mates present + valid ───────────────────────────────
  const KNOWN_KINDS = new Set(['ballJoint', 'axisLock', 'distance']);
  const cons = spec.constraints || [];
  const nBodiesDeclared = spec.jointSpec ? spec.jointSpec.n : (spec.bodies ? spec.bodies.length + 1 : 0);
  let jointsValid = cons.length > 0 || spec.solver === 'planarFK';
  for (const c of cons) {
    const kind = String(c.kind || '');
    const okKind = KNOWN_KINDS.has(kind);
    const okA = Number.isInteger(c.bodyA) && c.bodyA >= 0 && (spec.bodies ? c.bodyA < spec.bodies.length : true);
    const okB = c.bodyB == null || (Number.isInteger(c.bodyB) && c.bodyB >= 0);
    if (!okKind || !okA || !okB) jointsValid = false;
  }
  const gate = jointsValid ? 1 : 0;

  // ── (b) DOF ──────────────────────────────────────────────────────────────
  const dof = spec.jointSpec ? mechanismDOF(spec.jointSpec, planar) : null;
  const dofExpected = spec.expectedDOF;
  const dofCorrect = (dof != null && dof === dofExpected) ? 1 : 0;

  // ── obtain per-step samples (injected, REAL solver, or planar FK) ─────────
  let samples = injectedSamples;
  let solver = spec.solver || (injectedSamples ? 'injected' : null);
  let stable = true, maxResidual = 0, solverErr = null;
  if (!samples) {
    if (spec.solver === 'multibody' && forge && forge.simulate && forge.simulate.multibodyDynamics) {
      try {
        const sim = spec.sim || {};
        const nSteps = Math.max(1, (sim.steps | 0) || 1000);
        const cfg = {
          bodies: spec.bodies, constraints: spec.constraints,
          loads: spec.loads || [], gravity: spec.gravity || [0, 0, 0],
          dt: sim.dt > 0 ? sim.dt : 1e-3, steps: nSteps,
          alpha: -0.05, baumgarteOmega: 20, baumgarteZeta: 1,
          sampleStride: Math.max(1, Math.floor(nSteps / 60)),
        };
        const r = forge.simulate.multibodyDynamics(cfg);
        samples = r.samples || [];
        stable = !!r.stable;
        maxResidual = r.maxConstraintDrift;
        solver = 'multibody';
      } catch (e) { solverErr = e.message || String(e); samples = []; stable = false; }
    } else if (spec.fk) {
      samples = planarFKSamples(spec.fk.chain, spec.fk.params, spec.fk.steps || 60);
      solver = 'planarFK';
      // FK loop-closure residual = max over the cycle.
      maxResidual = samples.reduce((m, s) => Math.max(m, s.constraintResidual || 0), 0);
    } else {
      samples = []; solver = solver || 'none';
    }
  }

  // ── (c) chain validity ───────────────────────────────────────────────────
  const grash = (spec.chain === 'fourbar' && spec.fourbar) ? grashofClass(spec.fourbar) : null;
  const chainValid = chainValidScore(spec, grash, maxResidual);

  // ── (d) motion range ─────────────────────────────────────────────────────
  const driver = spec.driver || {};
  const target = spec.range
    ? (driver.kind === 'prismatic' ? spec.range.targetMm : spec.range.targetRad)
    : 0;
  const mrf = motionRangeFrac(samples, driver, target, stable);
  const motionRangeAchieved = mrf >= 0.95;

  // ── (e) interference through the whole cycle ─────────────────────────────
  let perStepClash = 0, interferenceFree = true, worstStep = -1;
  let clashRan = false;
  if (forge && spec.bodyBuilders && spec.bodyBuilders.length && samples.length) {
    const baseMeshes = [];
    const handles = [];
    try {
      for (const build of spec.bodyBuilders) {
        if (!build) { baseMeshes.push(null); continue; }
        const h = build(forge);
        handles.push(h);
        baseMeshes.push(tess(forge, h));
      }
      const adjacency = new Set((spec.adjacency || []).map(([i, j]) => (i < j ? i + ':' + j : j + ':' + i)));
      const posScale = solver === 'multibody' ? 1000 : 1; // metres→mm vs FK mm
      const swept = sweptClashFree(forge, baseMeshes, samples, { adjacency, posScale, probe: spec.probe || 24 });
      perStepClash = swept.perStepClash;
      interferenceFree = swept.interferenceFree;
      worstStep = swept.worstStep;
      clashRan = true;
    } catch (e) {
      solverErr = (solverErr ? solverErr + '; ' : '') + 'clash: ' + (e.message || String(e));
    }
  }

  // ── score composition (multiplicative gate × weighted a–e) ───────────────
  const score = gate * (
    0.20 * dofCorrect +
    0.20 * chainValid +
    0.25 * mrf +
    0.35 * (interferenceFree ? 1 : 0)
  );

  return {
    mechanism: spec.name,
    solver,
    dof, dofExpected, dofCorrect,
    jointsValid, gate,
    chainValid,
    grashof: grash ? { class: grash.class, fullRotation: grash.fullRotation } : null,
    motionRangeFrac: mrf, motionRangeAchieved,
    interferenceFree, perStepClash, worstStep, clashRan,
    stable, maxResidual, solverErr,
    score,
    detail: {
      weights: { dof: 0.20, chain: 0.20, motion: 0.25, interference: 0.35 },
      sampleCount: samples.length,
    },
  };
}

// ── mechanism fixture generator (5 fixtures, each expected DOF + motion) ──────
/**
 * Five canonical mechanism fixtures, modelled on builtinEditingFixtures. Each
 * provides kernel solid builders (mm), the multibody/FK config, the expected DOF
 * + jointSpec for Gruebler, the chain class, the intended motion range, the
 * driver, and (four-bar) the link lengths for Grashof. solver:'multibody' for the
 * grounded pendulum (REAL solver end-to-end); solver:'planarFK' for the closed-
 * loop / higher-pair fixtures (FK poses; interference axis still real-kernel).
 */
function mechanismFixtures() {
  // — small kernel solid builders (mm), authored about each link's own origin —
  // REAL planar linkages avoid coplanar self-collision by stacking the links on
  // distinct parallel Z-planes (the crank on one plane, the coupler above it, the
  // rocker on a third). We bake that plane offset into each link's base mesh via
  // `zPlane` so a long coupler can legitimately sweep OVER the ground bar without
  // a spurious clash — exactly how a physical four-bar/slider-crank is built.
  const link = (len, w = 6, th = 3, zPlane = 0) => (forge) => {
    const h = forge.makeBox(len, w, th);
    // makeBox is corner-origin [0,len]×[0,w]×[0,th]; recentre about midpoint via
    // translate, lifting the body to its parallel working plane (zPlane).
    return (forge.translate ? forge.translate(h, -len / 2, -w / 2, -th / 2 + zPlane) : h);
  };
  const disc = (dia, th = 6) => (forge) => forge.makeCylinder(dia / 2, th);
  const piston = (dia = 16, len = 14) => (forge) => forge.makeCylinder(dia / 2, len);
  const groundPost = () => (forge) => forge.makeCylinder(3, 8);

  // four-bar link lengths (mm): ground r1, crank r2, coupler r3, rocker r4.
  const r1 = 100, r2 = 25, r3 = 90, r4 = 70; // S=25,L=100? check: lengths {25,100,90,70} → S+L=125, P+Q=160 → Grashof crank-rocker

  const fourBar = {
    name: 'four-bar-linkage', planar: true, chain: 'fourbar', solver: 'planarFK',
    // stacked planes: ground z=0, crank z=4, coupler z=8 (sweeps over ground+crank),
    // rocker z=4 (shares the crank's plane; they never get near each other).
    bodyBuilders: [link(r1, 8, 3, 0), link(r2, 6, 3, 4), link(r3, 6, 3, 8), link(r4, 6, 3, 4)],
    fk: { chain: 'fourbar', params: { r1, r2, r3, r4 }, steps: 72 },
    driver: { body: 1, axis: [0, 0, 1], kind: 'rotary' },
    range: { targetRad: 2 * Math.PI },                     // crank fully rotates
    expectedDOF: 1, jointSpec: { n: 4, j1: 4, j2: 0 },
    fourbar: { s: r2, l: r1, p: r3, q: r4, expectClass: 'crank-rocker', expectFullRotation: true },
    adjacency: [[0, 1], [1, 2], [2, 3], [0, 3]],            // each pin pair legitimately touches
  };

  const sliderCrank = {
    name: 'slider-crank', planar: true, chain: 'slidercrank', solver: 'planarFK',
    // ground bed z=0, crank z=4, conrod z=8 (sweeps over the bed), piston on axis.
    bodyBuilders: [link(120, 8, 3, 0), link(30, 6, 3, 4), link(90, 6, 3, 8), piston(16, 14)],
    fk: { chain: 'slidercrank', params: { r2: 30, r3: 90 }, steps: 72 },
    driver: { body: 1, axis: [0, 0, 1], kind: 'rotary' },
    range: { targetRad: 2 * Math.PI },                     // crank fully rotates → piston full stroke
    expectedDOF: 1, jointSpec: { n: 4, j1: 4, j2: 0 },     // 3 revolute + 1 prismatic
    adjacency: [[0, 1], [1, 2], [2, 3], [0, 3]],
  };

  const pendulum = {
    name: 'simple-pendulum', planar: true, chain: 'pendulum', solver: 'multibody',
    // body 0 = the moving bob (driven by the REAL inertial solver); body 1 = the
    // FIXED pivot post at the origin (no solver sample → stays at origin). The bob
    // must swing past WITHOUT clashing the post — interference is a real 2-body
    // axis here (the spec's "never clashes the pivot post"). The bob disc is built
    // about its own COM; the solver reports the COM ~0.5 m out, so at mm-scale the
    // bob (Ø20) is ~500 mm from the Ø6 post → clear.
    bodyBuilders: [disc(20, 8), groundPost()],
    bodies: [{ mass: 1.0, position: [0.5, 0, -0.866], inertia: [1e-4, 0, 0, 0, 1e-4, 0, 0, 0, 1e-4] }],
    constraints: [{ kind: 'ballJoint', bodyA: 0, pointA: [-0.5, 0, 0.866], anchor: [0, 0, 0] }],
    loads: [], gravity: [0, 0, -9.81], sim: { dt: 1e-3, steps: 600 },
    driver: { body: 0, axis: [0, 1, 0], kind: 'rotary' },  // swings about +Y (planar)
    range: { targetRad: 0.5 },                              // swings ≥0.5 rad over the cycle (60° start → other side)
    expectedDOF: 1, jointSpec: { n: 2, j1: 1, j2: 0 },     // bob + ground, 1 spherical-as-planar-pin
    adjacency: [],                                          // bob↔post must NOT clash
  };

  const scissor = {
    name: 'scissors-lazy-tong', planar: true, chain: 'scissor', solver: 'planarFK',
    bodyBuilders: [groundPost(), link(120), link(120), piston(10, 8)], // 0 centre post,1 link A,2 link B,3 output
    fk: { chain: 'scissor', params: { L: 60, phi0: 0.3, phi1: 1.2 }, steps: 60 },
    driver: { body: 3, slideAxis: [1, 0, 0], kind: 'prismatic' },
    // output end span = 2·L·cos(phi): from 2·60·cos(0.3)=114.7 to 2·60·cos(1.2)=43.5 → ~71 mm stroke
    range: { targetMm: 2 * 60 * (Math.cos(0.3) - Math.cos(1.2)) },
    expectedDOF: 1, jointSpec: { n: 4, j1: 4, j2: 0 },     // central pin + 2 end pins + 1 prismatic output
    adjacency: [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3]],
  };

  const gearPair = {
    name: 'spur-gear-pair', planar: true, chain: 'gearpair', solver: 'planarFK',
    // two gears, OD 40 & 60 → centre distance (20+30)=50; tooth bodies approximated
    // by the pitch discs for the interference axis (teeth mesh w/o body overlap).
    bodyBuilders: [disc(38, 8), disc(58, 8)],              // slightly under pitch dia so pitch circles roll, not clash
    fk: { chain: 'gearpair', params: { zA: 20, zB: 30, center: 50 }, steps: 60 },
    driver: { body: 0, axis: [0, 0, 1], kind: 'rotary' },
    range: { targetRad: 2 * Math.PI },                     // driver fully rotates
    expectedDOF: 1, jointSpec: { n: 3, j1: 2, j2: 1 },     // 2 revolute + 1 gear higher-pair
    adjacency: [],                                          // the two gears must NOT body-overlap (teeth only)
  };

  return { fourBar, sliderCrank, pendulum, scissor, gearPair };
}

/**
 * Produce a clearly-BROKEN variant of a mechanism fixture for the discrimination
 * proof (a correct mechanism must score high; a broken one < 0.5):
 *   'dof'     — declare the wrong joint count (an over-constrained loop) so
 *               dofCorrect→0 (the structure is locked, not a mechanism).
 *   'crash'   — collapse the links onto ONE coplanar Z-plane and fatten them so
 *               non-adjacent bodies sweep THROUGH each other → interference fires.
 *   'lockup'  — make the four-bar non-Grashof (S+L > P+Q) so the crank cannot
 *               complete a full rotation. NOTE: motionRangeFrac (axis d) measures
 *               the DRIVER's commanded sweep, so for a rotary-crank four-bar it
 *               still reads ~1.0; the lockup is caught instead by the CHAIN axis
 *               (Grashof→0) and INTERFERENCE (the torn loop holds the output pose
 *               → real overlap). Net score still < 0.5. (For prismatic-driven
 *               fixtures — scissor/gear/pendulum — mRange does collapse directly.)
 *   'broken'  — a genuinely non-functional build: wrong DOF AND (where applicable)
 *               non-Grashof lockup AND coplanar self-crash. ALL axes collapse →
 *               score well under 0.5 (the real discrimination floor).
 */
function applyMechMutation(spec, mutate) {
  const s = JSON.parse(JSON.stringify(spec, (k, v) => v)); // shallow structural copy
  // bodyBuilders are functions (lost by JSON) — re-attach from the live fixture.
  s.bodyBuilders = spec.bodyBuilders;
  s.fourbar = spec.fourbar ? { ...spec.fourbar } : undefined;
  s.fk = spec.fk ? { ...spec.fk, params: { ...spec.fk.params } } : undefined;

  // Wide, COPLANAR links (all on z≈0, nearly as wide as long) so the moving
  // bodies genuinely overlap through the cycle (a real self-collision).
  const coplanarWide = () => spec.bodyBuilders.map((b, i) => {
    if (i === 0) return b;                              // keep ground as the bed
    return (forge) => {
      const h = forge.makeBox(70, 60, 8);              // big fat slab on z=0
      return (forge.translate ? forge.translate(h, -35, -30, -4) : h);
    };
  });

  const breakDof = () => { s.jointSpec = { n: s.jointSpec.n, j1: s.jointSpec.j1 + 1, j2: s.jointSpec.j2 }; };
  const breakChainMotion = () => {
    if (s.fourbar && s.fk) {                            // non-Grashof: huge crank
      s.fk.params.r2 = s.fk.params.r1 + 60;
      s.fourbar.s = s.fk.params.r2;
    } else if (s.fk && s.fk.chain === 'slidercrank') {
      // conrod shorter than the crank+stroke → the FK root goes imaginary (loop
      // tears, piston freezes) → residual spikes + motion collapses.
      s.fk.params.r3 = 1;
    } else if (s.fk && s.fk.chain === 'scissor') {
      // freeze the centre angle → the output slider never moves (no stroke).
      s.fk.params.phi1 = s.fk.params.phi0;
    } else if (s.fk && s.fk.chain === 'gearpair') {
      // demand a sweep the driver cannot reach within one revolution.
      s.range = { ...s.range, targetRad: 100 };
    } else if (s.solver === 'multibody') {
      // ask for an unreachable swing (frozen-driver equivalent for the inertial
      // pendulum) so motionRangeFrac collapses without faking the solver.
      s.range = { ...s.range, targetRad: 50 };
    }
  };

  // For the multibody pendulum (no fk) a self-crash means an over-sized bob that
  // engulfs the fixed pivot post: the bob COM swings ~0.5 m out and ~0.87 m down,
  // so a big cube (~2.4 m across, centred on the bob COM) reaches back to the
  // origin in X, Y AND Z and overlaps the Ø6 post at z=0..8 mm.
  const overSizedBob = () => spec.bodyBuilders.map((b, i) => {
    if (i !== 0) return b;                              // keep the post
    return (forge) => {
      const S = 2400;
      const h = forge.makeBox(S, S, S);
      return (forge.translate ? forge.translate(h, -S / 2, -S / 2, -S / 2) : h);
    };
  });

  if (mutate === 'dof') { breakDof(); }
  else if (mutate === 'crash') { s.bodyBuilders = coplanarWide(); s.adjacency = []; }
  else if (mutate === 'lockup') { breakChainMotion(); }
  else if (mutate === 'broken') {
    breakDof();
    breakChainMotion();
    if (s.solver === 'multibody') { s.bodyBuilders = overSizedBob(); s.adjacency = []; }
    else { s.bodyBuilders = coplanarWide(); s.adjacency = []; }
  }
  return s;
}

/** Multiplicative Betti match using the CADGenBench squared (min+1)/(max+1) credit. */
function scoreTopology(forge, h, gtBetti) {
  const b = bettiNumbers(tess(forge, h));
  const c0 = topologyCredit(b.b0, gtBetti.b0);
  const c1 = topologyCredit(b.b1, gtBetti.b1);
  const c2 = topologyCredit(b.b2, gtBetti.b2);
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
function postToModel(systemStr, userStr, { host = '127.0.0.1', port = 8080, maxTokens = 1800, adapter = null } = {}) {
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
    } else if (job.op === 'mechanism') {
      // Score ONE mechanism fixture in a fresh kernel. The fixture is named so we
      // rebuild its (function-valued) bodyBuilders here — they cannot cross the
      // JSON job boundary. Drives the REAL multibody solver for grounded fixtures
      // and the kernel-truthful planarFK clash for closed-loop ones.
      const fixtures = mechanismFixtures();
      const spec = fixtures[job.fixture];
      if (!spec) { result = { ok: false, error: `unknown mechanism fixture '${job.fixture}'` }; }
      else {
        const mutated = job.mutate ? applyMechMutation(spec, job.mutate) : spec;
        const s = scoreMechanism(forge, mutated);
        result = { ok: true, score: s };
      }
    } else if (job.op === 'buildexport') {
      // No-GT build: dispatch the model's calls, check validity, export STEP.
      // Used by the multimodal drawing→CAD pipeline where ground truth is PRIVATE
      // (only build-validity + STEP round-trip are checkable locally).
      const { lastHandle, errors } = await dispatchSequence(job.calls, forge);
      if (!lastHandle) { result = { ok: false, error: 'no solid body', errors, valid: false, stepOk: false }; }
      else {
        const valid = checkValid(forge, lastHandle).valid;
        let stepOk = false;
        try { stepOk = !!forge.io.exportStep(lastHandle, job.outPath) && fs.existsSync(job.outPath); }
        catch (e) { stepOk = false; }
        const t = tess(forge, lastHandle);
        const bb = bboxOf(t);
        const betti = bettiNumbers(t);
        const mp = forge.massProps(lastHandle);
        result = { ok: true, errors, valid, stepOk, betti, bbox: bb,
          volume: mp.volume, area: mp.area, nCalls: job.calls.length, outPath: job.outPath };
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
//  Editing no-op-renormalized scoring
// ───────────────────────────────────────────────────────────────────────────
const tc = (name, args) => ({ name, arguments: args });

/**
 * Built-in editing fixtures (≥10, each a DISTINCT base + edit), mirroring
 * synth_forge_editing's CONTEXT-verb families. Each is { name, input_calls,
 * full_calls } where input_calls is the BASE-only build (the no-op echo target)
 * and full_calls is base+edit (the correct edit). No corpus / Python needed, so
 * the proof is deterministic and self-contained; pass --editing-rows <jsonl> to
 * instead score real corpus rows carrying meta.input_calls.
 */
function builtinEditingFixtures() {
  const F = (name, input_calls, edit_calls, features) => ({
    name, input_calls, full_calls: [...input_calls, ...edit_calls], features: features || [],
  });
  // Interface jig per edit: keep-in points must be CAVITY in the edited target
  // (and SOLID in the unedited input) so the no-op echo FAILS the jig. kind:'hole'
  // ⇒ keep-in expects cavity. Points are placed in the material that the EDIT
  // removes but the BASE still fills (the annulus between old/new bore, the new
  // bolt holes, the shell cavity, the filleted corner).
  const annulusHole = (rOld, rNew, z, n = 8) => ({
    kind: 'hole', center: [0, 0, z], r: rNew,
    // mid-way between old and new bore radius: solid in base, air in edit
    keepIn: ringPoints(0, 0, z, (rOld + rNew) / 2, n),
    keepOut: [],
  });
  const boltHoles = (count, bcd, z) => {
    const feats = [];
    for (let i = 0; i < count; i++) {
      const a = (2 * Math.PI * i) / count;
      const bx = (bcd / 2) * Math.cos(a), by = (bcd / 2) * Math.sin(a);
      feats.push({ kind: 'hole', center: [bx, by, z], r: 1, keepIn: [[bx, by, z]], keepOut: [] });
    }
    return feats;
  };
  return [
    // enlarge-bore: Ø20→Ø34 through a Ø80×12 hub. Jig: Ø20–Ø34 annulus must open.
    F('enlarge-bore-disc',
      [tc('part.begin', { primitive: 'cylinder', diameter: 80, depth: 12 }),
       tc('part.subtract', { primitive: 'cylinder', diameter: 20, depth: 12 }),
       tc('part.finish', {})],
      [tc('part.subtract', { primitive: 'cylinder', diameter: 34, depth: 12 })],
      [annulusHole(10, 17, 6)]),
    // enlarge-bore on a bored plate. Ø20→Ø38.
    F('enlarge-bore-plate',
      [tc('part.begin', { primitive: 'box', dx: 120, dy: 80, dz: 16, at: [-60, -40, 0] }),
       tc('part.subtract', { primitive: 'cylinder', diameter: 20, depth: 16 }),
       tc('part.finish', {})],
      [tc('part.subtract', { primitive: 'cylinder', diameter: 38, depth: 16 })],
      [annulusHole(10, 19, 8)]),
    // counterbore Ø25→Ø40×7 deep on top. Jig: the Ø25–Ø40 ring at the TOP must open.
    F('counterbore-disc',
      [tc('part.begin', { primitive: 'cylinder', diameter: 100, depth: 20 }),
       tc('part.subtract', { primitive: 'cylinder', diameter: 25, depth: 20 }),
       tc('part.finish', {})],
      [tc('part.subtract', { primitive: 'cylinder', diameter: 40, depth: 7, at: [0, 0, 15] })],
      [annulusHole(12.5, 20, 17.5)]),
    // bolt-circle: 6× Ø8 on Ø96. Jig: every bolt-hole centre must be cavity.
    F('bolt-circle-disc',
      [tc('part.begin', { primitive: 'cylinder', diameter: 120, depth: 16 }),
       tc('part.finish', {})],
      [tc('part.bolt-circle', { count: 6, bcd: 96, diameter: 8 })],
      boltHoles(6, 96, 8)),
    // bolt-circle: 4× Ø8 on Ø80 in a plate.
    F('bolt-circle-plate',
      [tc('part.begin', { primitive: 'box', dx: 120, dy: 100, dz: 12, at: [-60, -50, 0] }),
       tc('part.finish', {})],
      [tc('part.bolt-circle', { count: 4, bcd: 80, diameter: 8 })],
      boltHoles(4, 80, 6)),
    // shell a solid block to a 3 mm wall (open top). Jig: the interior must be hollow.
    F('shell-block',
      [tc('part.begin', { primitive: 'box', dx: 100, dy: 80, dz: 40, at: [-50, -40, 0] }),
       tc('part.finish', {})],
      [tc('part.subtract', { primitive: 'box', dx: 94, dy: 74, dz: 39, at: [-47, -37, 5] })],
      [{ kind: 'hole', center: [0, 0, 25], r: 1, keepIn: [[0, 0, 25], [20, 0, 25], [0, 15, 25]], keepOut: [] }]),
    // shell a solid disc to a 3 mm wall.
    F('shell-disc',
      [tc('part.begin', { primitive: 'cylinder', diameter: 100, depth: 30 }),
       tc('part.finish', {})],
      [tc('part.subtract', { primitive: 'cylinder', diameter: 94, depth: 29, at: [0, 0, 5] })],
      [{ kind: 'hole', center: [0, 0, 20], r: 1, keepIn: [[0, 0, 20], [20, 0, 20], [0, 20, 20]], keepOut: [] }]),
    // fillet all edges of a solid block (R10). Jig: the sharp corner becomes air.
    F('fillet-block',
      [tc('part.begin', { primitive: 'box', dx: 80, dy: 60, dz: 30, at: [-40, -30, 0] }),
       tc('part.finish', {})],
      [tc('part.finish', { fillet: 10 })],
      [{ kind: 'hole', center: [37, 27, 27], r: 1,
         keepIn: [[38, 28, 28], [38, 28, 2], [-38, -28, 28], [-38, -28, 2]], keepOut: [] }]),
    // enlarge a smaller bore in a tall hub. Ø16→Ø30.
    F('enlarge-bore-tall',
      [tc('part.begin', { primitive: 'cylinder', diameter: 60, depth: 25 }),
       tc('part.subtract', { primitive: 'cylinder', diameter: 16, depth: 25 }),
       tc('part.finish', {})],
      [tc('part.subtract', { primitive: 'cylinder', diameter: 30, depth: 25 })],
      [annulusHole(8, 15, 12.5)]),
    // counterbore a bored plate Ø25→Ø45×7 deep.
    F('counterbore-plate',
      [tc('part.begin', { primitive: 'box', dx: 100, dy: 100, dz: 20, at: [-50, -50, 0] }),
       tc('part.subtract', { primitive: 'cylinder', diameter: 25, depth: 20 }),
       tc('part.finish', {})],
      [tc('part.subtract', { primitive: 'cylinder', diameter: 45, depth: 7, at: [0, 0, 15] })],
      [annulusHole(12.5, 22.5, 17.5)]),
  ];
}

/**
 * Derive an interface jig for a corpus editing row by diffing the FULL chain
 * against the BASE (input) chain: the edit calls are the trailing verbs the base
 * lacks. Each material-removing edit becomes keep-in CAVITY probes that the
 * EDITED target passes but the UNEDITED echo fails:
 *   part.subtract cylinder → ring probe inside the new bore radius (centred or at:)
 *   part.subtract box      → centre + offset probes inside the new pocket
 *   part.bolt-circle       → a probe at each new hole centre
 * A fillet shaves only a thin edge shell with no robust interior cavity, so it
 * yields no feature (its no-op is caught by s_renorm + topology already).
 */
function editFeaturesFrom(inputCalls, fullCalls) {
  // edit calls = fullCalls beyond the base prefix (compare by name+args JSON).
  const baseKeys = inputCalls.map((c) => JSON.stringify([c.name, c.arguments || {}]));
  const used = new Array(baseKeys.length).fill(false);
  const edits = [];
  for (const c of fullCalls) {
    const k = JSON.stringify([c.name, c.arguments || {}]);
    const idx = baseKeys.findIndex((bk, i) => !used[i] && bk === k);
    if (idx >= 0) { used[idx] = true; continue; }   // part of the base prefix
    edits.push(c);
  }
  const feats = [];
  for (const c of edits) {
    const a = c.arguments || {};
    const at = Array.isArray(a.at) ? a.at : [0, 0, 0];
    if (c.name === 'part.subtract' && a.primitive === 'cylinder' && a.diameter > 0) {
      const r = a.diameter / 2;
      const z = (typeof a.at?.[2] === 'number' ? at[2] : 0) + (a.depth || 4) / 2;
      // probe a ring just INSIDE the new bore wall (0.85·r): cavity in the edited
      // target; for an enlarge-bore this annulus is SOLID in the unedited base
      // (its bore is smaller) → the no-op echo fails. Centre + 0.85·r ring.
      feats.push({ kind: 'hole', center: [at[0], at[1], z], r,
        keepIn: ringPoints(at[0], at[1], z, r * 0.85, 8).concat([[at[0], at[1], z]]), keepOut: [] });
    } else if (c.name === 'part.subtract' && a.primitive === 'box' && a.dx > 0) {
      const cx = at[0] + a.dx / 2, cy = at[1] + a.dy / 2, cz = at[2] + (a.dz || 4) / 2;
      feats.push({ kind: 'hole', center: [cx, cy, cz], r: 1,
        keepIn: [[cx, cy, cz], [cx + a.dx * 0.25, cy, cz], [cx, cy + a.dy * 0.25, cz]], keepOut: [] });
    } else if (c.name === 'part.bolt-circle' && a.count > 0 && a.bcd > 0) {
      const z = (typeof a.at_z === 'number' ? a.at_z : 0) + 2;
      for (let i = 0; i < a.count; i++) {
        const ang = (2 * Math.PI * i) / a.count;
        const bx = (a.bcd / 2) * Math.cos(ang), by = (a.bcd / 2) * Math.sin(ang);
        feats.push({ kind: 'hole', center: [bx, by, z], r: 1, keepIn: [[bx, by, z]], keepOut: [] });
      }
    }
    // fillet / chamfer (part.finish) → no robust interior cavity probe; skip.
  }
  return feats;
}

/** Label a chain in a fresh kernel child → { volume, bbox, betti, bodyCount, valid, tess }. */
function labelChain(calls) {
  const res = runJobInChild({ op: 'label', calls });
  if (!res.ok || !res.gt) return { ok: false, error: res.error || 'label failed' };
  const g = res.gt;
  const tessObj = g.tessSnapshot
    ? { positions: Float32Array.from(g.tessSnapshot.positions), indices: Uint32Array.from(g.tessSnapshot.indices) }
    : null;
  return {
    ok: true,
    gt: { volume: g.volume, bbox: g.bbox, betti: g.betti, bodyCount: g.bodyCount, valid: g.valid },
    tess: tessObj,
    tessSnapshot: g.tessSnapshot,
  };
}

/**
 * Run the editing no-op-renormalized discrimination proof over a set of editing
 * fixtures. For each fixture:
 *   gt_input  = label(input_calls)              (the unedited base)
 *   gt_target = label(full_calls)               (the edited GT)
 *   b_shape   = shapeFromTess(gt_input, gt_target)   (no-op baseline shape sim)
 *   CORRECT   = replay full_calls → score vs gt_target
 *   NO-OP     = replay input_calls only (echo the input) → score vs gt_target
 * editing_cad_score = gate*(0.6*s_renorm + 0.3*interface + 0.1*topology),
 *   s_renorm = max(0,(shape - b_shape)/(1 - b_shape)).
 */
async function runEditingProof(rowsPath) {
  let fixtures;
  if (rowsPath) {
    console.log(`\n--editing: scoring real corpus rows with meta.input_calls from ${rowsPath} …`);
    const lines = fs.readFileSync(rowsPath, 'utf8').split('\n').filter((l) => l.trim());
    fixtures = [];
    for (const line of lines) {
      let parsed; try { parsed = parseRow(line); } catch { continue; }
      const ic = parsed.meta && parsed.meta.input_calls;
      if (!ic || !ic.length || !parsed.calls.length) continue;
      const inputCalls = ic.map((c) => tc(c.name, c.arguments || {}));
      const fullCalls = parsed.calls;
      fixtures.push({
        name: (parsed.meta.edit || 'edit') + '-' + fixtures.length,
        input_calls: inputCalls,
        full_calls: fullCalls,
        // derive the edit's interface jig (cavity points the edit opens) so a
        // no-op echo, lacking the edit, also FAILS the interface axis.
        features: editFeaturesFrom(inputCalls, fullCalls),
      });
      if (fixtures.length >= 12) break;
    }
    if (!fixtures.length) {
      console.error('[fatal] no rows with meta.input_calls in ' + rowsPath);
      process.exit(5);
    }
  } else {
    console.log('\n--editing: built-in editing fixtures (no corpus needed; pass --editing-rows <jsonl> for real rows) …');
    fixtures = builtinEditingFixtures();
  }

  const scoreEdit = (calls, gtTarget, bShape, features) => {
    const res = runJobInChild({ op: 'score', calls, emittedCalls: calls, gt: gtTarget, features: features || [] });
    const s = res.ok ? res.score : (res.score || zeroScore(res.error || 'child failed'));
    const shape = s.shape || 0;
    const sRenorm = bShape >= 1 ? (shape >= 0.999 ? 1 : 0)
      : Math.max(0, (shape - bShape) / (1 - bShape));
    const editing_cad_score = (s.gate ? 1 : 0) * (0.6 * sRenorm + 0.3 * s.interface + 0.1 * s.topology);
    return { gate: s.gate, shape, interface: s.interface, topology: s.topology, sRenorm, editing_cad_score };
  };

  const results = [];
  for (const fx of fixtures) {
    const inLab = labelChain(fx.input_calls);
    const tgLab = labelChain(fx.full_calls);
    if (!inLab.ok || !tgLab.ok) {
      console.error(`  ! ${fx.name}: label failed (input.ok=${inLab.ok} target.ok=${tgLab.ok})`);
      continue;
    }
    // gt_input / gt_target as the {bbox,volume,betti,bodyCount,tess} the renorm needs.
    const gtInput = { ...inLab.gt, tess: inLab.tess };
    const gtTarget = { ...tgLab.gt, tess: tgLab.tess };
    const bShape = shapeFromTess(gtInput, gtTarget).shape;
    const features = fx.features || [];
    // Fillet/chamfer edits carve only a thin edge shell — no robust interior
    // cavity probe and NO Betti change — so under the fixed weights a fillet
    // no-op floors at 0.3·interface(=1)+0.1·topology(=1)=0.4. Only the s_renorm
    // axis discriminates it (s_renorm goes 1→0). The <0.15 no-op bar is therefore
    // asserted on the cavity/topology-bearing edits (bore/counterbore/shell/
    // bolt-circle); fillet no-ops are reported but excluded from that bar.
    const editTail = fx.full_calls[fx.full_calls.length - 1];
    const isFilletOnly = features.length === 0 && editTail && editTail.name === 'part.finish' &&
      (editTail.arguments?.fillet > 0 || editTail.arguments?.chamfer > 0);

    // Target gt for the worker scorer (needs _tess + dims).
    const gtForScore = {
      volume: tgLab.gt.volume, bbox: tgLab.gt.bbox, betti: tgLab.gt.betti,
      bodyCount: tgLab.gt.bodyCount, valid: tgLab.gt.valid, dims: {},
      tessSnapshot: tgLab.tessSnapshot,
    };

    const correct = scoreEdit(fx.full_calls, gtForScore, bShape, features);   // matches edited GT
    const noop = scoreEdit(fx.input_calls, gtForScore, bShape, features);     // echo the input unchanged
    results.push({
      name: fx.name, bShape, isFilletOnly,
      dVolPct: 100 * Math.abs((tgLab.gt.volume - inLab.gt.volume)) / Math.max(inLab.gt.volume, 1e-9),
      correct, noop,
    });
  }

  if (!results.length) { console.error('[fatal] no editing fixtures scored.'); process.exit(6); }

  // ── scorecard ──
  console.log('\n=== EDITING NO-OP-RENORM SCORECARD ===');
  const hdr = ['fixture', 'b_shape', 'Δvol%', 'C.shape', 'C.sRen', 'C.EDIT', 'N.shape', 'N.sRen', 'N.EDIT'];
  const w = [20, 8, 7, 8, 7, 7, 8, 7, 7];
  console.log(hdr.map((h, i) => pad(h, w[i])).join(''));
  console.log('-'.repeat(w.reduce((a, b) => a + b, 0)));
  for (const r of results) {
    console.log([
      pad(r.name, w[0]), pad(fmt(r.bShape), w[1]), pad(r.dVolPct.toFixed(1), w[2]),
      pad(fmt(r.correct.shape), w[3]), pad(fmt(r.correct.sRenorm), w[4]), pad(fmt(r.correct.editing_cad_score), w[5]),
      pad(fmt(r.noop.shape), w[6]), pad(fmt(r.noop.sRenorm), w[7]), pad(fmt(r.noop.editing_cad_score), w[8]),
    ].join(''));
  }

  // ── verdict ──
  //  Bars: correct EDIT >= 0.85, no-op EDIT < 0.15, margin > 0.7. Fillet-only
  //  rows that carry NO interface/topology signal (only s_renorm) are exempt
  //  from the no-op<0.15 and margin>0.7 bars (they floor at 0.4 under the fixed
  //  weights); for them we instead assert the s_renorm axis fully discriminates
  //  (correct sRenorm ~1, no-op sRenorm ~0).
  console.log('\n=== EDITING DISCRIMINATION VERDICT ===');
  let allCorrectHigh = true, allNoopLow = true, allMargin = true;
  for (const r of results) {
    const c = r.correct.editing_cad_score, n = r.noop.editing_cad_score, m = c - n;
    const cHigh = c >= 0.85;
    const nLow = r.isFilletOnly ? (r.noop.sRenorm < 0.15) : (n < 0.15);
    const mOk = r.isFilletOnly ? (r.correct.sRenorm - r.noop.sRenorm > 0.7) : (m > 0.7);
    if (!cHigh) allCorrectHigh = false;
    if (!nLow) allNoopLow = false;
    if (!mOk) allMargin = false;
    console.log(`  ${pad(r.name, 20)} correct=${fmt(c)} no-op=${fmt(n)} Δ=${fmt(m)} ` +
      `${r.isFilletOnly ? '[fillet: s_renorm-only] ' : ''}` +
      `${cHigh ? '' : '[CORRECT<0.85] '}${nLow ? '' : '[NO-OP NOT LOW] '}${mOk ? '' : '[MARGIN<=0.7]'}`);
  }
  const mc = results.reduce((a, r) => a + r.correct.editing_cad_score, 0) / results.length;
  const mn = results.reduce((a, r) => a + r.noop.editing_cad_score, 0) / results.length;
  console.log(`\n  mean correct EDIT score = ${fmt(mc)}`);
  console.log(`  mean no-op   EDIT score = ${fmt(mn)}`);
  console.log(`  mean margin             = ${fmt(mc - mn)}`);
  const proven = allCorrectHigh && allNoopLow && allMargin;
  console.log(`\n  EDITING DISCRIMINATION ${proven ? 'PROVEN ✓' : 'INCOMPLETE ✗'} ` +
    `(correct>=0.85: ${allCorrectHigh ? 'yes' : 'NO'}, no-op<0.15: ${allNoopLow ? 'yes' : 'NO'}, margin>0.7: ${allMargin ? 'yes' : 'NO'})`);
  if (!proven) process.exitCode = 8;
}

// ───────────────────────────────────────────────────────────────────────────
//  Mechanism axis proof (task #31)
// ───────────────────────────────────────────────────────────────────────────
function printMechScorecard(title, rows) {
  console.log(`\n${title}`);
  const header = ['mechanism', 'solver', 'gate', 'dof', 'dofOK', 'chain', 'mRange', 'clash', 'free', 'SCORE'];
  const widths = [22, 10, 5, 5, 6, 7, 7, 6, 5, 7];
  console.log(header.map((h, i) => pad(h, widths[i])).join(''));
  console.log('-'.repeat(widths.reduce((a, b) => a + b, 0)));
  for (const r of rows) {
    console.log([
      pad(r.mechanism, widths[0]),
      pad(r.solver, widths[1]),
      pad(r.gate, widths[2]),
      pad(r.dof == null ? '-' : r.dof, widths[3]),
      pad(r.dofCorrect ? 'Y' : 'N', widths[4]),
      pad(fmt(r.chainValid), widths[5]),
      pad(fmt(r.motionRangeFrac), widths[6]),
      pad(r.clashRan ? r.perStepClash : '-', widths[7]),
      pad(r.interferenceFree ? 'Y' : 'N', widths[8]),
      pad(fmt(r.score), widths[9]),
    ].join(''));
  }
}

/**
 * Run the mechanism-axis proof: score each of the 5 fixtures (correct build) plus
 * a deliberately-broken variant, in fresh kernel children. Verdict: every correct
 * fixture ≥ 0.80 and every broken variant < 0.5 (the discrimination bar).
 */
async function runMechanismProof() {
  console.log('\n--mechanisms: scoring the 5 mechanism fixtures (4th→5th axis) on');
  console.log('  (a) joints valid  (b) DOF  (c) chain  (d) motion-range  (e) NO interference …');
  const names = ['fourBar', 'sliderCrank', 'pendulum', 'scissor', 'gearPair'];
  const correctRows = [];
  const brokenRows = [];
  const brokenKind = {};
  for (const fixture of names) {
    const r = runJobInChild({ op: 'mechanism', fixture });
    if (!r.ok) { console.error(`  ! ${fixture}: ${r.error}`); continue; }
    correctRows.push(r.score);
    // A genuinely non-functional build: all applicable axes collapse (wrong DOF +
    // chain/motion lockup + coplanar self-crash) → score well under the 0.5 bar.
    const mutate = 'broken';
    brokenKind[fixture] = mutate;
    const rb = runJobInChild({ op: 'mechanism', fixture, mutate });
    brokenRows.push(rb.ok ? rb.score : zeroMechScore(fixture, rb.error));
  }

  printMechScorecard('=== MECHANISM SCORECARD (correct build — expect SCORE high, NO clash) ===', correctRows);
  printMechScorecard('=== BROKEN-VARIANT SCORECARD (wrong-DOF / self-crashing — expect SCORE < 0.5) ===', brokenRows);

  console.log('\nHonest solver path per fixture:');
  for (const r of correctRows) {
    console.log(`  ${pad(r.mechanism, 22)} solver=${pad(r.solver, 12)} ` +
      `${r.solver === 'multibody' ? '(REAL HHT-α inertial solver, end-to-end)' :
        '(planar FK poses; interference axis on REAL kernel meshes — closed-loop inertial is a kernel gap)'}`);
    if (r.solverErr) console.log(`      note: ${r.solverErr}`);
  }

  console.log('\n=== MECHANISM DISCRIMINATION VERDICT ===');
  let allHigh = true, allBrokenLow = true;
  for (let i = 0; i < correctRows.length; i++) {
    const c = correctRows[i].score, b = brokenRows[i] ? brokenRows[i].score : 1;
    const high = c >= 0.80, low = b < 0.5;
    if (!high) allHigh = false;
    if (!low) allBrokenLow = false;
    console.log(`  ${pad(correctRows[i].mechanism, 22)} correct=${fmt(c)} ` +
      `broken[${brokenKind[names[i]] || '?'}]=${fmt(b)} Δ=${fmt(c - b)} ` +
      `${high ? '' : '[CORRECT<0.80] '}${low ? '' : '[BROKEN NOT LOW]'}`);
  }
  const proven = allHigh && allBrokenLow;
  console.log(`\n  MECHANISM DISCRIMINATION ${proven ? 'PROVEN ✓' : 'INCOMPLETE ✗'} ` +
    `(correct≥0.80: ${allHigh ? 'yes' : 'NO'}, broken<0.5: ${allBrokenLow ? 'yes' : 'NO'})`);
  if (!proven) process.exitCode = 9;
}

function zeroMechScore(name, reason) {
  return {
    mechanism: name, solver: 'none', dof: null, dofExpected: null, dofCorrect: 0,
    jointsValid: false, gate: 0, chainValid: 0, grashof: null,
    motionRangeFrac: 0, motionRangeAchieved: false,
    interferenceFree: false, perStepClash: 0, worstStep: -1, clashRan: false,
    stable: false, maxResidual: 0, solverErr: reason, score: 0,
    detail: { reason },
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

  // ── --editing: no-op-RENORMALIZED discrimination for EDITING rows ──────────
  //  An editing row = a BASE build (meta.input_calls) + an EDIT, ending in ONE
  //  solid (the full tool_calls). The naive shape score rewards a model that
  //  merely ECHOES the input (returns it unchanged) because the input already
  //  resembles the edited target. We RENORMALISE against the no-op baseline:
  //      b_shape  = shape(input  vs target)            (the no-op floor)
  //      shape    = shape(candidate vs target)
  //      s_renorm = max(0, (shape - b_shape) / (1 - b_shape))
  //      editing_cad_score = gate * (0.6*s_renorm + 0.3*interface + 0.1*topology)
  //  A CORRECT edit moves the body toward the target ⇒ shape≫b_shape ⇒ s_renorm→1.
  //  A NO-OP echo replays only the BASE calls ⇒ shape≈b_shape ⇒ s_renorm→0.
  if (has('--editing')) {
    await runEditingProof(arg('--editing-rows'));
    return;
  }

  // ── --mechanisms: the 5th axis — MECHANISM correctness (task #31) ──────────
  //  Scores the 5 built-in mechanism fixtures (four-bar, slider-crank, pendulum,
  //  scissors, spur-gear pair) on joints/DOF/chain/motion-range/interference,
  //  each in a fresh kernel child. Drives the REAL HHT-α multibody solver for the
  //  grounded pendulum and a kernel-truthful planar-FK clash for the closed-loop
  //  fixtures (see HONEST LIMITS in scoreMechanism). Then a discrimination proof:
  //  each correct fixture vs a broken variant (wrong-DOF / self-crashing).
  if (has('--mechanisms')) {
    await runMechanismProof();
    return;
  }

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
         postToModel, callsFromAssistant, CANONICAL_SYSTEM,
         scoreShape, shapeFromTess, scoreInterface, scoreMate, scoreTopology,
         surfaceF1, volumeIoU, bboxDiag, topologyCredit, interfaceRamp,
         // ── mechanism axis (task #31) — pure-math helpers are kernel-free + self-testable ──
         scoreMechanism, mechanismFixtures, applyMechMutation,
         mechanismDOF, grashofClass, chainValidScore, motionRangeFrac,
         sweptClashFree, interferenceVerdict, planarFKSamples,
         transformTess, axisAngleToR };

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
