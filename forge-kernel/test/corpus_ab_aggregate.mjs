#!/usr/bin/env node
// corpus_ab_aggregate.mjs — turn a corpus_ab_coverage JSONL into the per-family
// coverage table that the drop options' flip gate is written against.
//
// The gate, quoted from forge-kernel/CMakeLists.txt:432/:475/:555 (which quote
// reports/TKOFFSET_DECOMPOSITION.md §5 step 6):
//
//     "native success rate >= the measured OCCT baseline"
//
// PER FAMILY, NEVER AGGREGATED. Each drop option is flipped on its own, so an
// aggregate rate would let a family with wide coverage pay for one with none —
// which is exactly the capability deletion the gate exists to prevent.
//
// WHAT IS REPORTED, and why each column is there:
//   N            applicable parts. NOT_APPLICABLE parts are excluded and
//                counted separately: a rate over an unstated denominator is
//                not a measurement.
//   both         both engines produced a result the call site would accept
//   nat only     native built where OCCT did not          (a capability ADD)
//   OCCT only    OCCT built where native declined         <- THE DELETION
//   neither      neither built (says nothing about either engine)
//   nat %, occt % (both + own-only) / N
//   delta        native % - occt %, with a 95% CI. A difference without an
//                interval is not a result, and these samples are small.
//   McNemar p    exact two-sided binomial test on the DISCORDANT pairs only —
//                the correct test for paired binary outcomes. The concordant
//                pairs carry no information about which engine is better and
//                including them (a two-proportion z) would understate the
//                uncertainty.
//   verdict      PASS iff ALL FOUR terms below hold. See "THE VERDICT" .
//                UNDERPOWERED is printed alongside when the CI straddles zero:
//                "not significantly worse" is not "not worse", and this repo
//                has already been burnt once by reading an underpowered
//                held-out set as an answer.
//
// Also reported per family: agreement inside the `both` bucket (a vector of
// observables, not volume alone) and the per-arm status histogram, so a family
// whose OCCT arm is mostly CRASH is not silently read as a native win.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE VERDICT — REPLACEABILITY, NOT COVERAGE.
//
// The gate used to be one line:
//
//     const pass = natOk >= occtOk;      // natOk = both + nat only
//                                        // occtOk = both + OCCT only
//
// which asks only WHETHER EACH ARM RETURNED A SHAPE. Three measured facts say
// that is not the question the drop options are actually asking:
//
//   H OFFSETSHAPE   native 24/600 vs OCCT 38/600 -> the gate says FAIL and sets
//                   the native arm a bar of 38. 33 OF THOSE 38 FAIL BRepCheck.
//                   The bar is mostly made of invalid solids.
//   G THICKSOLID    native 0/600 vs OCCT 133/600, and reports/corpus_ab/
//                   THICKSOLID_ATTRIBUTION.md §4 measures ALL 133 of OCCT's
//                   "successes" as INVALID, on a corpus whose 600 source solids
//                   are all valid; six have MORE volume than the body they
//                   hollowed.
//   E PIPE / F PIPESHELL
//                   both read 599/600 vs 600/600 — "one part from parity" — and
//                   AGREE ON 0 OF 599, at a constant volume ratio of
//                   2/(1+cos30) = 1.071797. Coverage parity with zero agreement
//                   is not equivalence; it is two different operations.
//
// So the verdict is now a CONJUNCTION of five terms. Every one of them is an
// ADDED REQUIREMENT: the original coverage line is term 1, kept verbatim and
// still binding, so no family can pass this gate that would not also have
// passed the old one. THE GATE CAN ONLY GET STRICTER HERE, NEVER LOOSER, and
// that direction is asserted mechanically by test/corpus_ab_gate_selftest.mjs.
//
//   1. coverage       natOk >= occtOk                      (UNCHANGED, verbatim)
//   2. validity       native OK-and-BRepCheck-valid >= OCCT OK-and-valid
//   3. agreement      of the parts where BOTH arms return a VALID shape, the
//                     number whose observable vectors DISAGREE must be 0
//   4. replaceability the deficit against the VALID bar must be 0 — every part
//                     where OCCT returns a valid shape is reproduced by a
//                     native shape that is itself valid AND agrees
//   5. sanity         the native arm returns no shape whose centre of mass is
//                     more than 1000x its own diagonal outside its own bbox —
//                     the wrong-code-path fingerprint, twice measured in this
//                     repo with the volume clean or exact
//
// THE VALID BAR IS REPORTED, NEVER SILENTLY SUBSTITUTED. Term 1 still measures
// the native arm against ALL of OCCT's answers, invalid ones included, because
// dropping the invalid ones from the bar would LOWER it and this change is not
// permitted to lower anything. The corrected bar (`occt_ok_valid`) and its
// deficit are printed BESIDE the coverage bar, per family, with the invalid
// count spelled out — so a reader can see that H's bar of 38 is really a bar of
// 5, and act on it as a separate, deliberate decision about the ledger rather
// than as a side effect of this aggregator.
//
// WHAT "AGREE" MEANS HERE. `agree_strict` from the harness: volume, area,
// centre of mass, all six bbox bounds, face/edge/vertex/shell/solid counts, AND
// the faces and edges binned by surface / curve kind. Volume alone has ratified
// a wrong solid four times in this repo. Counts alone are blind to a quadric
// replaced by a spline, which is exactly the substitution these engines make.
// A JSONL with no `agree_strict` field (produced before this change) falls back
// to `agree` — the strongest vector that run actually measured — and the
// fallback is COUNTED and PRINTED, never silent.
// ─────────────────────────────────────────────────────────────────────────────
//
// usage: node corpus_ab_aggregate.mjs <results.jsonl> [--json <out.json>] [--md <out.md>]

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('usage: corpus_ab_aggregate.mjs <results.jsonl> [--json out.json] [--md out.md]');
  process.exit(2);
}
const inPath = args[0];
let jsonOut = null, mdOut = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--json') jsonOut = args[++i];
  else if (args[i] === '--md') mdOut = args[++i];
}

const rows = [];
let malformed = 0;
for (const line of readFileSync(inPath, 'utf8').split('\n')) {
  const s = line.trim();
  if (!s || s.startsWith('#')) continue;
  try { rows.push(JSON.parse(s)); } catch { malformed++; }
}

// ── statistics ──────────────────────────────────────────────────────────────
function logChoose(n, k) {
  // log C(n,k) via lgamma, so a 600-row discordant count does not overflow.
  const lg = (x) => {
    // Lanczos approximation, plenty for the integer arguments used here.
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
               771.32342877765313, -176.61502916214059, 12.507343278686905,
               -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lg(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  };
  return lg(n + 1) - lg(k + 1) - lg(n - k + 1);
}

// Exact two-sided McNemar: b and c are the two discordant counts.
function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1.0;
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(n, i) + n * Math.log(0.5));
  return Math.min(1.0, 2 * tail);
}

// 95% CI for the paired difference in proportions (native - occt).
// d = (c - b)/N; Var(d) = ((b + c) - (b - c)^2 / N) / N^2  (the standard paired
// binary variance; the concordant cells contribute nothing to the difference).
function pairedCI(b, c, N) {
  if (N === 0) return [0, 0, 0];
  const d = (c - b) / N;
  const v = ((b + c) - ((b - c) * (b - c)) / N) / (N * N);
  const se = Math.sqrt(Math.max(0, v));
  return [d, d - 1.96 * se, d + 1.96 * se];
}

// Exact (Clopper-Pearson) one-sided 95% UPPER bound on a binomial proportion.
// A deficit of 0/7 and a deficit of 0/407 are both "0", and they are not the
// same statement: the first is consistent with a true deficit rate of 35%. Every
// zero this gate reports therefore carries the bound it was measured at. Solved
// by bisection on BinomCDF(k; n, p) = alpha, which is monotone in p.
function upperBound95(k, n) {
  if (n === 0) return 1;
  if (k >= n) return 1;
  const cdf = (p) => {
    let acc = 0;
    for (let i = 0; i <= k; i++) {
      acc += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log1p(-p));
    }
    return acc;
  };
  let lo = 0, hi = 1;
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (lo + hi);
    if (cdf(mid) > 0.05) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ── the wrong-code-path fingerprint ─────────────────────────────────────────
// A centre of mass of ~1e33 on a part 50 mm across has been a WRONG-CODE-PATH
// fingerprint in this repo twice (FeatureTreeCompiler's test-only setter: mass
// properties 85.2% low with COM 1e34; the separately-filed boss_on_plate defect:
// COM 2e33 with the volume EXACT). Both times the volume was clean, so a volume
// check could not see either.
//
// The centroid of any bounded set lies inside its convex hull. A returned shape
// whose COM is THIRTY ORDERS OF MAGNITUDE away from its own extent is not a
// marginal result, it is a broken one, and it is detectable from ONE arm without
// reference to the other. Computed from `com` and `bb`, which every row already
// carries, so it reads on runs made before the check existed.
//
// ★ THE THRESHOLD IS DELIBERATELY ENORMOUS, AND MEASURED RATHER THAN ASSUMED.
//   The first version of this check tested COM against the bbox with a 1e-3
//   tolerance, and it FIRED on 12 of 61 THICKEN rows and 1 of 45 FILLING rows on
//   the real corpus. Those are not wrong-code-path hits. `bb` is VERTEX-derived
//   (measure() says so, and deliberately, so that Bnd_Box's tolerance inflation
//   cannot blur a disagreement) — and a curved face bulges past its own vertex
//   hull. A full cylinder's only vertices lie on the seam, so its vertex bbox is
//   a LINE and its centroid is legitimately outside it. A term that reds a valid
//   cylinder is not a stricter gate, it is a wrong one.
//   So the gate term uses K = 1e3 diagonals — three orders clear of any curvature
//   bulge, and still ~28 orders inside the 1e33-on-a-50mm-part fingerprint. The
//   tight count is kept as REPORTING ONLY, under a name that says what it is.
const COM_FINGERPRINT_K = 1e3;
function comDistOutsideBBox(a) {
  if (!a || a.status !== 'OK' || !Array.isArray(a.com) || !Array.isArray(a.bb)) return null;
  if (a.com.length < 3 || a.bb.length < 6) return null;
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(a.com[i])) return Infinity;
    worst = Math.max(worst, a.bb[i] - a.com[i], a.com[i] - a.bb[i + 3], 0);
  }
  return worst;
}
function comScale(a) {
  const d = Math.hypot(a.bb[3] - a.bb[0], a.bb[4] - a.bb[1], a.bb[5] - a.bb[2]);
  return Number.isFinite(d) ? Math.max(1, d) : 1;
}
// THE GATE TERM: a centroid impossibly far from the shape it belongs to.
function comIsFingerprint(a) {
  const dist = comDistOutsideBBox(a);
  if (dist === null) return false;
  return dist > COM_FINGERPRINT_K * comScale(a);
}
// REPORTING ONLY: outside the vertex-derived bbox at all. Includes legitimate
// curvature bulge and must never be read as a defect count.
function comOutsideVertexBBox(a) {
  const dist = comDistOutsideBBox(a);
  if (dist === null) return false;
  return dist > 1e-3 * comScale(a);
}

// ── tally ───────────────────────────────────────────────────────────────────
const fams = new Map();
const errs = [];
for (const r of rows) {
  if (r.error) { errs.push(r); continue; }
  if (!r.family) continue;
  if (!fams.has(r.family)) {
    fams.set(r.family, {
      family: r.family, rows: 0, na: 0, naReasons: {},
      BOTH_OK: 0, NATIVE_ONLY: 0, OCCT_ONLY: 0, NEITHER: 0,
      agree: 0, agreeOrient: 0, disagree: 0,
      natStatus: {}, occtStatus: {},
      natValid: 0, occtValid: 0,
      occtOnlyParts: [],
      // ── the replaceability terms ──────────────────────────────────────────
      // Conditioned on the arm having RETURNED something (status OK), unlike
      // natValid/occtValid above which count valid===1 over every row. Both are
      // kept: the old pair is what earlier reports quote, the new pair is what
      // the verdict reads, and conflating them is how a bar moves by accident.
      natOkValid: 0, natOkInvalid: 0, natOkUnk: 0,
      occtOkValid: 0, occtOkInvalid: 0, occtOkUnk: 0,
      agreeStrict: 0, rowsMissingStrict: 0,
      // the VALID bar, decomposed by why each part is not replaced
      replaced: 0, defNativeAbsent: 0, defNativeInvalid: 0, defDisagree: 0,
      deficitParts: [], disagreeParts: [],
      natComOut: 0, occtComOut: 0, comOutParts: [],
      natComBulge: 0, occtComBulge: 0,
    });
  }
  const f = fams.get(r.family);
  f.rows++;
  if (!r.applicable) {
    f.na++;
    f.naReasons[r.na_reason || '?'] = (f.naReasons[r.na_reason || '?'] || 0) + 1;
    continue;
  }
  f[r.bucket] = (f[r.bucket] || 0) + 1;
  if (r.bucket === 'BOTH_OK') {
    if (r.agree) f.agree++; else f.disagree++;
    if (r.agree_upto_orientation) f.agreeOrient++;
  }
  if (r.bucket === 'OCCT_ONLY' && f.occtOnlyParts.length < 12) f.occtOnlyParts.push(r.part);
  const ns = r.native?.status || '?', os = r.occt?.status || '?';
  f.natStatus[ns] = (f.natStatus[ns] || 0) + 1;
  f.occtStatus[os] = (f.occtStatus[os] || 0) + 1;
  if (r.native?.valid === 1) f.natValid++;
  if (r.occt?.valid === 1) f.occtValid++;

  // ── the replaceability terms, per row ────────────────────────────────────
  const nOK = ns === 'OK', oOK = os === 'OK';
  // valid===1 is the only thing that counts as valid. valid===0 is INVALID and
  // valid===-1 means BRepCheck itself threw or never ran — an UNKNOWN, which is
  // not evidence of validity and is tallied in its own bin so it can never be
  // quietly rounded either way.
  const nV = r.native?.valid === 1, oV = r.occt?.valid === 1;
  if (nOK) { if (nV) f.natOkValid++; else if (r.native?.valid === 0) f.natOkInvalid++; else f.natOkUnk++; }
  if (oOK) { if (oV) f.occtOkValid++; else if (r.occt?.valid === 0) f.occtOkInvalid++; else f.occtOkUnk++; }

  // The wrong-code-path fingerprint, per arm, independent of the other.
  if (comIsFingerprint(r.native)) {
    f.natComOut++;
    if (f.comOutParts.length < 12) f.comOutParts.push(`${r.part}(native)`);
  }
  if (comIsFingerprint(r.occt)) {
    f.occtComOut++;
    if (f.comOutParts.length < 12) f.comOutParts.push(`${r.part}(occt)`);
  }
  // and the tight count, reporting only — curvature bulge lives in here too.
  if (comOutsideVertexBBox(r.native)) f.natComBulge++;
  if (comOutsideVertexBBox(r.occt)) f.occtComBulge++;

  // The agreement observable. `agree_strict` adds the surface/curve-kind
  // histograms to `agree`; a JSONL produced before the harness emitted it falls
  // back to `agree`, and every such row is counted so the fallback is visible.
  const hasStrict = r.agree_strict !== undefined;
  if (!hasStrict) f.rowsMissingStrict++;
  const ag = hasStrict ? !!r.agree_strict : !!r.agree;
  if (r.bucket === 'BOTH_OK' && ag) f.agreeStrict++;

  // THE VALID BAR: the parts where OCCT returned a shape that passes BRepCheck.
  // These are the only OCCT answers a caller could rely on, and they are what
  // the drop actually has to reproduce.
  if (oOK && oV) {
    if (!nOK) { f.defNativeAbsent++; if (f.deficitParts.length < 12) f.deficitParts.push(r.part); }
    else if (!nV) { f.defNativeInvalid++; if (f.deficitParts.length < 12) f.deficitParts.push(r.part); }
    else if (!ag) {
      f.defDisagree++;
      if (f.deficitParts.length < 12) f.deficitParts.push(r.part);
      if (f.disagreeParts.length < 12) f.disagreeParts.push(r.part);
    } else f.replaced++;
  }
}

const order = ['FILLET', 'MAKEOFFSET', 'THICKSOLID', 'OFFSETSHAPE', 'THRUSECTIONS',
               'PIPE', 'PIPESHELL', 'FILLING', 'THICKEN', 'DRAFT'];
const famList = [...fams.values()].sort(
  (a, b) => (order.indexOf(a.family) + 1000 * (order.indexOf(a.family) < 0)) -
            (order.indexOf(b.family) + 1000 * (order.indexOf(b.family) < 0)));

const OPTION = {
  FILLET:       'FORGE_FILLET_DROP_NATIVE',
  MAKEOFFSET:   'FORGE_OFFSET_DROP_MAKEOFFSET',
  THICKSOLID:   'FORGE_THICKSOLID_DROP_NATIVE',
  OFFSETSHAPE:  'FORGE_OFFSETSHAPE_DROP_NATIVE',
  THRUSECTIONS: 'FORGE_THRUSECTIONS_DROP_NATIVE',
  PIPE:         'FORGE_PIPE_DROP_NATIVE',
  PIPESHELL:    'FORGE_PIPESHELL_DROP_NATIVE',
  FILLING:      'FORGE_FILLING_DROP_NATIVE',
  THICKEN:      'FORGE_THICKEN_DROP_NATIVE',
  DRAFT:        'FORGE_DRAFT_DROP_NATIVE',
};

const summary = [];
for (const f of famList) {
  const N = f.BOTH_OK + f.NATIVE_ONLY + f.OCCT_ONLY + f.NEITHER;
  const natOk = f.BOTH_OK + f.NATIVE_ONLY;
  const occtOk = f.BOTH_OK + f.OCCT_ONLY;
  const [d, lo, hi] = pairedCI(f.OCCT_ONLY, f.NATIVE_ONLY, N);
  const p = mcnemarExact(f.OCCT_ONLY, f.NATIVE_ONLY);

  // ── THE FIVE TERMS ────────────────────────────────────────────────────────
  // Term 1 is the original gate line, unchanged and still binding. Terms 2-5
  // are ADDED, so `pass` here is a strict subset of the old `pass`: no family
  // can clear this gate that would not have cleared the old one.
  const termCoverage = natOk >= occtOk;                       // ← the original
  const termValidity = f.natOkValid >= f.occtOkValid;
  const termAgreement = f.defDisagree === 0;
  const bar = f.occtOkValid;                                  // the VALID bar
  const deficitValid = f.defNativeAbsent + f.defNativeInvalid + f.defDisagree;
  const termReplaceable = deficitValid === 0;
  // Term 5 constrains the NATIVE arm only. The OCCT count is reported beside it
  // but does NOT shrink the bar: shrinking it would be the one direction this
  // change is not allowed to move, and an OCCT answer with a broken centroid is
  // a fact about the incumbent that belongs in the report, not a discount.
  const termSanity = f.natComOut === 0;
  const pass = termCoverage && termValidity && termAgreement && termReplaceable && termSanity;
  const failed = [];
  if (!termCoverage) failed.push('coverage');
  if (!termValidity) failed.push('validity');
  if (!termAgreement) failed.push('agreement');
  if (!termReplaceable) failed.push('replaceability');
  if (!termSanity) failed.push('sanity');

  summary.push({
    family: f.family, option: OPTION[f.family] || '?',
    N, not_applicable: f.na, na_reasons: f.naReasons,
    both_ok: f.BOTH_OK, native_only: f.NATIVE_ONLY, occt_only: f.OCCT_ONLY, neither: f.NEITHER,
    native_rate: N ? natOk / N : 0, occt_rate: N ? occtOk / N : 0,
    delta: d, ci95: [lo, hi], mcnemar_p: p,
    verdict: N === 0 ? 'NO DATA' : (pass ? 'PASS' : 'FAIL'),
    failed_terms: failed,
    // Term 1 alone, kept as its own field so the BEFORE/AFTER of this change is
    // readable from a single summary.json without re-running anything: this is
    // exactly what the verdict used to be.
    coverage_only_verdict: N === 0 ? 'NO DATA' : (termCoverage ? 'PASS' : 'FAIL'),
    term_coverage: termCoverage, term_validity: termValidity,
    term_agreement: termAgreement, term_replaceable: termReplaceable,
    term_sanity: termSanity,
    native_com_fingerprint: f.natComOut, occt_com_fingerprint: f.occtComOut,
    com_fingerprint_k: COM_FINGERPRINT_K,
    // reporting only; includes legitimate curvature bulge past a VERTEX bbox
    native_com_outside_vertex_bbox: f.natComBulge,
    occt_com_outside_vertex_bbox: f.occtComBulge,
    com_fingerprint_examples: f.comOutParts,
    // The two bars, side by side, and never one instead of the other.
    occt_ok: occtOk, native_ok: natOk,
    occt_ok_valid: f.occtOkValid, occt_ok_invalid: f.occtOkInvalid,
    occt_ok_validity_unknown: f.occtOkUnk,
    native_ok_valid: f.natOkValid, native_ok_invalid: f.natOkInvalid,
    native_ok_validity_unknown: f.natOkUnk,
    valid_bar: bar, replaced: f.replaced, deficit_valid: deficitValid,
    deficit_native_absent: f.defNativeAbsent,
    deficit_native_invalid: f.defNativeInvalid,
    deficit_disagree: f.defDisagree,
    deficit_rate: bar ? deficitValid / bar : 0,
    // The bound is on the DEFICIT, which is the quantity in the column beside
    // it. Passing the complement here printed "100.0% (<= 4.7%)" — an upper
    // bound BELOW its own point estimate, which is the shape of this mistake.
    deficit_rate_upper95: upperBound95(deficitValid, bar),
    // Terms 2-4 are vacuously satisfied when OCCT has no valid answer to
    // reproduce AND the native arm returns nothing either. That is not evidence
    // of replaceability, it is an absence of evidence, and it is labelled.
    vacuous: bar === 0 && natOk === 0,
    both_ok_agree_strict: f.agreeStrict,
    rows_missing_agree_strict: f.rowsMissingStrict,
    agreement_observables: f.rowsMissingStrict > 0
      ? 'LEGACY (no agree_strict in this JSONL: volume/area/com/bbox/counts only)'
      : 'volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind',
    deficit_examples: f.deficitParts, disagree_examples: f.disagreeParts,
    // UNDERPOWERED means "the data cannot distinguish the two engines", which
    // requires there to BE discordant pairs whose split is uncertain. With zero
    // discordant pairs the CI is the degenerate [0,0] and the two engines agreed
    // on every single part -- that is the strongest possible tie, not a weak
    // one, and labelling it "underpowered" would misreport it.
    underpowered: N > 0 && (f.OCCT_ONLY + f.NATIVE_ONLY) > 0 && lo <= 0 && hi >= 0,
    discordant: f.OCCT_ONLY + f.NATIVE_ONLY,
    deficit_parts: f.OCCT_ONLY,
    both_ok_agree: f.agree, both_ok_agree_upto_orientation: f.agreeOrient,
    both_ok_disagree: f.disagree,
    native_status: f.natStatus, occt_status: f.occtStatus,
    native_valid: f.natValid, occt_valid: f.occtValid,
    occt_only_examples: f.occtOnlyParts,
  });
}

const parts = new Set(rows.filter((r) => r.part).map((r) => r.part));

const pct = (x) => (100 * x).toFixed(1).padStart(5) + '%';
const lines = [];
lines.push(`# Corpus A/B coverage — native vs OCCT, per dropped family`);
lines.push('');
lines.push(`parts: ${parts.size}   rows: ${rows.length}   part-level errors: ${errs.length}` +
           (malformed ? `   malformed lines: ${malformed}` : ''));
lines.push('');
lines.push('| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | **agree** | delta (95% CI) | McNemar p | coverage term | **verdict** |');
lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|---|');
for (const s of summary) {
  // AGREE, on the headline row and not only in the detail below it. The verdict
  // is a COVERAGE comparison — it asks whether each arm returned a shape and
  // never whether the two shapes are the same. Families E and F measured 99.8%
  // vs 100.0% ("one part from parity") while agreeing on ZERO of 599 parts,
  // because the native engine mitres the section through the spine corner and
  // OCCT's default BRepBuilderAPI_Transformed does not: the volume ratio is a
  // constant 2/(1+cos30) = 1.071797 on every part. A reader of the old table had
  // no way to see that from the row that carries the verdict.
  // NOTHING ABOUT THE VERDICT CHANGES HERE — this column is additive reporting.
  const agr = s.both_ok > 0
    ? `${s.both_ok_agree}/${s.both_ok} (${(100 * s.both_ok_agree / s.both_ok).toFixed(1)}%)`
    : '-';
  lines.push(`| ${s.family} | \`${s.option}\` | ${s.N} | ${s.both_ok} | ${s.native_only} | ` +
    `**${s.occt_only}** | ${s.neither} | ${pct(s.native_rate).trim()} | ${pct(s.occt_rate).trim()} | ` +
    `${agr} | ` +
    `${(100 * s.delta).toFixed(1)}% [${(100 * s.ci95[0]).toFixed(1)}, ${(100 * s.ci95[1]).toFixed(1)}] | ` +
    `${s.mcnemar_p < 1e-4 ? s.mcnemar_p.toExponential(1) : s.mcnemar_p.toFixed(4)} | ` +
    `${s.coverage_only_verdict} | ` +
    `${s.verdict}${s.failed_terms.length ? ' (' + s.failed_terms.join(', ') + ')' : ''}` +
    `${s.vacuous ? ' [VACUOUS: neither arm produced a valid shape]' : ''}` +
    `${s.underpowered && s.coverage_only_verdict === 'PASS' ? ' [coverage CI straddles 0]' : ''}` +
    `${s.coverage_only_verdict === 'PASS' && s.discordant === 0 ? ' [0 discordant pairs]' : ''} |`);
}
lines.push('');
lines.push('**OCCT only** is the capability the drop deletes: OCCT built a result the call site');
lines.push('would have accepted and the native engine declined, on the same input. Under the drop');
lines.push('option that decline becomes a thrown error at every one of those call sites.');
lines.push('');
lines.push('**agree** is how many of the `both` pairs match on the full observable vector');
lines.push('(volume, area, centre of mass, all six bbox bounds, face/edge/vertex/shell/solid');
lines.push('counts, and faces + edges binned by surface / curve kind). **THE VERDICT NOW READS IT.**');
lines.push('It did not use to: a family could be one part from a green coverage gate and still');
lines.push('return different geometry on every part it built — measured for E and F, which agree');
lines.push('on 0 of 599 while reading 99.8% vs 100.0%. A LOW agree COLUMN MEANS THE TWO ARMS ARE');
lines.push('COMPUTING DIFFERENT OPERATIONS, and a coverage number over two different operations is');
lines.push('not a statement about how close the drop is.');
lines.push('');
lines.push('**coverage term** is the verdict this gate used to print, and nothing else: `natOk >=');
lines.push('occtOk`. It is retained verbatim as term 1 of the conjunction, so **verdict** is a');
lines.push('strict subset of it — a family can never pass here that would not have passed before.');
lines.push('');
lines.push('## Replaceability — can the native arm actually stand in for OCCT?');
lines.push('');
lines.push('The coverage bar counts every OCCT answer, INCLUDING the ones that fail `BRepCheck`.');
lines.push('That is deliberate and it is not lowered here: term 1 still measures against it. What');
lines.push('this table adds is the bar a caller could actually rely on — OCCT answers that are');
lines.push('VALID — and the deficit against it, decomposed by why each part is not reproduced.');
lines.push('An OCCT answer that fails BRepCheck is shown as invalid rather than deleted, so the');
lines.push('difference between the two bars is visible instead of assumed.');
lines.push('');
lines.push('| family | OCCT ok | of which INVALID | **valid bar** | native ok | native ok+valid | replaced | **deficit** | native absent | native invalid | disagree | COM fingerprint nat/occt | deficit rate (95% upper) |');
lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
for (const s of summary) {
  lines.push(`| ${s.family} | ${s.occt_ok} | ${s.occt_ok_invalid}` +
    `${s.occt_ok_validity_unknown ? ' (+' + s.occt_ok_validity_unknown + ' unknown)' : ''} | ` +
    `**${s.valid_bar}** | ${s.native_ok} | ${s.native_ok_valid} | ${s.replaced} | ` +
    `**${s.deficit_valid}** | ${s.deficit_native_absent} | ${s.deficit_native_invalid} | ` +
    `${s.deficit_disagree} | ` +
    `${s.native_com_fingerprint}/${s.occt_com_fingerprint} | ` +
    `${(100 * s.deficit_rate).toFixed(1)}% (<= ${(100 * s.deficit_rate_upper95).toFixed(1)}%) |`);
}
lines.push('');
lines.push('**deficit** = valid bar - replaced. `replaced` requires all three of: the native arm');
lines.push('returned a shape, that shape passes BRepCheck, and it AGREES with OCCT on the full');
lines.push('observable vector. A deficit of 0 over a small bar is not the same statement as a');
lines.push('deficit of 0 over a large one, so every rate carries an exact one-sided 95% upper');
lines.push('bound: 0 of 7 is consistent with a true deficit rate of 35%.');
lines.push('');
lines.push('**COM fingerprint** counts answers whose centre of mass lies more than 1000x the');
lines.push("shape's own diagonal outside its own bounding box — the wrong-code-path signature");
lines.push('this repo has hit twice (COM 1e34 and 2e33 with the volume clean or exact). It is');
lines.push('term 5, and it constrains the NATIVE arm only; the OCCT count is reported beside it');
lines.push('and does not shrink the bar. The threshold is 1000x and not "outside the bbox"');
lines.push('because `bb` is VERTEX-derived, and a full cylinder\'s vertices lie on its seam, so');
lines.push('its vertex bbox is a LINE and its centroid is legitimately outside it. The tight');
lines.push('count is in the per-family detail, labelled as reporting only.');
if (summary.some((s) => s.rows_missing_agree_strict > 0)) {
  lines.push('');
  lines.push('> **This JSONL predates `agree_strict`.** The agreement term fell back to `agree`, which');
  lines.push('> compares volume, area, centre of mass, bbox and topology COUNTS but not surface or');
  lines.push('> curve KINDS. A quadric replaced by a spline of the same count is therefore scored as');
  lines.push('> agreement in this table. Re-run the harness to close that gap. Rows affected: ' +
             summary.map((s) => `${s.family}:${s.rows_missing_agree_strict}`)
                    .filter((x) => !x.endsWith(':0')).join(', ') + '.');
}
lines.push('');
lines.push('## Per-family detail');
for (const s of summary) {
  lines.push('');
  lines.push(`### ${s.family} — \`${s.option}\``);
  lines.push(`- applicable ${s.N}, not applicable ${s.not_applicable} ` +
             `(${Object.entries(s.na_reasons).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'})`);
  lines.push(`- native arm statuses: ${Object.entries(s.native_status).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  lines.push(`- OCCT arm statuses:   ${Object.entries(s.occt_status).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  lines.push(`- BRepCheck_Analyzer valid results: native ${s.native_valid}, OCCT ${s.occt_valid}`);
  lines.push(`- of the answers each arm RETURNED: native ${s.native_ok} ok ` +
             `(${s.native_ok_valid} valid, ${s.native_ok_invalid} invalid, ${s.native_ok_validity_unknown} unknown), ` +
             `OCCT ${s.occt_ok} ok ` +
             `(${s.occt_ok_valid} valid, ${s.occt_ok_invalid} invalid, ${s.occt_ok_validity_unknown} unknown)`);
  // TWO NUMBERS, NAMED. The first is the LOOSE vector `agree` — volume, area, com,
  // bbox and the topology COUNTS — kept because reports already in reports/corpus_ab/
  // quote it. The second is `agree_strict`, which adds the surface/curve KINDS and is
  // WHAT THE VERDICT READS. Printing only the first put a "407 agree" line directly
  // above an "agreement FAIL (407 disagree)" line and read as a contradiction; it was
  // two different vectors, and they are now labelled as such on both lines.
  lines.push(`- inside \`both\`: ${s.both_ok_agree} agree on the LOOSE vector ` +
             `(volume, area, com, bbox, f/e/v/shell/solid counts), ` +
             `${s.both_ok_agree_strict} on the STRICT vector the verdict reads (+ surface/curve kinds), ` +
             `${s.both_ok_agree_upto_orientation} agree up to solid orientation (|volume|), ` +
             `${s.both_ok_disagree} disagree on the loose vector`);
  if (s.both_ok_agree > s.both_ok_agree_strict)
    lines.push(`  - **${s.both_ok_agree - s.both_ok_agree_strict} pair(s) match on every scalar AND every ` +
               `count and are different B-Rep** — caught only by the kind histograms.`);
  lines.push(`- centre-of-mass wrong-code-path fingerprint (COM more than ` +
             `${s.com_fingerprint_k}x the shape's own diagonal outside its own bbox): ` +
             `native ${s.native_com_fingerprint}, OCCT ${s.occt_com_fingerprint}` +
             `${s.com_fingerprint_examples.length ? ' — ' + s.com_fingerprint_examples.join(', ') : ''}`);
  lines.push(`- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, ` +
             `which a curved face legitimately does: native ${s.native_com_outside_vertex_bbox}, ` +
             `OCCT ${s.occt_com_outside_vertex_bbox}`);
  lines.push(`- agreement observables: ${s.agreement_observables}` +
             `${s.rows_missing_agree_strict ? ` (${s.rows_missing_agree_strict} row(s) had no agree_strict)` : ''}`);
  lines.push(`- **terms**: coverage ${s.term_coverage ? 'PASS' : 'FAIL'} ` +
             `(${s.native_ok} >= ${s.occt_ok}), validity ${s.term_validity ? 'PASS' : 'FAIL'} ` +
             `(${s.native_ok_valid} >= ${s.occt_ok_valid}), agreement ${s.term_agreement ? 'PASS' : 'FAIL'} ` +
             `(${s.deficit_disagree} valid pair(s) disagree), replaceability ` +
             `${s.term_replaceable ? 'PASS' : 'FAIL'} (deficit ${s.deficit_valid} of a valid bar of ${s.valid_bar}), ` +
             `sanity ${s.term_sanity ? 'PASS' : 'FAIL'} (${s.native_com_fingerprint} native COM fingerprint(s))`);
  if (s.deficit_examples.length)
    lines.push(`- parts in the VALID deficit (first ${s.deficit_examples.length}): ${s.deficit_examples.join(', ')}`);
  if (s.disagree_examples.length)
    lines.push(`- parts where both arms are VALID and the shapes DIFFER (first ${s.disagree_examples.length}): ${s.disagree_examples.join(', ')}`);
  if (s.occt_only_examples.length)
    lines.push(`- parts in the deletion bucket (first ${s.occt_only_examples.length}): ${s.occt_only_examples.join(', ')}`);
}
if (errs.length) {
  lines.push('');
  lines.push('## Part-level errors');
  const byErr = {};
  for (const e of errs) byErr[e.error] = (byErr[e.error] || 0) + 1;
  for (const [k, v] of Object.entries(byErr)) lines.push(`- ${k}: ${v}`);
}

const md = lines.join('\n') + '\n';
process.stdout.write(md);
if (mdOut) writeFileSync(mdOut, md);
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    generated_from: inPath,
    parts: parts.size, rows: rows.length, part_errors: errs.length, malformed,
    families: summary,
  }, null, 2) + '\n');
}
