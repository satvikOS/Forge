// PUSH-102 (Slice-70) — Multi-section Loft panel.
//
// User defines N planar sections — each a (z, radius) row — and the
// panel generates a swept NURBS surface through them via the existing
// window.forge.surfacing.buildPatch primitive. The default is 4
// sections (z=0/20/60/80, r=30/40/40/30) — a wing-profile-ish sleeve.
//
// What this panel ships:
//   • A sections table — z and radius columns + per-row Remove. Add
//     button appends a new row that picks up sensible defaults from the
//     existing rows.
//   • An Apply button that builds the (uCount × vCount) control grid
//     via loftMath.buildSweptGrid, hands it to
//     window.forge.surfacing.buildPatch, and commits the returned face
//     handle as a native surface body via window.__forgeAppendBody.
//   • A bus event (forge:loft-sections-built) the e2e listens for to
//     prove the build round-tripped.
//
// Hard constraints honoured:
//   * NO new npm / C++ dependencies. Pure React + the existing
//     buildPatch primitive + the loftMath helper.
//   * NO kernel modifications. Single big control grid, one buildPatch
//     call, one native body committed.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one mount).
//   * Manual clicks NEVER post to Archie's thread.
//   * Multi-cam e2e mandate honoured by push-102-loft-sections.spec.js.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  buildSweptGrid,
  buildPatchKnots,
  normaliseSections,
  DEFAULT_SECTIONS,
  DEFAULT_U_COUNT,
  DEFAULT_V_COUNT,
} from './loftMath.js';

// ─────────────────────────────────────────────────────────────────────
// Constants — bus event + persistence key.

export const FORGE_LOFT_SECTIONS_EVENT = 'forge:loft-sections-built';
export const FORGE_LOFT_SECTIONS_STORAGE = 'forge.v4.loftSections';

// ─────────────────────────────────────────────────────────────────────
// Headless pipeline helpers — exported so the e2e (and Archie tool
// calls, once those land) can drive the build without mounting React.

/** Build the control grid and commit a NURBS face via
 *  window.forge.surfacing.buildPatch. Returns { ok, faceHandle, reason,
 *  message, gridSpec }. */
export function commitLoftGrid(gridSpec, { uDeg = 3, vDeg = 3 } = {}) {
  if (typeof window === 'undefined' || !window.forge || !window.forge.surfacing) {
    return { ok: false, reason: 'kernel not ready', gridSpec };
  }
  const buildPatch = window.forge.surfacing.buildPatch;
  if (typeof buildPatch !== 'function') {
    return { ok: false, reason: 'buildPatch missing', gridSpec };
  }
  const uKnots = buildPatchKnots(gridSpec.uCount, uDeg);
  const vKnots = buildPatchKnots(gridSpec.vCount, vDeg);
  try {
    // Hand the spec object directly. preload.js's buildPatch shim
    // accepts either a nested array (which it flattens with
    // rows=uCount, cols=vCount) or a { uCount, vCount, xyz } payload
    // pass-through. We use the pass-through form so our own
    // uCount/vCount convention (uCount=theta samples, vCount=section
    // samples) lines up with the kernel's knot-vector sizing check
    // (uKnots.length must equal uCount+uDeg+1, etc).
    const spec = {
      uCount: gridSpec.uCount, vCount: gridSpec.vCount,
      xyz: gridSpec.xyz,
    };
    const faceHandle = buildPatch(spec, uDeg, vDeg, uKnots, vKnots);
    if (typeof faceHandle !== 'number' || !Number.isFinite(faceHandle)) {
      return { ok: false, reason: 'buildPatch returned non-handle',
               message: String(faceHandle), gridSpec };
    }
    return { ok: true, faceHandle, uKnots, vKnots, uDeg, vDeg, gridSpec };
  } catch (err) {
    return { ok: false, reason: 'buildPatch threw',
             message: err && err.message ? err.message : String(err),
             gridSpec };
  }
}

/** Append a surface body to the live scene. Returns the body record
 *  appended (or null if __forgeAppendBody isn't wired). */
export function appendLoftBody(faceHandle, { sections, uCount, vCount, name }) {
  if (typeof window === 'undefined') return null;
  const ts = Date.now();
  const id = `loft-sections-${ts}`;
  const body = {
    id, kind: 'native', handle: faceHandle,
    toolId: 'surfacing.loftSections',
    surface: true,
    params: {
      sections: sections.map((s) => ({ z: s.z, radius: s.radius })),
      uCount, vCount,
    },
    name: name || `Loft (${sections.length} sections)`,
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }
  return body;
}

/** Top-level driver — sections → buildSweptGrid → buildPatch →
 *  __forgeAppendBody → bus event. Used by both the panel button and the
 *  e2e spec. */
export function runLoftSectionsPipeline({
  sections = DEFAULT_SECTIONS,
  uCount = DEFAULT_U_COUNT,
  vCount = DEFAULT_V_COUNT,
} = {}) {
  const sane = normaliseSections(sections);
  if (sane.length < 2) {
    return { ok: false, reason: 'need at least 2 sections',
             sections: sane };
  }
  const gridSpec = buildSweptGrid(sane, uCount, vCount);
  const built = commitLoftGrid(gridSpec);
  if (!built.ok) {
    return {
      ok: false, reason: built.reason, message: built.message,
      gridSpec,
    };
  }
  const body = appendLoftBody(built.faceHandle, {
    sections: sane, uCount, vCount,
    name: `Loft (${sane.length} sections)`,
  });
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FORGE_LOFT_SECTIONS_EVENT, {
        detail: {
          faceHandle: built.faceHandle,
          bodyId: body?.id,
          sectionCount: sane.length,
          uCount: gridSpec.uCount,
          vCount: gridSpec.vCount,
          ts: Date.now(),
        },
      }));
    }
  } catch { /* fail soft — CustomEvent is universal in Electron */ }
  return {
    ok: true, faceHandle: built.faceHandle, body,
    gridSpec, uKnots: built.uKnots, vKnots: built.vKnots,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Side-effect helper API install — same pattern as ClassABlendPanel.
// The moment this module is imported, the helper surface is live so
// e2e + plugin code can drive the pipeline without the React Host
// being mounted.

if (typeof window !== 'undefined') {
  try {
    window.__forgeLoftSectionsHelper = Object.freeze({
      buildSweptGrid,
      buildPatchKnots,
      normaliseSections,
      commitLoftGrid,
      appendLoftBody,
      runLoftSectionsPipeline,
      DEFAULT_SECTIONS,
      DEFAULT_U_COUNT,
      DEFAULT_V_COUNT,
      EVENT_NAME: FORGE_LOFT_SECTIONS_EVENT,
      STORAGE_KEY: FORGE_LOFT_SECTIONS_STORAGE,
    });
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.loftSections') {
        window.__forgeLoftSectionsLastMenuTs = Date.now();
      }
    });
  } catch { /* fail soft — defensive in SSR / non-window envs */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail as PUSH-85 / other PUSH-N panels.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 440,
  zIndex: 1333,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: 8 };
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)', margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const TABLE_HEADER_ROW = {
  display: 'grid', gridTemplateColumns: '36px 1fr 1fr 40px',
  alignItems: 'center', gap: 6,
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  paddingBottom: 4,
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const TABLE_ROW = (active) => ({
  display: 'grid', gridTemplateColumns: '36px 1fr 1fr 40px',
  alignItems: 'center', gap: 6,
  background: active ? 'var(--forge-accent-mute, #1f2c4a)' : 'transparent',
  borderRadius: 3,
  padding: '4px 2px',
});
const INPUT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  width: '100%', boxSizing: 'border-box',
};
const SMALL_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer', padding: '2px 6px', borderRadius: 3, fontSize: 11,
};
const TABLE_ROW_LABEL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  textAlign: 'center',
};
const ACTION_ROW = { display: 'flex', gap: 6, alignItems: 'center' };
const ACTION_BTN = (variant = 'default', disabled = false) => ({
  background: disabled ? 'var(--forge-surface-mute, #1a1f27)'
            : variant === 'primary' ? 'var(--forge-accent, #4f87ff)'
            : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: disabled ? 'var(--forge-ink-mute, #9aa1ab)'
       : variant === 'primary' ? '#fff'
       : 'var(--forge-ink, #dadde2)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '6px 14px', borderRadius: 3, fontSize: 12,
  fontWeight: variant === 'primary' ? 600 : 400,
});
const LOG_BOX = {
  flex: 1, minHeight: 0, overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, background: 'var(--forge-canvas-1, #0e1218)',
  padding: 6, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-2, #b5bac4)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

function clonePreset() {
  return DEFAULT_SECTIONS.map((s) => ({ z: s.z, radius: s.radius }));
}

export function LoftSectionsPanel({ open, onClose }) {
  const [sections, setSections] = useState(clonePreset);
  const [log, setLog] = useState([]);
  const lastFaceRef = useRef(null);

  // Reset to the wing-profile preset each time the panel opens so the
  // e2e's "click Apply with default sections" assertion is deterministic.
  useEffect(() => {
    if (!open) return;
    setSections(clonePreset());
    setLog([]);
  }, [open]);

  const onChangeField = useCallback((idx, field, value) => {
    setSections((prev) => {
      const next = prev.map((row, i) =>
        i === idx ? { ...row, [field]: Number(value) } : row);
      return next;
    });
  }, []);

  const onAddRow = useCallback(() => {
    setSections((prev) => {
      // New row inherits the last row's z + a 20 mm bump, and the last
      // row's radius. Keeps additions sensible without forcing the user
      // to type from scratch.
      const last = prev[prev.length - 1] || { z: 0, radius: 30 };
      const next = [...prev, { z: last.z + 20, radius: last.radius }];
      return next;
    });
  }, []);

  const onRemoveRow = useCallback((idx) => {
    setSections((prev) => {
      if (prev.length <= 2) return prev; // keep at least 2 sections
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const onResetToPreset = useCallback(() => {
    setSections(clonePreset());
  }, []);

  const sane = useMemo(() => normaliseSections(sections), [sections]);

  const onApply = useCallback(() => {
    const r = runLoftSectionsPipeline({
      sections, uCount: DEFAULT_U_COUNT, vCount: DEFAULT_V_COUNT,
    });
    if (r.ok) lastFaceRef.current = r.faceHandle;
    setLog((l) => [
      ...l.slice(-12),
      {
        ok: r.ok, ts: Date.now(),
        message: r.ok
          ? `Lofted ${sane.length} sections → face ${r.faceHandle} (${r.gridSpec.uCount}×${r.gridSpec.vCount} grid)`
          : `Apply failed: ${r.reason || 'error'}${r.message ? ' · ' + r.message : ''}`,
      },
    ]);
  }, [sections, sane.length]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Multi-section loft"
         data-testid="forge-loft-sections-panel"
         data-section-count={sane.length}
         data-last-face={lastFaceRef.current == null ? '' : String(lastFaceRef.current)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.spline" size={14} />
        <strong style={{ fontSize: 13 }}>Loft Sections</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          NURBS sleeve
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Loft Sections panel"
                data-testid="forge-loft-sections-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Sweep a NURBS surface through N planar sections (z + radius). The
        default 4-section profile is wing-shaped (root → max chord → tip).
        Builds an OCCT face through surfacing.buildPatch.
      </div>

      <div style={SECTION_TITLE}>Sections (z, radius)</div>
      <div style={SECTION_BOX}>
        <div style={TABLE_HEADER_ROW}>
          <span style={{ textAlign: 'center' }}>#</span>
          <span>z (mm)</span>
          <span>radius (mm)</span>
          <span></span>
        </div>
        <div data-testid="forge-loft-sections-table"
             data-row-count={sections.length}
             style={{ display: 'flex', flexDirection: 'column', gap: 2,
                      maxHeight: 180, overflowY: 'auto' }}>
          {sections.map((row, idx) => (
            <div key={idx}
                 data-testid={`forge-loft-sections-row-${idx}`}
                 style={TABLE_ROW(false)}>
              <span style={TABLE_ROW_LABEL}>{idx + 1}</span>
              <input type="number"
                     step="0.1"
                     value={row.z}
                     onChange={(e) => onChangeField(idx, 'z', e.target.value)}
                     data-testid={`forge-loft-sections-z-${idx}`}
                     style={INPUT_STYLE} />
              <input type="number"
                     step="0.1"
                     min="0.1"
                     value={row.radius}
                     onChange={(e) => onChangeField(idx, 'radius', e.target.value)}
                     data-testid={`forge-loft-sections-radius-${idx}`}
                     style={INPUT_STYLE} />
              <button type="button"
                      onClick={() => onRemoveRow(idx)}
                      data-testid={`forge-loft-sections-remove-${idx}`}
                      aria-label={`Remove section ${idx + 1}`}
                      disabled={sections.length <= 2}
                      style={{
                        ...SMALL_BTN,
                        opacity: sections.length <= 2 ? 0.4 : 1,
                        cursor: sections.length <= 2 ? 'not-allowed' : 'pointer',
                      }}>−</button>
            </div>
          ))}
        </div>
        <div style={ACTION_ROW}>
          <button type="button"
                  onClick={onAddRow}
                  data-testid="forge-loft-sections-add"
                  style={SMALL_BTN}>+ Add section</button>
          <button type="button"
                  onClick={onResetToPreset}
                  data-testid="forge-loft-sections-reset"
                  style={SMALL_BTN}>Reset to preset</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            {sane.length} valid · {DEFAULT_U_COUNT}×{DEFAULT_V_COUNT} grid
          </span>
        </div>
      </div>

      <div style={SECTION_TITLE}>Build</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onApply}
                disabled={sane.length < 2}
                data-testid="forge-loft-sections-apply"
                style={ACTION_BTN('primary', sane.length < 2)}>
          Apply — Build loft
        </button>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`Polar sampling · ${DEFAULT_U_COUNT}-pt rings · ${DEFAULT_V_COUNT}-pt v-axis · degree 3 · open-uniform knots`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Log</div>
      <div data-testid="forge-loft-sections-log"
           data-log-count={log.length}
           style={LOG_BOX}>
        {log.length === 0 ? (
          <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            no builds yet
          </span>
        ) : log.slice().reverse().map((entry, i) => (
          <div key={`${entry.ts}-${i}`}
               style={{
                 display: 'flex', gap: 6, alignItems: 'baseline',
                 borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
                 padding: '2px 0',
               }}>
            <span style={{ color: entry.ok ? 'var(--forge-ok, #4caf50)'
                                            : 'var(--forge-err, #ef5350)' }}>
              {entry.ok ? 'OK' : 'ER'}
            </span>
            <span style={{ flex: 1 }}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.loftSections` menu action, exposes the
// imperative open/close hooks for plugins / e2e / Archie tool calls.

export function LoftSectionsPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenLoftSections  = () => setOpen(true);
    window.__forgeCloseLoftSections = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.loftSections') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenLoftSections; } catch {}
      try { delete window.__forgeCloseLoftSections; } catch {}
    };
  }, []);
  if (!open) return null;
  return <LoftSectionsPanel open={open} onClose={() => setOpen(false)} />;
}

export default LoftSectionsPanel;
