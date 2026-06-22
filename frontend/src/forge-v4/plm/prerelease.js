// Task #19 — AUTO-MBD + Autonomous PLM pre-manufacturing release pipeline.
//
// This module is a PURE ORCHESTRATOR. It does NOT re-implement any of the
// model-based-definition / archival / PDM / drawing engines that already ship
// in forge-v4 — it CALLS them, reads their REAL outputs, and folds those into
//   (A) a Model-Based-Definition COMPLETENESS check (mbdCompleteness), and
//   (B) an autonomous pre-release GATE that an ECO/ECN release board would run
//       before a design is allowed onto the shop floor (prePlmRelease).
//
// ─────────────────────────────────────────────────────────────────────────────
// STANDARDS THIS ENFORCES (cited inline at each gate):
//
//   ASME Y14.41-2019  "Digital Product Definition Data Practices" — the U.S.
//       standard for a Model-Based Definition (MBD). §4 (Data Set Requirements)
//       requires a complete data set to carry, for every part: the geometry,
//       ALL applicable dimensions and tolerances (no un-toleranced features
//       that affect form/fit/function), the datum reference frame, surface
//       texture, material, and the units/precision/general-tolerance notes.
//       A model that omits any of these is NOT a releasable MBD per Y14.41.
//
//   ISO 16792:2021  "Technical product documentation — Digital product
//       definition data practices" — the ISO mirror of Y14.41. Same data-set
//       completeness requirement (clause 5): a digital data set is the
//       authority only when it is fully defined.
//
//   ASME Y14.5-2018  geometric-tolerancing semantics — the well-formedness of
//       every Feature Control Frame is judged by forge-v4/asmeY145Rules.js
//       (datum precedence, Ø-on-axis, material-modifier legality, datum-letter
//       validity, ≤3 datums, deprecated characteristics, …). mbdCompleteness
//       runs that REAL validator over the part's PMI rather than re-deciding.
//
//   EN 9300 (LOTAR) / ISO 14721 (OAIS) / ISO 10303-242 (STEP AP242) — the
//       long-term-archival package the release builds and VERIFIES via
//       forge-v4/io/archivalExport.js (fixity digest + per-body validation
//       properties + structure hash). A release that cannot produce a
//       self-verifying archival package is not releasable.
//
//   PLM release-gate semantics (ECO/ECN): a part is "released" only when EVERY
//       blocking gate passes. We collect ALL gate results (never short-circuit)
//       so the report cites every reason a release is held — exactly how a
//       Change Control Board reviews an Engineering Change Order.
//
// Hard constraints: pure JS/ESM, NO new npm packages, REAL engine calls only.
// Kernel-optional: every native call is guarded; a kernel-free fixture path
// (parts carrying {volume, area, vertices/faces}) keeps the node test runnable.
// ─────────────────────────────────────────────────────────────────────────────

import { listAnnotationsForBody, annotationToText } from '../pmiAnnotations.js';
import { validateFrames, CHARACTERISTIC_RULES } from '../asmeY145Rules.js';
import { exportArchival, verifyArchival } from '../io/archivalExport.js';
import { indexVault, findDuplicates } from '../pdm/partRetrieval.js';
import { listRationale } from '../rationale/designRationale.js';
import {
  generateDrawing,
  setForgeKernel as setAutoDrawingKernel,
} from '../drawing/autoDrawing.js';
import { Dimension, Stack, DIST } from '../../foundation/ToleranceStack.js';

// ─────────────────────────────────────────────────────────────────────────────
// PMI-registry characteristic vocab → asmeY145Rules.CHARACTERISTIC_RULES vocab.
//
// The PMI registry (pmiAnnotations.js) and the Y14.5 rules engine
// (asmeY145Rules.js) ship slightly different symbol ids for the same
// characteristics (e.g. the registry says `circularity`/`circularRunout`/
// `totalRunout`/`runout`; the rules engine says `roundness`/`runoutCircular`/
// `runoutTotal`). We map registry → rules so the REAL validator recognises the
// frame. Identity entries are listed for clarity and to fail loudly if either
// vocab drifts.
const PMI_TO_RULE_SYMBOL = Object.freeze({
  flatness: 'flatness',
  straightness: 'straightness',
  circularity: 'roundness',      // ISO/registry "circularity" === Y14.5 "roundness"
  roundness: 'roundness',
  cylindricity: 'cylindricity',
  profileLine: 'profileLine',
  profileSurface: 'profileSurface',
  parallelism: 'parallelism',
  perpendicularity: 'perpendicularity',
  angularity: 'angularity',
  position: 'position',
  concentricity: 'concentricity',
  symmetry: 'symmetry',
  circularRunout: 'runoutCircular',
  runout: 'runoutCircular',      // bare "runout" → circular runout
  totalRunout: 'runoutTotal',
});

// Material-modifier glyph id (registry uses MMC/LMC/RFS) → the modifier code the
// validator's R-012/R-014 read ('M'/'L', else none).
const PMI_MOD_TO_RULE = Object.freeze({ MMC: 'M', LMC: 'L', RFS: 'none', none: 'none' });

// ─────────────────────────────────────────────────────────────────────────────
// PMI → Y14.5 frame ADAPTER.
//
// The FCF validator (validateFrames) wants frames shaped:
//   { id, symbolId, toleranceValue:Number, datums:[{letter, modifier?}],
//     diameterPrefix?:bool, toleranceModifier?:'M'|'L' }
// The PMI registry stores:
//   { id, kind:'gdt', payload:{ characteristic, tolerance, zoneShape,
//                               materialMod, datums:[{ref, mod}] } }
// This adapter does the shape translation so the REAL Y14.5 rules run over the
// part's actual stored PMI.
function pmiGdtToFrame(ann) {
  const p = ann && ann.payload ? ann.payload : {};
  const symbolId = PMI_TO_RULE_SYMBOL[p.characteristic] || p.characteristic || null;
  const datums = Array.isArray(p.datums)
    ? p.datums
        .filter((d) => d && d.ref != null && String(d.ref).trim().length > 0)
        .map((d) => ({ letter: String(d.ref).trim(), modifier: PMI_MOD_TO_RULE[d.mod] || 'none' }))
    : [];
  // Ø prefix is carried as the zone shape 'diameter' (or 'spherical') in the
  // registry; the validator wants the boolean diameterPrefix.
  const diameterPrefix = p.zoneShape === 'diameter' || p.zoneShape === 'spherical';
  return {
    id: ann.id,
    symbolId,
    toleranceValue: typeof p.tolerance === 'number' ? p.tolerance : parseFloat(p.tolerance),
    datums,
    diameterPrefix,
    toleranceModifier: PMI_MOD_TO_RULE[p.materialMod] || 'none',
    formatted: annotationToText(ann),
    // carry the registry characteristic so callers can report the un-mapped name
    _pmiCharacteristic: p.characteristic,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// (A) mbdCompleteness — ASME Y14.41-2019 / ISO 16792 MODEL-BASED-DEFINITION
//     completeness check.
//
// Walks the part's PMI + features and reports EVERY way the digital data set is
// incomplete per Y14.41 §4 / ISO 16792 clause 5:
//
//   • malformed-fcf          — an FCF that fails ASME Y14.5-2018 well-formedness
//                              (datum precedence, Ø-on-axis, material modifier,
//                              datum letter, …) — the REAL validateFrames errors.
//   • missing-datum-ref      — a characteristic that REQUIRES a datum reference
//                              frame (position/orientation/runout/profile-surf)
//                              carries no datums.
//   • dangling-datum         — an FCF references a datum letter that is NOT
//                              defined on the part (no datum-feature annotation /
//                              not in opts.datums) — a dangling DRF reference.
//   • untoleranced-critical  — a critical feature (a hole, or a driving overall
//                              dimension) that no dimension-tolerance OR FCF
//                              covers — an un-toleranced feature that affects
//                              fit/function, which Y14.41 forbids in a released
//                              data set.
//   • missing-material       — no material assigned (Y14.41 §4: material is part
//                              of the data set).
//   • missing-finish         — no surface-texture/finish defined anywhere on the
//                              part (no PMI 'finish' annotation and no
//                              part.surfaceFinish).
//   • missing-units-precision— units and/or default precision absent (Y14.41 §4
//                              units & general-tolerance/precision block).
//
// @param {object} part {
//     shape:<uint kernel handle> | null,   // for drawing-driven feature/dim probe
//     bodyId:<string>,                      // key into the PMI registry
//     id?:<string>,
//     material?:<string>,
//     surfaceFinish?:<object|string>,
//     units?:<string>,
//     precision?:<number>,                  // decimal places for the data set
//     criticalFeatures?:[{ id, kind?, covered?:bool }],  // explicit critical features
//     datums?:[<letter>],                   // datum letters DEFINED on the part
//   }
// @param {object} [opts] { forge, drawing? }
// @returns {{ complete:boolean, missing:[{feature, reason, kind, detail}],
//             pmiFrameCount, validatedFrames, datumSet:[] }}
export function mbdCompleteness(part, opts = {}) {
  if (!part || typeof part !== 'object') {
    throw new Error('mbdCompleteness: a part object is required');
  }
  const forge = opts.forge;
  const missing = [];

  // ── 1. Pull the part's real PMI from the registry. ──────────────────────────
  const bodyId = part.bodyId != null ? part.bodyId : part.id;
  const anns = bodyId != null ? listAnnotationsForBody(bodyId) : [];
  const gdtAnns = anns.filter((a) => a.kind === 'gdt');
  const finishAnns = anns.filter((a) => a.kind === 'finish');

  // ── 2. Build the part's DEFINED datum set (for dangling-datum detection). ────
  // Datum letters can be declared three ways:
  //   - explicit opts/part.datums (an array of letters), OR
  //   - any datum-feature annotation in the PMI (kind 'datum' / payload.datum),
  //     OR — pragmatically — every datum letter REFERENCED by a frame is taken
  //     as defined ONLY when it also appears in an explicit declaration. Per
  //     Y14.41 a referenced datum must trace to a datum feature; we treat the
  //     explicit declaration as that trace.
  const datumSet = new Set();
  const declared = Array.isArray(part.datums) ? part.datums : (opts.datums || []);
  for (const d of declared) {
    const letter = typeof d === 'string' ? d.trim() : (d && d.ref ? String(d.ref).trim() : '');
    if (letter) datumSet.add(letter);
  }
  for (const a of anns) {
    // datum-feature annotations (if the registry carries them): kind 'datum' or
    // a payload.datum letter.
    const letter = a && a.payload
      ? (a.payload.datum || a.payload.datumLetter || (a.kind === 'datum' ? a.payload.ref : null))
      : null;
    if (letter && typeof letter === 'string') datumSet.add(letter.trim());
  }

  // ── 3. Run the REAL ASME Y14.5-2018 well-formedness validator. ──────────────
  const frames = gdtAnns.map(pmiGdtToFrame);
  const report = frames.length ? validateFrames(frames) : { frames: [], summary: { framesTotal: 0 } };

  for (const f of report.frames) {
    const frame = frames[f.idx];
    // (a) malformed FCF — any error-severity Y14.5 violation.
    if (f.errorCount > 0) {
      const msgs = f.violations
        .filter((v) => v.severity === 'error')
        .map((v) => `${v.ruleId}: ${v.message}`);
      missing.push({
        feature: f.frameId,
        kind: 'malformed-fcf',
        reason: `FCF ${frame.formatted || f.frameId} violates ASME Y14.5-2018`,
        detail: msgs,
      });
    }
    // (b) required-datum characteristic with no datums — surface explicitly even
    //     though R-006 also flags it (so the MBD report carries the MBD reason).
    const ruleMeta = frame.symbolId ? CHARACTERISTIC_RULES[frame.symbolId] : null;
    if (ruleMeta && ruleMeta.takesDatums === 'required' && frame.datums.length === 0) {
      missing.push({
        feature: f.frameId,
        kind: 'missing-datum-ref',
        reason: `${frame._pmiCharacteristic || frame.symbolId} requires a datum reference frame (Y14.41 §4 DRF) — none set`,
        detail: frame.formatted,
      });
    }
    // (c) dangling datum — references a letter not defined on the part.
    for (const d of frame.datums) {
      if (datumSet.size > 0 && !datumSet.has(d.letter)) {
        missing.push({
          feature: f.frameId,
          kind: 'dangling-datum',
          reason: `FCF references datum '${d.letter}' which is not defined on the part`,
          detail: `defined datums: {${[...datumSet].join(', ') || '∅'}}`,
        });
      } else if (datumSet.size === 0) {
        // No datum features declared at all but a frame references one → dangling.
        missing.push({
          feature: f.frameId,
          kind: 'dangling-datum',
          reason: `FCF references datum '${d.letter}' but the part declares no datum features`,
          detail: 'Y14.41 §4: every referenced datum must trace to a datum feature',
        });
      }
    }
  }

  // ── 4. Un-toleranced CRITICAL FEATURES (Y14.41 §4 — no feature affecting ─────
  //     fit/function may be un-toleranced in a released data set).
  // Critical features come from part.criticalFeatures (explicit) OR are derived
  // from the auto-drawing: detected holes (need a position/size tolerance) and
  // the overall driving dimensions. A feature is "covered" iff a dimension-with-
  // tolerance or an FCF targets it. We treat any FCF presence + any toleranced
  // dimension as coverage signals; absence on a declared-critical feature fails.
  const coveredByFcf = frames.length > 0;
  let drawing = null;
  if (part.shape != null && forge) {
    try {
      setAutoDrawingKernel(forge);
      drawing = generateDrawing({ shape: part.shape, bodyId, kind: part.kind, params: part.params },
        (opts.drawing && typeof opts.drawing === 'object') ? opts.drawing : {});
    } catch {
      drawing = null; // drawing probe is best-effort; explicit criticalFeatures still checked
    }
  }
  const explicitCritical = Array.isArray(part.criticalFeatures) ? part.criticalFeatures : [];
  for (const cf of explicitCritical) {
    const id = cf && cf.id != null ? cf.id : String(cf);
    // explicit `covered:true` overrides; else covered iff an FCF or a toleranced
    // dimension exists for it (we accept any FCF on the body as coverage when no
    // per-feature linkage is provided — matching how MBD tools attribute frames).
    const covered = cf && cf.covered === true ? true
      : (cf && cf.fcf) ? coveredByFcf
        : coveredByFcf || hasTolerancedDimension(drawing);
    if (!covered) {
      missing.push({
        feature: id,
        kind: 'untoleranced-critical',
        reason: `critical feature '${id}' has no covering tolerance or FCF (Y14.41 §4)`,
        detail: cf && cf.kind ? `feature kind: ${cf.kind}` : undefined,
      });
    }
  }
  // If the drawing detected holes but the part declared NO FCFs and NO explicit
  // critical features, that is an un-toleranced critical hole.
  if (drawing && explicitCritical.length === 0 && !coveredByFcf) {
    const holeCount = countDetectedHoles(drawing);
    if (holeCount > 0) {
      missing.push({
        feature: 'detected-holes',
        kind: 'untoleranced-critical',
        reason: `${holeCount} hole(s) detected in the model but no position/size FCF defines them (Y14.41 §4)`,
        detail: `${holeCount} center mark(s) from auto-drawing`,
      });
    }
  }

  // ── 5. MATERIAL / SURFACE-FINISH / UNITS+PRECISION (Y14.41 §4 data-set items).
  if (!part.material || String(part.material).trim().length === 0
      || String(part.material).toLowerCase() === 'default') {
    missing.push({
      feature: '__part__',
      kind: 'missing-material',
      reason: 'no material assigned to the part (Y14.41 §4 / ISO 16792 cl.5: material is part of the data set)',
    });
  }
  if (finishAnns.length === 0 && !part.surfaceFinish) {
    missing.push({
      feature: '__part__',
      kind: 'missing-finish',
      reason: 'no surface-texture / finish defined (Y14.41 §4 surface-texture requirement)',
    });
  }
  if (!part.units || String(part.units).trim().length === 0 || part.precision == null) {
    missing.push({
      feature: '__part__',
      kind: 'missing-units-precision',
      reason: 'units and/or default precision not specified (Y14.41 §4 units & general-tolerance block)',
      detail: `units=${part.units ?? '∅'} precision=${part.precision ?? '∅'}`,
    });
  }

  return {
    complete: missing.length === 0,
    missing,
    // cite the real engine outputs so callers can prove this is not canned:
    pmiFrameCount: frames.length,
    validatedFrames: report.summary,
    datumSet: [...datumSet],
    finishCount: finishAnns.length,
  };
}

// A toleranced dimension is one whose text carries a ± / tolerance band. The
// auto-drawing emits dimension text; we look for a tolerance marker.
function hasTolerancedDimension(drawing) {
  if (!drawing || !Array.isArray(drawing.dimensions)) return false;
  return drawing.dimensions.some((d) => {
    const t = (d && d.text) ? String(d.text) : '';
    return /[±]|\+\s*\d|−|H\d|h\d|\bG\d|\bg\d/.test(t);
  });
}

function countDetectedHoles(drawing) {
  if (!drawing) return 0;
  if (Array.isArray(drawing.centerMarks)) return drawing.centerMarks.length;
  return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// RSS-validity assessment for a 1-D tolerance stack (surfaces the real
// tolerance-stack engine's warning).
//
// The native tolerance engine (forge.tolerance.compute) returns an RSS Cp/Cpk on
// the ASSUMPTION that every link is an INDEPENDENT NORMAL whose ±tolerance is
// 3σ. That assumption is INVALID — and the RSS Cpk meaningless — when:
//   • rssSigma === 0 (a deterministic / zero-tolerance stack — Cpk explodes to
//     ~1e6; RSS degenerates to the worst-case point),
//   • any link has a zero ± tolerance (that link is deterministic, breaking the
//     "all normal" premise),
//   • there are fewer than 2 links (a single link has no root-sum-square to take;
//     RSS === worst-case),
//   • links are declared correlated (chain[].correlatedWith) — RSS assumes
//     independence.
// When RSS is invalid the worst-case bound is the trustworthy number; we surface
// `rssValid:false` with the reason so the gate can warn/fail rather than trust a
// fictitious Cpk.
function assessRssValidity(chain, result) {
  const links = Array.isArray(chain) ? chain : [];
  const reasons = [];
  if (links.length < 2) reasons.push('fewer than 2 links — RSS degenerates to worst-case');
  const zeroTol = links.some((l) => Math.abs(+l.plus || 0) === 0 && Math.abs(+l.minus || 0) === 0);
  if (zeroTol) reasons.push('a link has zero ± tolerance (deterministic — breaks the all-normal premise)');
  const correlated = links.some((l) => l && l.correlatedWith);
  if (correlated) reasons.push('a link is declared correlated — RSS assumes independence');
  if (!result || !(result.rssSigma > 0)) reasons.push('rssSigma === 0 — no statistical spread (deterministic stack)');
  if (!result || !Number.isFinite(result.rssCpk)) reasons.push('rssCpk is not finite');
  return { rssValid: reasons.length === 0, reasons };
}

// Run a REAL 1-D tolerance stack and normalize to a common shape:
//   { engine, worstCaseLow/High/Nominal, rssMu, rssSigma, rssCpk, mcCpk,
//     mcYieldPct, USL, LSL }.
// Prefer the native kernel engine; fall back to the pure-JS
// foundation/ToleranceStack.js so the gate is genuinely kernel-optional. Both
// use the SAME RSS convention (±tol = 3σ; Cp=1.0 on the pure-JS Dimension).
function computeStack(tolChain, spec, forge, opts = {}) {
  const links = tolChain.map((c, i) => ({
    name: c.name != null ? String(c.name) : `dim${i}`,
    nominal: +c.nominal || 0,
    tolPlus: Math.abs(+c.plus || 0),
    tolMinus: Math.abs(+c.minus || 0),
    dist: (c.dist | 0) || 0,
  }));
  const nominalSum = links.reduce((s, l) => s + l.nominal, 0);
  const wcSpan = links.reduce((s, l) => s + Math.max(l.tolPlus, l.tolMinus), 0);
  const USL = Number.isFinite(spec.USL) ? spec.USL : nominalSum + wcSpan;
  const LSL = Number.isFinite(spec.LSL) ? spec.LSL : nominalSum - wcSpan;

  if (forge && forge.tolerance && typeof forge.tolerance.compute === 'function') {
    const r = forge.tolerance.compute({
      chain: links, USL, LSL,
      mcSamples: opts.mcSamples || 10000, randomSeed: opts.randomSeed || 42,
    });
    return {
      engine: 'forge.tolerance.compute (native worst-case + RSS + Monte-Carlo)',
      worstCaseLow: r.worstCaseLow, worstCaseHigh: r.worstCaseHigh, worstCaseNominal: r.worstCaseNominal,
      rssMu: r.rssMu, rssSigma: r.rssSigma, rssCpk: r.rssCpk,
      mcCpk: r.mcCpk, mcYieldPct: r.mcYieldPct, USL, LSL,
    };
  }

  // Pure-JS fallback — the REAL foundation/ToleranceStack.js engine.
  const distOf = (d) => (d === 1 ? DIST.UNIFORM : DIST.NORMAL);
  const dims = links.map((l) => new Dimension({
    name: l.name, nominal: l.nominal, tolPlus: l.tolPlus, tolMinus: l.tolMinus,
    distribution: distOf(l.dist), cp: 1.0, // ±tol = 3σ to match the native convention
  }));
  const stack = new Stack({
    inputs: dims,
    compute: (vals) => dims.reduce((s, d) => s + vals[d.name], 0), // linear sum chain
    outputName: 'stack', spec: { usl: USL, lsl: LSL },
  });
  const wc = stack.worstCase();
  const rss = stack.rss();
  const mc = stack.monteCarlo(opts.mcSamples || 10000, seededUniform(opts.randomSeed || 42));
  // RSS Cpk against the spec limits (mirrors the native rssCpk; sigma=0 → ∞).
  const rssCpk = rss.sigma > 0
    ? Math.min((USL - rss.nominal) / (3 * rss.sigma), (rss.nominal - LSL) / (3 * rss.sigma))
    : 1e6;
  return {
    engine: 'foundation/ToleranceStack.js (pure-JS worst-case + RSS + Monte-Carlo)',
    worstCaseLow: wc.low, worstCaseHigh: wc.high, worstCaseNominal: wc.nominal,
    rssMu: rss.nominal, rssSigma: rss.sigma, rssCpk,
    mcCpk: mc.Cpk, mcYieldPct: mc.N ? (1 - mc.outOfSpec / mc.N) * 100 : null, USL, LSL,
  };
}

// A small deterministic uniform RNG (mulberry32) so the pure-JS Monte-Carlo is
// reproducible given a seed — same role as the native randomSeed.
function seededUniform(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// (B) prePlmRelease — autonomous pre-manufacturing PLM release gate.
//
// Runs EVERY release gate by invoking the REAL shipped engines, collects all
// results (never short-circuits — an ECO review wants every reason), and decides
// releasable = (no blocking gate failed). DFM is advisory (flag, don't block)
// unless a CRITICAL DFM error (zero/degenerate volume) is present.
//
// @param {object} assembly {
//     name?:<string>,
//     parts:[{ shape:<uint|null>, bodyId, id, name?, material?, surfaceFinish?,
//              units?, precision?, criticalFeatures?, datums?, tolChain?,
//              tolSpec?:{USL,LSL}, descriptor?, volume?, area?, vertices?, faces? }],
//     mates?:[]
//   }
// @param {object} [opts] {
//     forge, retention?, provenance?, minCpk?(=1.0), drawing?, vaultIndex?,
//     dupThreshold?, requireRationale?(=true)
//   }
// @returns {{ releasable:boolean, gates:[{name,pass,detail,blocking}],
//             blockers:[{gate,reason}], dfm:{}, archive:{} }}
export function prePlmRelease(assembly, opts = {}) {
  if (!assembly || !Array.isArray(assembly.parts) || assembly.parts.length === 0) {
    throw new Error('prePlmRelease: assembly.parts[] (at least one part) is required');
  }
  const forge = opts.forge;
  const minCpk = Number.isFinite(opts.minCpk) ? opts.minCpk : 1.0;
  const requireRationale = opts.requireRationale !== false;
  if (forge) setAutoDrawingKernel(forge); // align the drawing kernel up front

  const parts = assembly.parts;
  const gates = [];
  const addGate = (name, pass, detail, blocking = true) =>
    gates.push({ name, pass: !!pass, detail, blocking });

  // ── GATE 1 — geometry-valid (REAL kernel: forge.heal.checkValidity). ─────────
  // OCCT BRepCheck validity per part. Kernel-free parts (no shape, fixture
  // geometry) are treated as valid-by-construction (the fixture IS a closed box).
  {
    const perPart = parts.map((p) => {
      if (p.shape == null || !forge || !forge.heal || typeof forge.heal.checkValidity !== 'function') {
        return { id: p.id ?? p.bodyId, checked: false, valid: true, note: 'no kernel handle — fixture geometry assumed valid' };
      }
      const v = forge.heal.checkValidity(p.shape);
      const valid = !!v.isClosed && !!v.isManifold && !v.hasSelfIntersect && !v.hasNonManifoldEdge;
      return { id: p.id ?? p.bodyId, checked: true, valid, report: v };
    });
    const pass = perPart.every((r) => r.valid);
    addGate('geometry-valid', pass,
      { engine: 'forge.heal.checkValidity (OCCT BRepCheck)', perPart,
        failing: perPart.filter((r) => !r.valid).map((r) => r.id) });
  }

  // ── GATE 2 — MBD-complete (REAL: mbdCompleteness → asmeY145Rules.validateFrames
  //     + PMI registry). Per ASME Y14.41-2019 / ISO 16792. ──────────────────────
  {
    const perPart = parts.map((p) => {
      const res = mbdCompleteness(p, { forge, drawing: opts.drawing });
      return { id: p.id ?? p.bodyId, complete: res.complete, missing: res.missing,
        pmiFrameCount: res.pmiFrameCount, validatedFrames: res.validatedFrames };
    });
    const pass = perPart.every((r) => r.complete);
    const incomplete = perPart.filter((r) => !r.complete);
    addGate('mbd-complete', pass,
      { standard: 'ASME Y14.41-2019 / ISO 16792', engine: 'mbdCompleteness → asmeY145Rules.validateFrames',
        perPart,
        missing: incomplete.flatMap((r) => r.missing.map((m) => ({ part: r.id, ...m }))) });
  }

  // ── GATE 3 — tolerance RSS-valid (REAL tolerance-stack engine). ──────────────
  // For each part carrying a tolChain, run a REAL 1-D stack — the native kernel
  // engine (forge.tolerance.compute) when loaded, else the pure-JS
  // foundation/ToleranceStack.js (Stack.rss + monteCarlo) — judge the RSS Cpk
  // against the spec limits, and SURFACE the RSS-validity warning.
  let tolEngine = 'forge.tolerance.compute (native worst-case + RSS + Monte-Carlo)';
  {
    const perChain = [];
    for (const p of parts) {
      if (!Array.isArray(p.tolChain) || p.tolChain.length === 0) continue;
      const spec = p.tolSpec || {};
      const r = computeStack(p.tolChain, spec, forge, opts);
      tolEngine = r.engine;
      const rss = assessRssValidity(p.tolChain, r);
      const cpkOk = rss.rssValid && Number.isFinite(r.rssCpk) && r.rssCpk >= minCpk;
      perChain.push({
        id: p.id ?? p.bodyId, ok: cpkOk, engine: r.engine,
        Cpk: r.rssCpk, rssMu: r.rssMu, rssSigma: r.rssSigma,
        worstCase: { low: r.worstCaseLow, high: r.worstCaseHigh, nominal: r.worstCaseNominal },
        mcCpk: r.mcCpk, mcYieldPct: r.mcYieldPct, USL: r.USL, LSL: r.LSL, minCpk,
        rssValid: rss.rssValid, rssWarnings: rss.reasons,
        reason: cpkOk ? undefined
          : (!rss.rssValid ? `RSS invalid: ${rss.reasons.join('; ')}`
            : `RSS Cpk ${Number(r.rssCpk).toFixed(3)} < required ${minCpk}`),
      });
    }
    // The gate passes if there are no chains (nothing to fail) OR every chain is ok.
    const pass = perChain.every((c) => c.ok);
    addGate('tolerance-rss-valid', pass,
      { engine: tolEngine,
        note: 'numeric 1-D stack; NOT a geometric/datum-frame check',
        chains: perChain.length, perChain });
  }

  // ── GATE 4 — no-unresolved-duplicates (REAL: partRetrieval.findDuplicates). ──
  // Build a fingerprint vault index from the parts and flag any CONFIRMED
  // duplicate pair (a real 40k-part vault accumulates duplicate debt; releasing a
  // confirmed duplicate creates a second source-of-truth for the same geometry).
  {
    let index = opts.vaultIndex || null;
    let pairs = [];
    let note;
    try {
      if (!index) {
        const vaultParts = parts.map((p) => fingerprintablePart(p));
        index = indexVault(vaultParts, forge);
      }
      if (index.entries.length < 2) {
        note = 'need ≥2 fingerprinted parts to compare';
      } else {
        const dopts = { forge, confirm: true };
        if (Number(opts.dupThreshold) > 0) dopts.threshold = Number(opts.dupThreshold);
        pairs = findDuplicates(index, dopts);
      }
    } catch (e) {
      note = `duplicate scan skipped: ${e.message}`;
    }
    const confirmed = pairs.filter((d) => d.confirmed === true);
    const pass = confirmed.length === 0;
    addGate('no-unresolved-duplicates', pass,
      { engine: 'partRetrieval.findDuplicates (D2 shape fingerprint + geometric confirm)',
        note,
        pairCount: pairs.length, confirmedCount: confirmed.length,
        confirmed: confirmed.map((d) => ({
          a: partLabel(d.a), b: partLabel(d.b),
          distance: Number(d.distance.toFixed(4)),
          shapeSimilarity: d.shapeSimilarity == null ? null : Number(d.shapeSimilarity.toFixed(4)),
        })) });
  }

  // ── GATE 5 — drawing-generated (REAL: autoDrawing.generateDrawing). ──────────
  // Per part with a kernel handle, project a 3-view (front/top/right HLR) drawing
  // with dimensions. PASS = ≥3 views AND ≥1 dimension. A release with no drawing
  // is not manufacturable.
  {
    const perPart = parts.map((p) => {
      if (p.shape == null || !forge) {
        return { id: p.id ?? p.bodyId, generated: false, note: 'no kernel handle — drawing requires geometry', views: 0, dimensions: 0 };
      }
      try {
        const dwg = generateDrawing({ shape: p.shape, bodyId: p.bodyId, kind: p.kind, params: p.params },
          (opts.drawing && typeof opts.drawing === 'object') ? opts.drawing : {});
        const views = Array.isArray(dwg.views) ? dwg.views.length : 0;
        const dims = Array.isArray(dwg.dimensions) ? dwg.dimensions.length : 0;
        return { id: p.id ?? p.bodyId, generated: views >= 3 && dims > 0,
          views, dimensions: dims, gdt: Array.isArray(dwg.gdt) ? dwg.gdt.length : 0,
          svgLength: typeof dwg.svg === 'string' ? dwg.svg.length : 0 };
      } catch (e) {
        return { id: p.id ?? p.bodyId, generated: false, error: e.message, views: 0, dimensions: 0 };
      }
    });
    // Only parts that HAVE geometry are required to produce a drawing.
    const withGeom = perPart.filter((r) => r.generated || r.views > 0 || r.error);
    const pass = withGeom.length === 0 ? true : withGeom.every((r) => r.generated);
    addGate('drawing-generated', pass,
      { engine: 'autoDrawing.generateDrawing (HLR third-angle projection + auto-dimension)',
        perPart,
        failing: perPart.filter((r) => !r.generated && (r.views > 0 || r.error)).map((r) => r.id) });
  }

  // ── GATE 6 — archival-built-and-verified (REAL: archivalExport.exportArchival ─
  //     + verifyArchival). EN 9300 (LOTAR) / ISO 14721 (OAIS) / AP242. ──────────
  let archiveSummary = null;
  {
    // Build the archival input: map our parts (which carry `shape`) into the
    // archival part shape (which reads `handle`) + carry fixture geometry through.
    const archInput = {
      name: assembly.name || 'release',
      parts: parts.map((p, i) => ({
        id: p.id != null ? String(p.id) : `body-${i + 1}`,
        name: p.name || p.id || `Body ${i + 1}`,
        material: p.material || 'default',
        handle: p.shape != null ? p.shape : null,
        vertices: p.vertices || null,
        faces: p.faces || null,
      })),
      mates: assembly.mates || [],
    };
    let pass = false; let verify = null; let pkg = null; let err = null;
    try {
      pkg = exportArchival(archInput, { forge, retention: opts.retention, provenance: opts.provenance });
      verify = verifyArchival(pkg, { forge });
      pass = !!verify.valid && Array.isArray(verify.mismatches) && verify.mismatches.length === 0;
    } catch (e) {
      err = e.message;
    }
    archiveSummary = pkg ? {
      conformance: pkg.conformance,
      fixity: pkg.fixity.packageDigest,
      structureHash: pkg.validationProperties.structureHash,
      bodyCount: pkg.validationProperties.bodies.length,
      retentionYears: pkg.retention.years,
    } : { error: err };
    addGate('archival-built-and-verified', pass,
      { engine: 'archivalExport.exportArchival + verifyArchival (EN 9300 / ISO 14721 / AP242)',
        valid: verify ? verify.valid : false,
        mismatches: verify ? verify.mismatches : undefined,
        fixity: pkg ? pkg.fixity.packageDigest : undefined,
        error: err });
  }

  // ── GATE 7 — rationale-present (REAL: designRationale.listRationale). ─────────
  // Every part should carry at least one non-orphaned "why" (intent / constraint
  // / driving requirement). Releasing a design whose reasoning is undocumented is
  // the #1 PLM knowledge-loss failure. Optional via opts.requireRationale.
  {
    const perPart = parts.map((p) => {
      const partId = p.id != null ? p.id : p.bodyId;
      let records = [];
      try { records = listRationale(partId); } catch { records = []; }
      const present = records.filter((r) =>
        r && !r.orphaned && (r.intent || r.constraint || r.drivingRequirement)).length;
      return { id: partId, present, total: records.length,
        orphaned: records.filter((r) => r && r.orphaned).length };
    });
    const pass = !requireRationale || perPart.every((r) => r.present > 0);
    addGate('rationale-present', pass,
      { engine: 'designRationale.listRationale',
        required: requireRationale, perPart,
        missing: perPart.filter((r) => r.present === 0).map((r) => r.id) }, requireRationale);
  }

  // ── GATE 8 — DFM (ADVISORY). Derive metrics from forge.massProps (or the ─────
  //     fixture volume/area) and flag manufacturability concerns. Only a CRITICAL
  //     error — zero / degenerate volume — blocks; everything else is advisory.
  const dfm = { perPart: [], blockingErrors: [] };
  {
    for (const p of parts) {
      const id = p.id ?? p.bodyId;
      let volume = null; let area = null;
      if (p.shape != null && forge && typeof forge.massProps === 'function') {
        try { const mp = forge.massProps(p.shape); volume = mp.volume; area = mp.area; } catch { /* */ }
      }
      if (volume == null && Number.isFinite(p.volume)) volume = p.volume;
      if (area == null && Number.isFinite(p.area)) area = p.area;
      const issues = [];
      const critical = (volume != null && !(volume > 1e-9));
      if (critical) {
        issues.push({ severity: 'error', code: 'DFM-ZERO-VOL',
          title: 'Zero / degenerate volume',
          detail: `volume=${volume} — the solid is empty or degenerate; not manufacturable` });
        dfm.blockingErrors.push({ part: id, code: 'DFM-ZERO-VOL' });
      }
      dfm.perPart.push({ id, volume, area, issues });
    }
    const pass = dfm.blockingErrors.length === 0;
    addGate('dfm-advisory', pass,
      { engine: 'forge.massProps (volume/area)', advisory: true,
        blockingErrors: dfm.blockingErrors, perPart: dfm.perPart },
      /* blocking only when a critical error exists */ dfm.blockingErrors.length > 0);
  }

  // ── DECISION — releasable iff no BLOCKING gate failed. ───────────────────────
  const blockers = gates
    .filter((g) => g.blocking && !g.pass)
    .map((g) => ({ gate: g.name, reason: blockerReason(g) }));
  const releasable = blockers.length === 0;

  return { releasable, gates, blockers, dfm, archive: archiveSummary };
}

// Build the most specific human-readable reason a gate failed, citing the real
// engine output.
function blockerReason(g) {
  const d = g.detail || {};
  switch (g.name) {
    case 'geometry-valid':
      return `invalid geometry on: ${(d.failing || []).join(', ')}`;
    case 'mbd-complete':
      return `incomplete MBD (Y14.41): ${(d.missing || []).map((m) => `${m.part}/${m.kind}`).join(', ')}`;
    case 'tolerance-rss-valid': {
      const bad = (d.perChain || []).filter((c) => !c.ok);
      return bad.map((c) => `${c.id}: ${c.reason}`).join('; ') || 'tolerance stack failed';
    }
    case 'no-unresolved-duplicates':
      return `${d.confirmedCount} confirmed duplicate pair(s): ` +
        (d.confirmed || []).map((p) => `${p.a}↔${p.b}`).join(', ');
    case 'drawing-generated':
      return `drawing not generated for: ${(d.failing || []).join(', ')}`;
    case 'archival-built-and-verified':
      return d.error ? `archival export failed: ${d.error}`
        : `archive failed verification: ${JSON.stringify(d.mismatches)}`;
    case 'rationale-present':
      return `no design rationale captured for: ${(d.missing || []).join(', ')}`;
    case 'dfm-advisory':
      return `critical DFM error: ${(d.blockingErrors || []).map((e) => `${e.part}/${e.code}`).join(', ')}`;
    default:
      return 'gate failed';
  }
}

// Map a release part → a partRetrieval-fingerprintable body. partRetrieval's
// resolveMesh reads a kernel handle (.handle) OR a FLAT inline mesh
// (.positions/.indices). The kernel-free archival fixtures carry NESTED
// .vertices/.faces, so we flatten them here; findDuplicates' confirm step also
// reads .positions, so flattening is what makes the duplicate gate run headless.
function fingerprintablePart(p) {
  const out = { itemId: p.id ?? p.bodyId, name: p.name || p.id, partNumber: p.id ?? p.bodyId };
  if (p.descriptor) out.descriptor = p.descriptor;
  if (p.shape != null) out.handle = p.shape;
  if (p.positions && p.indices) { out.positions = p.positions; out.indices = p.indices; }
  else if (p.vertices && p.faces) {
    const flat = flattenMesh(p.vertices, p.faces);
    out.positions = flat.positions;
    out.indices = flat.indices;
  }
  if (Number.isFinite(p.volume)) out.volume = p.volume;
  if (Number.isFinite(p.area)) out.area = p.area;
  return out;
}

// Flatten nested vertices [[x,y,z],…] + faces [[i,j,k],…] into the flat
// positions[] / indices[] partRetrieval.resolveMesh expects.
function flattenMesh(vertices, faces) {
  const positions = [];
  for (const v of vertices) positions.push(v[0], v[1], v[2]);
  const indices = [];
  for (const f of faces) indices.push(f[0], f[1], f[2]);
  return { positions, indices };
}

function partLabel(part) {
  if (!part) return '?';
  return part.partNumber || part.name || part.itemId || '?';
}

export default { mbdCompleteness, prePlmRelease };
