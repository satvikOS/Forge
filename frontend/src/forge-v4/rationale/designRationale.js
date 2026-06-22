/**
 * ArchDisc Forge — In-Model DESIGN-RATIONALE / Knowledge Capture — Task #39
 * ============================================================================
 * One of the most under-served capabilities in current PLM is preservation of
 * DESIGN RATIONALE. The geometry, the dimensions, the tolerances — all of that
 * is captured. The *why* is not. When a senior engineer leaves, the reasoning
 * behind every non-obvious decision ("why is this wall 4 mm and not 3?") walks
 * out the door with them, and is rediscovered later at real cost (a re-run
 * moldflow study, a re-derived stiffness calc, a repeated field failure).
 *
 * This module makes the "why" a FIRST-CLASS, PERSISTENT artefact of the model,
 * captured as a BYPRODUCT of building — not a separate manual documentation
 * step that never gets done.
 *
 * WHAT A RATIONALE RECORD IS  (per feature / operation)
 *   { partId, featureId,
 *     intent,             — the design goal ("min wall for injection-mould fill")
 *     drivingRequirement, — the requirement that forced it ("R-12 min stiffness")
 *     constraint,         — the binding constraint ("4 mm — moldflow short-shot limit")
 *     rejectedAlternatives:[ {alternative, reason} ],   — what was considered & why not
 *     provenance:{ who, when(ISO), source },            — accountability trail
 *     links:{ requirements:[], tests:[] },              — into the req/test world
 *     feature:{ fid, op, params, kind? },               — snapshot for the NL resolver
 *     orphaned:boolean, orphanedAt? }                   — flagged if its feature is removed
 *
 * THE PERSISTENT FEATURE ID  (the load-bearing decision)
 *   Records are keyed by (partId, featureId) where featureId is the recipe
 *   feature's `fid ?? id` — the SAME stable key the version-control 3-way
 *   merge/diff machinery uses (versionControl.mergeKeyedList / diffKeyed). That
 *   id is bound to the recipe/feature, NOT to a volatile array index, so it
 *   survives rebuild, reorder, and param edits BY CONSTRUCTION. A whole-part
 *   rationale (why this kind / a top-level param) keys on the sentinel
 *   featureId `'__part__'`.
 *
 * AUTO-CAPTURE AS ARCHIE BUILDS
 *   `rationaleFromOp(...)` is the capture hook a build op calls: when Archie
 *   dispatches a build op and supplies any rationale field (intent / constraint
 *   / drivingRequirement / a `rationale` blob), the "why" is attached to that
 *   feature automatically. No rationale supplied → no-op. ForgeToolBridge calls
 *   this from its post-run dispatch hook, riding the same per-sequence `ctx`
 *   accumulator the GD&T / context-build verbs already use.
 *
 * NATURAL-LANGUAGE QUERY  (deterministic resolver; LLM layer is the noted enhancement)
 *   `queryRationale(partId, "why is this wall 4mm?")` tokenizes the question,
 *   extracts numeric+unit and keyword (op/param-name) tokens, scores every
 *   stored record against the captured feature snapshot (a value match on a
 *   param is the strongest signal), and returns the best record's intent +
 *   driving requirement + binding constraint + the rejected alternative +
 *   provenance. Returns `{ found:false }` honestly when nothing scores — never a
 *   fabricated answer.
 *
 * SURVIVES REBUILD
 *   `reconcile(partId, recipe)` re-keys every stored record against the
 *   (possibly rebuilt / param-edited) recipe: a record whose featureId is still
 *   present is refreshed (so the resolver sees current values) and un-orphaned;
 *   a record whose feature was GENUINELY REMOVED is flagged `orphaned:true`
 *   (never deleted — the "why" is not lost, it is surfaced). Editing an
 *   unrelated param keeps every record attached, because the key is the
 *   persistent fid, not an index.
 *
 * PERSISTENCE  (mirrors versionControl.js — the Forge no-dup rule)
 *   A module-level `_state` { schemaVersion, records:{ [partId]:{ [featureId]:rec } } }
 *   persisted under its own localStorage key with the same crash-safe
 *   temp-then-commit write, debounced autosave, and `.tmp`-recovering load. The
 *   key-sorted canonical serializer is IMPORTED from versionControl (already
 *   exported there) rather than duplicated. Pure JS — no React/DOM — so it runs
 *   head-less in a Node test with zero native deps.
 *
 * No new npm packages.
 *
 * @module forge-v4/rationale/designRationale
 */

import { canonicalize } from '../pdm/versionControl.js';

// ───────────────────────────────────────────────────────── persistence keys

const LS_KEY = 'forge.v4.pdm.rationale';
const LS_TMP = `${LS_KEY}.tmp`;
const SCHEMA_VERSION = 1;
const AUTOSAVE_MS = 250;

/** Sentinel featureId for a rationale that pertains to the WHOLE part (its kind / a top-level param). */
export const PART_SENTINEL = '__part__';

// ───────────────────────────────────────────────────────── in-memory state

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    records: {}, // partId → { featureId → RationaleRecord }
  };
}

let _state = loadState();
let _autosaveTimer = null;

// ───────────────────────────────────────────────────────── persistence (crash-safe)

function hasLS() { return typeof localStorage !== 'undefined' && localStorage; }

/**
 * Crash-safe load. Prefer KEY; if KEY is absent but a half-written `.tmp`
 * survives a crash mid-write, recover from it and promote it to the live KEY.
 * Defensive about a partial/old schema — start fresh rather than mangle.
 */
function loadState() {
  if (!hasLS()) return emptyState();
  try {
    let raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const tmp = localStorage.getItem(LS_TMP);
      if (tmp) {
        raw = tmp;
        try { localStorage.setItem(LS_KEY, tmp); localStorage.removeItem(LS_TMP); } catch { /* best effort */ }
      }
    }
    if (!raw) return emptyState();
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || v.schemaVersion !== SCHEMA_VERSION) return emptyState();
    return {
      schemaVersion: SCHEMA_VERSION,
      records: (v.records && typeof v.records === 'object') ? v.records : {},
    };
  } catch {
    return emptyState();
  }
}

/**
 * Atomic write: temp-then-commit. Write the full serialized state to `.tmp`
 * FIRST (so a crash here leaves the live KEY intact), then commit to KEY, then
 * drop the tmp. If the commit is interrupted, the next load recovers the tmp.
 */
function writeStateNow() {
  if (!hasLS()) return;
  const text = JSON.stringify(canonicalize(_state));
  try {
    localStorage.setItem(LS_TMP, text); // 1) durable temp
    localStorage.setItem(LS_KEY, text); // 2) commit
    localStorage.removeItem(LS_TMP);     // 3) clear temp
  } catch { /* quota / denied — in-memory state remains the source of truth */ }
}

/** Debounced autosave so a burst of captures coalesces into one durable write. */
function persist() {
  if (!hasLS()) return;
  if (_autosaveTimer) { try { clearTimeout(_autosaveTimer); } catch { /* */ } }
  writeStateNow(); // always an immediate durable write (crash-safety) AND debounce
  _autosaveTimer = setTimeout(writeStateNow, AUTOSAVE_MS);
  if (_autosaveTimer && typeof _autosaveTimer.unref === 'function') _autosaveTimer.unref();
}

// ───────────────────────────────────────────────────────── helpers

/** The persistent feature id — the SAME key vcs merge/diff uses (`fid ?? id`). */
export function featureIdOf(feature) {
  if (feature == null) return '';
  if (typeof feature === 'string') return feature;
  return String(feature.fid ?? feature.id ?? '');
}

/** Normalize a rejected-alternatives input (array of strings or {alternative,reason}) → uniform records. */
function normalizeAlternatives(rejected, rejectedAlternatives) {
  const src = rejectedAlternatives ?? rejected ?? [];
  const arr = Array.isArray(src) ? src : [src];
  return arr
    .filter((x) => x != null && x !== '')
    .map((x) => {
      if (typeof x === 'string') return { alternative: x, reason: '' };
      return {
        alternative: x.alternative ?? x.alt ?? x.value ?? '',
        reason: x.reason ?? x.why ?? '',
      };
    });
}

/** Shallow, JSON-safe snapshot of the recipe feature for the NL resolver index. */
function snapshotFeature(feature) {
  if (!feature || typeof feature !== 'object') return null;
  const out = {
    fid: feature.fid ?? feature.id ?? null,
    op: feature.op ?? null,
  };
  if (feature.kind != null) out.kind = feature.kind;
  // Carry params (the values the NL value-match resolves against).
  if (feature.params && typeof feature.params === 'object') {
    out.params = { ...feature.params };
  } else {
    // A feature may carry its scalar params flat (e.g. {fid,op,r,d,edges});
    // capture the numeric/scalar siblings so the resolver can value-match them.
    const params = {};
    for (const [k, val] of Object.entries(feature)) {
      if (k === 'fid' || k === 'id' || k === 'op' || k === 'kind') continue;
      if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') params[k] = val;
    }
    if (Object.keys(params).length) out.params = params;
  }
  return out;
}

function recordsFor(partId) {
  if (!_state.records[partId]) _state.records[partId] = {};
  return _state.records[partId];
}

// ───────────────────────────────────────────────────────── capture

/**
 * Capture (upsert) the rationale for one feature of a part, keyed by the
 * PERSISTENT feature id. Re-capturing the same (partId, featureId) merges into
 * the existing record (fields supplied overwrite; unspecified fields persist).
 *
 * @param {string} partId    the PDM item id this part belongs to (required).
 * @param {string} featureId the recipe feature's persistent id (`fid ?? id`);
 *                           use PART_SENTINEL ('__part__') for a whole-part why.
 * @param {object} r
 *   intent, drivingRequirement, constraint  — the "why" fields.
 *   rejected | rejectedAlternatives         — [string] or [{alternative,reason}].
 *   provenance:{ who, when, source }        — who/when default to archie/now.
 *   links:{ requirements:[], tests:[] }     — links into the req/test world.
 *   feature                                 — the recipe feature snapshot for
 *                                             the NL resolver (auto if omitted
 *                                             and an existing record has one).
 * @returns {object} the stored RationaleRecord.
 */
export function captureRationale(partId, featureId, r = {}) {
  if (!partId) throw new Error('captureRationale: partId required');
  const fid = featureIdOf(featureId) || PART_SENTINEL;
  const bucket = recordsFor(partId);
  const prev = bucket[fid] || null;

  const prov = r.provenance || {};
  const provenance = {
    who: prov.who || (prev && prev.provenance && prev.provenance.who) || 'archie',
    when: prov.when || new Date().toISOString(),
    source: prov.source || (prev && prev.provenance && prev.provenance.source) || '',
  };

  const links = {
    requirements: dedupeStrings([
      ...((prev && prev.links && prev.links.requirements) || []),
      ...((r.links && r.links.requirements) || []),
    ]),
    tests: dedupeStrings([
      ...((prev && prev.links && prev.links.tests) || []),
      ...((r.links && r.links.tests) || []),
    ]),
  };

  // Feature snapshot: explicit one wins, else keep the previous, else none.
  const feature = r.feature != null
    ? snapshotFeature(r.feature)
    : (prev ? prev.feature : null);

  const hasAlts = r.rejected !== undefined || r.rejectedAlternatives !== undefined;
  const rejectedAlternatives = hasAlts
    ? normalizeAlternatives(r.rejected, r.rejectedAlternatives)
    : (prev ? prev.rejectedAlternatives : []);

  const rec = {
    partId,
    featureId: fid,
    intent: r.intent !== undefined ? r.intent : (prev ? prev.intent : ''),
    drivingRequirement: r.drivingRequirement !== undefined
      ? r.drivingRequirement : (prev ? prev.drivingRequirement : ''),
    constraint: r.constraint !== undefined ? r.constraint : (prev ? prev.constraint : ''),
    rejectedAlternatives,
    provenance,
    links,
    feature,
    orphaned: false,
  };
  delete rec.orphanedAt; // capturing re-attaches: clear any prior orphan flag

  bucket[fid] = rec;
  persist();
  return rec;
}

function dedupeStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const x of (Array.isArray(arr) ? arr : [])) {
    const s = String(x);
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

/**
 * AUTO-CAPTURE HOOK — the "why is a byproduct of building" seam.
 *
 * Called by ForgeToolBridge AFTER a build op runs. If the op (or its caller)
 * supplied any rationale field, attach it to the feature the op produced/targeted
 * and return the stored record; otherwise it is a no-op (returns null), so every
 * legacy build call is fully backward-compatible.
 *
 * @param {object} args    the tool_call arguments (may carry `rationale`/`intent`/…).
 * @param {object} result  the op's result (may carry the produced feature / fid).
 * @param {object} [opts]
 *   partId    — the part this op belongs to (e.g. ctx.partId).
 *   featureId — explicit feature id; else derived from result.feature / result.fid.
 *   feature   — explicit feature snapshot; else result.feature.
 * @returns {?object} the stored RationaleRecord, or null if nothing to capture.
 */
export function rationaleFromOp(args = {}, result = {}, opts = {}) {
  const partId = opts.partId ?? args.partId ?? result.partId;
  if (!partId) return null;

  // Gather the rationale payload from either a nested `rationale` blob or the
  // flat sibling fields a build op may pass through.
  const blob = (args && typeof args.rationale === 'object' && args.rationale) || {};
  const r = {
    intent: blob.intent ?? args.intent,
    drivingRequirement: blob.drivingRequirement ?? args.drivingRequirement,
    constraint: blob.constraint ?? args.constraint,
    rejected: blob.rejected ?? blob.rejectedAlternatives ?? args.rejected ?? args.rejectedAlternatives,
    provenance: blob.provenance ?? args.provenance,
    links: blob.links ?? args.links,
  };
  // Nothing meaningful supplied → no-op (do not litter the store with empties).
  const hasWhy = r.intent || r.drivingRequirement || r.constraint
    || (Array.isArray(r.rejected) && r.rejected.length) || (r.rejected && !Array.isArray(r.rejected));
  if (!hasWhy) return null;

  const feature = opts.feature ?? result.feature ?? null;
  const featureId = opts.featureId
    ?? featureIdOf(feature)
    ?? result.fid
    ?? PART_SENTINEL;

  return captureRationale(partId, featureId || PART_SENTINEL, { ...r, feature });
}

// ───────────────────────────────────────────────────────── natural-language query

const UNIT_RE = /(-?\d+(?:\.\d+)?)\s*(mm|cm|m|deg|°|µm|um|in|"|mil)?/g;
const STOP = new Set([
  'why', 'is', 'the', 'this', 'that', 'a', 'an', 'of', 'for', 'to', 'and',
  'we', 'it', 'do', 'did', 'was', 'are', 'be', 'on', 'in', 'at', 'so', 'how',
  'come', 'have', 'has', 'with', 'what', "what's", 'whats', 'reason', 'behind',
]);
// Op/keyword synonyms → the op token they should match in a feature snapshot.
const OP_SYNONYMS = {
  wall: ['wall', 'thickness', 'shell'],
  thickness: ['wall', 'thickness', 'shell'],
  hole: ['hole', 'bore', 'drill'],
  bore: ['hole', 'bore', 'counterbore'],
  fillet: ['fillet', 'round'],
  round: ['fillet', 'round'],
  chamfer: ['chamfer', 'bevel'],
  boss: ['boss', 'pad'],
  rib: ['rib'],
  slot: ['slot'],
  pocket: ['pocket', 'cut'],
};
const PARAM_TOKENS = new Set([
  'dx', 'dy', 'dz', 'diameter', 'dia', 'depth', 'thickness', 'holer', 'r',
  'radius', 'width', 'height', 'length', 'd', 'angle', 'count', 'pitch', 'wall',
]);

function tokenize(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[?,.!;:()[\]{}]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

/** Pull numeric values (with optional unit) out of the question. */
function numbersIn(q) {
  const out = [];
  const s = String(q || '').toLowerCase();
  let m;
  UNIT_RE.lastIndex = 0;
  while ((m = UNIT_RE.exec(s)) !== null) {
    const val = parseFloat(m[1]);
    if (Number.isFinite(val)) out.push({ value: val, unit: m[2] || null });
  }
  return out;
}

/** Flatten a feature snapshot's numeric param values for value-matching. */
function featureNumbers(feature) {
  const out = [];
  if (!feature) return out;
  const params = (feature.params && typeof feature.params === 'object') ? feature.params : {};
  for (const [k, v] of Object.entries(params)) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (Number.isFinite(n)) out.push({ name: String(k).toLowerCase(), value: n });
  }
  return out;
}

/** All op/param/kind name tokens a record exposes for keyword matching. */
function featureNameTokens(feature) {
  const out = new Set();
  if (!feature) return out;
  if (feature.op) out.add(String(feature.op).toLowerCase());
  if (feature.kind) out.add(String(feature.kind).toLowerCase());
  const params = (feature.params && typeof feature.params === 'object') ? feature.params : {};
  for (const k of Object.keys(params)) out.add(String(k).toLowerCase());
  return out;
}

function textTokens(...strings) {
  const out = new Set();
  for (const s of strings) {
    for (const t of tokenize(s)) out.add(t);
  }
  return out;
}

const VALUE_EPS = 1e-6;
const SCORE_FLOOR = 1.0; // a bare text-token overlap alone is too weak to answer

/**
 * Deterministic NL resolver. Scores every stored (non-deleted) record for the
 * part against the question and returns the best match's rationale, or
 * `{ found:false }` when nothing clears the floor (honest — not a stub). An LLM
 * NL layer is the noted enhancement; this resolver is the shipped increment.
 *
 * Scoring signals (strongest first):
 *   • VALUE MATCH  — a number in the question equals a feature param value (±ε): +5
 *                    (+2 more if that param's NAME is also referenced in the question)
 *   • NAME MATCH   — an op/kind/param name (or its synonym) is in the question:  +3 each
 *   • TEXT OVERLAP — question tokens overlapping intent/constraint/req text:     +0.5 each
 */
export function queryRationale(partId, nlQuestion) {
  const bucket = _state.records[partId] || {};
  const records = Object.values(bucket).filter((rec) => rec && !rec.orphaned);
  if (records.length === 0) return { found: false, question: nlQuestion, reason: 'no rationale captured for this part' };

  const qNums = numbersIn(nlQuestion);
  const qTokens = tokenize(nlQuestion);
  const qTokenSet = new Set(qTokens);

  // Expand the question's keyword tokens through the op-synonym map.
  const qOpTokens = new Set(qTokens);
  for (const t of qTokens) {
    if (OP_SYNONYMS[t]) for (const syn of OP_SYNONYMS[t]) qOpTokens.add(syn);
  }

  let best = null;
  let bestScore = -Infinity;
  let bestMatchedOn = [];

  for (const rec of records) {
    let score = 0;
    const matchedOn = [];

    const fNums = featureNumbers(rec.feature);
    const fNames = featureNameTokens(rec.feature);

    // (a) value match — the strongest signal.
    for (const qn of qNums) {
      for (const fn of fNums) {
        if (Math.abs(fn.value - qn.value) <= VALUE_EPS) {
          score += 5;
          matchedOn.push(`value:${fn.name}=${fn.value}`);
          // bonus if the param name itself (or a synonym) is referenced.
          if (qOpTokens.has(fn.name) || (PARAM_TOKENS.has(fn.name) && qTokenSet.has(fn.name))) {
            score += 2;
            matchedOn.push(`param:${fn.name}`);
          }
        }
      }
    }

    // (b) op / kind / param NAME match (synonym-aware).
    for (const name of fNames) {
      if (qOpTokens.has(name)) {
        score += 3;
        matchedOn.push(`name:${name}`);
      } else {
        // synonym families: question says "wall" → matches a feature op "shell"/"thickness".
        for (const [, syns] of Object.entries(OP_SYNONYMS)) {
          if (syns.includes(name) && qTokens.some((t) => syns.includes(t))) {
            score += 3;
            matchedOn.push(`syn:${name}`);
            break;
          }
        }
      }
    }

    // (c) text overlap with the captured why (weak tiebreaker).
    const why = textTokens(rec.intent, rec.constraint, rec.drivingRequirement);
    let overlap = 0;
    for (const t of qTokenSet) if (why.has(t)) overlap++;
    score += overlap * 0.5;
    if (overlap) matchedOn.push(`text:${overlap}`);

    if (score > bestScore) {
      bestScore = score;
      best = rec;
      bestMatchedOn = matchedOn;
    }
  }

  if (!best || bestScore < SCORE_FLOOR) {
    return { found: false, question: nlQuestion, reason: 'no feature in this part matched the question' };
  }

  return {
    found: true,
    question: nlQuestion,
    featureId: best.featureId,
    feature: best.feature,
    intent: best.intent,
    drivingRequirement: best.drivingRequirement,
    constraint: best.constraint,
    alternatives: best.rejectedAlternatives,
    provenance: best.provenance,
    links: best.links,
    score: bestScore,
    matchedOn: bestMatchedOn,
  };
}

// ───────────────────────────────────────────────────────── list

/** All rationale records for a part (including orphaned), stable order by featureId. */
export function listRationale(partId) {
  const bucket = _state.records[partId] || {};
  return Object.keys(bucket)
    .sort()
    .map((fid) => bucket[fid]);
}

/** A single record by (partId, featureId), or null. */
export function getRationale(partId, featureId) {
  const bucket = _state.records[partId] || {};
  return bucket[featureIdOf(featureId) || PART_SENTINEL] || null;
}

// ───────────────────────────────────────────────────────── rebuild survival

/**
 * Reconcile a part's rationale against a (possibly rebuilt / param-edited)
 * recipe. Because records key on the PERSISTENT feature id (`fid ?? id`), this
 * keeps every record attached to its feature even if the feature order or an
 * unrelated param changed — it only FLAGS a record whose feature was genuinely
 * removed (never deletes it; the "why" is surfaced, not lost).
 *
 *   • feature still present  → refresh the stored feature snapshot (so the NL
 *                              resolver value-matches the CURRENT params) + clear orphan.
 *   • feature removed        → mark orphaned:true + stamp orphanedAt.
 *   • the PART_SENTINEL record is always considered attached (it pertains to the
 *     whole part, which still exists).
 *
 * @param {string} partId
 * @param {object} recipe  { kind, params:{}, features:[{fid|id, op, params}] }
 * @returns {{ attached:string[], orphaned:string[] }}  featureIds in each set.
 */
export function reconcile(partId, recipe) {
  const bucket = _state.records[partId];
  if (!bucket) return { attached: [], orphaned: [] };

  const features = (recipe && Array.isArray(recipe.features)) ? recipe.features : [];
  const byId = new Map();
  for (const f of features) {
    const id = featureIdOf(f);
    if (id) byId.set(id, f);
  }

  const attached = [];
  const orphaned = [];

  for (const fid of Object.keys(bucket)) {
    const rec = bucket[fid];
    if (fid === PART_SENTINEL) {
      // Whole-part rationale: refresh from the top-level recipe and stay attached.
      if (recipe) {
        rec.feature = snapshotFeature({
          fid: PART_SENTINEL, op: '__part__', kind: recipe.kind, params: recipe.params,
        });
      }
      rec.orphaned = false;
      delete rec.orphanedAt;
      attached.push(fid);
      continue;
    }
    if (byId.has(fid)) {
      // Still present — refresh the snapshot so the resolver sees current values.
      rec.feature = snapshotFeature(byId.get(fid));
      rec.orphaned = false;
      delete rec.orphanedAt;
      attached.push(fid);
    } else {
      // Genuinely removed — flag, never delete.
      rec.orphaned = true;
      rec.orphanedAt = new Date().toISOString();
      orphaned.push(fid);
    }
  }

  persist();
  return { attached, orphaned };
}

// ───────────────────────────────────────────────────────── serialize / state

/** Lossless, key-sorted text dump of the whole rationale store (text-diffable). */
export function serializeState() {
  return JSON.stringify(canonicalize(_state), null, 2);
}

export function snapshotState() { return JSON.parse(JSON.stringify(_state)); }

// ───────────────────────────────────────────────────────── test / dev hooks

export function _resetForTests() {
  _state = emptyState();
  if (hasLS()) {
    try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_TMP); } catch { /* */ }
  }
}

/** Force a synchronous durable write (used by crash-safety tests). */
export function _flushForTests() { writeStateNow(); }

/** Reload state from localStorage (used by crash-safety tests). */
export function _reloadForTests() { _state = loadState(); return _state; }

export const __test = { LS_KEY, LS_TMP, snapshotFeature, numbersIn, tokenize };

export default {
  captureRationale, rationaleFromOp, queryRationale, listRationale,
  getRationale, reconcile, featureIdOf,
  serializeState, snapshotState, PART_SENTINEL,
};
