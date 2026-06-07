// PUSH-80 (Slice-48 / Direct Edit numeric input panel — translate).
//
// Up through PUSH-79 the only way to move a kernel-backed body around
// the viewport was either (a) animate it through the timeline workbench
// (PUSH-57's `window.__forgeAnimationPose` Map → AnimationPoseTicker),
// (b) call `forge.translate(handle, dx, dy, dz)` from a script, which
// rebuilds the OCCT shape under a fresh handle and replaces the
// existing body wholesale, or (c) drag a manipulator handle. None of
// those let an engineer just *type* "move this body 50 mm along X" —
// table stakes for any MCAD direct-edit workflow.
//
// PUSH-80 lights that up as a numeric Direct Edit panel:
//   • Right-docked panel, same shelf as MassProps / Layers / Body
//     Colours, opened by the `tools.directEditTranslate` menu action
//     (or the imperative `window.__forgeOpenDirectEditTranslate`
//     hook used by Archie tool calls + the e2e spec).
//   • Picker dropdown listing every native body in the scene, with
//     the active body auto-selected (selection → last-native fallback,
//     matching the MassProps / EntityProps convention).
//   • Three numeric inputs — dx, dy, dz (mm). Free-typed values
//     accept floats and negatives; non-finite parses clear back to 0.
//   • Apply writes the dx/dy/dz to `window.__forgeAnimationPose` Map
//     using the same channel PUSH-57's AnimationPoseTicker reads. The
//     viewport ticker (Viewport.jsx:744) walks the scene, finds the
//     mesh with `userData.body.handle === <handle>` and sets
//     `mesh.position` imperatively — no React re-render, so the move
//     lands on the very next animation frame.
//   • Reset button drops the pose entry for the active body (delete
//     from the Map), returning the body to its base mesh.position.
//
// Channel contract — same Map shape PUSH-57 uses, so the existing
// Viewport.jsx AnimationPoseTicker picks the entry up without any
// renderer change:
//   window.__forgeAnimationPose : Map<handle, { pos: [x, y, z] }>
// The Animation timeline workbench *replaces* this Map wholesale on
// every keyframe evaluation when its "Live tracks" flag is on, so a
// user running the animation will see numeric translates re-stomped
// each frame — that is the correct behaviour (the timeline is the
// authoritative pose source while playing). When the timeline isn't
// live, the Map persists between renders and the numeric translation
// is the only pose entry, so Apply moves the mesh and Reset returns it.
//
// Constraints honoured (PUSH-80 brief):
//   • NO new npm packages, NO new C++ libs — pure React + the existing
//     window.__forge* surface.
//   • No MVP, no stub — the active-body fallback mirrors MassProps /
//     EntityProps, the bus event matches PUSH-71 / PUSH-73 conventions,
//     and the pose Map is the real PUSH-57 channel (not a parallel
//     stub).
//   • Surgical edits to Menus.jsx (one new tools.directEditTranslate
//     entry) + App.jsx (one import + one mount).
//   • Viewport.jsx unmodified — the pose ticker already does the work.
//   • Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants — bus event name + the menu action that opens the panel.
// Kept in sync with the PUSH-71 / PUSH-73 naming pattern.

export const FORGE_DIRECT_EDIT_TRANSLATE_EVENT =
  'forge:direct-edit-translate-applied';
export const FORGE_DIRECT_EDIT_TRANSLATE_MENU_ID =
  'tools.directEditTranslate';

// ─────────────────────────────────────────────────────────────────────
// Native body snapshot — same filter MassProps / EntityProps / Body
// Colours / Layers use. Only kernel-backed bodies have a numeric
// handle the OCCT-side translate call can act on.

function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter(
    (b) => b && b.kind === 'native' && typeof b.handle === 'number',
  );
}

// Selection → active body. Mirrors MassPropsPanel.activeBody so the
// "open panel and immediately type dx/dy/dz" workflow does not need a
// second click to pick the body. Falls back to the last native body in
// the scene so freshly-seeded bodies (e.g. the e2e spec's box) are
// pre-selected even before the user clicks anything.
function activeBodyHandle() {
  if (typeof window === 'undefined') return null;
  const native = readNativeBodies();
  if (native.length === 0) return null;
  const sel = window.__forgeSelection || null;
  if (sel && typeof sel.bodyHandle === 'number') {
    const m = native.find((b) => b.handle === sel.bodyHandle);
    if (m) return m.handle;
  }
  return native[native.length - 1].handle;
}

// ─────────────────────────────────────────────────────────────────────
// Pose-channel mutators — share PUSH-57's window.__forgeAnimationPose
// Map. Lazily create the Map if PUSH-57 has not run yet (the timeline
// workbench installs it on first render; the direct-edit panel must
// not depend on that order).

function ensurePoseMap() {
  if (typeof window === 'undefined') return null;
  if (!(window.__forgeAnimationPose instanceof Map)) {
    window.__forgeAnimationPose = new Map();
  }
  return window.__forgeAnimationPose;
}

export function applyDirectEditTranslate(handle, dx, dy, dz) {
  if (typeof handle !== 'number' || !Number.isFinite(handle)) return false;
  const x = Number(dx); const y = Number(dy); const z = Number(dz);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return false;
  }
  const pose = ensurePoseMap();
  if (!pose) return false;
  pose.set(handle, { pos: [x, y, z] });
  try {
    window.dispatchEvent(new CustomEvent(FORGE_DIRECT_EDIT_TRANSLATE_EVENT, {
      detail: { handle, dx: x, dy: y, dz: z },
    }));
  } catch { /* CustomEvent always exists in Electron — fail-soft anyway */ }
  return true;
}

export function clearDirectEditTranslate(handle) {
  if (typeof handle !== 'number' || !Number.isFinite(handle)) return false;
  const pose = ensurePoseMap();
  if (!pose) return false;
  if (!pose.has(handle)) return false;
  pose.delete(handle);
  try {
    window.dispatchEvent(new CustomEvent(FORGE_DIRECT_EDIT_TRANSLATE_EVENT, {
      detail: { handle, cleared: true },
    }));
  } catch { /* fail-soft */ }
  return true;
}

// Read whatever pose entry (if any) the channel currently holds for a
// body, so the panel can show the user the persistent values that
// would be applied on the next ticker frame. Returns null when no
// override is in effect.
export function readDirectEditTranslate(handle) {
  if (typeof handle !== 'number' || !Number.isFinite(handle)) return null;
  if (typeof window === 'undefined') return null;
  const pose = window.__forgeAnimationPose;
  if (!(pose instanceof Map)) return null;
  const e = pose.get(handle);
  if (!e || !e.pos || e.pos.length < 3) return null;
  return {
    dx: Number(e.pos[0]) || 0,
    dy: Number(e.pos[1]) || 0,
    dz: Number(e.pos[2]) || 0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail, same shelf as the sibling MassProps /
// Layers / Body Colours / Camera Bookmarks panels. 360 px wide so the
// three labelled numeric inputs fit alongside the body picker without
// truncating the body name.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 360,
  zIndex: 1330,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflowY: 'auto',
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
const PICKER_STYLE = {
  width: '100%',
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px', borderRadius: 3, fontSize: 12,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const INPUT_ROW = {
  display: 'grid',
  gridTemplateColumns: '32px 1fr 24px',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
};
const INPUT_STYLE = {
  width: '100%',
  background: 'var(--forge-canvas-1, #0d1117)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px', borderRadius: 3,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 12, textAlign: 'right',
};
const AXIS_LABEL = (axis) => ({
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 12, fontWeight: 600,
  color: axis === 'x' ? '#e2535a'
       : axis === 'y' ? '#5ad17a'
       : '#5d8df0',
});
const APPLY_BTN = (enabled) => ({
  background: enabled
    ? 'var(--forge-accent, #4178d4)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: enabled ? '#fff' : 'var(--forge-ink-mute, #9aa1ab)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  padding: '6px 14px', borderRadius: 3,
  fontSize: 11, fontWeight: 600,
  opacity: enabled ? 1 : 0.6,
});
const RESET_BTN = (enabled) => ({
  background: enabled ? 'var(--forge-surface, #1f242c)' : 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: enabled ? 'var(--forge-ink, #dadde2)' : 'var(--forge-ink-mute, #9aa1ab)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  padding: '6px 12px', borderRadius: 3,
  fontSize: 11,
  opacity: enabled ? 1 : 0.5,
});
const STATUS_LINE = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  padding: '4px 0',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

function parseFiniteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function DirectEditTranslatePanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => readNativeBodies());
  const [handle, setHandle] = useState(() => activeBodyHandle());
  const [dx, setDx] = useState('0');
  const [dy, setDy] = useState('0');
  const [dz, setDz] = useState('0');
  const [status, setStatus] = useState('Ready.');
  const [lastApplied, setLastApplied] = useState(null);

  // Refresh on open + listen for body churn while open. Selection
  // changes auto-pick a body ONLY when the panel currently has no
  // explicit pick (handle === null) — once the user has chosen a body
  // from the dropdown we must not silently switch it under them when a
  // viewport click fires forge:selection-changed.
  useEffect(() => {
    if (!open) return undefined;
    setBodies(readNativeBodies());
    setHandle((cur) => (cur == null ? activeBodyHandle() : cur));
    const onBodies = () => {
      const fresh = readNativeBodies();
      setBodies(fresh);
      // If the user's picked handle was deleted (body gone), fall back
      // to whatever the new active body is.
      setHandle((cur) => {
        if (cur == null) return activeBodyHandle();
        if (!fresh.find((b) => b.handle === cur)) return activeBodyHandle();
        return cur;
      });
    };
    const onSelection = () => {
      // Only auto-pick if no body has been chosen yet.
      setHandle((cur) => (cur == null ? activeBodyHandle() : cur));
    };
    window.addEventListener('forge:bodies-changed', onBodies);
    window.addEventListener('forge:selection-changed', onSelection);
    return () => {
      window.removeEventListener('forge:bodies-changed', onBodies);
      window.removeEventListener('forge:selection-changed', onSelection);
    };
  }, [open]);

  // When the picker switches to a different body, pre-fill the input
  // fields with whatever the pose channel currently holds for that
  // body (so the user sees the persistent translation, not a stale 0).
  useEffect(() => {
    if (!open || handle == null) return;
    const persisted = readDirectEditTranslate(handle);
    if (persisted) {
      setDx(String(persisted.dx));
      setDy(String(persisted.dy));
      setDz(String(persisted.dz));
    } else {
      setDx('0'); setDy('0'); setDz('0');
    }
  }, [open, handle]);

  const onApply = useCallback(() => {
    if (handle == null) {
      setStatus('No body picked.');
      return;
    }
    const xn = parseFiniteOr(dx, 0);
    const yn = parseFiniteOr(dy, 0);
    const zn = parseFiniteOr(dz, 0);
    const ok = applyDirectEditTranslate(handle, xn, yn, zn);
    if (ok) {
      setLastApplied({ handle, dx: xn, dy: yn, dz: zn });
      setStatus(`Applied: handle ${handle} → dx=${xn} dy=${yn} dz=${zn} mm`);
    } else {
      setStatus('Apply failed — invalid handle or values.');
    }
  }, [handle, dx, dy, dz]);

  const onReset = useCallback(() => {
    if (handle == null) {
      setStatus('No body picked.');
      return;
    }
    const ok = clearDirectEditTranslate(handle);
    setLastApplied(null);
    setStatus(ok
      ? `Reset: handle ${handle} pose cleared.`
      : `Reset: handle ${handle} had no pose entry.`);
    setDx('0'); setDy('0'); setDz('0');
  }, [handle]);

  const pickerOptions = useMemo(() => {
    return [...bodies].sort((a, b) => a.handle - b.handle);
  }, [bodies]);

  const canApply = handle != null;
  const canReset = handle != null
    && readDirectEditTranslate(handle) != null;

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Direct edit — numeric translate"
         data-testid="forge-direct-edit-translate-panel"
         data-active-handle={handle == null ? '' : String(handle)}
         data-body-count={bodies.length}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.rect" size={14} />
        <strong style={{ fontSize: 13 }}>Direct Edit — Translate</strong>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close direct edit translate panel"
                data-testid="forge-direct-edit-translate-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>Body</div>
      {bodies.length === 0 ? (
        <div data-testid="forge-direct-edit-translate-empty"
             style={{
               padding: '12px 0',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No native bodies in the scene. Add a body via any modelling
          workbench, then type a numeric translation here.
        </div>
      ) : (
        <select data-testid="forge-direct-edit-translate-picker"
                value={handle == null ? '' : String(handle)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setHandle(v);
                }}
                style={PICKER_STYLE}>
          {pickerOptions.map((b) => (
            <option key={b.handle}
                    value={String(b.handle)}
                    data-testid={`forge-direct-edit-translate-option-${b.handle}`}>
              {b.name || b.toolId || `handle ${b.handle}`} — h{b.handle}
            </option>
          ))}
        </select>
      )}

      <div style={SECTION_TITLE}>Translation (mm)</div>
      <div style={INPUT_ROW}>
        <span style={AXIS_LABEL('x')}>dx</span>
        <input type="number"
               inputMode="decimal"
               step="any"
               value={dx}
               onChange={(e) => setDx(e.target.value)}
               data-testid="forge-direct-edit-translate-dx"
               aria-label="dx in millimetres"
               style={INPUT_STYLE} />
        <span style={{
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
        }}>mm</span>
      </div>
      <div style={INPUT_ROW}>
        <span style={AXIS_LABEL('y')}>dy</span>
        <input type="number"
               inputMode="decimal"
               step="any"
               value={dy}
               onChange={(e) => setDy(e.target.value)}
               data-testid="forge-direct-edit-translate-dy"
               aria-label="dy in millimetres"
               style={INPUT_STYLE} />
        <span style={{
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
        }}>mm</span>
      </div>
      <div style={INPUT_ROW}>
        <span style={AXIS_LABEL('z')}>dz</span>
        <input type="number"
               inputMode="decimal"
               step="any"
               value={dz}
               onChange={(e) => setDz(e.target.value)}
               data-testid="forge-direct-edit-translate-dz"
               aria-label="dz in millimetres"
               style={INPUT_STYLE} />
        <span style={{
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
        }}>mm</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button"
                onClick={onApply}
                disabled={!canApply}
                data-testid="forge-direct-edit-translate-apply"
                data-dx={parseFiniteOr(dx, 0)}
                data-dy={parseFiniteOr(dy, 0)}
                data-dz={parseFiniteOr(dz, 0)}
                style={APPLY_BTN(canApply)}>
          Apply
        </button>
        <button type="button"
                onClick={onReset}
                disabled={!canReset}
                title="Drop the pose entry for this body so its mesh returns to the base position"
                data-testid="forge-direct-edit-translate-reset"
                style={RESET_BTN(canReset)}>
          Reset
        </button>
      </div>

      <div data-testid="forge-direct-edit-translate-status"
           data-last-handle={lastApplied?.handle ?? ''}
           data-last-dx={lastApplied?.dx ?? ''}
           data-last-dy={lastApplied?.dy ?? ''}
           data-last-dz={lastApplied?.dz ?? ''}
           style={STATUS_LINE}>
        {status}
      </div>

      <footer style={{
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        fontSize: 10,
        lineHeight: 1.4,
        marginTop: 'auto',
      }}>
        Numeric translation writes to <code>window.__forgeAnimationPose</code> —
        the PUSH-57 viewport pose channel. The Animation timeline replaces
        this Map on every Play tick, so disable Play before typing values.
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.directEditTranslate` menu action,
// exposes imperative open/close hooks for Archie tool calls / the
// e2e spec, and surfaces the mutator helpers on a small debug surface
// so other modules can drive the channel without mounting the React
// panel first.

export function DirectEditTranslatePanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenDirectEditTranslate  = () => setOpen(true);
    window.__forgeCloseDirectEditTranslate = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === FORGE_DIRECT_EDIT_TRANSLATE_MENU_ID) setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    window.__forgeDirectEditTranslateHelper = Object.freeze({
      applyDirectEditTranslate,
      clearDirectEditTranslate,
      readDirectEditTranslate,
      EVENT_NAME: FORGE_DIRECT_EDIT_TRANSLATE_EVENT,
      MENU_ID: FORGE_DIRECT_EDIT_TRANSLATE_MENU_ID,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenDirectEditTranslate; } catch {}
      try { delete window.__forgeCloseDirectEditTranslate; } catch {}
    };
  }, []);
  return (
    <DirectEditTranslatePanel open={open} onClose={() => setOpen(false)} />
  );
}

export default DirectEditTranslatePanel;
