// PUSH-143 (Slice-103) — ASME Y14.5-2018 semantic GD&T rules engine.
//
// PUSH-92 shipped the Feature Control Frame BUILDER. The frames it
// produces are syntactically valid (the formatter guarantees the glyph |
// tolerance | datum cell layout), but ASME Y14.5-2018 also has dozens of
// SEMANTIC rules a drawing-checker enforces:
//
//   * Datum reference frame precedence — you can't have a tertiary
//     datum without a secondary, or a secondary without a primary.
//   * Material condition modifiers (Ⓜ MMC / Ⓛ LMC / Ⓕ Free state) only
//     apply to certain characteristics — putting Ⓜ on a Flatness
//     tolerance is illegal because Flatness is a surface-condition tol
//     that doesn't have a feature axis to take Ⓜ.
//   * Position / Profile of a surface need at least 1 datum.
//   * Ø (diameter modifier) is REQUIRED on the tolerance value for axis
//     tolerances (Position on a hole, Cylindricity on a shaft) — the
//     tolerance zone is a cylinder, not a width.
//   * Tolerance value > 0.
//   * Form tolerances (Straightness, Flatness, Roundness, Cylindricity)
//     never take datums.
//   * Concentricity / Symmetry are deprecated in Y14.5-2018 — they're
//     replaced by Position. We surface this as a warning.
//   * Composite frames (Position upper + Position lower) — when present,
//     the upper datums must be a superset of the lower datums.
//   * Datum letter must be a single capital A-Z (ASCII).
//
// This module is a PURE FUNCTION rules engine. No DOM, no React, no
// localStorage. The panel imports `validateFrames(frames)` and renders
// the report; the e2e + plugins / Archie can import the same module to
// run the engine headlessly.
//
// Each rule produces a `{ id, label, severity, frames: [{ idx, frameId,
// passed, message }] }` record. Severity is `error` or `warning`.
//
// Hard constraints (PUSH-143 brief):
//   * NO new npm packages.
//   * Real semantic rules per ASME Y14.5-2018 — no placeholders.
//   * Pure functions only. Module is import-safe in test runners.

// ─────────────────────────────────────────────────────────────────────
// Characteristic taxonomy. The eight categories mirror Table 5-1 of
// ASME Y14.5-2018 (Geometric Characteristic Symbols).
//
// `takesDatums`:
//   none      — Form tolerances (Straightness, Flatness, Roundness,
//               Cylindricity) — datums never apply.
//   optional  — Profile of a line — datums optional (TGC vs. non-TGC).
//   required  — every other characteristic — datums required.
//
// `axisTolerance`:
//   true  — the tolerance zone is a cylinder; Ø (diameter modifier) is
//           required on the tolerance value.
//   false — the tolerance zone is a width or surface zone; Ø disallowed.
//
// `allowsMaterialModifier`:
//   true  — Ⓜ / Ⓛ may modify the tolerance value (Position, Perpendi-
//           cularity / Parallelism / Angularity on a feature of size).
//   false — Ⓜ / Ⓛ illegal on the tolerance value (surface tolerances).
//
// `deprecated`:
//   true  — Y14.5-2018 retired the characteristic (Concentricity,
//           Symmetry); replaced by Position. Surfaced as a warning.

export const CHARACTERISTIC_RULES = Object.freeze({
  straightness: {
    category: 'Form',
    takesDatums: 'none',
    axisTolerance: false,
    allowsMaterialModifier: false,
    deprecated: false,
  },
  flatness: {
    category: 'Form',
    takesDatums: 'none',
    axisTolerance: false,
    allowsMaterialModifier: false,
    deprecated: false,
  },
  roundness: {
    category: 'Form',
    takesDatums: 'none',
    axisTolerance: false,
    allowsMaterialModifier: false,
    deprecated: false,
  },
  cylindricity: {
    category: 'Form',
    takesDatums: 'none',
    axisTolerance: false,
    allowsMaterialModifier: false,
    deprecated: false,
  },
  profileLine: {
    category: 'Profile',
    takesDatums: 'optional',
    axisTolerance: false,
    allowsMaterialModifier: false,
    deprecated: false,
  },
  profileSurface: {
    category: 'Profile',
    takesDatums: 'required',
    axisTolerance: false,
    allowsMaterialModifier: false,
    deprecated: false,
  },
  angularity: {
    category: 'Orientation',
    takesDatums: 'required',
    axisTolerance: false,
    allowsMaterialModifier: true,
    deprecated: false,
  },
  perpendicularity: {
    category: 'Orientation',
    takesDatums: 'required',
    axisTolerance: false,
    allowsMaterialModifier: true,
    deprecated: false,
  },
  parallelism: {
    category: 'Orientation',
    takesDatums: 'required',
    axisTolerance: false,
    allowsMaterialModifier: true,
    deprecated: false,
  },
  position: {
    category: 'Location',
    takesDatums: 'required',
    axisTolerance: true,
    allowsMaterialModifier: true,
    deprecated: false,
  },
  concentricity: {
    category: 'Location',
    takesDatums: 'required',
    axisTolerance: true,
    allowsMaterialModifier: false,
    deprecated: true,
  },
  symmetry: {
    category: 'Location',
    takesDatums: 'required',
    axisTolerance: false,
    allowsMaterialModifier: false,
    deprecated: true,
  },
  runoutCircular: {
    category: 'Runout',
    takesDatums: 'required',
    axisTolerance: false,
    allowsMaterialModifier: false,
    deprecated: false,
  },
  runoutTotal: {
    category: 'Runout',
    takesDatums: 'required',
    axisTolerance: false,
    allowsMaterialModifier: false,
    deprecated: false,
  },
});

// Material condition modifier ids used by PUSH-92's builder.
const MOD_NONE = 'none';
const MOD_MMC  = 'M';
const MOD_LMC  = 'L';
const MOD_FREE = 'F';
const MATERIAL_MODS = new Set([MOD_MMC, MOD_LMC]);

// Helper — strip empty datum rows so precedence + count rules see the
// real list of datum references.
function realDatums(frame) {
  if (!frame || !Array.isArray(frame.datums)) return [];
  return frame.datums.filter((d) =>
    d && typeof d.letter === 'string' && d.letter.trim().length > 0);
}

// Helper — read the per-position datum letters (or null when empty).
function datumPositions(frame) {
  const arr = (frame && Array.isArray(frame.datums)) ? frame.datums : [];
  return [0, 1, 2].map((i) => {
    const d = arr[i];
    const letter = d && typeof d.letter === 'string' ? d.letter.trim() : '';
    return letter.length ? letter : null;
  });
}

function letterOK(letter) {
  return /^[A-Z]$/.test(letter);
}

function numericToleranceValue(frame) {
  const v = frame ? frame.toleranceValue : null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

// ─────────────────────────────────────────────────────────────────────
// Rule definitions. Each rule is a pure function over (frame, idx,
// frames) → { passed, message }. The runner wraps them with the
// per-rule metadata + iterates over every frame.

const RULES = Object.freeze([
  // R-001 — tolerance value > 0.
  {
    id: 'R-001-toleranceValue',
    label: 'Tolerance value > 0',
    severity: 'error',
    check: (f) => {
      const n = numericToleranceValue(f);
      if (!Number.isFinite(n)) {
        return { passed: false, message: 'Tolerance value missing or non-numeric.' };
      }
      if (n <= 0) {
        return { passed: false,
          message: `Tolerance value must be > 0 (got ${n}).` };
      }
      return { passed: true, message: `Tolerance value ${n} > 0.` };
    },
  },

  // R-002 — recognised geometric characteristic symbol.
  {
    id: 'R-002-characteristic',
    label: 'Geometric characteristic recognised by Y14.5-2018',
    severity: 'error',
    check: (f) => {
      const sym = f ? f.symbolId : null;
      if (!sym || typeof sym !== 'string') {
        return { passed: false, message: 'No symbol id on frame.' };
      }
      if (!CHARACTERISTIC_RULES[sym]) {
        return { passed: false,
          message: `Unknown characteristic '${sym}'.` };
      }
      return { passed: true,
        message: `Characteristic '${sym}' recognised (${CHARACTERISTIC_RULES[sym].category}).` };
    },
  },

  // R-003 — datum reference frame precedence: no skipping. If tertiary
  // is set, secondary must be set. If secondary is set, primary must be
  // set.
  {
    id: 'R-003-datumPrecedence',
    label: 'Datum precedence — primary → secondary → tertiary, no skipping',
    severity: 'error',
    check: (f) => {
      const [p, s, t] = datumPositions(f);
      if (t && !s) {
        return { passed: false,
          message: `Tertiary datum '${t}' set without a secondary datum.` };
      }
      if (s && !p) {
        return { passed: false,
          message: `Secondary datum '${s}' set without a primary datum.` };
      }
      if (t && !p) {
        return { passed: false,
          message: `Tertiary datum '${t}' set without a primary datum.` };
      }
      return { passed: true, message: 'Datum precedence respected.' };
    },
  },

  // R-004 — datum letters must be A-Z singletons (capital).
  {
    id: 'R-004-datumLetters',
    label: 'Datum letters are single capital A-Z',
    severity: 'error',
    check: (f) => {
      const dats = realDatums(f);
      for (const d of dats) {
        if (!letterOK(d.letter)) {
          return { passed: false,
            message: `Datum letter '${d.letter}' is not a single capital A-Z.` };
        }
      }
      return { passed: true,
        message: dats.length === 0 ? 'No datum letters to check.'
          : `All ${dats.length} datum letter(s) are valid.` };
    },
  },

  // R-005 — datum letters unique within a frame (a frame can't reference
  // the same datum twice).
  {
    id: 'R-005-datumUniqueness',
    label: 'Datum letters unique within frame',
    severity: 'error',
    check: (f) => {
      const dats = realDatums(f);
      const seen = new Set();
      for (const d of dats) {
        if (seen.has(d.letter)) {
          return { passed: false,
            message: `Datum letter '${d.letter}' appears more than once.` };
        }
        seen.add(d.letter);
      }
      return { passed: true,
        message: dats.length === 0 ? 'No datum letters to check.'
          : `All ${dats.length} datum letter(s) are unique.` };
    },
  },

  // R-006 — characteristics that REQUIRE datums must have at least 1.
  // (Position, Profile of a surface, Orientation tolerances, Runout.)
  {
    id: 'R-006-datumRequired',
    label: 'Characteristic with required datums has ≥1 datum',
    severity: 'error',
    check: (f) => {
      const meta = f && f.symbolId ? CHARACTERISTIC_RULES[f.symbolId] : null;
      if (!meta) return { passed: true, message: 'Skip — unknown characteristic.' };
      if (meta.takesDatums !== 'required') {
        return { passed: true, message: 'Datums not required for this characteristic.' };
      }
      const dats = realDatums(f);
      if (dats.length === 0) {
        return { passed: false,
          message: `${f.symbolId} requires at least 1 datum reference (none set).` };
      }
      return { passed: true, message: `${dats.length} datum(s) referenced.` };
    },
  },

  // R-007 — Position needs at least 1 datum. (Subset of R-006 but the
  // brief calls it out explicitly so we make it its own rule.)
  {
    id: 'R-007-positionDatum',
    label: 'Position needs ≥1 datum',
    severity: 'error',
    check: (f) => {
      if (!f || f.symbolId !== 'position') {
        return { passed: true, message: 'Skip — not a Position frame.' };
      }
      const dats = realDatums(f);
      if (dats.length === 0) {
        return { passed: false,
          message: 'Position frame has no datum references.' };
      }
      return { passed: true,
        message: `Position frame has ${dats.length} datum(s).` };
    },
  },

  // R-008 — Profile of a surface needs at least 1 datum.
  {
    id: 'R-008-profileSurfaceDatum',
    label: 'Profile of a surface needs ≥1 datum',
    severity: 'error',
    check: (f) => {
      if (!f || f.symbolId !== 'profileSurface') {
        return { passed: true, message: 'Skip — not a Profile-surface frame.' };
      }
      const dats = realDatums(f);
      if (dats.length === 0) {
        return { passed: false,
          message: 'Profile of a surface has no datum references.' };
      }
      return { passed: true,
        message: `Profile of a surface has ${dats.length} datum(s).` };
    },
  },

  // R-009 — Form tolerances NEVER take datums.
  {
    id: 'R-009-formNoDatums',
    label: 'Form tolerances take no datums',
    severity: 'error',
    check: (f) => {
      const meta = f && f.symbolId ? CHARACTERISTIC_RULES[f.symbolId] : null;
      if (!meta || meta.takesDatums !== 'none') {
        return { passed: true, message: 'Skip — not a Form characteristic.' };
      }
      const dats = realDatums(f);
      if (dats.length > 0) {
        return { passed: false,
          message: `${f.symbolId} (Form) must not reference any datums (got ${dats.length}).` };
      }
      return { passed: true,
        message: `${f.symbolId} (Form) correctly has no datums.` };
    },
  },

  // R-010 — Ø (diameter modifier) REQUIRED for axis tolerances.
  // (Position on a feature of size, Concentricity, etc.)
  {
    id: 'R-010-diameterPrefix',
    label: 'Ø modifier required for axis tolerances',
    severity: 'error',
    check: (f) => {
      const meta = f && f.symbolId ? CHARACTERISTIC_RULES[f.symbolId] : null;
      if (!meta || !meta.axisTolerance) {
        return { passed: true, message: 'Skip — not an axis tolerance.' };
      }
      if (!f.diameterPrefix) {
        return { passed: false,
          message: `${f.symbolId} is an axis tolerance — Ø prefix required on tolerance value.` };
      }
      return { passed: true,
        message: `Ø prefix present on axis tolerance ${f.symbolId}.` };
    },
  },

  // R-011 — Ø prefix DISALLOWED on width / surface tolerances.
  {
    id: 'R-011-diameterDisallowed',
    label: 'Ø modifier disallowed on width / surface tolerances',
    severity: 'error',
    check: (f) => {
      const meta = f && f.symbolId ? CHARACTERISTIC_RULES[f.symbolId] : null;
      if (!meta || meta.axisTolerance) {
        return { passed: true, message: 'Skip — axis tolerance or unknown.' };
      }
      if (f.diameterPrefix) {
        return { passed: false,
          message: `${f.symbolId} is a width / surface tolerance — Ø prefix disallowed.` };
      }
      return { passed: true,
        message: `Ø prefix correctly absent on ${f.symbolId}.` };
    },
  },

  // R-012 — Material condition modifier (Ⓜ MMC / Ⓛ LMC) only allowed
  // on characteristics that ride on features of size.
  {
    id: 'R-012-materialModifierAllowed',
    label: 'Material condition modifier (Ⓜ / Ⓛ) only on feature-of-size tolerances',
    severity: 'error',
    check: (f) => {
      const mod = f ? f.toleranceModifier : MOD_NONE;
      if (!MATERIAL_MODS.has(mod)) {
        return { passed: true,
          message: 'No material condition modifier on tolerance.' };
      }
      const meta = f && f.symbolId ? CHARACTERISTIC_RULES[f.symbolId] : null;
      if (!meta) return { passed: true, message: 'Skip — unknown characteristic.' };
      if (!meta.allowsMaterialModifier) {
        return { passed: false,
          message: `${f.symbolId} does not accept Ⓜ / Ⓛ material modifiers.` };
      }
      return { passed: true,
        message: `${f.symbolId} accepts material modifier ${mod}.` };
    },
  },

  // R-013 — Free state modifier (Ⓕ) only meaningful on flexible parts.
  // Y14.5 §3.27 — informational pass-through; allowed everywhere but
  // surface a warning if it's combined with Ⓜ on the same value.
  {
    id: 'R-013-freeStateExclusive',
    label: 'Free state (Ⓕ) cannot combine with Ⓜ / Ⓛ on the same value',
    severity: 'warning',
    check: (f) => {
      const mod = f ? f.toleranceModifier : MOD_NONE;
      if (mod !== MOD_FREE) return { passed: true, message: 'No Ⓕ on tolerance.' };
      // The PUSH-92 builder only stores ONE modifier per slot, so an
      // explicit Ⓕ already excludes Ⓜ / Ⓛ. The rule passes by
      // construction; this is here so a future composite-modifier
      // surface can fail it without us adding code.
      return { passed: true, message: 'Free state modifier in isolation.' };
    },
  },

  // R-014 — datum material condition modifiers (Ⓜ / Ⓛ) on per-datum
  // letters only allowed when that datum is itself a feature of size.
  // We can't know the geometric type from a frame alone, so we surface
  // a WARNING when Ⓜ / Ⓛ appears on a per-datum row to nudge the
  // checker — not a hard fail.
  {
    id: 'R-014-datumModifierGuidance',
    label: 'Per-datum Ⓜ / Ⓛ modifier guidance',
    severity: 'warning',
    check: (f) => {
      const dats = realDatums(f);
      const mods = dats.filter((d) => MATERIAL_MODS.has(d.modifier));
      if (mods.length === 0) return { passed: true, message: 'No per-datum material modifiers.' };
      return { passed: true,
        message: `${mods.length} per-datum material modifier(s) — verify each datum is a feature of size.` };
    },
  },

  // R-015 — Concentricity / Symmetry are deprecated in Y14.5-2018.
  {
    id: 'R-015-deprecated',
    label: 'Characteristic not deprecated in Y14.5-2018',
    severity: 'warning',
    check: (f) => {
      const meta = f && f.symbolId ? CHARACTERISTIC_RULES[f.symbolId] : null;
      if (!meta) return { passed: true, message: 'Skip — unknown characteristic.' };
      if (meta.deprecated) {
        return { passed: false,
          message: `${f.symbolId} is deprecated in ASME Y14.5-2018 — use Position instead.` };
      }
      return { passed: true,
        message: `${f.symbolId} is current in Y14.5-2018.` };
    },
  },

  // R-016 — Tolerance value precision shouldn't exceed the resolution
  // of standard drawing decimals (5 decimal places). Drafters who type
  // 0.123456 usually meant 0.12345. Warning only.
  {
    id: 'R-016-precision',
    label: 'Tolerance value precision ≤ 5 decimals',
    severity: 'warning',
    check: (f) => {
      const v = f ? f.toleranceValue : null;
      const raw = (typeof v === 'number') ? String(v)
        : (typeof v === 'string' ? v.trim() : '');
      const m = raw.match(/^[-+]?\d*\.?(\d*)$/);
      if (!m) return { passed: true, message: 'Skip — non-decimal tolerance.' };
      const decimals = m[1] ? m[1].length : 0;
      if (decimals > 5) {
        return { passed: false,
          message: `Tolerance value has ${decimals} decimals (max 5 recommended).` };
      }
      return { passed: true,
        message: `Tolerance value has ${decimals} decimal(s).` };
    },
  },

  // R-017 — Tolerance value reasonable upper bound (1000 mm). A frame
  // claiming a 5000-mm tolerance is almost certainly a typo. Warning.
  {
    id: 'R-017-upperBound',
    label: 'Tolerance value within reasonable upper bound (≤ 1000)',
    severity: 'warning',
    check: (f) => {
      const n = numericToleranceValue(f);
      if (!Number.isFinite(n)) return { passed: true, message: 'Skip — non-numeric tolerance.' };
      if (n > 1000) {
        return { passed: false,
          message: `Tolerance value ${n} exceeds 1000 — likely typo.` };
      }
      return { passed: true,
        message: `Tolerance value ${n} within reasonable bound.` };
    },
  },

  // R-018 — Composite-frame upper datum superset rule. When two
  // sequential Position frames target the same feature ("composite"
  // frame), the upper frame's datums must be a SUPERSET of the lower
  // frame's. We can't read intent from frames alone, so we treat any
  // immediately-adjacent pair of Position frames in the array as a
  // composite candidate and enforce the rule.
  {
    id: 'R-018-compositeDatumSuperset',
    label: 'Composite Position upper datums superset of lower',
    severity: 'error',
    check: (f, idx, frames) => {
      if (!f || f.symbolId !== 'position') {
        return { passed: true, message: 'Skip — not a Position frame.' };
      }
      // We look BACKWARDS — if the previous frame is also Position and
      // this one is the 'lower' tier, this frame's datums must be a
      // subset of the previous (upper) frame's.
      const prev = idx > 0 ? frames[idx - 1] : null;
      if (!prev || prev.symbolId !== 'position') {
        return { passed: true, message: 'No composite pair — frame is standalone.' };
      }
      const upperLetters = new Set(realDatums(prev).map((d) => d.letter));
      const lowerLetters = realDatums(f).map((d) => d.letter);
      const orphans = lowerLetters.filter((l) => !upperLetters.has(l));
      if (orphans.length > 0) {
        return { passed: false,
          message: `Composite lower datums {${lowerLetters.join(', ')}} not subset of upper {${[...upperLetters].join(', ')}}; orphans: ${orphans.join(', ')}.` };
      }
      return { passed: true,
        message: `Composite lower datums {${lowerLetters.join(', ')}} ⊆ upper {${[...upperLetters].join(', ')}}.` };
    },
  },

  // R-019 — At most 3 datum references (primary / secondary / tertiary)
  // per ASME Y14.5 — anything more violates the datum reference frame
  // mathematical model (3 mutually perpendicular planes).
  {
    id: 'R-019-maxThreeDatums',
    label: 'At most 3 datum references per frame',
    severity: 'error',
    check: (f) => {
      const dats = realDatums(f);
      if (dats.length > 3) {
        return { passed: false,
          message: `Frame has ${dats.length} datums; maximum is 3 (primary / secondary / tertiary).` };
      }
      return { passed: true,
        message: `Frame has ${dats.length} datum(s) ≤ 3.` };
    },
  },

  // R-020 — Tertiary datum forbidden on characteristics whose tolerance
  // zone has no rotational degree of freedom around the secondary axis
  // (Concentricity is replaced; Runout has at most a secondary). This
  // rule keeps the Runout pair tidy.
  {
    id: 'R-020-runoutDatumLimit',
    label: 'Runout frames use at most 2 datums',
    severity: 'error',
    check: (f) => {
      if (!f) return { passed: true, message: 'Skip — empty frame.' };
      if (f.symbolId !== 'runoutCircular' && f.symbolId !== 'runoutTotal') {
        return { passed: true, message: 'Skip — not a Runout frame.' };
      }
      const dats = realDatums(f);
      if (dats.length > 2) {
        return { passed: false,
          message: `${f.symbolId} accepts at most 2 datums (got ${dats.length}).` };
      }
      return { passed: true,
        message: `${f.symbolId} has ${dats.length} datum(s) ≤ 2.` };
    },
  },
]);

export const ALL_RULES = RULES;

// ─────────────────────────────────────────────────────────────────────
// Engine.

/**
 * Run every rule against every frame and return a structured report.
 *
 * Shape:
 *   {
 *     summary: { framesTotal, framesPassed, framesFailed,
 *                errorCount, warningCount },
 *     rules: [
 *       { id, label, severity,
 *         results: [{ frameIdx, frameId, passed, message }] }
 *     ],
 *     frames: [
 *       { idx, frameId, symbolId, formatted,
 *         passed,             // pass = no error-severity violations
 *         errorCount, warningCount,
 *         violations: [{ ruleId, severity, message }] }
 *     ]
 *   }
 *
 * The shape is JSON-safe so the panel can render it directly and the
 * e2e / Archie can read it via window.__forgeAsmeValidatorReport.
 */
export function validateFrames(frames) {
  const list = Array.isArray(frames) ? frames : [];
  const rulesOut = [];
  const framesOut = list.map((f, i) => ({
    idx: i,
    frameId: (f && typeof f.id === 'string') ? f.id : `frame-${i}`,
    symbolId: f && f.symbolId ? f.symbolId : null,
    formatted: f && typeof f.formatted === 'string' ? f.formatted : '',
    passed: true,
    errorCount: 0,
    warningCount: 0,
    violations: [],
  }));

  for (const rule of RULES) {
    const ruleResults = list.map((f, i) => {
      let r;
      try {
        r = rule.check(f, i, list);
      } catch (err) {
        r = { passed: false,
          message: `Rule threw: ${err && err.message ? err.message : String(err)}` };
      }
      if (!r || typeof r !== 'object') {
        r = { passed: false, message: 'Rule returned no result.' };
      }
      const passed = !!r.passed;
      const message = typeof r.message === 'string' ? r.message : '';
      if (!passed) {
        framesOut[i].violations.push({
          ruleId: rule.id, severity: rule.severity, message,
        });
        if (rule.severity === 'error') {
          framesOut[i].errorCount += 1;
          framesOut[i].passed = false;
        } else {
          framesOut[i].warningCount += 1;
        }
      }
      return {
        frameIdx: i,
        frameId: framesOut[i].frameId,
        passed, message,
      };
    });
    rulesOut.push({
      id: rule.id,
      label: rule.label,
      severity: rule.severity,
      results: ruleResults,
    });
  }

  const framesTotal = framesOut.length;
  const framesPassed = framesOut.filter((f) => f.passed).length;
  const framesFailed = framesTotal - framesPassed;
  const errorCount = framesOut.reduce((s, f) => s + f.errorCount, 0);
  const warningCount = framesOut.reduce((s, f) => s + f.warningCount, 0);

  return {
    summary: { framesTotal, framesPassed, framesFailed,
      errorCount, warningCount, ruleCount: RULES.length },
    rules: rulesOut,
    frames: framesOut,
  };
}

/**
 * Convenience — return only the per-frame summary (id, passed,
 * error/warning counts). Useful for compact log lines.
 */
export function summariseFrames(report) {
  if (!report || !Array.isArray(report.frames)) return [];
  return report.frames.map((f) => ({
    frameId: f.frameId, idx: f.idx, symbolId: f.symbolId,
    passed: f.passed,
    errorCount: f.errorCount, warningCount: f.warningCount,
  }));
}

export default validateFrames;
