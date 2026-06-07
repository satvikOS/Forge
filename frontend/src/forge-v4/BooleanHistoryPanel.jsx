// PUSH-103 (Slice-71 / Boolean Operations History panel — track + replay).
//
// Forge ships cut / fuse / common from the kernel (binding.cpp 411-425) and
// the v4 shell already lets a panel, a workbench, a plugin or Archie dispatch
// any of them through window.forge.cut / .fuse / .common — but there is no
// audit surface for which bool ops fired, against which two bodies, and what
// the result handle was. That's a real ergonomics gap once a user has stacked
// half-a-dozen booleans into a part: the feature tree shows the resulting
// body chain, but it doesn't remember which two predecessors built each
// result, and it can't replay or undo individual ops without throwing away
// every later edit.
//
// PUSH-103 ships the Boolean History panel:
//
//   • Right-docked panel reachable via the `tools.boolHistory` menu action
//     OR `window.__forgeOpenBoolHistory()`.
//
//   • A single subscriber to `forge:tool-dispatched` that filters the event
//     stream down to boolean tool ids. Each matched dispatch is recorded as
//     an immutable entry:
//
//       { id, op, aId, bId, resultId, when,
//         aSnapshot, bSnapshot, resultSnapshot }
//
//     Snapshots are shallow copies of the body record (excluding the live
//     three.js mesh reference) so an Undo can reinstate the originals on
//     `window.__forgeSetBodies` even after the kernel has already discarded
//     their handles.
//
//   • Imperative `window.__forgeRecordBooleanOp(entry)` so e2e specs, plugins
//     and Archie tool calls can record an op without firing through the
//     v4 dispatch surface. (The PUSH-103 e2e drives this path directly so it
//     doesn't have to spin up the kernel tool registry.)
//
//   • Per-row "Undo" button: removes the result body from `__forgeBodies`
//     and re-appends the a / b snapshots (with a fresh id suffix so the
//     feature tree doesn't collide with any later append that reused the
//     same id). After undo, the row is marked `undone` so a second click is
//     a no-op.
//
//   • Per-row "Replay" button: calls `window.forge[op]` against the live
//     handles for ids a and b (resolved by walking the live
//     `window.__forgeBodies` snapshot), commits the result back into the
//     scene via `__forgeAppendBody`, and appends a new history row tagged
//     `source: 'replay'` so the audit trail stays honest.
//
//   • "Undo last" button at the top: convenience that runs Undo against the
//     most recent non-undone op. Tracks how many entries are reachable for
//     undo and disables itself when none are left.
//
//   • Pure React + the existing window.__forge* surface. NO new npm packages,
//     NO C++ libs, NO external services. Pure UI-side bookkeeping.
//
//   • Multi-cam e2e contract honoured by `push-103-bool-history.spec.js` —
//     5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants

// The kernel-side tool ids that this panel treats as boolean ops. The
// brief explicitly asks for solid.cut / solid.fuse / solid.common — but
// the Forge v4 dispatch surface already routes through bool.union /
// bool.cut / bool.common (see kernelDispatch.js 424-437) so we listen
// for both naming conventions and normalise into a canonical `op` field.
export const FORGE_BOOL_TOOL_IDS = Object.freeze([
  'solid.cut', 'solid.fuse', 'solid.common',
  'bool.cut', 'bool.union', 'bool.common',
]);

// Canonical op name → the property on window.forge that runs the op.
// This is what the Replay button calls.
export const FORGE_BOOL_OP_KERNEL_FN = Object.freeze({
  cut:    'cut',
  fuse:   'fuse',
  common: 'common',
});

// Map any inbound tool id (solid.* or bool.*) to its canonical op name.
// Returns null for ids that aren't booleans so the listener can ignore
// every other forge:tool-dispatched event cheaply.
export function canonicalBoolOp(toolId) {
  if (typeof toolId !== 'string') return null;
  switch (toolId) {
    case 'solid.cut':    return 'cut';
    case 'bool.cut':     return 'cut';
    case 'solid.fuse':   return 'fuse';
    case 'bool.union':   return 'fuse';
    case 'solid.common': return 'common';
    case 'bool.common':  return 'common';
    default:             return null;
  }
}

export const FORGE_BOOL_HISTORY_EVENT = 'forge:bool-history-changed';

// Cap the history at 200 entries so a runaway plugin can't OOM the panel.
// 200 booleans is multiple orders of magnitude beyond what a real assembly
// session pushes — the panel will visibly recycle the bottom row in that
// pathological case rather than freeze.
export const FORGE_BOOL_HISTORY_CAP = 200;

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — exported so the e2e spec / Archie tool calls / plugins
// can drive the same logic without mounting the React panel first.

let _entryCounter = 0;
function nextEntryId() {
  _entryCounter += 1;
  return `bh-${Date.now().toString(36)}-${_entryCounter.toString(36)}`;
}

/** Snapshot a body record without the live three.js mesh ref. Mesh is
 *  rebuilt from `handle` on every scene re-derive, so we drop it here
 *  to keep the snapshot JSON-safe (matches PUSH-81's diagnostic dump). */
export function snapshotBody(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  for (const k of Object.keys(body)) {
    if (k === 'mesh' || k === 'three' || k === '_mesh') continue;
    out[k] = body[k];
  }
  return out;
}

/** Walk the live bodies array for the first body with a matching id. */
export function findBodyById(id) {
  if (typeof window === 'undefined' || typeof id !== 'string') return null;
  const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return arr.find((b) => b && b.id === id) || null;
}

/** Walk the live bodies array for the first body with a matching handle. */
export function findBodyByHandle(handle) {
  if (typeof window === 'undefined' || typeof handle !== 'number') return null;
  const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return arr.find((b) => b && b.handle === handle) || null;
}

/** Resolve { aId, bId } against the live bodies array → { aHandle, bHandle }.
 *  Returns null for either side that fails to resolve. The Replay button
 *  uses this to find live kernel handles for an op recorded against
 *  long-gone snapshots. */
export function resolveHandles(aId, bId) {
  const a = findBodyById(aId);
  const b = findBodyById(bId);
  return {
    a: (a && typeof a.handle === 'number') ? a.handle : null,
    b: (b && typeof b.handle === 'number') ? b.handle : null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// History store. A plain module-scope array gives us a single source of
// truth that the panel, the helper API and the menu-driven open both
// share. Mutations dispatch FORGE_BOOL_HISTORY_EVENT for live updates.

const _history = [];

/** Read the live history. Returns a fresh array so callers can mutate
 *  it without poisoning the store. */
export function getBoolHistory() {
  return _history.slice();
}

/** Record a boolean op entry. Accepts a partial entry — fills in id,
 *  when, undone defaults. Caps the history at FORGE_BOOL_HISTORY_CAP by
 *  dropping the oldest entry once the cap is hit. Returns the stored
 *  entry. Dispatches FORGE_BOOL_HISTORY_EVENT so the panel re-renders. */
export function recordBoolEntry(partial) {
  if (!partial || typeof partial !== 'object') return null;
  const op = canonicalBoolOp(partial.op) || canonicalBoolOp(partial.toolId)
             || (typeof partial.op === 'string' ? partial.op : null);
  if (!op) return null;
  const entry = Object.freeze({
    id: typeof partial.id === 'string' && partial.id ? partial.id : nextEntryId(),
    op,
    aId:      typeof partial.aId === 'string' ? partial.aId : null,
    bId:      typeof partial.bId === 'string' ? partial.bId : null,
    resultId: typeof partial.resultId === 'string' ? partial.resultId : null,
    aHandle:  typeof partial.aHandle === 'number' ? partial.aHandle : null,
    bHandle:  typeof partial.bHandle === 'number' ? partial.bHandle : null,
    resultHandle: typeof partial.resultHandle === 'number' ? partial.resultHandle : null,
    when:     typeof partial.when === 'number' ? partial.when : Date.now(),
    source:   typeof partial.source === 'string' ? partial.source : 'dispatch',
    aSnapshot:      partial.aSnapshot      ? snapshotBody(partial.aSnapshot)      : null,
    bSnapshot:      partial.bSnapshot      ? snapshotBody(partial.bSnapshot)      : null,
    resultSnapshot: partial.resultSnapshot ? snapshotBody(partial.resultSnapshot) : null,
    undone: false,
  });
  _history.push(entry);
  while (_history.length > FORGE_BOOL_HISTORY_CAP) _history.shift();
  _broadcast();
  return entry;
}

/** Mark an entry as undone. Returns the rewritten entry so callers can
 *  see the updated state. The new entry is a fresh frozen object — the
 *  store swaps it in by index. */
function _markUndone(entryId) {
  const i = _history.findIndex((e) => e.id === entryId);
  if (i < 0) return null;
  const cur = _history[i];
  if (cur.undone) return cur;
  const next = Object.freeze({ ...cur, undone: true });
  _history[i] = next;
  _broadcast();
  return next;
}

function _broadcast() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(FORGE_BOOL_HISTORY_EVENT, {
      detail: { count: _history.length },
    }));
  } catch {}
}

/** Drop every entry. Useful for the e2e spec to reset between tests
 *  and for the user-facing "Clear" button. */
export function clearBoolHistory() {
  _history.length = 0;
  _broadcast();
}

// ─────────────────────────────────────────────────────────────────────
// Listener — every forge:tool-dispatched is filtered through
// canonicalBoolOp. Matches are converted into history entries with the
// live bodies snapshotted at dispatch time.

function _onToolDispatched(e) {
  const detail = e?.detail;
  if (!detail) return;
  const op = canonicalBoolOp(detail.toolId);
  if (!op) return;
  const params = detail.params || {};
  // The Forge v4 dispatch shape is loose — kernelDispatch picks aId/bId
  // out of ctx + params (pickPair). We accept either explicit ids on
  // params (aId/bId) or fall back to whatever the live scene yields as
  // the last two native bodies, which is what kernelDispatch resolves
  // against when the user didn't pick.
  const aId = typeof params.aId === 'string' ? params.aId : null;
  const bId = typeof params.bId === 'string' ? params.bId : null;
  const aHandle = typeof params.a === 'number' ? params.a : null;
  const bHandle = typeof params.b === 'number' ? params.b : null;
  const aBody = aId ? findBodyById(aId) : (aHandle != null ? findBodyByHandle(aHandle) : null);
  const bBody = bId ? findBodyById(bId) : (bHandle != null ? findBodyByHandle(bHandle) : null);
  const resultHandle = (detail.result && typeof detail.result.shape === 'number')
    ? detail.result.shape
    : (typeof detail.result === 'number' ? detail.result : null);
  // params.resultId is the dispatch-author-supplied id of the body the
  // shell *will* commit for the result. The Forge v4 shell's __forgeAppendBody
  // batches into a React setState() so the live window.__forgeBodies
  // mirror trails the actual scene by one render cycle. By honouring
  // params.resultId first we capture the result body's stable id even
  // when the synthetic mirror hasn't caught up yet.
  const explicitResultId = typeof params.resultId === 'string' ? params.resultId : null;
  const resultBody = explicitResultId
    ? findBodyById(explicitResultId)
    : (resultHandle != null ? findBodyByHandle(resultHandle) : null);
  recordBoolEntry({
    op,
    aId:      aBody ? aBody.id : aId,
    bId:      bBody ? bBody.id : bId,
    aHandle:  aBody ? aBody.handle : aHandle,
    bHandle:  bBody ? bBody.handle : bHandle,
    resultId: explicitResultId || (resultBody ? resultBody.id : null),
    resultHandle,
    aSnapshot: aBody,
    bSnapshot: bBody,
    resultSnapshot: resultBody,
    source: detail.source === 'plugin' ? 'plugin' : 'dispatch',
    when: Date.now(),
  });
}

let _listenerInstalled = false;
function _installListener() {
  if (_listenerInstalled || typeof window === 'undefined') return;
  window.addEventListener('forge:tool-dispatched', _onToolDispatched);
  _listenerInstalled = true;
}
function _uninstallListener() {
  if (!_listenerInstalled || typeof window === 'undefined') return;
  window.removeEventListener('forge:tool-dispatched', _onToolDispatched);
  _listenerInstalled = false;
}

// ─────────────────────────────────────────────────────────────────────
// Operations — undo + replay. Both work against the live
// window.__forgeBodies snapshot via __forgeSetBodies (canonical setter).

/** Undo the boolean op recorded as `entryId`. Removes the result body
 *  from the scene and re-appends the a / b snapshots. Returns true if
 *  the scene was actually mutated. */
export function undoBooleanOp(entryId) {
  if (typeof window === 'undefined') return false;
  const entry = _history.find((e) => e.id === entryId);
  if (!entry || entry.undone) return false;
  const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies.slice() : [];
  let mutated = false;
  // Remove result body by id (and by handle for callers that didn't tag
  // the result with a stable id).
  const filtered = arr.filter((b) => {
    if (!b) return false;
    if (entry.resultId && b.id === entry.resultId) { mutated = true; return false; }
    if (entry.resultHandle != null && b.handle === entry.resultHandle) {
      mutated = true; return false;
    }
    return true;
  });
  // Re-append the originals if they aren't already in the scene. Using
  // a fresh id suffix avoids collision with any later append that
  // reused the same string id (e.g. a Drag-Drop import).
  const restored = filtered.slice();
  if (entry.aSnapshot && !restored.find((b) => b.id === entry.aSnapshot.id)) {
    restored.push({ ...entry.aSnapshot, id: `${entry.aSnapshot.id}-undo` });
    mutated = true;
  }
  if (entry.bSnapshot && !restored.find((b) => b.id === entry.bSnapshot.id)) {
    restored.push({ ...entry.bSnapshot, id: `${entry.bSnapshot.id}-undo` });
    mutated = true;
  }
  if (mutated && typeof window.__forgeSetBodies === 'function') {
    window.__forgeSetBodies(restored);
    try { window.__forgeBodies = restored; } catch {}
  }
  _markUndone(entry.id);
  return mutated;
}

/** Replay the boolean op recorded as `entryId` against whatever ids
 *  a / b currently resolve to. Returns the new result body record (or
 *  null if either side couldn't be resolved). */
export function replayBooleanOp(entryId) {
  if (typeof window === 'undefined') return null;
  const entry = _history.find((e) => e.id === entryId);
  if (!entry) return null;
  const fnName = FORGE_BOOL_OP_KERNEL_FN[entry.op];
  const fn = window.forge?.[fnName];
  if (typeof fn !== 'function') return null;
  // Resolve handles in priority order: live id → snapshot handle.
  // (Snapshot handle is the kernel handle at dispatch time; the kernel
  // keeps it valid as long as the underlying body lives.)
  let { a, b } = resolveHandles(entry.aId, entry.bId);
  if (a == null && typeof entry.aHandle === 'number') a = entry.aHandle;
  if (b == null && typeof entry.bHandle === 'number') b = entry.bHandle;
  if (a == null || b == null) return null;
  let handle;
  try { handle = fn(a, b); }
  catch { return null; }
  if (typeof handle !== 'number') return null;
  const replayId = `bool-replay-${Date.now().toString(36)}`;
  const body = {
    id: replayId,
    kind: 'native',
    handle,
    toolId: `solid.${entry.op}`,
    name: `${entry.op[0].toUpperCase()}${entry.op.slice(1)} (replay)`,
    params: { a, b, aId: entry.aId, bId: entry.bId, replayOf: entry.id },
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }
  // Also record the replay as its own history entry so the audit trail
  // stays honest. Tag the source so the panel can render it distinctly.
  recordBoolEntry({
    op: entry.op,
    aId: entry.aId,
    bId: entry.bId,
    aHandle: a,
    bHandle: b,
    resultId: replayId,
    resultHandle: handle,
    aSnapshot: findBodyById(entry.aId),
    bSnapshot: findBodyById(entry.bId),
    resultSnapshot: body,
    source: 'replay',
    when: Date.now(),
  });
  return body;
}

/** Undo the most recent non-undone op. Returns the entry that was
 *  undone, or null if nothing was reachable for undo. */
export function undoLastBooleanOp() {
  for (let i = _history.length - 1; i >= 0; i -= 1) {
    if (!_history[i].undone) {
      const id = _history[i].id;
      const ok = undoBooleanOp(id);
      return ok ? _history.find((e) => e.id === id) : null;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching BatchRenamePanel / BodyColorsPanel.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 520,
  zIndex: 1332,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const PILL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  padding: '1px 6px',
  borderRadius: 'var(--forge-radius-pill, 10px)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const TOOLBAR = {
  display: 'flex', alignItems: 'center', gap: 6,
};
const ACTION_BTN = (variant = 'default', enabled = true) => ({
  background: !enabled
    ? 'var(--forge-surface, #1f242c)'
    : variant === 'primary'
      ? 'var(--forge-accent, #4f87ff)'
      : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: !enabled
    ? 'var(--forge-ink-mute, #9aa1ab)'
    : variant === 'primary' ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: variant === 'primary' ? 600 : 400,
  opacity: enabled ? 1 : 0.55,
});
const TABLE_BOX = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  background: 'var(--forge-canvas-1, #0e1218)',
};
const TABLE_HEAD_ROW = {
  display: 'grid',
  gridTemplateColumns: '32px 70px 1fr 1fr 70px 110px',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  background: 'var(--forge-canvas-2, #161b22)',
  position: 'sticky', top: 0, zIndex: 1,
};
const ROW = (undone, replay) => ({
  display: 'grid',
  gridTemplateColumns: '32px 70px 1fr 1fr 70px 110px',
  alignItems: 'center',
  gap: 6,
  padding: '5px 8px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
  background: undone
    ? 'rgba(255, 99, 99, 0.06)'
    : replay
      ? 'rgba(79, 135, 255, 0.05)'
      : 'transparent',
  opacity: undone ? 0.55 : 1,
});
const ROW_INDEX = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  textAlign: 'right',
};
const OP_CELL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  textTransform: 'uppercase',
  fontWeight: 600,
};
const ID_CELL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const ROW_BTN_GROUP = {
  display: 'flex', gap: 4,
};
const ROW_BTN = (enabled) => ({
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: enabled ? 'var(--forge-ink, #dadde2)' : 'var(--forge-ink-mute, #9aa1ab)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  padding: '2px 6px',
  borderRadius: 3,
  fontSize: 10,
  opacity: enabled ? 1 : 0.5,
});

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function BooleanHistoryPanel({ open, onClose }) {
  const [tick, setTick] = useState(0);

  // Subscribe to history changes while open. We don't snapshot into
  // local state — we re-render from getBoolHistory() each tick because
  // entries are immutable, so a fresh slice is cheap and keeps the live
  // dispatch listener as the single source of truth.
  useEffect(() => {
    if (!open) return undefined;
    const onChange = () => setTick((n) => n + 1);
    window.addEventListener(FORGE_BOOL_HISTORY_EVENT, onChange);
    // Re-sync once when the panel opens so we display whatever
    // accumulated before mount.
    setTick((n) => n + 1);
    return () => window.removeEventListener(FORGE_BOOL_HISTORY_EVENT, onChange);
  }, [open]);

  const entries = useMemo(() => getBoolHistory(), [tick]);
  const undoableCount = useMemo(() => entries.filter((e) => !e.undone).length, [entries]);

  const onUndoLast = useCallback(() => {
    undoLastBooleanOp();
  }, []);

  const onClear = useCallback(() => {
    clearBoolHistory();
  }, []);

  const onRowUndo = useCallback((id) => {
    undoBooleanOp(id);
  }, []);

  const onRowReplay = useCallback((id) => {
    replayBooleanOp(id);
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Boolean operations history"
         data-testid="forge-bool-history-panel"
         data-entry-count={entries.length}
         data-undoable-count={undoableCount}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.rect" size={14} />
        <strong style={{ fontSize: 13 }}>Boolean History</strong>
        <span data-testid="forge-bool-history-count" style={PILL}>
          {entries.length} {entries.length === 1 ? 'op' : 'ops'}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onUndoLast}
                disabled={undoableCount === 0}
                title="Undo the most recent recorded op"
                data-testid="forge-bool-history-undo-last"
                style={ACTION_BTN('primary', undoableCount > 0)}>
          Undo last
        </button>
        <button type="button"
                onClick={onClear}
                disabled={entries.length === 0}
                title="Clear every history entry"
                data-testid="forge-bool-history-clear"
                style={ACTION_BTN('default', entries.length > 0)}>
          Clear
        </button>
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close boolean history panel"
                data-testid="forge-bool-history-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{
        fontSize: 10,
        color: 'var(--forge-ink-mute, #9aa1ab)',
      }}>
        Subscribes to <code>forge:tool-dispatched</code> for solid.cut /
        solid.fuse / solid.common (and the bool.* aliases). Per-row Undo
        removes the result body and restores the originals; Replay re-runs
        the op against the live a / b ids.
      </div>

      {entries.length === 0 ? (
        <div data-testid="forge-bool-history-empty"
             style={{
               padding: '24px 0',
               textAlign: 'center',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No boolean ops recorded yet. Run cut / fuse / common from any
          workbench, or fire <code>forge:tool-dispatched</code> via a
          plugin — the entry will appear here.
        </div>
      ) : (
        <div data-testid="forge-bool-history-table" style={TABLE_BOX}>
          <div style={TABLE_HEAD_ROW}>
            <span style={{ textAlign: 'right' }}>#</span>
            <span>Op</span>
            <span>A</span>
            <span>B</span>
            <span>Result</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>
          {entries.map((e, i) => {
            const replay = e.source === 'replay';
            const aDisplay = e.aId || (e.aHandle != null ? `h${e.aHandle}` : '—');
            const bDisplay = e.bId || (e.bHandle != null ? `h${e.bHandle}` : '—');
            const resultDisplay = e.resultId
              || (e.resultHandle != null ? `h${e.resultHandle}` : '—');
            return (
              <div key={e.id}
                   data-testid="forge-bool-history-row"
                   data-entry-id={e.id}
                   data-op={e.op}
                   data-a-id={e.aId || ''}
                   data-b-id={e.bId || ''}
                   data-result-id={e.resultId || ''}
                   data-undone={e.undone ? '1' : '0'}
                   data-source={e.source}
                   style={ROW(e.undone, replay)}>
                <span style={ROW_INDEX}>{i + 1}</span>
                <span style={OP_CELL} title={e.source}>{e.op}</span>
                <span style={ID_CELL} title={aDisplay}>{aDisplay}</span>
                <span style={ID_CELL} title={bDisplay}>{bDisplay}</span>
                <span style={ID_CELL} title={resultDisplay}>{resultDisplay}</span>
                <span style={{ ...ROW_BTN_GROUP, justifyContent: 'flex-end' }}>
                  <button type="button"
                          onClick={() => onRowUndo(e.id)}
                          disabled={e.undone}
                          title="Undo this op — remove result, restore a + b"
                          data-testid={`forge-bool-history-undo-${e.id}`}
                          data-action="undo"
                          style={ROW_BTN(!e.undone)}>
                    Undo
                  </button>
                  <button type="button"
                          onClick={() => onRowReplay(e.id)}
                          title="Replay this op against the live a / b ids"
                          data-testid={`forge-bool-history-replay-${e.id}`}
                          data-action="replay"
                          style={ROW_BTN(true)}>
                    Replay
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <footer style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
        fontSize: 10,
        color: 'var(--forge-ink-mute, #9aa1ab)',
      }}>
        <span data-testid="forge-bool-history-undoable">
          {undoableCount} undoable
        </span>
        <span style={{ flex: 1 }} />
        <span>
          Cap: {FORGE_BOOL_HISTORY_CAP} entries
        </span>
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Module-load install. The forge:tool-dispatched listener + the helper
// API + the open/close imperatives are installed eagerly so the e2e
// spec can drive the panel before any React Host mounts. The React
// Host below is still mounted by App.jsx for the visible UI; opening
// it (window.__forgeOpenBoolHistory or the tools.boolHistory menu
// action) flips the module-scope `_openState` flag which the Host
// effect reads via the FORGE_BOOL_HISTORY_OPEN_EVENT.

const FORGE_BOOL_HISTORY_OPEN_EVENT = 'forge:bool-history-open-state';
let _openState = false;

function _setOpenState(next) {
  const v = !!next;
  if (_openState === v) return;
  _openState = v;
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(FORGE_BOOL_HISTORY_OPEN_EVENT, {
        detail: { open: v },
      }));
    } catch {}
  }
}

/** Re-entrant install — safe to call from multiple bootstrap paths
 *  (module-load side effect, React Host effect, plugin code) because
 *  each step is idempotent: the listener install is guarded by
 *  _listenerInstalled, and writing the same function reference into
 *  the window globals is a no-op. */
export function installBoolHistoryGlobals() {
  if (typeof window === 'undefined') return;
  _installListener();
  window.__forgeOpenBoolHistory  = () => _setOpenState(true);
  window.__forgeCloseBoolHistory = () => _setOpenState(false);
  if (!window.__forgeBoolHistoryHelper) {
    window.__forgeBoolHistoryHelper = Object.freeze({
      canonicalBoolOp,
      snapshotBody,
      findBodyById,
      findBodyByHandle,
      resolveHandles,
      getBoolHistory,
      recordBoolEntry,
      undoBooleanOp,
      replayBooleanOp,
      undoLastBooleanOp,
      clearBoolHistory,
      EVENT_NAME: FORGE_BOOL_HISTORY_EVENT,
      OPEN_EVENT_NAME: FORGE_BOOL_HISTORY_OPEN_EVENT,
      TOOL_IDS: FORGE_BOOL_TOOL_IDS,
      CAP: FORGE_BOOL_HISTORY_CAP,
    });
  }
  window.__forgeRecordBooleanOp = recordBoolEntry;
  // Menu action listener — installs once regardless of how many React
  // Hosts mount over the lifetime of the app.
  if (!window.__forgeBoolHistoryMenuListenerInstalled) {
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.boolHistory') _setOpenState(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    window.__forgeBoolHistoryMenuListenerInstalled = true;
  }
}

// Module-load side effect — install the helper API + listener
// immediately so they're available without React having mounted yet.
// This is the bootstrap path the e2e spec relies on.
installBoolHistoryGlobals();

// ─────────────────────────────────────────────────────────────────────
// Standalone React root — mounts the panel UI directly into document.body
// the first time __forgeOpenBoolHistory() fires (or the tools.boolHistory
// menu action is dispatched). This decouples the visible UI from
// App.jsx so the panel is reachable regardless of whether the App tree
// also mounted <BooleanHistoryPanelHost />.

let _standaloneRoot = null;
let _standaloneContainer = null;

function _ensureStandaloneRoot() {
  if (typeof document === 'undefined') return;
  if (_standaloneRoot) return;
  _standaloneContainer = document.createElement('div');
  _standaloneContainer.setAttribute('data-forge-bool-history-root', '');
  document.body.appendChild(_standaloneContainer);
  _standaloneRoot = createRoot(_standaloneContainer);
  _standaloneRoot.render(<BooleanHistoryPanelHost />);
}

if (typeof window !== 'undefined') {
  // Wrap the open-state setter so the first open mounts the standalone
  // React root if no Host has registered itself yet. The Host registers
  // itself by setting window.__forgeBoolHistoryHostRegistered = true on
  // mount; if that flag is missing when open is requested, we mount our
  // own root.
  const _origOpen = _setOpenState;
  const _wrappedOpen = (next) => {
    if (next && !window.__forgeBoolHistoryHostRegistered) {
      _ensureStandaloneRoot();
    }
    _origOpen(next);
  };
  window.__forgeOpenBoolHistory  = () => _wrappedOpen(true);
  window.__forgeCloseBoolHistory = () => _wrappedOpen(false);
  // Re-route the menu listener via the wrapped opener so the standalone
  // root is mounted on menu-driven opens too.
  window.removeEventListener?.('forge:menu-action',
    window.__forgeBoolHistoryMenuListenerHandle || (() => {}));
  const onMenuWrapped = (e) => {
    const id = e?.detail?.id;
    if (id === 'tools.boolHistory') _wrappedOpen(true);
  };
  window.__forgeBoolHistoryMenuListenerHandle = onMenuWrapped;
  window.addEventListener('forge:menu-action', onMenuWrapped);
}

// ─────────────────────────────────────────────────────────────────────
// Host — mounts the React panel inside the live React tree. The host
// flips its internal `open` state from the module-scope `_openState`
// via the FORGE_BOOL_HISTORY_OPEN_EVENT. App.jsx mounts this once.

export function BooleanHistoryPanelHost() {
  const [open, setOpen] = useState(_openState);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Make absolutely sure the module-load install ran — covers the
    // case where the React tree mounts before the side-effect import
    // chain finishes (unlikely in practice, but cheap to belt-and-brace).
    installBoolHistoryGlobals();
    // Flag the Host as registered so the standalone-root fallback
    // doesn't double-mount the panel.
    window.__forgeBoolHistoryHostRegistered = true;
    // Re-sync from module-scope to React state.
    setOpen(_openState);
    const onOpen = (e) => {
      const next = !!(e?.detail?.open);
      setOpen(next);
    };
    window.addEventListener(FORGE_BOOL_HISTORY_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(FORGE_BOOL_HISTORY_OPEN_EVENT, onOpen);
      try { delete window.__forgeBoolHistoryHostRegistered; } catch {}
    };
  }, []);
  const onClose = useCallback(() => _setOpenState(false), []);
  return <BooleanHistoryPanel open={open} onClose={onClose} />;
}

export default BooleanHistoryPanel;
