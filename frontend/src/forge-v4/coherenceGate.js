// Deterministic coherence + logic gate (parity #57, layer b).
//
// Pure function — no DOM, no THREE, no network — so it node-tests in
// isolation and runs identically in Studio and Forge (byte-equal copies
// until an @archdisc/coherence package is extracted, mirroring the
// SessionMemoryClient pattern).
//
// The premise behind the "~100% coherence" bar: a senior designer never
// ships a scene with a zero-scale body, a hero shot with no lights, or
// three props stacked at the origin. These are DETERMINISTIC defects —
// catchable by rules, no LLM verifier needed. The LLM verifier (layer c)
// only adds noun-plausibility ("does sphere×3 read as a snowman") ON TOP
// of this floor, once it earns ≥90% on a leakage-free probe.
//
// Returns EVERY violated rule (not just the first) so a corrector can fix
// them all in one regen pass.

const HUMAN_MAX_M = 50;       // largest sensible single-body dimension
const SLIVER_MIN_M = 0.002;   // sub-millimetre sliver floor
const ASPECT_MAX = 200;       // degenerate aspect unless intentionally flat

// Kinds that are legitimately flat/thin → exempt from the aspect check.
const FLAT_KINDS = new Set(['plane', 'floor', 'ground', 'curve', 'text']);

export function verifyCoherence(scene) {
  const reasons = [];
  const bodies = Array.isArray(scene && scene.bodies) ? scene.bodies : [];
  const intent = (scene && scene.intent) || {};

  // ── per-body geometry sanity ──────────────────────────────────────
  for (const b of bodies) {
    // Adversarial fix (2026-06-13): a null/undefined hole in bodies[]
    // (callers map/splice/filter) used to crash the whole verifier on
    // `b.scale`. A gate whose job is to RETURN defects must never throw.
    if (!b || typeof b !== 'object') { reasons.push('malformed body (not an object)'); continue; }
    // Distinguish ABSENT scale (size in geometry, unit default — not a
    // defect) from present-but-bad. Absent used to emit 3 bogus
    // "non-finite" reasons + force a needless regen.
    const hasScale = Array.isArray(b.scale);
    const s = hasScale ? b.scale : [];
    if (hasScale) {
      for (let k = 0; k < 3; k++) {
        const v = s[k];
        if (!Number.isFinite(v)) { reasons.push(`body "${b.kind}" non-finite scale on axis ${k}`); continue; }
        if (v === 0) reasons.push(`body "${b.kind}" zero scale on axis ${k}`);
        else if (v < 0) reasons.push(`body "${b.kind}" negative scale on axis ${k}`);
        else if (v > HUMAN_MAX_M) reasons.push(`body "${b.kind}" axis ${k} is ${v} m — beyond any human-factor bound`);
        else if (v < SLIVER_MIN_M) reasons.push(`body "${b.kind}" axis ${k} is ${v} m — sub-millimetre sliver`);
      }
    }
    // aspect ratio — a 200:1 box is a defect; a plane/curve is meant flat.
    const fin = s.filter((v) => Number.isFinite(v) && v > 0);
    if (fin.length === 3 && !FLAT_KINDS.has(String(b.kind || '').toLowerCase())) {
      const mx = Math.max(...fin), mn = Math.min(...fin);
      if (mn > 0 && mx / mn > ASPECT_MAX) {
        reasons.push(`body "${b.kind}" aspect ${Math.round(mx / mn)}:1 — degenerate proportion`);
      }
    }
  }

  // Valid (non-null) bodies — every iteration past the per-body loop
  // must use these, or a null hole crashes the composition/material
  // checks too (the per-body loop already reported the malformed ones).
  const valid = bodies.filter((b) => b && typeof b === 'object');

  // ── scene-composition logic (multi-body scenes only) ──────────────
  if (valid.length >= 3) {
    const offOrigin = valid.filter((b) => {
      const p = Array.isArray(b.position) ? b.position : [0, 0, 0];
      return Math.abs(p[0]) > 1e-3 || Math.abs(p[1]) > 1e-3 || Math.abs(p[2]) > 1e-3;
    }).length;
    if (offOrigin === 0) {
      reasons.push(`${valid.length} bodies all at the origin — no composition (stacked, not staged)`);
    }
  }

  // ── intent-driven logic (render/hero/portfolio prompts) ───────────
  if (intent.wantsRender || intent.wantsHero) {
    // Count lights robustly — a Studio scene plausibly passes lights as
    // an ARRAY; `[] || 0` is truthy so the old `=== 0` never fired
    // (false-negative: render scene with empty lights judged coherent).
    const lightCount = Array.isArray(scene.lights) ? scene.lights.length
      : (Number.isFinite(scene.lights) ? scene.lights : 0);
    if (lightCount === 0) reasons.push('render/hero intent but the scene has no lights');
    if (intent.wantsHero && scene.cameraMoved === false) reasons.push('hero shot but the camera never framed the subject');
    if (valid.length > 0 && valid.every((b) => b.isPhysicalMaterial === false)) {
      reasons.push('render-ready intent but no physical materials applied');
    }
  }

  return { verdict: reasons.length ? 'incoherent' : 'coherent', reasons };
}

// Deterministic intent parse from the user prompt (keyword scan).
export function intentFromPrompt(text) {
  const t = String(text || '').toLowerCase();
  const wantsHero = /\b(hero shot|hero|beauty shot|portfolio|presentation|render-ready)\b/.test(t);
  return {
    wantsHero,
    wantsRender: wantsHero || /\b(render|lit|lighting|cinematic|golden hour|studio shot)\b/.test(t),
  };
}

// Back-compat shim: the old gate returned {verdict, reason} (singular,
// first-defect). StudioShellV3 can swap to this without touching callers.
export function verifyCoherenceRules(bodies, ctx) {
  const r = verifyCoherence({ bodies, ...(ctx || {}) });
  return { verdict: r.verdict, reason: r.reasons[0] || '', reasons: r.reasons };
}

// ─── Mesh-topology gate (parity #57 + defect-taxonomy #62) ───────────────
// Deterministic detection of the rule-checkable MESH degradation modes
// from data/knowledge/modeling_defects.json — runs on raw geometry
// (positions: flat xyz, indices: triangle list) and reports every defect
// class found, so the visual go/no-go can block a degraded build before
// it reaches the user. Pure, O(n) except the optional weld scan.
// Self-intersection (O(n²)) is intentionally excluded here — too costly
// for a live gate; flagged for an explicit on-demand check.
export function verifyMeshTopology(positions, indices, opts = {}) {
  const reasons = [];
  const pos = positions && positions.length != null ? positions : [];
  const nV = Math.floor(pos.length / 3);
  let idx = indices && indices.length != null ? indices : null;
  if (!idx) { idx = []; for (let i = 0; i < nV; i++) idx.push(i); }
  const nT = Math.floor(idx.length / 3);
  if (nT === 0) return { verdict: 'coherent', reasons, stats: { tris: 0 } };

  const eps = Number.isFinite(opts.eps) ? opts.eps : 1e-9;
  const degenEps = Number.isFinite(opts.degenAreaEps) ? opts.degenAreaEps : 1e-12;
  const edgeFaces = new Map();   // 'a_b' → count (manifold check)
  const edgeDir = new Map();     // 'a_b' (a<b) → net winding sign (consistency)
  const usedV = new Uint8Array(nV);
  let degenerate = 0, nanFace = 0;

  const area2 = (a, b, c) => {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return Math.hypot(nx, ny, nz); // = 2× triangle area
  };

  for (let f = 0; f < nT; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    if (![a, b, c].every((i) => i >= 0 && i < nV)) { nanFace++; continue; }
    usedV[a] = usedV[b] = usedV[c] = 1;
    const ar = area2(a, b, c);
    if (!Number.isFinite(ar)) { nanFace++; continue; }
    if (ar < degenEps || a === b || b === c || a === c) { degenerate++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      edgeFaces.set(k, (edgeFaces.get(k) || 0) + 1);
      edgeDir.set(k, (edgeDir.get(k) || 0) + (u < v ? 1 : -1)); // ±1 per traversal
    }
  }

  // Degenerate / zero-area faces.
  if (degenerate > 0) reasons.push(`${degenerate} degenerate (zero-area) face(s)`);
  if (nanFace > 0) reasons.push(`${nanFace} face(s) with non-finite / out-of-range vertices`);

  // Non-manifold + boundary (tearing) from edge-face counts.
  let nonManifold = 0, boundary = 0;
  for (const cnt of edgeFaces.values()) {
    if (cnt > 2) nonManifold++;
    else if (cnt === 1) boundary++;
  }
  if (nonManifold > 0) reasons.push(`${nonManifold} non-manifold edge(s) (shared by >2 faces)`);
  if (boundary > 0 && opts.expectClosed) reasons.push(`${boundary} boundary edge(s) — open/torn shell (closed expected)`);

  // Inverted facets: a manifold edge whose two traversals do NOT cancel
  // means both faces wound it the same way (inconsistent winding).
  let inconsistent = 0;
  for (const [k, cnt] of edgeFaces) {
    if (cnt === 2 && edgeDir.get(k) !== 0) inconsistent++;
  }
  if (inconsistent > 0) reasons.push(`${inconsistent} edge(s) with inconsistent winding (inverted facets / non-unified normals)`);

  // Floating / isolated vertices.
  let floating = 0;
  for (let v = 0; v < nV; v++) if (!usedV[v]) floating++;
  if (floating > 0) reasons.push(`${floating} floating (isolated) vertex/vertices`);

  // Coincident unwelded vertices (mesh-tearing / split-vertex signal) —
  // optional scan (skipped above a cap for perf).
  if (opts.weldScan !== false && nV <= (opts.weldScanCap || 50000)) {
    const grid = new Map();
    const q = (x) => Math.round(x / Math.max(eps, 1e-9));
    let coincident = 0;
    for (let v = 0; v < nV; v++) {
      const key = `${q(pos[v * 3])},${q(pos[v * 3 + 1])},${q(pos[v * 3 + 2])}`;
      const prev = grid.get(key);
      if (prev !== undefined) coincident++; else grid.set(key, v);
    }
    if (coincident > 0) reasons.push(`${coincident} coincident unwelded vertex/vertices (potential tearing/split seam)`);
  }

  return {
    verdict: reasons.length ? 'incoherent' : 'coherent',
    reasons,
    stats: { tris: nT, verts: nV, nonManifold, boundary, degenerate, inconsistent, floating },
  };
}
