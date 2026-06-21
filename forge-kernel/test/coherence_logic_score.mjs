#!/usr/bin/env node
/**
 * coherence_logic_score.mjs — Coherence + Logic scorer for ArchDisc Forge scenes.
 *
 * Scores a BUILT scene 0..1 from THREE axes, each grounded in REAL kernel checks
 * where the kernel can answer exactly, and clearly LABELLED heuristics where it
 * cannot. Per the Forge Engineering Bible §0/§9 honesty mandate: never fake a
 * score; a correct "this check is heuristic" beats a fake "validated".
 *
 *   coherence_logic = base * defectGate
 *     base      = 0.45*GEOMETRIC + 0.35*ASSEMBLY + 0.20*LOGICAL   (mean-of-axes)
 *     defectGate= 0.5^(geomFailures + assemblyClashes)            (severity gate)
 *
 *   The weighted mean alone DILUTES a single hard failure across a many-body
 *   scene (one non-watertight body among four reads 0.75, not "broken"). A
 *   real coherence breach — a body the kernel rejects, or two bodies the kernel
 *   says physically overlap — is categorical, so each such REAL-kernel defect
 *   halves the final score. A clean scene has zero defects ⇒ gate=1 ⇒ score=base.
 *   (Heuristic logical flags do NOT drive the gate — only kernel-exact failures
 *   do; honesty mandate: never let a heuristic masquerade as a hard verdict.)
 *
 * ── (1) GEOMETRIC coherence  [REAL kernel] ──────────────────────────────────
 *   Each body must pass the kernel validity check AND be watertight / 2-manifold.
 *   Uses forge.heal.checkValidity(h)  (Healing.cpp:265-311, bound binding.cpp:3540-3558),
 *   gated EXACTLY like cadscore_harness.mjs:433-440 checkValid():
 *       valid = isClosed && isManifold && isOriented && !hasSelfIntersect && badFaces===0
 *   - isClosed   = shapeIsClosedSolid           (watertight)        Healing.cpp:268-274
 *   - isManifold = no edge shared by >=3 faces   (2-manifold)        Healing.cpp:276-291
 *   - isOriented = BRepCheck_Analyzer(s,true).IsValid() (OCCT topo)  Healing.cpp:266
 *   - badFaces   = per-face BRepCheck_Analyzer.IsValid               Healing.cpp:302-309
 *   Geometric score = fraction of bodies that pass (mean over bodies).
 *
 * ── (2) ASSEMBLY coherence  [REAL kernel] ───────────────────────────────────
 *   No UNINTENDED interference between bodies. Uses the SAME exact OCCT boolean
 *   that Forge uses for clash: forge.assembly.detectInterference([instIds], tol)
 *   (InterferenceDetection.cpp:66-113 — broad-phase inflated-AABB cull then
 *   narrow-phase BRepAlgoAPI_Common; returns interfering pairs with .volume),
 *   bound binding.cpp / bridge assembly.detect-interference. Each body is placed
 *   as an instance (forge.addInstance) at its scene transform; any pair NOT listed
 *   in `intended` whose intersection volume > eps is an unintended clash.
 *   Assembly score = fraction of body-pairs that are clash-free (or intended).
 *
 * ── (3) LOGICAL coherence  [HEURISTIC — labelled] ───────────────────────────
 *   NOT a kernel check. Pure-JS engineering-sanity heuristics on the scene's
 *   numeric description + measured geometry:
 *     (a) dimensions within a sane engineering range (0.01 mm .. 1e6 mm = 1 km),
 *         measured from each body's REAL bbox extents (forge.tessellate);
 *     (b) no degenerate bodies (positive real volume from forge.massProps);
 *     (c) consistent units — all extents within a 1e7 dynamic-range window
 *         (mixing mm and m without conversion blows this up);
 *     (d) no contradictory/duplicate bodies — two bodies with identical bbox AND
 *         identical centre-of-mass are a duplicate (heuristic flag).
 *   Logical score = mean of the per-rule pass fractions. LABELLED heuristic.
 *
 * REAL vs HEURISTIC is reported explicitly in realChecks[] / heuristicChecks[].
 *
 * USAGE:
 *   node forge-kernel/test/coherence_logic_score.mjs            # self-validate (clean vs incoherent)
 *   import { scoreScene } from './coherence_logic_score.mjs'    # score your own scene
 *
 * A "scene" is { bodies:[ { handle, name?, transform?(Float64 16, col-major like
 * forge.addInstance), nominalDims?:{label:number} } ], intendedInterferences?:
 * [[i,j],…] }. transform defaults to identity; if a body is already positioned by
 * its own geometry (e.g. built with translate) pass identity and it just works.
 *
 * Dependency-free: native kernel + Node builtins only. No Electron, no browser.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KERNEL_PATH = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');

// ───────────────────────────────────────────────────────────────────────────
//  Headless forge acquisition (raw kernel; no Electron preload needed for the
//  methods this scorer calls — identical to cadscore_harness.mjs:125-159).
// ───────────────────────────────────────────────────────────────────────────
export function loadForge(kernelPath = KERNEL_PATH) {
  return require(kernelPath);
}

const IDENT16 = () => Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// ───────────────────────────────────────────────────────────────────────────
//  Small geometry helpers (dependency-free)
// ───────────────────────────────────────────────────────────────────────────
function arrLen(x) {
  if (x == null) return 0;
  if (Array.isArray(x)) return x.length;
  if (typeof x.length === 'number') return x.length;
  if (typeof x === 'object') return Object.keys(x).length;
  return 0;
}

/** Tessellate a handle → { positions, indices, ... } (same params as harness:167). */
function tess(forge, h) {
  return forge.tessellate(h, 0.1, 0.5);
}

/** Axis-aligned bbox {min,max} from a tessellation (harness:171-183). */
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

// ───────────────────────────────────────────────────────────────────────────
//  (1) GEOMETRIC coherence — REAL kernel validity + watertight/2-manifold gate.
//      Gate is byte-for-byte the audited cadscore_harness.mjs:433-440 logic.
// ───────────────────────────────────────────────────────────────────────────
function checkValid(forge, h) {
  const v = forge.heal.checkValidity(h);                 // Healing.cpp:265-311
  const badF = arrLen(v.badFaces);
  const badE = arrLen(v.badEdges);
  const valid =
    !!v.isClosed && !!v.isManifold && !!v.isOriented &&
    !v.hasSelfIntersect && badF === 0;
  return {
    valid,
    watertight: !!v.isClosed,                              // closed-solid test
    manifold: !!v.isManifold,                              // 2-manifold test
    oriented: !!v.isOriented,
    selfIntersect: !!v.hasSelfIntersect,
    badFaces: badF,
    badEdges: badE,
    raw: v,
  };
}

function scoreGeometric(forge, bodies) {
  const perBody = [];
  let pass = 0;
  for (const b of bodies) {
    let res;
    try {
      res = checkValid(forge, b.handle);
    } catch (e) {
      res = { valid: false, watertight: false, manifold: false, error: e.message || String(e) };
    }
    if (res.valid) pass++;
    perBody.push({ name: b.name || `body#${b.handle}`, handle: b.handle, ...res });
  }
  const score = bodies.length ? pass / bodies.length : 0;
  return { score, perBody, passed: pass, total: bodies.length };
}

// ───────────────────────────────────────────────────────────────────────────
//  (2) ASSEMBLY coherence — REAL kernel interference (exact OCCT boolean), the
//      same clash check Forge ships. InterferenceDetection.cpp:66-113.
// ───────────────────────────────────────────────────────────────────────────
const CLASH_EPS = 1e-6; // mm^3; below this, a "clash" is float noise, not real overlap

function scoreAssembly(forge, bodies) {
  const n = bodies.length;
  // Pairs needed only when there are >=2 bodies.
  if (n < 2) {
    return { score: 1, totalPairs: 0, unintended: [], intended: [], note: '<2 bodies: no pairs' };
  }
  // Intended-interference allowlist (canonicalised as "i:j", i<j over body INDEX).
  const intendedSet = new Set();
  for (const pr of (bodies.__intended || [])) {
    const a = Math.min(pr[0], pr[1]), b = Math.max(pr[0], pr[1]);
    intendedSet.add(a + ':' + b);
  }

  // Place every body as an instance at its scene transform.
  const instIds = [];
  const instToIndex = new Map();
  try {
    for (let i = 0; i < n; i++) {
      const tf = bodies[i].transform instanceof Float64Array
        ? bodies[i].transform
        : (Array.isArray(bodies[i].transform) ? Float64Array.from(bodies[i].transform) : IDENT16());
      const id = forge.addInstance(bodies[i].handle, tf);
      instIds.push(id);
      instToIndex.set(id, i);
    }

    // ONE exact-boolean pass over the whole instance set (clash check).
    const pairs = forge.assembly.detectInterference(instIds, 0) || [];

    const unintended = [];
    const intended = [];
    for (const p of pairs) {
      const vol = Math.max(0, p.volume || 0);
      if (vol <= CLASH_EPS) continue;
      const ia = instToIndex.get(p.instA);
      const ib = instToIndex.get(p.instB);
      if (ia === undefined || ib === undefined) continue;
      const a = Math.min(ia, ib), b = Math.max(ia, ib);
      const key = a + ':' + b;
      const entry = {
        bodies: [bodies[a].name || `body#${bodies[a].handle}`, bodies[b].name || `body#${bodies[b].handle}`],
        indices: [a, b],
        volume: vol,
      };
      if (intendedSet.has(key)) intended.push(entry);
      else unintended.push(entry);
    }

    const totalPairs = (n * (n - 1)) / 2;
    const badPairs = unintended.length;
    const score = totalPairs ? (totalPairs - badPairs) / totalPairs : 1;
    return { score, totalPairs, unintended, intended };
  } finally {
    for (const id of instIds) { try { forge.removeInstance(id); } catch { /* ignore */ } }
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  (3) LOGICAL coherence — HEURISTIC (clearly labelled; NOT a kernel proof).
//      Engineering-sanity rules on numerics + measured geometry.
// ───────────────────────────────────────────────────────────────────────────
const DIM_MIN_MM = 0.01;     // 10 micron — below this is sub-machining noise
const DIM_MAX_MM = 1e6;      // 1 km — above this is almost certainly a unit error
const UNIT_DYNAMIC_RANGE = 1e7; // ratio between largest and smallest extent across scene

function scoreLogical(forge, bodies) {
  const flags = [];                 // human-readable problems found
  const ruleScores = [];            // each in [0,1]

  // Gather measured geometry per body.
  const measured = [];
  for (const b of bodies) {
    let bb = null, vol = NaN, extents = null;
    try {
      const t = tess(forge, b.handle);
      bb = bboxOf(t);
      extents = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
    } catch { /* body may not tessellate (degenerate) */ }
    try { vol = forge.massProps(b.handle).volume; } catch { /* ignore */ }
    measured.push({ name: b.name || `body#${b.handle}`, handle: b.handle, bb, vol, extents });
  }

  // (a) Dimensions within a sane engineering range — measured extents + any
  //     declared nominalDims. [HEURISTIC]
  {
    let total = 0, ok = 0;
    for (const m of measured) {
      const dims = [];
      if (m.extents) for (const e of m.extents) if (e > 0) dims.push(e);
      const nd = bodies.find((b) => b.handle === m.handle)?.nominalDims;
      if (nd) for (const k of Object.keys(nd)) dims.push(Math.abs(nd[k]));
      for (const d of dims) {
        total++;
        if (d >= DIM_MIN_MM && d <= DIM_MAX_MM) ok++;
        else flags.push(`dim out of range on ${m.name}: ${d} mm (sane ${DIM_MIN_MM}..${DIM_MAX_MM} mm)`);
      }
    }
    ruleScores.push(total ? ok / total : 1);
  }

  // (b) No degenerate bodies — positive, finite real volume. [HEURISTIC]
  {
    let ok = 0;
    for (const m of measured) {
      if (Number.isFinite(m.vol) && m.vol > 0) ok++;
      else flags.push(`degenerate / zero-volume body: ${m.name} (vol=${m.vol})`);
    }
    ruleScores.push(measured.length ? ok / measured.length : 1);
  }

  // (c) Consistent units — all positive extents across the WHOLE scene fall in a
  //     single dynamic-range window. A body sized in metres next to bodies sized
  //     in millimetres blows the ratio past UNIT_DYNAMIC_RANGE. [HEURISTIC]
  {
    let smallest = Infinity, largest = 0;
    for (const m of measured) {
      if (!m.extents) continue;
      for (const e of m.extents) {
        if (e > 0) { if (e < smallest) smallest = e; if (e > largest) largest = e; }
      }
    }
    let ok = 1;
    if (largest > 0 && Number.isFinite(smallest)) {
      const range = largest / smallest;
      if (range > UNIT_DYNAMIC_RANGE) {
        ok = 0;
        flags.push(`unit inconsistency: extent dynamic range ${range.toExponential(2)} ` +
          `(> ${UNIT_DYNAMIC_RANGE.toExponential(0)}) — likely mixed mm/m`);
      }
    }
    ruleScores.push(ok);
  }

  // (d) No contradictory / duplicate bodies — identical bbox AND centre-of-mass.
  //     [HEURISTIC]
  {
    let dupes = 0;
    const seen = [];
    for (const m of measured) {
      if (!m.bb) continue;
      let com = null;
      try { com = forge.massProps(m.handle).centerOfMass; } catch { /* ignore */ }
      const sig = m.bb.min.concat(m.bb.max, com || [0, 0, 0]).map((x) => Math.round(x * 1e3) / 1e3).join(',');
      if (seen.includes(sig)) {
        dupes++;
        flags.push(`duplicate body (identical bbox + COM): ${m.name}`);
      } else seen.push(sig);
    }
    ruleScores.push(measured.length ? (measured.length - dupes) / measured.length : 1);
  }

  const score = ruleScores.length ? ruleScores.reduce((a, b) => a + b, 0) / ruleScores.length : 1;
  return { score, ruleScores, flags };
}

// ───────────────────────────────────────────────────────────────────────────
//  Top-level scorer
// ───────────────────────────────────────────────────────────────────────────
const W_GEOM = 0.45, W_ASM = 0.35, W_LOGIC = 0.20;

export function scoreScene(forge, scene) {
  const bodies = (scene.bodies || []).map((b) => ({
    handle: b.handle,
    name: b.name,
    transform: b.transform,
    nominalDims: b.nominalDims,
  }));
  // attach intended-interference allowlist on the array for scoreAssembly
  bodies.__intended = scene.intendedInterferences || [];

  const geometric = scoreGeometric(forge, bodies);
  const assembly = scoreAssembly(forge, bodies);
  const logical = scoreLogical(forge, bodies);

  const base =
    W_GEOM * geometric.score + W_ASM * assembly.score + W_LOGIC * logical.score;

  // Severity gate: each REAL-kernel coherence defect (an invalid body, or an
  // unintended clash) halves the score. Heuristic logical flags do NOT gate.
  const geomFailures = geometric.total - geometric.passed;
  const assemblyClashes = assembly.unintended.length;
  const kernelDefects = geomFailures + assemblyClashes;
  const defectGate = Math.pow(0.5, kernelDefects);
  const score = base * defectGate;

  return {
    score,
    base,
    defectGate,
    kernelDefects,
    weights: { geometric: W_GEOM, assembly: W_ASM, logical: W_LOGIC },
    geometric,
    assembly,
    logical,
    realChecks: [
      'GEOMETRIC validity + watertight/2-manifold: forge.heal.checkValidity (Healing.cpp:265-311; bound binding.cpp:3540-3558) — gated exactly like cadscore_harness.mjs:433-440 (isClosed && isManifold && isOriented && !hasSelfIntersect && badFaces===0).',
      'ASSEMBLY non-interference: forge.assembly.detectInterference (InterferenceDetection.cpp:66-113 — broad-phase inflated-AABB cull then narrow-phase exact BRepAlgoAPI_Common boolean; returns interfering pairs with .volume) — the same clash check cadscore_harness.mjs:619 uses.',
    ],
    heuristicChecks: [
      'LOGICAL dimension range: measured bbox extents (forge.tessellate) + declared nominalDims must lie in 0.01 mm .. 1e6 mm. HEURISTIC engineering-sanity bound, not a kernel proof.',
      'LOGICAL non-degenerate: forge.massProps volume must be finite and > 0. Volume is a REAL kernel measurement; the >0 sanity rule is HEURISTIC.',
      'LOGICAL unit consistency: scene-wide extent dynamic range must be < 1e7 (catches mixed mm/m). HEURISTIC.',
      'LOGICAL duplicate/contradiction: two bodies with identical rounded bbox + centre-of-mass flagged as duplicate. HEURISTIC.',
    ],
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Self-validation: clean scene (~1.0) vs injected-incoherent scene (clearly LOW)
// ───────────────────────────────────────────────────────────────────────────
// RANDOM examples each run (no cherry-picking — feedback-vary-test-prompts).
// The scorer's logic is exact, so the clean/incoherent discrimination MUST hold
// for ANY random scene — that is precisely what makes random validation honest.
function rnd(a, b) { return a + Math.random() * (b - a); }

function buildCleanScene(forge) {
  // 2..4 random valid primitives, placed far apart along X so they never clash.
  const n = 2 + Math.floor(Math.random() * 3);
  const bodies = [];
  let x = 0;
  for (let k = 0; k < n; k++) {
    const t = Math.floor(Math.random() * 3);
    let h;
    if (t === 0) h = forge.makeBox(rnd(8, 40), rnd(8, 40), rnd(8, 40));
    else if (t === 1) h = forge.makeCylinder(rnd(4, 16), rnd(10, 40));
    else h = forge.makeSphere(rnd(6, 20));
    bodies.push({ handle: forge.translate(h, x, 0, 0), name: ['box', 'cyl', 'sph'][t] + k });
    x += 220 + rnd(0, 120); // gap >> body size ⇒ guaranteed non-interfering
  }
  return { bodies };
}

function buildIncoherentScene(forge) {
  // Random partial-overlap box pair (REAL clash) + a non-watertight open patch +
  // a random absurd dimension — different magnitudes / positions every run.
  const s = rnd(15, 25);
  const overlap = rnd(s * 0.3, s * 0.7);
  const a = forge.makeBox(s, s, s);
  const b = forge.translate(forge.makeBox(s, s, s), s - overlap, 0, 0);
  const rows = 3, cols = 3;
  const xyz = new Float64Array(rows * cols * 3);
  let i = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { xyz[i++] = c * 10; xyz[i++] = r * 10; xyz[i++] = rnd(-2, 2); }
  const patch = forge.surfacing.buildPatch({ uCount: rows, vCount: cols, xyz }, 2, 2, null, null);
  const d = forge.translate(forge.makeBox(10, 10, 10), 500, 0, 0);
  return {
    bodies: [
      { handle: a, name: 'blockA(clash)' },
      { handle: b, name: 'blockB(clash)' },
      { handle: patch, name: 'openShell(non-watertight)' },
      { handle: d, name: 'absurdDim', nominalDims: { bore: rnd(2e6, 9e6) } }, // 2..9 km
    ],
  };
}

function fmt(n) { return Number(n).toFixed(4); }

async function main() {
  const forge = loadForge();
  console.log('forge-kernel.node version:', forge.version ? forge.version() : '(no version())');

  const clean = buildCleanScene(forge);
  const cleanRes = scoreScene(forge, clean);

  // Fresh handles for the incoherent scene (handle counter is process-global but
  // each body carries its own handle, so no collision with the clean scene).
  const bad = buildIncoherentScene(forge);
  const badRes = scoreScene(forge, bad);

  console.log('\n================ CLEAN SCENE ================');
  console.log(`coherence_logic = ${fmt(cleanRes.score)}  (base ${fmt(cleanRes.base)} x defectGate ${fmt(cleanRes.defectGate)}, kernelDefects=${cleanRes.kernelDefects})`);
  console.log(`  geometric (REAL)  = ${fmt(cleanRes.geometric.score)}  (${cleanRes.geometric.passed}/${cleanRes.geometric.total} bodies valid+watertight)`);
  console.log(`  assembly  (REAL)  = ${fmt(cleanRes.assembly.score)}  (unintended clashes: ${cleanRes.assembly.unintended.length})`);
  console.log(`  logical   (HEUR)  = ${fmt(cleanRes.logical.score)}  (flags: ${cleanRes.logical.flags.length})`);
  if (cleanRes.logical.flags.length) console.log('   ', cleanRes.logical.flags.join('\n    '));

  console.log('\n============= INCOHERENT SCENE =============');
  console.log(`coherence_logic = ${fmt(badRes.score)}  (base ${fmt(badRes.base)} x defectGate ${fmt(badRes.defectGate)}, kernelDefects=${badRes.kernelDefects})`);
  console.log(`  geometric (REAL)  = ${fmt(badRes.geometric.score)}  (${badRes.geometric.passed}/${badRes.geometric.total} bodies valid+watertight)`);
  for (const pb of badRes.geometric.perBody) {
    if (!pb.valid) console.log(`     FAIL ${pb.name}: watertight=${pb.watertight} manifold=${pb.manifold} badFaces=${pb.badFaces}`);
  }
  console.log(`  assembly  (REAL)  = ${fmt(badRes.assembly.score)}  (unintended clashes: ${badRes.assembly.unintended.length})`);
  for (const u of badRes.assembly.unintended) console.log(`     CLASH ${u.bodies[0]} ↔ ${u.bodies[1]}  vol=${fmt(u.volume)} mm^3`);
  console.log(`  logical   (HEUR)  = ${fmt(badRes.logical.score)}  (flags: ${badRes.logical.flags.length})`);
  if (badRes.logical.flags.length) console.log('    ' + badRes.logical.flags.join('\n    '));

  console.log('\n================== SUMMARY =================');
  console.log(`CLEAN      coherence_logic = ${fmt(cleanRes.score)}   (expected high, ~1.0)`);
  console.log(`INCOHERENT coherence_logic = ${fmt(badRes.score)}   (expected clearly LOW)`);
  console.log('\nREAL (kernel-exact) checks:');
  for (const r of cleanRes.realChecks) console.log('  - ' + r);
  console.log('HEURISTIC (labelled) checks:');
  for (const h of cleanRes.heuristicChecks) console.log('  - ' + h);

  const discriminates = cleanRes.score >= 0.9 && badRes.score <= 0.6 && (cleanRes.score - badRes.score) >= 0.3;
  console.log(`\nDISCRIMINATION: ${discriminates ? 'PASS' : 'FAIL'} (clean ${fmt(cleanRes.score)} vs incoherent ${fmt(badRes.score)})`);

  // Machine-readable line for harness consumption.
  console.log('\nRESULT_JSON ' + JSON.stringify({
    cleanScore: cleanRes.score,
    incoherentScore: badRes.score,
    cleanBreakdown: { geometric: cleanRes.geometric.score, assembly: cleanRes.assembly.score, logical: cleanRes.logical.score },
    incoherentBreakdown: { geometric: badRes.geometric.score, assembly: badRes.assembly.score, logical: badRes.logical.score },
    discriminates,
  }));

  process.exit(discriminates ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
