// Forge-133 — Product Data Management (PDM) store.
//
// A real item-revision graph backed by localStorage with proper schema
// versioning. PDM-equivalent surface for ArchDisc Forge:
//
//   • Items (one per real-world part), each carrying a part number,
//     descriptive name, material, and a chain of revisions.
//   • Revisions step through letters A → B → C … per ASME Y14.35M
//     (skipping I, O, Q, S, X, Z so handwritten Os/0s and Ss/5s never
//     get confused on a drawing). Every revise() call attaches the
//     ECN identifier that drove the change.
//   • ECNs (Engineering Change Notices) — numbered + dated, linking
//     the affected items so traceability runs both ways.
//   • Lifecycle states — WIP, Released, Obsolete. Only the Released
//     revision is what ships; the WIP cone is where engineering work
//     happens.
//   • Check-in / check-out locks an item to a single user with a
//     timestamped history note. A second checkout while locked throws.
//   • BOM edges link a child item-id to its parent with quantity, so
//     bomDiff() / whereUsed() / releasedBom() / workingBom() return
//     real graphs, not stubs.
//
// Schema version is recorded so future migrations have a known floor.
// All set-mutating helpers persist immediately, notify subscribers, and
// return the affected entity for callers to thread into UI state.

const LS_KEY        = 'forge.v4.pdm';
const SCHEMA_VERSION = 1;

// ASME Y14.35M — these letters are skipped to avoid confusion
// (I↔1, O↔0, Q↔O, S↔5, X↔×, Z↔2). The sequence runs:
//   A, B, C, D, E, F, G, H, J, K, L, M, N, P, R, T, U, V, W, Y
// then doubles: AA, AB, AC, … (we extend rather than wrap).
const SKIP = new Set(['I', 'O', 'Q', 'S', 'X', 'Z']);

// Build the ordered letter list once.
const REV_LETTERS = (() => {
  const out = [];
  for (let code = 65; code <= 90; code++) {
    const c = String.fromCharCode(code);
    if (!SKIP.has(c)) out.push(c);
  }
  return out;
})();

/**
 * Return the next ASME revision letter after `current`.
 *
 *   nextRevLetter()      → 'A'
 *   nextRevLetter('A')   → 'B'
 *   nextRevLetter('H')   → 'J'   (skips I)
 *   nextRevLetter('N')   → 'P'   (skips O)
 *   nextRevLetter('Y')   → 'AA'  (extend)
 *   nextRevLetter('AA')  → 'AB'
 *   nextRevLetter('AH')  → 'AJ'
 */
export function nextRevLetter(current) {
  if (!current) return REV_LETTERS[0];
  const s = String(current).toUpperCase();
  // Single-letter case.
  if (s.length === 1) {
    const idx = REV_LETTERS.indexOf(s);
    if (idx === -1) {
      // Unknown letter (could be skipped) — treat as starting fresh.
      return REV_LETTERS[0];
    }
    if (idx + 1 < REV_LETTERS.length) return REV_LETTERS[idx + 1];
    // After 'Y' → 'AA'.
    return REV_LETTERS[0] + REV_LETTERS[0];
  }
  // Multi-letter — increment the right-most position; carry left.
  const chars = s.split('');
  let i = chars.length - 1;
  while (i >= 0) {
    const cur = chars[i];
    const idx = REV_LETTERS.indexOf(cur);
    if (idx === -1) {
      chars[i] = REV_LETTERS[0];
      break;
    }
    if (idx + 1 < REV_LETTERS.length) {
      chars[i] = REV_LETTERS[idx + 1];
      return chars.join('');
    }
    // overflow this digit → wrap to A and carry left
    chars[i] = REV_LETTERS[0];
    i--;
  }
  // Carried past the leftmost position → grow the string.
  return REV_LETTERS[0] + chars.join('');
}

// ── persistence ──────────────────────────────────────────────────────

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    items:    [],   // { id, partNumber, name, material, currentRev, lifecycle, lockedBy, createdAt }
    revs:     [],   // { id, itemId, rev, ecnRef, createdAt, note }
    ecns:     [],   // { id, number, date, reason, affectedItems: [itemId] }
    boms:     [],   // { id, parentItemId, childItemId, qty, createdAt }
    history:  [],   // { id, itemId, kind, user, note, ts }
    locks:    {},   // itemId -> { user, ts }
  };
}

function loadLS() {
  if (typeof localStorage === 'undefined') return emptyState();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return emptyState();
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return emptyState();
    if (v.schemaVersion !== SCHEMA_VERSION) {
      // Future-proof: if a stale schema is encountered, archive it and
      // start fresh. We never silently mangle older data.
      try {
        localStorage.setItem(`${LS_KEY}.archive.${v.schemaVersion ?? 0}`, raw);
      } catch { /* quota — best effort */ }
      return emptyState();
    }
    // Defensive: ensure every array/map exists even if a partial state
    // is read back (e.g. a hand-edit in devtools).
    const base = emptyState();
    return {
      schemaVersion: SCHEMA_VERSION,
      items:   Array.isArray(v.items)   ? v.items   : base.items,
      revs:    Array.isArray(v.revs)    ? v.revs    : base.revs,
      ecns:    Array.isArray(v.ecns)    ? v.ecns    : base.ecns,
      boms:    Array.isArray(v.boms)    ? v.boms    : base.boms,
      history: Array.isArray(v.history) ? v.history : base.history,
      locks:   (v.locks && typeof v.locks === 'object') ? v.locks : base.locks,
    };
  } catch {
    return emptyState();
  }
}

function saveLS(state) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
  catch { /* quota or denied — store remains in-memory */ }
}

let _state = loadLS();
const _subs = new Set();

function notify() {
  for (const s of _subs) {
    try { s(); } catch { /* keep going */ }
  }
}

function persist() {
  saveLS(_state);
  notify();
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(16)}`;
}

// ── selectors ────────────────────────────────────────────────────────

export function listItems()   { return _state.items.slice();   }
export function listRevs()    { return _state.revs.slice();    }
export function listEcns()    { return _state.ecns.slice();    }
export function listBoms()    { return _state.boms.slice();    }
export function listHistory() { return _state.history.slice(); }
export function getLock(itemId) { return _state.locks[itemId] ?? null; }

export function getItem(itemId) {
  return _state.items.find((it) => it.id === itemId) || null;
}
export function revsForItem(itemId) {
  return _state.revs.filter((r) => r.itemId === itemId)
                    .sort((a, b) => a.createdAt - b.createdAt);
}
export function historyForItem(itemId) {
  return _state.history.filter((h) => h.itemId === itemId)
                       .sort((a, b) => a.ts - b.ts);
}

// ── mutations ────────────────────────────────────────────────────────

/**
 * Create a new item with starting revision 'A' in WIP lifecycle.
 */
export function createItem({ partNumber, name, material }) {
  const pn = String(partNumber || '').trim();
  if (!pn) throw new Error('createItem: partNumber required');
  if (_state.items.some((it) => it.partNumber === pn)) {
    throw new Error(`createItem: partNumber "${pn}" already exists`);
  }
  const id = uid('item');
  const now = Date.now();
  const item = {
    id,
    partNumber: pn,
    name:       String(name || pn),
    material:   String(material || 'unspecified'),
    currentRev: 'A',
    lifecycle:  'WIP',
    lockedBy:   null,
    createdAt:  now,
  };
  const rev = {
    id:        uid('rev'),
    itemId:    id,
    rev:       'A',
    ecnRef:    null,
    note:      'initial creation',
    createdAt: now,
  };
  _state.items = [..._state.items, item];
  _state.revs  = [..._state.revs, rev];
  _state.history = [..._state.history, {
    id:    uid('h'),
    itemId: id,
    kind:  'create',
    user:  'system',
    note:  `Item ${pn} created at rev A`,
    ts:    now,
  }];
  persist();
  return item;
}

/**
 * Bump an item to the next revision letter. Optionally tag with an ECN.
 * Lifecycle is reset to 'WIP' because a new rev hasn't been released
 * yet — the user must explicitly setLifecycle('Released') after review.
 */
export function revise(itemId, ecnRef = null) {
  const idx = _state.items.findIndex((it) => it.id === itemId);
  if (idx === -1) throw new Error(`revise: unknown itemId ${itemId}`);
  const item = _state.items[idx];
  if (item.lockedBy) {
    throw new Error(`revise: item ${item.partNumber} is locked by ${item.lockedBy}`);
  }
  const nextRev = nextRevLetter(item.currentRev);
  const now = Date.now();
  const updated = { ...item, currentRev: nextRev, lifecycle: 'WIP' };
  const rev = {
    id:        uid('rev'),
    itemId,
    rev:       nextRev,
    ecnRef:    ecnRef || null,
    note:      ecnRef ? `revision per ${ecnRef}` : 'engineering revision',
    createdAt: now,
  };
  _state.items = [
    ..._state.items.slice(0, idx),
    updated,
    ..._state.items.slice(idx + 1),
  ];
  _state.revs = [..._state.revs, rev];
  _state.history = [..._state.history, {
    id:    uid('h'),
    itemId,
    kind:  'revise',
    user:  'system',
    note:  `Bumped ${item.partNumber} ${item.currentRev} → ${nextRev}${ecnRef ? ` (${ecnRef})` : ''}`,
    ts:    now,
  }];
  persist();
  return updated;
}

/**
 * Acquire an exclusive lock for `user` on `itemId`. Throws if already
 * locked by someone else.
 */
export function checkout(itemId, user) {
  const idx = _state.items.findIndex((it) => it.id === itemId);
  if (idx === -1) throw new Error(`checkout: unknown itemId ${itemId}`);
  const item = _state.items[idx];
  const u = String(user || '').trim();
  if (!u) throw new Error('checkout: user required');
  const existing = _state.locks[itemId];
  if (existing && existing.user !== u) {
    throw new Error(`checkout: ${item.partNumber} already checked out by ${existing.user}`);
  }
  const now = Date.now();
  _state.locks = { ..._state.locks, [itemId]: { user: u, ts: now } };
  _state.items = [
    ..._state.items.slice(0, idx),
    { ...item, lockedBy: u },
    ..._state.items.slice(idx + 1),
  ];
  _state.history = [..._state.history, {
    id:    uid('h'),
    itemId,
    kind:  'checkout',
    user:  u,
    note:  `Checked out by ${u}`,
    ts:    now,
  }];
  persist();
  return _state.items[idx];
}

/**
 * Release the lock held by `user` and append the change `note` to the
 * history. Throws if the lock is held by someone else.
 */
export function checkin(itemId, user, note = '') {
  const idx = _state.items.findIndex((it) => it.id === itemId);
  if (idx === -1) throw new Error(`checkin: unknown itemId ${itemId}`);
  const item = _state.items[idx];
  const u = String(user || '').trim();
  if (!u) throw new Error('checkin: user required');
  const existing = _state.locks[itemId];
  if (!existing) throw new Error(`checkin: ${item.partNumber} not currently locked`);
  if (existing.user !== u) {
    throw new Error(`checkin: ${item.partNumber} locked by ${existing.user}, not ${u}`);
  }
  const now = Date.now();
  const locks = { ..._state.locks };
  delete locks[itemId];
  _state.locks = locks;
  _state.items = [
    ..._state.items.slice(0, idx),
    { ...item, lockedBy: null },
    ..._state.items.slice(idx + 1),
  ];
  _state.history = [..._state.history, {
    id:    uid('h'),
    itemId,
    kind:  'checkin',
    user:  u,
    note:  note ? String(note) : `Checked in by ${u}`,
    ts:    now,
  }];
  persist();
  return _state.items[idx];
}

/**
 * Move an item between lifecycle states.
 *   WIP      — engineering in progress
 *   Released — frozen production rev
 *   Obsolete — superseded, do-not-use
 */
export function setLifecycle(itemId, lifecycle) {
  const allowed = new Set(['WIP', 'Released', 'Obsolete']);
  if (!allowed.has(lifecycle)) {
    throw new Error(`setLifecycle: invalid state ${lifecycle}`);
  }
  const idx = _state.items.findIndex((it) => it.id === itemId);
  if (idx === -1) throw new Error(`setLifecycle: unknown itemId ${itemId}`);
  const item = _state.items[idx];
  const now = Date.now();
  _state.items = [
    ..._state.items.slice(0, idx),
    { ...item, lifecycle },
    ..._state.items.slice(idx + 1),
  ];
  _state.history = [..._state.history, {
    id:    uid('h'),
    itemId,
    kind:  'lifecycle',
    user:  'system',
    note:  `Lifecycle ${item.lifecycle} → ${lifecycle}`,
    ts:    now,
  }];
  persist();
  return _state.items[idx];
}

/**
 * Add a new ECN linking the listed items as affected.
 */
export function addEcn({ number, date, reason, affectedItems = [] }) {
  const num = String(number || '').trim();
  if (!num) throw new Error('addEcn: number required');
  if (_state.ecns.some((e) => e.number === num)) {
    throw new Error(`addEcn: ECN number "${num}" already exists`);
  }
  // Validate the affected items exist.
  const knownIds = new Set(_state.items.map((it) => it.id));
  const affected = affectedItems.filter((id) => knownIds.has(id));
  const ecn = {
    id:             uid('ecn'),
    number:         num,
    date:           date || new Date().toISOString().slice(0, 10),
    reason:         String(reason || ''),
    affectedItems:  affected,
    createdAt:      Date.now(),
  };
  _state.ecns = [..._state.ecns, ecn];
  for (const itemId of affected) {
    _state.history = [..._state.history, {
      id:    uid('h'),
      itemId,
      kind:  'ecn',
      user:  'system',
      note:  `Linked to ECN ${num}`,
      ts:    Date.now(),
    }];
  }
  persist();
  return ecn;
}

/**
 * Link a child item under a parent with a given quantity. If the same
 * (parent, child) pair already exists, the qty is summed (real BOM
 * behaviour — two M6 bolts in a sub-assembly become qty: 4 if the
 * sub-assembly is referenced twice).
 */
export function linkBom(itemId, parentItemId, qty = 1) {
  if (itemId === parentItemId) {
    throw new Error('linkBom: an item cannot be its own parent');
  }
  const parent = getItem(parentItemId);
  const child  = getItem(itemId);
  if (!parent) throw new Error(`linkBom: unknown parentItemId ${parentItemId}`);
  if (!child)  throw new Error(`linkBom: unknown itemId ${itemId}`);
  // Cycle detection — walk up from parent; if we hit itemId, refuse.
  const visited = new Set();
  const walk = (id) => {
    if (visited.has(id)) return false;
    visited.add(id);
    if (id === itemId) return true;
    const ups = _state.boms.filter((b) => b.childItemId === id)
                           .map((b) => b.parentItemId);
    return ups.some(walk);
  };
  if (walk(parentItemId)) {
    throw new Error('linkBom: would create a cycle');
  }
  const q = Math.max(1, Math.floor(Number(qty) || 1));
  const existingIdx = _state.boms.findIndex(
    (b) => b.parentItemId === parentItemId && b.childItemId === itemId);
  let edge;
  if (existingIdx >= 0) {
    edge = { ..._state.boms[existingIdx], qty: _state.boms[existingIdx].qty + q };
    _state.boms = [
      ..._state.boms.slice(0, existingIdx),
      edge,
      ..._state.boms.slice(existingIdx + 1),
    ];
  } else {
    edge = {
      id:           uid('bom'),
      parentItemId,
      childItemId:  itemId,
      qty:          q,
      createdAt:    Date.now(),
    };
    _state.boms = [..._state.boms, edge];
  }
  persist();
  return edge;
}

/**
 * Remove a BOM edge by id.
 */
export function unlinkBom(edgeId) {
  const before = _state.boms.length;
  _state.boms = _state.boms.filter((b) => b.id !== edgeId);
  if (_state.boms.length !== before) persist();
}

// ── derived queries ──────────────────────────────────────────────────

/**
 * Return all parent items that reference `itemId` (transitive disabled —
 * direct parents only; callers can recurse if they need transitive).
 */
export function whereUsed(itemId) {
  const parents = _state.boms.filter((b) => b.childItemId === itemId);
  return parents.map((b) => ({
    edge:   b,
    parent: getItem(b.parentItemId),
    qty:    b.qty,
  })).filter((row) => row.parent != null);
}

/**
 * BOM rolled up for the *released* revision of a parent item. If the
 * parent is not currently Released, returns an empty array (the
 * released BOM doesn't exist yet).
 */
export function releasedBom(itemId) {
  const item = getItem(itemId);
  if (!item || item.lifecycle !== 'Released') return [];
  return _state.boms
    .filter((b) => b.parentItemId === itemId)
    .map((b) => ({
      edge:  b,
      child: getItem(b.childItemId),
      qty:   b.qty,
      rev:   getItem(b.childItemId)?.currentRev ?? null,
    }))
    .filter((row) => row.child != null);
}

/**
 * BOM rolled up for the working (latest WIP) cone of a parent item.
 * Always returns the current edges, regardless of lifecycle state.
 */
export function workingBom(itemId) {
  return _state.boms
    .filter((b) => b.parentItemId === itemId)
    .map((b) => ({
      edge:  b,
      child: getItem(b.childItemId),
      qty:   b.qty,
      rev:   getItem(b.childItemId)?.currentRev ?? null,
    }))
    .filter((row) => row.child != null);
}

/**
 * Compute the diff between the released and working BOM for a parent.
 * Returns:
 *   added    — edges present in working but not released
 *   removed  — edges present in released but not working
 *   changed  — same (parent,child) but qty or child rev differs
 */
export function bomDiff(parentId) {
  const released = releasedBom(parentId);
  const working  = workingBom(parentId);
  const key = (row) => row.child.id;
  const relMap = new Map(released.map((r) => [key(r), r]));
  const wrkMap = new Map(working.map((r) => [key(r), r]));
  const added   = [];
  const removed = [];
  const changed = [];
  for (const [k, w] of wrkMap) {
    const r = relMap.get(k);
    if (!r) { added.push(w); continue; }
    if (r.qty !== w.qty || r.rev !== w.rev) {
      changed.push({ released: r, working: w });
    }
  }
  for (const [k, r] of relMap) {
    if (!wrkMap.has(k)) removed.push(r);
  }
  return { added, removed, changed };
}

// ── subscription hook ────────────────────────────────────────────────

export function subscribe(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}

/**
 * Convenience: snapshot every list as a single object. Useful for
 * React's useSyncExternalStore — but each call returns a fresh object
 * so identity-comparison is meaningful only on the underlying lists.
 */
export function snapshot() {
  return {
    items:   listItems(),
    revs:    listRevs(),
    ecns:    listEcns(),
    boms:    listBoms(),
    history: listHistory(),
  };
}

// ── test / dev helpers ───────────────────────────────────────────────

/**
 * Wipe persisted state. Used by e2e specs that need a clean slate.
 */
export function _resetForTests() {
  _state = emptyState();
  saveLS(_state);
  notify();
}

export const __SCHEMA_VERSION = SCHEMA_VERSION;
export const __LS_KEY = LS_KEY;
