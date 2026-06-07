// PUSH-82 (Slice-50 / Body Rename batch dialog).
//
// Up through PUSH-81 a body's `name` field was settable one at a time
// via the inline rename input in the Bodies panel / Assembly Tree. With
// a dozen "Box 20", "Box 30", "Box 40" bodies in a real scene that gets
// tedious — the user is asking for a batch dialog with three modes:
//
//   1. **Inline edit per row** — a table lists every body in the scene
//      and each row has an editable name field. Type a new name into
//      any row, the staged buffer updates immediately. Hit Apply at the
//      bottom and every changed name is written back through
//      `window.__forgeSetBodies` (the canonical ForgeShellV4 setter).
//
//   2. **Find / Replace across all bodies** — two inputs (`Find`,
//      `Replace`). The renamer walks every body's *current* name, applies
//      a global substring replace, and stages the result. Empty `Find`
//      is a no-op. This is the headline use case from the brief:
//      "Box 20" / "Box 30" / "Box 40" → "Plate 20" / "Plate 30" /
//      "Plate 40" with one click.
//
//   3. **Number suffix** — a prefix input plus a "Renumber" button. The
//      panel rewrites the staged names to `Prefix-1`, `Prefix-2`,
//      `Prefix-3` … in the order the bodies appear in the table. Handy
//      after a Mirror / Pattern op that left a swarm of "BoxCopy" /
//      "BoxCopy1" / "BoxCopy2" names.
//
// All three modes write to the same `staged` map. The Apply button is
// the *only* commit path — it diffs the staged map against the current
// `window.__forgeBodies` snapshot, builds the rewritten array, and
// invokes `__forgeSetBodies`. Nothing mutates the live scene until Apply
// is pressed, so Cancel / Close throws the staged edits away cleanly.
//
// Hard constraints (PUSH-82 brief):
//   * NO new npm packages, NO new C++ libs — pure React + the existing
//     window.__forge* surface.
//   * Real impl, no MVP, no stub: every body in the scene is in the
//     table, the staged map is keyed by stable `id` so re-orderings
//     don't lose edits, and the helper API is mirrored on
//     `window.__forgeBatchRenameHelper` for plugins / Archie tool calls.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).
//   * Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const FORGE_BATCH_RENAME_EVENT = 'forge:batch-rename-applied';

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — exported so the e2e specs / Archie tool calls / plugins
// can drive the same logic without mounting the React panel first.

/** Read the live bodies snapshot. Same filter the Layers / Body Colours
 *  / MassProps panels use — we accept every body that has a stable
 *  string id (the rename map is keyed by id, not handle, so synthetic
 *  bodies without a kernel handle are still renamable). */
export function readBodiesSnapshot() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter((b) => b && typeof b.id === 'string' && b.id.length);
}

/** Compute the display name for a body when no override is staged. The
 *  fallback chain matches BodyColorsPanel / BomPanel / ForgeShellV4. */
export function defaultBodyName(body) {
  if (!body) return '';
  if (typeof body.name === 'string' && body.name.length) return body.name;
  if (typeof body.toolId === 'string' && body.toolId.length) return body.toolId;
  if (typeof body.handle === 'number') return `handle ${body.handle}`;
  return body.id || '';
}

/** Apply a Find/Replace across every body's *current* name, returning a
 *  fresh staged map `{ <bodyId>: <newName> }`. Empty `find` is a no-op
 *  and returns an empty map. The replacement is a literal substring
 *  replace (no regex) so users can paste "Box (10)" without escaping. */
export function findReplaceNames(bodies, find, replace) {
  const out = {};
  if (typeof find !== 'string' || find.length === 0) return out;
  const rep = typeof replace === 'string' ? replace : '';
  for (const b of bodies) {
    const current = defaultBodyName(b);
    if (current.indexOf(find) < 0) continue;
    // Literal string replaceAll — no regex, no special chars to escape.
    out[b.id] = current.split(find).join(rep);
  }
  return out;
}

/** Apply the number-suffix renamer: `Prefix-1`, `Prefix-2` … in row
 *  order. Empty prefix is a no-op and returns an empty map. */
export function numberSuffixNames(bodies, prefix) {
  const out = {};
  if (typeof prefix !== 'string' || prefix.length === 0) return out;
  bodies.forEach((b, i) => {
    out[b.id] = `${prefix}-${i + 1}`;
  });
  return out;
}

/** Diff the staged map against the live bodies snapshot, return the
 *  full rewritten array suitable for `window.__forgeSetBodies`. Bodies
 *  with no staged override pass through with their fields untouched. */
export function buildRenamedBodies(bodies, staged) {
  const map = (staged && typeof staged === 'object') ? staged : {};
  return bodies.map((b) => {
    if (!b || typeof b.id !== 'string') return b;
    if (!(b.id in map)) return b;
    const next = map[b.id];
    if (typeof next !== 'string') return b;
    // Trim trailing/leading whitespace so an accidental " " input
    // doesn't silently rename to a blank-looking row.
    const trimmed = next.trim();
    // Empty string falls back to the default — i.e. "clear" the rename.
    if (trimmed.length === 0) {
      const { name: _drop, ...rest } = b;
      return rest;
    }
    return { ...b, name: trimmed };
  });
}

/** Count the staged edits that would actually change a body's name —
 *  i.e. ignore no-op edits where the staged value equals the current
 *  display name. */
export function countEffectiveChanges(bodies, staged) {
  let n = 0;
  for (const b of bodies) {
    if (!b || typeof b.id !== 'string') continue;
    if (!(b.id in staged)) continue;
    const next = (staged[b.id] || '').trim();
    const current = defaultBodyName(b);
    if (next === current) continue;
    n += 1;
  }
  return n;
}

/** Commit a staged map to the live scene. Routes through
 *  `__forgeSetBodies` (the canonical ForgeShellV4 setter) so the
 *  feature-tree re-derives in lockstep. Returns the number of bodies
 *  whose name actually changed. */
export function commitBatchRename(staged) {
  if (typeof window === 'undefined') return 0;
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const next = buildRenamedBodies(bodies, staged);
  const changed = countEffectiveChanges(bodies, staged);
  if (typeof window.__forgeSetBodies === 'function') {
    window.__forgeSetBodies(next);
  }
  // Also mirror into the live `window.__forgeBodies` array synchronously
  // so subscribers that poll the global (rather than waiting for the
  // next React render cycle) see the new names immediately. The
  // ForgeShellV4 useEffect overwrites this on the next render with the
  // same value, so the mirror stays consistent.
  try { window.__forgeBodies = next; } catch {}
  try {
    window.dispatchEvent(new CustomEvent(FORGE_BATCH_RENAME_EVENT, {
      detail: { changed, total: bodies.length },
    }));
  } catch { /* CustomEvent is universal in Electron — fail-soft anyway */ }
  // Also publish the canonical bodies-changed event so subscribers that
  // already listen to that bus (e.g. BodyColorsPanel / LayersPanel)
  // re-render in lockstep with the rename without waiting for a parent
  // re-render.
  try {
    window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
      detail: { bodies: next },
    }));
  } catch {}
  return changed;
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail as BodyColorsPanel / LayersPanel.
// 480 px wide so the body name field + Find/Replace inputs have room
// without the table going zebra-narrow.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 480,
  zIndex: 1331,
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
const SECTION_TITLE = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const TWO_COL = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
};
const LABELED_INPUT = {
  display: 'flex', flexDirection: 'column', gap: 2,
};
const FIELD_LABEL = {
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const TEXT_INPUT = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px',
  borderRadius: 3,
  fontSize: 12,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const ACTION_BTN = (variant = 'default') => ({
  background: variant === 'primary'
    ? 'var(--forge-accent, #4f87ff)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: variant === 'primary' ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: variant === 'primary' ? 600 : 400,
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
  gridTemplateColumns: '36px 1fr 1fr 28px',
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
const BODY_ROW = (dirty) => ({
  display: 'grid',
  gridTemplateColumns: '36px 1fr 1fr 28px',
  alignItems: 'center',
  gap: 6,
  padding: '5px 8px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
  background: dirty
    ? 'rgba(79, 135, 255, 0.07)'
    : 'transparent',
});
const ROW_INDEX = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  textAlign: 'right',
};
const CURRENT_NAME = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-mute, #9aa1ab)',
};
const NAME_INPUT = {
  background: 'var(--forge-canvas-2, #161b22)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  width: '100%',
};
const REVERT_BTN = (enabled) => ({
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: enabled ? 'var(--forge-ink, #dadde2)' : 'var(--forge-ink-mute, #9aa1ab)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  padding: '2px 5px',
  borderRadius: 3,
  fontSize: 9,
  opacity: enabled ? 1 : 0.45,
});

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function BatchRenamePanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => readBodiesSnapshot());
  // Staged renames: { <bodyId>: <newName> }. Initialised empty every
  // time the panel is opened so the user starts from a known state.
  const [staged, setStaged] = useState({});
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [prefixText, setPrefixText] = useState('');
  // Toast that surfaces the Apply outcome (changed N body names).
  const [applyToast, setApplyToast] = useState(null);

  // Refresh bodies on open + listen for live scene churn while open.
  useEffect(() => {
    if (!open) return undefined;
    setBodies(readBodiesSnapshot());
    setStaged({});
    setFindText('');
    setReplaceText('');
    setPrefixText('');
    setApplyToast(null);
    const onBodies = () => setBodies(readBodiesSnapshot());
    window.addEventListener('forge:bodies-changed', onBodies);
    return () => {
      window.removeEventListener('forge:bodies-changed', onBodies);
    };
  }, [open]);

  // ─── Per-row inline edit. The staged map is keyed by body id so a
  // re-order (e.g. via the feature tree) doesn't lose edits.
  const setRowName = useCallback((id, value) => {
    setStaged((prev) => ({ ...prev, [id]: value }));
  }, []);

  const revertRow = useCallback((id) => {
    setStaged((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // ─── Find / Replace.
  const applyFindReplace = useCallback(() => {
    const overrides = findReplaceNames(bodies, findText, replaceText);
    // Merge the bulk overrides on top of whatever the user is already
    // staging — Find/Replace shouldn't blow away an inline edit, just
    // augment it.
    setStaged((prev) => ({ ...prev, ...overrides }));
  }, [bodies, findText, replaceText]);

  // ─── Number-suffix renumber.
  const applyNumberSuffix = useCallback(() => {
    const overrides = numberSuffixNames(bodies, prefixText);
    setStaged((prev) => ({ ...prev, ...overrides }));
  }, [bodies, prefixText]);

  // ─── Reset all staged edits.
  const resetStaged = useCallback(() => {
    setStaged({});
    setApplyToast(null);
  }, []);

  // ─── Commit. Routes through commitBatchRename so the bus event fires
  // and the feature tree re-derives in lockstep.
  const apply = useCallback(() => {
    const changed = commitBatchRename(staged);
    setApplyToast({ changed, when: Date.now() });
    // Snapshot the new scene so the table re-displays the committed
    // names as the new baseline. Drop the staged map: every row is now
    // pristine again.
    setBodies(readBodiesSnapshot());
    setStaged({});
  }, [staged]);

  const effectiveChanges = useMemo(
    () => countEffectiveChanges(bodies, staged),
    [bodies, staged],
  );

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Batch rename bodies"
         data-testid="forge-batch-rename-panel"
         data-staged-count={effectiveChanges}
         data-body-count={bodies.length}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="select.body" size={14} />
        <strong style={{ fontSize: 13 }}>Batch Rename</strong>
        <span data-testid="forge-batch-rename-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px',
                borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {effectiveChanges}/{bodies.length}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={resetStaged}
                title="Discard all staged edits and return every row to its current scene name"
                data-testid="forge-batch-rename-reset"
                style={ACTION_BTN('default')}>
          Reset
        </button>
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close batch rename panel"
                data-testid="forge-batch-rename-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>Find / Replace</div>
      <div style={SECTION_BOX}>
        <div style={TWO_COL}>
          <label style={LABELED_INPUT}>
            <span style={FIELD_LABEL}>Find</span>
            <input type="text"
                   value={findText}
                   onChange={(e) => setFindText(e.target.value)}
                   placeholder="Box"
                   data-testid="forge-batch-rename-find-input"
                   style={TEXT_INPUT} />
          </label>
          <label style={LABELED_INPUT}>
            <span style={FIELD_LABEL}>Replace with</span>
            <input type="text"
                   value={replaceText}
                   onChange={(e) => setReplaceText(e.target.value)}
                   placeholder="Plate"
                   data-testid="forge-batch-rename-replace-input"
                   style={TEXT_INPUT} />
          </label>
        </div>
        <div>
          <button type="button"
                  onClick={applyFindReplace}
                  disabled={findText.length === 0}
                  title="Stage a substring replace across every body's current name"
                  data-testid="forge-batch-rename-find-replace-btn"
                  style={{
                    ...ACTION_BTN('default'),
                    opacity: findText.length === 0 ? 0.5 : 1,
                    cursor: findText.length === 0 ? 'not-allowed' : 'pointer',
                  }}>
            Stage Find/Replace
          </button>
        </div>
      </div>

      <div style={SECTION_TITLE}>Number Suffix</div>
      <div style={SECTION_BOX}>
        <label style={LABELED_INPUT}>
          <span style={FIELD_LABEL}>Prefix</span>
          <input type="text"
                 value={prefixText}
                 onChange={(e) => setPrefixText(e.target.value)}
                 placeholder="Part"
                 data-testid="forge-batch-rename-prefix-input"
                 style={TEXT_INPUT} />
        </label>
        <div>
          <button type="button"
                  onClick={applyNumberSuffix}
                  disabled={prefixText.length === 0}
                  title="Stage Prefix-1, Prefix-2, Prefix-3 … in table row order"
                  data-testid="forge-batch-rename-renumber-btn"
                  style={{
                    ...ACTION_BTN('default'),
                    opacity: prefixText.length === 0 ? 0.5 : 1,
                    cursor: prefixText.length === 0 ? 'not-allowed' : 'pointer',
                  }}>
            Stage Renumber
          </button>
        </div>
      </div>

      <div style={SECTION_TITLE}>
        Bodies ({bodies.length})
      </div>
      {bodies.length === 0 ? (
        <div data-testid="forge-batch-rename-empty"
             style={{
               padding: '12px 0',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No bodies in the scene. Add a body via any modelling workbench,
          then rename here.
        </div>
      ) : (
        <div data-testid="forge-batch-rename-table" style={TABLE_BOX}>
          <div style={TABLE_HEAD_ROW}>
            <span style={{ textAlign: 'right' }}>#</span>
            <span>Current</span>
            <span>New name</span>
            <span />
          </div>
          {bodies.map((b, i) => {
            const current = defaultBodyName(b);
            const stagedValue = b.id in staged ? staged[b.id] : current;
            const dirty = b.id in staged && (stagedValue.trim() !== current);
            return (
              <div key={b.id}
                   data-testid="forge-batch-rename-row"
                   data-body-id={b.id}
                   data-current-name={current}
                   data-staged-name={stagedValue}
                   data-dirty={dirty ? '1' : '0'}
                   style={BODY_ROW(dirty)}>
                <span style={ROW_INDEX}>{i + 1}</span>
                <span title={current} style={CURRENT_NAME}>{current}</span>
                <input type="text"
                       value={stagedValue}
                       data-testid={`forge-batch-rename-input-${b.id}`}
                       aria-label={`New name for ${current}`}
                       onChange={(e) => setRowName(b.id, e.target.value)}
                       style={NAME_INPUT} />
                <button type="button"
                        title="Discard staged edit for this row"
                        data-testid={`forge-batch-rename-revert-${b.id}`}
                        onClick={() => revertRow(b.id)}
                        disabled={!(b.id in staged)}
                        style={REVERT_BTN(b.id in staged)}>
                  ⟲
                </button>
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
      }}>
        {applyToast ? (
          <span data-testid="forge-batch-rename-toast"
                style={{
                  fontSize: 11,
                  color: 'var(--forge-accent, #4f87ff)',
                }}>
            Renamed {applyToast.changed} {applyToast.changed === 1 ? 'body' : 'bodies'}.
          </span>
        ) : (
          <span style={{
            fontSize: 10,
            color: 'var(--forge-ink-mute, #9aa1ab)',
          }}>
            {effectiveChanges === 0
              ? 'Edit inline, or use Find/Replace + Number Suffix above.'
              : `${effectiveChanges} pending change${effectiveChanges === 1 ? '' : 's'}.`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={apply}
                disabled={effectiveChanges === 0}
                title="Commit every staged rename via __forgeSetBodies"
                data-testid="forge-batch-rename-apply"
                style={{
                  ...ACTION_BTN('primary'),
                  opacity: effectiveChanges === 0 ? 0.5 : 1,
                  cursor: effectiveChanges === 0 ? 'not-allowed' : 'pointer',
                }}>
          Apply
        </button>
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.batchRename` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the headless helpers on the window debug mirror.

export function BatchRenamePanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBatchRenamePanel  = () => setOpen(true);
    window.__forgeCloseBatchRenamePanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.batchRename') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    // Expose a small debug surface so the e2e specs / Archie tool calls
    // can drive the renamer without mounting the React panel first.
    window.__forgeBatchRenameHelper = Object.freeze({
      readBodiesSnapshot,
      defaultBodyName,
      findReplaceNames,
      numberSuffixNames,
      buildRenamedBodies,
      countEffectiveChanges,
      commitBatchRename,
      EVENT_NAME: FORGE_BATCH_RENAME_EVENT,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenBatchRenamePanel; } catch {}
      try { delete window.__forgeCloseBatchRenamePanel; } catch {}
    };
  }, []);
  return <BatchRenamePanel open={open} onClose={() => setOpen(false)} />;
}

export default BatchRenamePanel;
