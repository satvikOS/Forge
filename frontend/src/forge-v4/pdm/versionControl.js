/**
 * ArchDisc Forge — Local-First Version Control for CAD ("git-for-CAD") — Task #32
 * ============================================================================
 * The #1 community gripe in MCAD is VERSION CHAOS: lock-blocked parallel work,
 * no change-diff, manual merge, "I was working on the wrong version." PLM that
 * solves it is six-figure and IT-gated, so SMBs opt out and live in the chaos.
 *
 * This module adds a CONTENT-ADDRESSED VERSION GRAPH over the PDM vault — a
 * lock-free, branch-and-merge layer that captures the ACTUAL part recipe (not
 * just the coarse ASME letter-revision metadata `pdmStore` tracks). It is
 * orthogonal to the letter-rev/lock workflow: you can branch a part, edit it on
 * two branches in parallel, and 3-way-merge them WITHOUT ever taking a lock.
 *
 * WHAT A VERSION IS
 *   An immutable snapshot of one item's design intent:
 *       { recipe:{ kind, params:{}, features:[] }, pmi:[] }
 *   keyed by a CONTENT HASH of its canonical (sorted-key) JSON. Identical
 *   content under the same parent dedupes to the same version id.
 *
 * THE GRAPH (text-serializable, diffable — the anti-binary-blob lesson)
 *   • commits{}  id → { id, contentHash, itemId, recipe, pmi, parents:[id],
 *                       branch, message, author, ts }
 *   • branches{} name → { name, head }            (a named ref)
 *   • tags{}     name → versionId                 (an immutable ref)
 *   • heads{}    branch → versionId               (the HEAD per branch)
 *   Everything is plain JSON; `serializeState()` round-trips losslessly with
 *   recursively SORTED keys so two logically-equal states diff cleanly as text.
 *
 * CRASH-SAFE PERSISTENCE
 *   A write goes to `${KEY}.tmp` first, then commits to `KEY`, then clears the
 *   tmp (write-temp-then-rename, the localStorage analogue of an atomic rename).
 *   On load, if `KEY` is missing but `.tmp` is present, we recover from the tmp
 *   — a half-finished previous write is never lost. An autosave debounce
 *   coalesces bursts.
 *
 * 3-WAY MERGE (lock-free parallel work)
 *   merge(base, ours, theirs) walks param-set / feature-list / PMI three-way:
 *     • changed on one side only            → take that side  (auto-merge)
 *     • changed on both to the SAME value   → take it         (no conflict)
 *     • changed on both DIFFERENTLY         → CONFLICT, both values retained
 *   Non-conflicting edits on different keys/features merge automatically; a
 *   conflict is SURFACED with base/ours/theirs and the merged value defaults to
 *   ours — an edit is NEVER silently dropped. mergeBranches() finds the lowest
 *   common ancestor automatically.
 *
 * 3D CHANGE-DIFF
 *   diff(a, b, forge?) returns a structured recipeDiff (params/features/pmi
 *   added·removed·modified, human-readable) PLUS a geomDelta computed from the
 *   REAL kernel: rebuild both recipes (rebuildShape), massProps for volume/area,
 *   and a bbox from the tessellation (no native bounds export — same pattern as
 *   partRetrieval.bboxDiag / assemblyHierarchy.localBoundsForBody). With no
 *   kernel resolvable, geomDelta is null (flagged) and the text recipeDiff still
 *   returns — honest scope, not a stub.
 *
 * WHERE-USED + IMPACT
 *   whereUsed(itemId, {transitive}) wraps pdmStore's BOM edge graph (direct
 *   parents, or a cycle-guarded BFS up to all ancestors). impact(itemId) is the
 *   transitive parent closure — every assembly that would need rebuild /
 *   revalidation if the part changes.
 *
 * No new npm packages (the Forge rule): the content hash (FNV-1a 64-bit) and
 * the 3-way merge are inlined below. Pure JS — no React/DOM imports — so it
 * runs head-less in a Node test against the prebuilt kernel.
 *
 * @module forge-v4/pdm/versionControl
 */

/* eslint-disable no-bitwise */

import { listBoms, getItem, whereUsed as pdmWhereUsed } from '../pdmStore.js';
import { rebuildShape, setForgeKernel } from '../drawing/autoDrawing.js';

// ───────────────────────────────────────────────────────── persistence keys

const LS_KEY = 'forge.v4.pdm.vcs';
const LS_TMP = `${LS_KEY}.tmp`;
const SCHEMA_VERSION = 1;
const AUTOSAVE_MS = 250;

// ───────────────────────────────────────────────────────── canonical text + hash

/**
 * Recursively sort object keys so two LOGICALLY-equal values serialize to the
 * exact same text. Arrays keep their order (feature/PMI order is meaningful);
 * objects are key-sorted. This is the text-serializable/diffable backbone — a
 * version is a diffable text doc, never a binary blob.
 */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v === undefined) continue; // drop undefined so it never perturbs the hash
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** Canonical JSON text of a snapshot — the unit of hashing + text diff. */
export function serializeVersion(snapshot) {
  return JSON.stringify(canonicalize(normalizeSnapshot(snapshot)));
}

/**
 * FNV-1a 64-bit, dependency-free. JS bit-ops are 32-bit and floats lose the
 * 53rd bit, so the 64-bit state is carried as FOUR 16-bit limbs and the FNV
 * prime (0x100000001b3) multiply is done with a schoolbook limb product. This
 * is canonical FNV-1a (verified against a BigInt reference for ASCII) — the
 * inline-hash the directive calls for (pmiAnnotations inlines a small hash the
 * same way). Operates on UTF-8 bytes so wide code points fold in correctly.
 * Returns a 16-hex-char string.
 *
 *   offset basis = 0xcbf29ce484222325  → limbs [0xcbf2,0x9ce4,0x8422,0x2325]
 *   prime        = 0x00000100000001b3  → limbs [0x0000,0x0100,0x0000,0x01b3]
 */
export function hashContent(text) {
  // 64-bit state as 4 limbs, most-significant first.
  let h0 = 0xcbf2, h1 = 0x9ce4, h2 = 0x8422, h3 = 0x2325;
  const bytes = utf8Bytes(String(text));
  for (let i = 0; i < bytes.length; i++) {
    h3 ^= bytes[i]; // XOR the byte into the least-significant limb
    // multiply the 64-bit state by the FNV prime (mod 2^64).
    [h0, h1, h2, h3] = mul64(h0, h1, h2, h3);
  }
  return toHex16(h0) + toHex16(h1) + toHex16(h2) + toHex16(h3);
}

/**
 * 64-bit × FNV-prime via 16-bit limbs ([m0..m3] most-significant first, so
 * limb m_i carries weight 2^(16·(3-i))). The prime in 16-bit limbs is
 *   P = [P0,P1,P2,P3] = [0x0000, 0x0100, 0x0000, 0x01b3]
 * (P1·2^32 = 0x0100·2^32 = 2^40, P3 = 0x01b3 = 2^8+0xb3 → prime = 2^40+2^8+0xb3).
 * A product m_i·P_j lands at output limb index (i+j-3) — terms with i+j<3
 * overflow past 2^64 and are dropped (mod 2^64). Only P1 and P3 are non-zero:
 *   k=3: m3·P3
 *   k=2: m2·P3                 (m3·P2 = 0)
 *   k=1: m1·P3 + m3·P1         (m2·P2 = 0)
 *   k=0: m0·P3 + m2·P1         (m1·P2 = m3·P0 = 0)
 * then carry-fold low→high (mod 2^16 per limb).
 */
function mul64(m0, m1, m2, m3) {
  const P1 = 0x0100, P3 = 0x01b3;
  let r3 = m3 * P3;
  let r2 = m2 * P3;
  let r1 = m1 * P3 + m3 * P1;
  let r0 = m0 * P3 + m2 * P1;
  r2 += Math.floor(r3 / 0x10000); r3 &= 0xffff;
  r1 += Math.floor(r2 / 0x10000); r2 &= 0xffff;
  r0 += Math.floor(r1 / 0x10000); r1 &= 0xffff;
  r0 &= 0xffff;
  return [r0, r1, r2, r3];
}

function toHex16(n) { return (n & 0xffff).toString(16).padStart(4, '0'); }

/** Minimal UTF-8 encoder (no TextEncoder dependency; deterministic). */
function utf8Bytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    // Surrogate pair → code point.
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c < 0x10000) { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    else { out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return out;
}

// ───────────────────────────────────────────────────────── snapshot normaliser

/** Coerce any caller snapshot into the canonical { recipe:{kind,params,features}, pmi } shape. */
function normalizeSnapshot(snap) {
  const s = snap || {};
  const recipe = s.recipe || {};
  return {
    recipe: {
      kind: recipe.kind ?? null,
      params: recipe.params ? { ...recipe.params } : {},
      features: Array.isArray(recipe.features) ? recipe.features.map((f) => ({ ...f })) : [],
    },
    pmi: Array.isArray(s.pmi) ? s.pmi.map((p) => ({ ...p })) : [],
  };
}

// ───────────────────────────────────────────────────────── in-memory state

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    commits: {},          // id → commit
    branches: {},         // name → { name, head }
    tags: {},             // name → versionId
    heads: {},            // branch → versionId
    currentBranch: 'main',
  };
}

let _state = loadState();
let _autosaveTimer = null;

// ───────────────────────────────────────────────────────── persistence

function hasLS() { return typeof localStorage !== 'undefined' && localStorage; }

/**
 * Crash-safe load. Prefer KEY; if KEY is absent but a half-written `.tmp`
 * survives a crash mid-write, recover from it. Defensive about partial/old
 * schema — start fresh rather than mangle.
 */
function loadState() {
  if (!hasLS()) return emptyState();
  try {
    let raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const tmp = localStorage.getItem(LS_TMP);
      if (tmp) {
        // A write crashed after the tmp was written but before the commit.
        // Promote the tmp to the live key (the recovery the brief mandates).
        raw = tmp;
        try { localStorage.setItem(LS_KEY, tmp); localStorage.removeItem(LS_TMP); } catch { /* best effort */ }
      }
    }
    if (!raw) return emptyState();
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || v.schemaVersion !== SCHEMA_VERSION) return emptyState();
    const base = emptyState();
    return {
      schemaVersion: SCHEMA_VERSION,
      commits: (v.commits && typeof v.commits === 'object') ? v.commits : base.commits,
      branches: (v.branches && typeof v.branches === 'object') ? v.branches : base.branches,
      tags: (v.tags && typeof v.tags === 'object') ? v.tags : base.tags,
      heads: (v.heads && typeof v.heads === 'object') ? v.heads : base.heads,
      currentBranch: typeof v.currentBranch === 'string' ? v.currentBranch : base.currentBranch,
    };
  } catch {
    return emptyState();
  }
}

/**
 * Atomic write: temp-then-rename. Write the full serialized state to `.tmp`
 * FIRST (so a crash here leaves the live KEY intact), then commit to KEY, then
 * drop the tmp. If the commit step is interrupted, the next load recovers the
 * tmp. A failure (quota) leaves the in-memory state authoritative.
 */
function writeStateNow() {
  if (!hasLS()) return;
  const text = JSON.stringify(canonicalize(_state));
  try {
    localStorage.setItem(LS_TMP, text);   // 1) durable temp
    localStorage.setItem(LS_KEY, text);   // 2) commit
    localStorage.removeItem(LS_TMP);      // 3) clear temp
  } catch { /* quota / denied — in-memory state remains the source of truth */ }
}

/** Debounced autosave so a burst of commits coalesces into one durable write. */
function persist() {
  if (!hasLS()) return;
  if (_autosaveTimer) { try { clearTimeout(_autosaveTimer); } catch { /* */ } }
  // Always do an immediate durable write (crash-safety) AND debounce the next.
  writeStateNow();
  _autosaveTimer = setTimeout(writeStateNow, AUTOSAVE_MS);
  if (_autosaveTimer && typeof _autosaveTimer.unref === 'function') _autosaveTimer.unref();
}

// ───────────────────────────────────────────────────────── commit / version ids

/**
 * A version id is the content hash of (canonical snapshot text + parent id).
 * Folding the parent in means the SAME geometry committed onto different
 * histories is a distinct node, while the same content onto the same parent
 * dedupes to one id (idempotent re-commit).
 */
function computeVersionId(snapshot, parentId) {
  return hashContent(serializeVersion(snapshot) + ' ' + (parentId || ''));
}

/**
 * Commit an immutable snapshot of one item onto a branch.
 *
 * @param {object} a
 *   itemId   — the pdmStore item id this version belongs to (required).
 *   recipe   — { kind, params, features:[] } (the parametric recipe / feature tree).
 *   pmi      — [] semantic PMI (optional).
 *   branch   — branch name to advance (default the current branch).
 *   message  — commit message.
 *   author   — author tag.
 *   parent   — explicit parent version id; defaults to the branch HEAD.
 * @returns {string} versionId
 */
export function commit({ itemId, recipe, pmi = [], branch, message = '', author = 'system', parent } = {}) {
  if (!itemId) throw new Error('commit: itemId required');
  const br = branch || _state.currentBranch || 'main';
  const parentId = parent !== undefined ? parent : (_state.heads[br] ?? null);
  const snapshot = normalizeSnapshot({ recipe, pmi });
  const id = computeVersionId(snapshot, parentId);

  // Idempotent: re-committing identical content on the same parent dedupes.
  if (!_state.commits[id]) {
    _state.commits[id] = {
      id,
      contentHash: hashContent(serializeVersion(snapshot)),
      itemId,
      recipe: snapshot.recipe,
      pmi: snapshot.pmi,
      parents: parentId ? [parentId] : [],
      branch: br,
      message: String(message || ''),
      author: String(author || 'system'),
      ts: Date.now(),
    };
  }
  // Advance the branch HEAD (and ensure a branch ref exists).
  _state.heads[br] = id;
  _state.branches[br] = { name: br, head: id };
  persist();
  return id;
}

// ───────────────────────────────────────────────────────── branch / tag / refs

/**
 * Name a branch at a version (lock-free — multiple branches share history).
 * @param {string} name
 * @param {string} [fromVersion] default: HEAD of the current branch.
 * @returns {{ name, head }}
 */
export function branch(name, fromVersion) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('branch: name required');
  const from = fromVersion !== undefined ? fromVersion : (_state.heads[_state.currentBranch] ?? null);
  if (from && !_state.commits[from]) throw new Error(`branch: unknown fromVersion ${from}`);
  _state.heads[nm] = from;
  _state.branches[nm] = { name: nm, head: from };
  persist();
  return { name: nm, head: from };
}

/** Tag a version with an immutable name. */
export function tag(name, versionId) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('tag: name required');
  if (!_state.commits[versionId]) throw new Error(`tag: unknown versionId ${versionId}`);
  _state.tags[nm] = versionId;
  persist();
  return { name: nm, versionId };
}

/** Move the current-branch pointer; creates the branch ref if it has a head. */
export function checkout(branchName) {
  const nm = String(branchName || '').trim();
  if (!nm) throw new Error('checkout: branch name required');
  if (!(nm in _state.heads) && !(nm in _state.branches)) {
    throw new Error(`checkout: unknown branch ${nm}`);
  }
  _state.currentBranch = nm;
  persist();
  return { branch: nm, head: _state.heads[nm] ?? null };
}

export function currentBranch() { return _state.currentBranch; }
export function headOf(branchName) { return _state.heads[branchName] ?? null; }
export function getCommit(id) { return _state.commits[id] || null; }
export function listBranches() {
  return Object.keys(_state.branches).map((nm) => ({ name: nm, head: _state.heads[nm] ?? null }));
}
export function listTags() {
  return Object.entries(_state.tags).map(([name, versionId]) => ({ name, versionId }));
}

/** Walk a branch (or version) back through its parents → newest-first history. */
export function log(branchOrVersion) {
  let id = _state.heads[branchOrVersion] ?? (_state.commits[branchOrVersion] ? branchOrVersion : null);
  const out = [];
  const seen = new Set();
  while (id && _state.commits[id] && !seen.has(id)) {
    seen.add(id);
    const c = _state.commits[id];
    out.push(c);
    id = c.parents && c.parents.length ? c.parents[0] : null;
  }
  return out;
}

// ───────────────────────────────────────────────────────── ancestry / LCA

/** Ordered ancestor chain of a version (excludes the version itself), oldest path first. */
function ancestors(id) {
  const out = [];
  const seen = new Set();
  let cur = _state.commits[id];
  while (cur && cur.parents && cur.parents.length) {
    const p = cur.parents[0];
    if (!p || seen.has(p)) break;
    seen.add(p);
    out.push(p);
    cur = _state.commits[p];
  }
  return out;
}

/**
 * Lowest common ancestor of two versions on a single-parent history — the
 * deepest node reachable from both. Used by mergeBranches to find the merge
 * base automatically when only two heads are given.
 */
export function mergeBase(oursId, theirsId) {
  if (oursId === theirsId) return oursId;
  const oursSet = new Set([oursId, ...ancestors(oursId)]);
  // Walk theirs from itself upward; the first node in ours' ancestry is the LCA.
  if (oursSet.has(theirsId)) return theirsId;
  for (const a of ancestors(theirsId)) {
    if (oursSet.has(a)) return a;
  }
  return null;
}

// ───────────────────────────────────────────────────────── 3-way merge

function snapshotOf(idOrSnap) {
  if (idOrSnap == null) return normalizeSnapshot({});
  if (typeof idOrSnap === 'object') {
    // Inline snapshot (headless tests) — accept { recipe, pmi } or a commit.
    if (idOrSnap.recipe || idOrSnap.pmi) return normalizeSnapshot(idOrSnap);
  }
  const c = _state.commits[idOrSnap];
  if (!c) throw new Error(`merge: unknown version ${idOrSnap}`);
  return normalizeSnapshot({ recipe: c.recipe, pmi: c.pmi });
}

/**
 * 3-way merge of param sets. For every key in union(base, ours, theirs):
 *   • unchanged on both              → base value
 *   • changed on one side only       → that side          (auto-merge)
 *   • changed on both to same value  → that value         (no conflict)
 *   • changed on both differently    → CONFLICT (merged defaults to ours)
 *   • added on one side only         → add
 *   • added on both, same value      → add
 *   • added on both, different value → CONFLICT
 * A conflict is recorded with base/ours/theirs; the value is NEVER dropped.
 */
function mergeParams(base = {}, ours = {}, theirs = {}) {
  const merged = {};
  const conflicts = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const key of [...keys].sort()) {
    const inB = key in base, inO = key in ours, inT = key in theirs;
    const bv = base[key], ov = ours[key], tv = theirs[key];
    const oChanged = inO ? !valEq(ov, bv) : (inB ? true : false); // ours diverged from base (incl. deletion)
    const tChanged = inT ? !valEq(tv, bv) : (inB ? true : false);

    // Deletions: a key present in base but missing on a side is a "change".
    const oDeleted = inB && !inO;
    const tDeleted = inB && !inT;

    if (oDeleted || tDeleted) {
      // delete on one side, unchanged on the other → delete
      if (oDeleted && tDeleted) continue;                 // both removed
      if (oDeleted && !tChanged) continue;                // ours removed, theirs untouched
      if (tDeleted && !oChanged) continue;                // theirs removed, ours untouched
      // delete vs modify → conflict; keep the surviving value, surface it.
      const keep = oDeleted ? tv : ov;
      conflicts.push({ kind: 'param', key, base: inB ? bv : undefined,
                       ours: inO ? ov : undefined, theirs: inT ? tv : undefined,
                       reason: 'delete/modify' });
      if (keep !== undefined) merged[key] = keep;
      continue;
    }

    if (!oChanged && !tChanged) { merged[key] = inB ? bv : (inO ? ov : tv); continue; }
    if (oChanged && !tChanged) { merged[key] = ov; continue; }
    if (!oChanged && tChanged) { merged[key] = tv; continue; }
    // both changed
    if (valEq(ov, tv)) { merged[key] = ov; continue; }     // converged → no conflict
    conflicts.push({ kind: 'param', key, base: inB ? bv : undefined, ours: ov, theirs: tv });
    merged[key] = ov; // default to ours; conflict is surfaced, edit not lost
  }
  return { merged, conflicts };
}

/**
 * 3-way merge of an id-keyed list (features by `fid`/`id`, or PMI by `id`).
 * add on one side → include; remove on one side (present in base) → remove;
 * modify-both differently → conflict (keep ours, surface it). Order is the
 * stable union of positions: base order first, then any side-added tail.
 */
function mergeKeyedList(kind, base = [], ours = [], theirs = []) {
  const keyOf = (f) => String(f.fid ?? f.id ?? '');
  const mapB = indexById(base, keyOf);
  const mapO = indexById(ours, keyOf);
  const mapT = indexById(theirs, keyOf);
  const conflicts = [];
  const result = new Map();

  const allIds = new Set([...mapB.keys(), ...mapO.keys(), ...mapT.keys()]);
  for (const id of allIds) {
    const b = mapB.get(id), o = mapO.get(id), t = mapT.get(id);
    const inB = b !== undefined, inO = o !== undefined, inT = t !== undefined;

    if (!inB) {
      // Added on a side (or both).
      if (inO && inT) {
        if (valEq(o, t)) result.set(id, o);
        else { conflicts.push({ kind, fid: id, base: undefined, ours: o, theirs: t, reason: 'add/add' }); result.set(id, o); }
      } else if (inO) result.set(id, o);
      else if (inT) result.set(id, t);
      continue;
    }
    // Present in base.
    const oChanged = inO ? !valEq(o, b) : true;   // missing on ours = removed = change
    const tChanged = inT ? !valEq(t, b) : true;
    const oRemoved = !inO, tRemoved = !inT;

    if (oRemoved || tRemoved) {
      if (oRemoved && tRemoved) continue;                 // both removed
      if (oRemoved && !tChanged) continue;                // ours removed, theirs untouched
      if (tRemoved && !oChanged) continue;                // theirs removed, ours untouched
      // remove vs modify → conflict; keep the survivor.
      const keep = oRemoved ? t : o;
      conflicts.push({ kind, fid: id, base: b, ours: inO ? o : undefined, theirs: inT ? t : undefined, reason: 'remove/modify' });
      if (keep !== undefined) result.set(id, keep);
      continue;
    }
    if (!oChanged && !tChanged) { result.set(id, b); continue; }
    if (oChanged && !tChanged) { result.set(id, o); continue; }
    if (!oChanged && tChanged) { result.set(id, t); continue; }
    if (valEq(o, t)) { result.set(id, o); continue; }
    conflicts.push({ kind, fid: id, base: b, ours: o, theirs: t });
    result.set(id, o); // default ours; surfaced, not lost
  }

  // Stable order: base order, then ours-added, then theirs-added.
  const ordered = [];
  const emitted = new Set();
  const emit = (id) => { if (result.has(id) && !emitted.has(id)) { ordered.push(result.get(id)); emitted.add(id); } };
  for (const f of base) emit(keyOf(f));
  for (const f of ours) emit(keyOf(f));
  for (const f of theirs) emit(keyOf(f));
  return { merged: ordered, conflicts };
}

function indexById(arr, keyOf) {
  const m = new Map();
  for (const x of (Array.isArray(arr) ? arr : [])) m.set(keyOf(x), x);
  return m;
}

/** Deep value equality over JSON-able values via canonical text. */
function valEq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object' && typeof b !== 'object') return a === b;
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

/**
 * Explicit 3-way merge of three snapshots (or version ids / inline snapshots).
 * Auto-merges every non-conflicting param / feature / PMI change; surfaces
 * conflicts (same thing changed differently) with both values, NEVER losing an
 * edit. The merged value defaults to OURS on a conflict.
 *
 * @returns { merged:{ recipe:{kind,params,features}, pmi }, conflicts:[] }
 */
export function merge(base, ours, theirs) {
  const B = snapshotOf(base);
  const O = snapshotOf(ours);
  const T = snapshotOf(theirs);

  const conflicts = [];

  // recipe.kind — a top-level conflict if both diverge differently.
  let kind = B.recipe.kind;
  const oKind = O.recipe.kind, tKind = T.recipe.kind;
  const oKindChanged = !valEq(oKind, B.recipe.kind);
  const tKindChanged = !valEq(tKind, B.recipe.kind);
  if (oKindChanged && !tKindChanged) kind = oKind;
  else if (!oKindChanged && tKindChanged) kind = tKind;
  else if (oKindChanged && tKindChanged) {
    if (valEq(oKind, tKind)) kind = oKind;
    else { conflicts.push({ kind: 'kind', base: B.recipe.kind, ours: oKind, theirs: tKind }); kind = oKind; }
  }

  const params = mergeParams(B.recipe.params, O.recipe.params, T.recipe.params);
  const features = mergeKeyedList('feature', B.recipe.features, O.recipe.features, T.recipe.features);
  const pmi = mergeKeyedList('pmi', B.pmi, O.pmi, T.pmi);

  conflicts.push(...params.conflicts, ...features.conflicts, ...pmi.conflicts);

  return {
    merged: {
      recipe: { kind, params: params.merged, features: features.merged },
      pmi: pmi.merged,
    },
    conflicts,
  };
}

/**
 * Merge two branch heads (or version ids), finding the merge base (LCA)
 * automatically. Convenience over `merge(base, ours, theirs)`.
 */
export function mergeBranches(oursRef, theirsRef) {
  const oursId = _state.heads[oursRef] ?? oursRef;
  const theirsId = _state.heads[theirsRef] ?? theirsRef;
  const baseId = mergeBase(oursId, theirsId);
  const res = merge(baseId, oursId, theirsId);
  return { ...res, base: baseId, ours: oursId, theirs: theirsId };
}

// ───────────────────────────────────────────────────────── recipe diff

/**
 * Structured, human-readable diff of two recipes — params/features/pmi as
 * added / removed / modified. Computed off the canonical recipes, NOT a blob
 * compare (the anti-binary lesson).
 */
export function recipeDiff(a, b) {
  const A = normalizeSnapshot(a);
  const B = normalizeSnapshot(b);
  return {
    kindChanged: valEq(A.recipe.kind, B.recipe.kind)
      ? null
      : { from: A.recipe.kind, to: B.recipe.kind },
    params: diffMap(A.recipe.params, B.recipe.params),
    features: diffKeyed(A.recipe.features, B.recipe.features),
    pmi: diffKeyed(A.pmi, B.pmi),
  };
}

function diffMap(a = {}, b = {}) {
  const added = {}, removed = {}, modified = {};
  for (const k of Object.keys(b)) if (!(k in a)) added[k] = b[k];
  for (const k of Object.keys(a)) {
    if (!(k in b)) { removed[k] = a[k]; continue; }
    if (!valEq(a[k], b[k])) modified[k] = { from: a[k], to: b[k] };
  }
  return { added, removed, modified };
}

function diffKeyed(a = [], b = []) {
  const keyOf = (f) => String(f.fid ?? f.id ?? '');
  const mapA = indexById(a, keyOf), mapB = indexById(b, keyOf);
  const added = [], removed = [], modified = [];
  for (const [k, v] of mapB) if (!mapA.has(k)) added.push(v);
  for (const [k, v] of mapA) {
    if (!mapB.has(k)) { removed.push(v); continue; }
    if (!valEq(v, mapB.get(k))) modified.push({ id: k, from: v, to: mapB.get(k) });
  }
  return { added, removed, modified };
}

// ───────────────────────────────────────────────────────── geometry delta (kernel)

const TESS_LIN_TOL = 0.25;
const TESS_ANG_TOL = 0.5;

/** Min/max bbox from tessellation positions — no native bounds export exists. */
function bboxFromTess(positions) {
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  if (!Number.isFinite(minx)) return null;
  return { min: [minx, miny, minz], max: [maxx, maxy, maxz] };
}

function diag(bb) {
  if (!bb) return 0;
  return Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
}

/** Rebuild a recipe's handle + read real kernel mass props + tessellated bbox. */
function geomOf(recipe, forge, density) {
  if (!recipe || !recipe.kind || !forge) return null;
  let handle;
  try {
    handle = rebuildShape(recipe.kind, recipe.params || {});
  } catch {
    return null; // recipe kind the rebuilder doesn't support → no geom (flagged upstream)
  }
  if (!Number.isInteger(handle)) return null;
  let volume = null, area = null, com = null;
  try {
    const mp = forge.massProps(handle);
    volume = mp.volume; area = mp.area; com = mp.centerOfMass;
  } catch { /* leave null */ }
  let bbox = null;
  try {
    const tess = forge.tessellate(handle, TESS_LIN_TOL, TESS_ANG_TOL);
    bbox = bboxFromTess(tess.positions);
  } catch { /* leave null */ }
  const mass = (volume != null && density) ? (volume / 1e9) * density : null; // mm³→m³ · kg/m³
  return { volume, area, com, bbox, mass };
}

function delta(a, b) {
  if (a == null || b == null) return { a, b, delta: null, pct: null };
  const d = b - a;
  const pct = a !== 0 ? (d / a) * 100 : null;
  return { a, b, delta: d, pct };
}

/**
 * Geometry delta between two recipes via the real kernel. Returns null only
 * when no kernel/recipe is resolvable (honest scope flag, not a stub).
 */
export function geomDelta(recipeA, recipeB, forge, opts = {}) {
  if (forge) { try { setForgeKernel(forge); } catch { /* */ } }
  const density = opts.density ?? null;
  const ga = geomOf(recipeA, forge, density);
  const gb = geomOf(recipeB, forge, density);
  if (!ga || !gb) return null;
  const out = {
    volume: delta(ga.volume, gb.volume),
    area: delta(ga.area, gb.area),
    bbox: {
      a: ga.bbox ? [ga.bbox.min, ga.bbox.max] : null,
      b: gb.bbox ? [gb.bbox.min, gb.bbox.max] : null,
      diagA: diag(ga.bbox),
      diagB: diag(gb.bbox),
      deltaDiag: (ga.bbox && gb.bbox) ? diag(gb.bbox) - diag(ga.bbox) : null,
    },
  };
  if (ga.mass != null && gb.mass != null) out.mass = delta(ga.mass, gb.mass);
  return out;
}

/**
 * Full change-diff between two versions (ids or inline snapshots): the
 * structured recipeDiff PLUS a geomDelta when a kernel is available. The text
 * recipeDiff always returns; geomDelta is null (flagged) when no kernel/handle
 * is resolvable — diff still works text-only.
 *
 * @param {string|object} a  version id or { recipe, pmi }
 * @param {string|object} b  version id or { recipe, pmi }
 * @param {object} [forge]   live kernel for the geom delta
 * @returns { recipeDiff, geomDelta, geomDeltaAvailable }
 */
export function diff(a, b, forge, opts = {}) {
  const A = snapshotOf(a);
  const B = snapshotOf(b);
  const rDiff = recipeDiff(A, B);
  let gDelta = null;
  if (forge) gDelta = geomDelta(A.recipe, B.recipe, forge, opts);
  return { recipeDiff: rDiff, geomDelta: gDelta, geomDeltaAvailable: gDelta != null };
}

// ───────────────────────────────────────────────────────── where-used + impact

/**
 * Which assemblies/parents reference `itemId`. Direct parents wrap
 * pdmStore.whereUsed; with `transitive`, BFS up the BOM edge graph to ALL
 * ancestors (cycle-guarded like pdmStore.linkBom).
 *
 * @returns [{ itemId, partNumber, name, qty, depth }]
 */
export function whereUsed(itemId, { transitive = false } = {}) {
  if (!transitive) {
    let rows = [];
    try { rows = pdmWhereUsed(itemId); } catch { rows = []; }
    return rows
      .filter((r) => r && r.parent)
      .map((r) => ({
        itemId: r.parent.id,
        partNumber: r.parent.partNumber,
        name: r.parent.name,
        qty: r.qty,
        depth: 1,
      }));
  }
  // Transitive: BFS up the edge graph.
  let boms = [];
  try { boms = listBoms(); } catch { boms = []; }
  const parentsOf = new Map(); // childId → [{ parentId, qty }]
  for (const e of boms) {
    if (!parentsOf.has(e.childItemId)) parentsOf.set(e.childItemId, []);
    parentsOf.get(e.childItemId).push({ parentId: e.parentItemId, qty: e.qty });
  }
  const out = [];
  const seen = new Set([itemId]);
  let frontier = [{ id: itemId, depth: 0 }];
  while (frontier.length) {
    const next = [];
    for (const { id, depth } of frontier) {
      for (const { parentId, qty } of (parentsOf.get(id) || [])) {
        if (seen.has(parentId)) continue;
        seen.add(parentId);
        const item = safeGetItem(parentId);
        out.push({
          itemId: parentId,
          partNumber: item ? item.partNumber : parentId,
          name: item ? item.name : parentId,
          qty,
          depth: depth + 1,
        });
        next.push({ id: parentId, depth: depth + 1 });
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Impact analysis: the transitive parent closure — every assembly/parent that
 * would need REBUILD/REVALIDATION if `itemId` changes. Deduped by itemId, each
 * tagged with the reason + shallowest depth at which it is reached.
 *
 * @returns [{ itemId, partNumber, name, depth, reason:'rebuild' }]
 */
export function impact(itemId) {
  return whereUsed(itemId, { transitive: true }).map((r) => ({
    itemId: r.itemId,
    partNumber: r.partNumber,
    name: r.name,
    depth: r.depth,
    reason: 'rebuild',
  }));
}

function safeGetItem(id) { try { return getItem(id); } catch { return null; } }

// ───────────────────────────────────────────────────────── serialize / state

/** Lossless, key-sorted text dump of the whole version graph (text-diffable). */
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

export const __test = {
  canonicalize, hashContent, mul64, utf8Bytes, computeVersionId,
  mergeParams, mergeKeyedList, mergeBase, ancestors,
  bboxFromTess, diag, geomOf, normalizeSnapshot,
  LS_KEY, LS_TMP,
};

export default {
  commit, branch, tag, checkout, merge, mergeBranches, mergeBase,
  diff, recipeDiff, geomDelta, whereUsed, impact,
  log, listBranches, listTags, getCommit, headOf, currentBranch,
  serializeVersion, serializeState, hashContent, canonicalize,
};
