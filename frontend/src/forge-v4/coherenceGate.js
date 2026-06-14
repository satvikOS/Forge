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
