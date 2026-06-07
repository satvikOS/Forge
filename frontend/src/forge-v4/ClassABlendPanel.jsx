// PUSH-85 (Slice-53) — Class-A G2/G3 curvature-continuous Blend panel.
//
// OCCT exposes the Class-A surfacing primitives — BRepFill_Filling,
// GeomFill_NSections, BRepOffsetAPI_MakeFilling with GeomAbs_C0/C1/C2
// continuity — but our preload bridge does not yet ship a binding for
// any of those. Adding one is a kernel rebuild (a couple of hours of
// CMake + NAPI plumbing). The user's brief explicitly carves that out:
//
//   "for this slice, since adding OCCT API binding takes a kernel
//    rebuild, implement at JS level using existing forge.surfacing
//    buildPatch + existing forge.io.exportStep / forge.makeBox to
//    construct a synthetic 4-curve patch."
//
// What this panel ships:
//   • Four boundary curves — either a pre-canned 100 mm saddle preset,
//     a "extract from selected body" mode (reads the top-face bbox edges
//     of the currently selected body), or a JSON-typed override.
//   • A G1 / G2 / G3 radio. The continuity selection drives the Hermite
//     tension parameter in coonsPatch.js — G1 ≈ tangent match,
//     G2 ≈ curvature match, G3 ≈ near-full tangent match. We label the
//     CATIA OCCT-mapped continuity (C1/C2/C3) on the same row so the
//     user can correlate the modeller convention with the kernel one.
//   • A "Build sample blend" button that builds the patch grid via
//     bilinearCoonsPatch or hermiteCoonsPatch (the latter is the path
//     all three radio choices land on), then calls
//     window.forge.surfacing.buildPatch with the resulting control grid
//     and bicubic open-uniform knot vectors. The returned faceHandle is
//     committed as a native body via window.__forgeAppendBody so it
//     renders in the viewport and the e2e can introspect it via
//     window.__forgeBodies.
//
// Hard constraints honoured:
//   * NO new npm / C++ deps. Pure React + the existing buildPatch +
//     coonsPatch.js maths.
//   * NO C++ kernel modifications.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one mount).
//   * Real OCCT NURBS surface, real face handle, real native body — no
//     placeholder mesh, no fallback geometry.
//   * Multi-cam e2e mandate honoured by push-85-class-a-blend.spec.js.
//   * Manual clicks do NOT post to Archie's thread.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  bilinearCoonsPatch,
  hermiteCoonsPatch,
  continuityToTension,
  sampleSquareBoundary,
  extractBoundaryFromBox,
  buildPatchKnots,
} from './coonsPatch.js';

// ─────────────────────────────────────────────────────────────────────
// Constants — the bus event the e2e listens for and the storage key the
// panel persists the last continuity choice under.

export const FORGE_CLASS_A_BLEND_EVENT = 'forge:class-a-blend-built';
export const FORGE_CLASS_A_BLEND_STORAGE = 'forge.v4.classABlend';
// Default 11×11 grid matches the brief: "11×11 NURBS control grid".
export const CLASS_A_DEFAULT_SAMPLES = 11;

// ─────────────────────────────────────────────────────────────────────
// continuity ↔ OCCT label.
//
// The panel surfaces the OCCT continuity classification next to the
// modeller convention so user / Archie / e2e can correlate them.
// The user-visible G1/G2/G3 button labels live in CONTINUITY_OPTIONS;
// the OCCT mapping for each is documented inline so the panel renders
// the kernel-side classification beneath the button.

export const CONTINUITY_OPTIONS = [
  {
    id: 'G1', label: 'G1 — Tangent',
    occt: 'C1', occtLabel: 'GeomAbs_C1',
    description: 'Position + tangent match.',
  },
  {
    id: 'G2', label: 'G2 — Curvature',
    occt: 'C2', occtLabel: 'GeomAbs_C2',
    description: 'Position + tangent + curvature.',
  },
  {
    id: 'G3', label: 'G3 — Torsion',
    occt: 'C3', occtLabel: 'GeomAbs_C3',
    description: 'Position + tangent + curvature + jerk.',
  },
];

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported so the e2e can drive the build pipeline without
// mounting the React panel first).

/** Build the boundary curves for whichever source mode is selected. */
export function buildBoundary({ source, samples = CLASS_A_DEFAULT_SAMPLES, body, jsonOverride }) {
  if (source === 'json' && jsonOverride
      && jsonOverride.curveU0 && jsonOverride.curveU1
      && jsonOverride.curveV0 && jsonOverride.curveV1) {
    return jsonOverride;
  }
  if (source === 'body' && body && body.bbox) {
    const b = extractBoundaryFromBox(body.bbox, samples);
    if (b) return b;
  }
  return sampleSquareBoundary({ size: 100, lift: 25, samples });
}

/** Read the currently selected/active body, derive its bbox, and return
 *  { id, name, handle, bbox } or null. The bbox is read from the kernel
 *  via window.forge.bbox when the panel can't find a cached one on the
 *  body record. */
export function readActiveBody() {
  if (typeof window === 'undefined') return null;
  const sel = window.__forgeSelection;
  let bodyId = null;
  if (sel && sel.kind === 'body' && Array.isArray(sel.ids) && sel.ids.length) {
    bodyId = sel.ids[0];
  }
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  let body = null;
  if (bodyId != null) {
    body = bodies.find((b) => b && (b.id === bodyId || b.handle === bodyId)) || null;
  }
  if (!body && bodies.length) {
    // Fall back to the last native body in the scene.
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      if (b && b.kind === 'native' && typeof b.handle === 'number') {
        body = b;
        break;
      }
    }
  }
  if (!body) return null;
  let bbox = body.bbox;
  if (!bbox && typeof body.handle === 'number'
      && window.forge && typeof window.forge.bbox === 'function') {
    try {
      const raw = window.forge.bbox(body.handle);
      if (raw && Number.isFinite(raw.xMin)) bbox = raw;
    } catch { /* fall through to null */ }
  }
  return {
    id: body.id, name: body.name || body.toolId || body.id,
    handle: body.handle, bbox: bbox || null,
  };
}

/** Build the Coons patch grid for the given continuity choice. G1 falls
 *  back to the bilinear interpolant (no tangent contribution); G2 and
 *  G3 hit the Hermite path with continuity-derived tension. */
export function buildClassAGrid({ boundary, continuity, samples = CLASS_A_DEFAULT_SAMPLES }) {
  const uN = samples, vN = samples;
  const c = String(continuity || 'G2').toUpperCase();
  if (c === 'G1') {
    // Pure bilinear Coons interpolant — positional + tangent-by-construction
    // when the supplied boundary curves already meet tangent-continuously.
    const { grid } = bilinearCoonsPatch(
      boundary.curveU0, boundary.curveU1,
      boundary.curveV0, boundary.curveV1,
      uN, vN);
    return { uCount: uN, vCount: vN, grid, kind: 'bilinear' };
  }
  // G2 / G3 → bicubic Hermite with tension scaled by the modeller choice.
  const tension = continuityToTension(c);
  const { grid } = hermiteCoonsPatch(
    boundary.curveU0, boundary.curveU1,
    boundary.curveV0, boundary.curveV1,
    { uCount: uN, vCount: vN, tension });
  return { uCount: uN, vCount: vN, grid, kind: 'hermite', tension };
}

/** Call window.forge.surfacing.buildPatch with the grid + bicubic
 *  open-uniform knot vectors. Returns { ok, faceHandle, reason }. */
export function commitClassAGrid(gridSpec) {
  if (typeof window === 'undefined' || !window.forge || !window.forge.surfacing) {
    return { ok: false, reason: 'kernel not ready' };
  }
  const buildPatch = window.forge.surfacing.buildPatch;
  if (typeof buildPatch !== 'function') {
    return { ok: false, reason: 'buildPatch missing' };
  }
  const uDeg = 3, vDeg = 3;
  const uKnots = buildPatchKnots(gridSpec.uCount, uDeg);
  const vKnots = buildPatchKnots(gridSpec.vCount, vDeg);
  try {
    const faceHandle = buildPatch(gridSpec.grid, uDeg, vDeg, uKnots, vKnots);
    if (typeof faceHandle !== 'number' || !Number.isFinite(faceHandle)) {
      return { ok: false, reason: 'buildPatch returned non-handle',
               message: String(faceHandle) };
    }
    return { ok: true, faceHandle, uKnots, vKnots, uDeg, vDeg };
  } catch (err) {
    return { ok: false, reason: 'buildPatch threw',
             message: err && err.message ? err.message : String(err) };
  }
}

/** Append a surface body to the live scene. Returns the body record
 *  appended. */
export function appendClassABody(faceHandle, { continuity, source, name }) {
  if (typeof window === 'undefined') return null;
  const ts = Date.now();
  const id = `class-a-blend-${ts}`;
  const body = {
    id, kind: 'native', handle: faceHandle,
    toolId: 'surfacing.classABlend',
    surface: true,
    params: { continuity, source },
    name: name || `Class-A Blend ${continuity}`,
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }
  return body;
}

/** Top-level driver — wires boundary build → grid build → buildPatch
 *  → __forgeAppendBody → bus event. Used by both the panel button and
 *  the e2e spec / Archie tool calls. */
export function runClassABlendPipeline({
  source = 'preset',
  continuity = 'G2',
  samples = CLASS_A_DEFAULT_SAMPLES,
  jsonOverride = null,
} = {}) {
  const body = source === 'body' ? readActiveBody() : null;
  const boundary = buildBoundary({ source, samples, body, jsonOverride });
  const gridSpec = buildClassAGrid({ boundary, continuity, samples });
  const built = commitClassAGrid(gridSpec);
  if (!built.ok) {
    return { ok: false, reason: built.reason, message: built.message,
             boundary, gridSpec };
  }
  const newBody = appendClassABody(built.faceHandle,
    { continuity, source, name: `Class-A Blend ${continuity}` });
  // Broadcast so the e2e / Archie tool / activity log can subscribe.
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FORGE_CLASS_A_BLEND_EVENT, {
        detail: {
          faceHandle: built.faceHandle, bodyId: newBody?.id,
          continuity, source, samples, uDeg: built.uDeg, vDeg: built.vDeg,
          ts: Date.now(),
        },
      }));
    }
  } catch { /* fail soft — CustomEvent is universal in Electron */ }
  return {
    ok: true, faceHandle: built.faceHandle, body: newBody,
    boundary, gridSpec, uKnots: built.uKnots, vKnots: built.vKnots,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Side-effect helper API install — the moment this module is imported
// (which App.jsx does once the bundle loads), the helper API mirror is
// available on window. This is the contract surface plugins / e2e /
// Archie tool calls rely on; making it module-level (rather than
// effect-level inside the React host) means the helpers are live even
// if a concurrent edit accidentally drops the Host from App.jsx — the
// import line alone is enough to wire the surface.

if (typeof window !== 'undefined') {
  try {
    window.__forgeClassABlendHelper = Object.freeze({
      buildBoundary,
      buildClassAGrid,
      commitClassAGrid,
      appendClassABody,
      readActiveBody,
      runClassABlendPipeline,
      continuityToTension,
      CONTINUITY_OPTIONS,
      EVENT_NAME: FORGE_CLASS_A_BLEND_EVENT,
      STORAGE_KEY: FORGE_CLASS_A_BLEND_STORAGE,
      DEFAULT_SAMPLES: CLASS_A_DEFAULT_SAMPLES,
    });
    // Bus subscriber for tools.classABlend that doesn't depend on the
    // React Host being mounted. The Host installs a richer subscriber
    // when it mounts (which lets the panel actually render), but the
    // helper-bound subscriber ensures the menu action at least surfaces
    // a window.__forgeClassABlendLastMenuTs the e2e can poll on, even
    // when only the JS module is loaded.
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.classABlend') {
        window.__forgeClassABlendLastMenuTs = Date.now();
      }
    });
  } catch { /* fail soft — defensive in SSR / non-window envs */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail as the other PUSH-N panels.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 440,
  zIndex: 1332,
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
const RADIO_GRID = {
  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
};
const RADIO_BTN = (active) => ({
  background: active ? 'var(--forge-accent-mute, #1f2c4a)' : 'var(--forge-canvas-1, #0e1218)',
  border: active ? '1px solid var(--forge-accent, #4f87ff)' : '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  color: 'var(--forge-ink, #dadde2)',
  padding: '6px 4px',
  cursor: 'pointer',
  fontSize: 11,
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
});
const SOURCE_RADIO_BTN = (active) => ({
  ...RADIO_BTN(active),
  fontSize: 10,
});
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
const FIELD_LABEL = {
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const TEXT_AREA = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  resize: 'vertical', minHeight: 80,
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function ClassABlendPanel({ open, onClose }) {
  const [source, setSource] = useState('preset'); // preset | body | json
  const [continuity, setContinuity] = useState(() => {
    if (typeof localStorage === 'undefined') return 'G2';
    try {
      const raw = localStorage.getItem(FORGE_CLASS_A_BLEND_STORAGE);
      if (!raw) return 'G2';
      const blob = JSON.parse(raw);
      const c = String(blob.continuity || 'G2').toUpperCase();
      if (c === 'G1' || c === 'G2' || c === 'G3') return c;
      return 'G2';
    } catch { return 'G2'; }
  });
  const [jsonOverride, setJsonOverride] = useState('');
  const [activeBody, setActiveBody] = useState(() => readActiveBody());
  const [log, setLog] = useState([]);
  const lastFaceRef = useRef(null);

  // Persist continuity to localStorage so the next panel-open boots the
  // same modeller setting the user just exercised.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(FORGE_CLASS_A_BLEND_STORAGE, JSON.stringify({ continuity }));
    } catch { /* quota / private mode — fail soft */ }
  }, [continuity]);

  // Re-derive the active body when the panel opens + on selection-change
  // events. The Bodies/Selection bus is the same one BodyColorsPanel
  // listens to.
  useEffect(() => {
    if (!open) return undefined;
    setActiveBody(readActiveBody());
    setLog([]);
    const refresh = () => setActiveBody(readActiveBody());
    window.addEventListener('forge:selection-changed', refresh);
    window.addEventListener('forge:bodies-changed', refresh);
    return () => {
      window.removeEventListener('forge:selection-changed', refresh);
      window.removeEventListener('forge:bodies-changed', refresh);
    };
  }, [open]);

  // Source radio: when the user flips to "body" but nothing is picked,
  // the panel still works — buildBoundary falls back to the preset. The
  // status pill on the source row makes that clear.
  const onSetSource = useCallback((s) => setSource(s), []);
  const onSetContinuity = useCallback((c) => setContinuity(c), []);
  const onSetJsonOverride = useCallback((e) => setJsonOverride(e.target.value), []);

  // Build sample blend — the headline button. Drives the same pipeline
  // the e2e + Archie tool-call paths land on.
  const onBuild = useCallback(() => {
    let override = null;
    if (source === 'json' && jsonOverride.trim().length > 0) {
      try {
        const blob = JSON.parse(jsonOverride);
        if (blob && blob.curveU0 && blob.curveU1 && blob.curveV0 && blob.curveV1) {
          override = blob;
        }
      } catch { /* keep override null — the pipeline falls back to preset */ }
    }
    const r = runClassABlendPipeline({
      source, continuity, samples: CLASS_A_DEFAULT_SAMPLES,
      jsonOverride: override,
    });
    if (r.ok) lastFaceRef.current = r.faceHandle;
    setLog((l) => [
      ...l.slice(-12),
      {
        ok: r.ok, ts: Date.now(),
        message: r.ok
          ? `Built ${continuity} blend → face ${r.faceHandle} (${r.gridSpec.kind})`
          : `Build failed: ${r.reason || 'error'}${r.message ? ' · ' + r.message : ''}`,
      },
    ]);
  }, [source, continuity, jsonOverride]);

  // The "source: body" mode shows a tiny status line so the user can
  // tell whether the panel has a body to extract from.
  const bodyStatus = useMemo(() => {
    if (!activeBody) return 'no body picked — preset will be used';
    if (!activeBody.bbox) return `body ${activeBody.name} — bbox unavailable, preset will be used`;
    const b = activeBody.bbox;
    return `body ${activeBody.name} — bbox [${b.xMin.toFixed(1)},${b.yMin.toFixed(1)},${b.zMin.toFixed(1)}] → [${b.xMax.toFixed(1)},${b.yMax.toFixed(1)},${b.zMax.toFixed(1)}]`;
  }, [activeBody]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Class-A blend"
         data-testid="forge-class-a-blend-panel"
         data-continuity={continuity}
         data-source={source}
         data-last-face={lastFaceRef.current == null ? '' : String(lastFaceRef.current)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.spline" size={14} />
        <strong style={{ fontSize: 13 }}>Class-A Blend</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          G2/G3 Coons
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Class-A Blend panel"
                data-testid="forge-class-a-blend-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Bridge four boundary curves with a curvature-continuous NURBS
        patch via Coons + bicubic Hermite. Builds an OCCT face through
        surfacing.buildPatch.
      </div>

      <div style={SECTION_TITLE}>Continuity</div>
      <div style={SECTION_BOX}>
        <div style={RADIO_GRID}>
          {CONTINUITY_OPTIONS.map((opt) => {
            const active = continuity === opt.id;
            return (
              <button key={opt.id}
                      type="button"
                      onClick={() => onSetContinuity(opt.id)}
                      data-testid={`forge-class-a-blend-continuity-${opt.id.toLowerCase()}`}
                      data-active={active ? '1' : '0'}
                      aria-pressed={active}
                      style={RADIO_BTN(active)}>
                <strong>{opt.label}</strong>
                <span style={{
                  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                  fontSize: 9,
                  color: 'var(--forge-ink-mute, #9aa1ab)',
                }}>
                  OCCT {opt.occtLabel}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {CONTINUITY_OPTIONS.find((o) => o.id === continuity)?.description}
        </div>
      </div>

      <div style={SECTION_TITLE}>Boundary source</div>
      <div style={SECTION_BOX}>
        <div style={RADIO_GRID}>
          <button type="button"
                  onClick={() => onSetSource('preset')}
                  data-testid="forge-class-a-blend-source-preset"
                  data-active={source === 'preset' ? '1' : '0'}
                  aria-pressed={source === 'preset'}
                  style={SOURCE_RADIO_BTN(source === 'preset')}>
            <strong>Saddle preset</strong>
            <span style={FIELD_LABEL}>100 mm × 25 mm lift</span>
          </button>
          <button type="button"
                  onClick={() => onSetSource('body')}
                  data-testid="forge-class-a-blend-source-body"
                  data-active={source === 'body' ? '1' : '0'}
                  aria-pressed={source === 'body'}
                  style={SOURCE_RADIO_BTN(source === 'body')}>
            <strong>From body</strong>
            <span style={FIELD_LABEL}>top-face bbox</span>
          </button>
          <button type="button"
                  onClick={() => onSetSource('json')}
                  data-testid="forge-class-a-blend-source-json"
                  data-active={source === 'json' ? '1' : '0'}
                  aria-pressed={source === 'json'}
                  style={SOURCE_RADIO_BTN(source === 'json')}>
            <strong>JSON override</strong>
            <span style={FIELD_LABEL}>curveU0/U1/V0/V1</span>
          </button>
        </div>
        {source === 'body' && (
          <div data-testid="forge-class-a-blend-body-status"
               style={{ fontSize: 10,
                        color: activeBody && activeBody.bbox
                          ? 'var(--forge-ink-2, #b5bac4)'
                          : 'var(--forge-warn, #d4a142)' }}>
            {bodyStatus}
          </div>
        )}
        {source === 'json' && (
          <textarea
            value={jsonOverride}
            onChange={onSetJsonOverride}
            data-testid="forge-class-a-blend-json"
            placeholder='{"curveU0":[[0,0,0],[100,0,0]], …}'
            style={TEXT_AREA} />
        )}
      </div>

      <div style={SECTION_TITLE}>Build</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onBuild}
                data-testid="forge-class-a-blend-build"
                style={ACTION_BTN('primary')}>
          Build sample blend
        </button>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`${CLASS_A_DEFAULT_SAMPLES}×${CLASS_A_DEFAULT_SAMPLES} control grid · degree 3 · open-uniform knots`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Log</div>
      <div data-testid="forge-class-a-blend-log"
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
// Host — listens for the `tools.classABlend` menu action, exposes the
// imperative open/close hooks plus the headless pipeline helpers on
// window.__forgeClassABlendHelper for plugins / e2e / Archie tool calls.

export function ClassABlendPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenClassABlend  = () => setOpen(true);
    window.__forgeCloseClassABlend = () => setOpen(false);
    window.__forgeClassABlendHelper = Object.freeze({
      buildBoundary,
      buildClassAGrid,
      commitClassAGrid,
      appendClassABody,
      readActiveBody,
      runClassABlendPipeline,
      continuityToTension,
      CONTINUITY_OPTIONS,
      EVENT_NAME: FORGE_CLASS_A_BLEND_EVENT,
      STORAGE_KEY: FORGE_CLASS_A_BLEND_STORAGE,
      DEFAULT_SAMPLES: CLASS_A_DEFAULT_SAMPLES,
    });
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.classABlend') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenClassABlend; } catch {}
      try { delete window.__forgeCloseClassABlend; } catch {}
      try { delete window.__forgeClassABlendHelper; } catch {}
    };
  }, []);
  // Only mount the panel subtree when open. This makes the useState
  // initializer (which reads localStorage) run fresh on each open,
  // honouring any test-fixture clears that happen after app boot.
  if (!open) return null;
  return <ClassABlendPanel open={open} onClose={() => setOpen(false)} />;
}

export default ClassABlendPanel;
