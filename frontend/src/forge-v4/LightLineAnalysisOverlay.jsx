// PUSH-87 (Slice-55) — Light-line / Isophote analysis overlay.
//
// A Class-A surfacing diagnostic distinct from PUSH-86's zebra stripes:
// where zebra reflects a *bundle* of stripes from a striped environment,
// an isophote view draws ONE highlight contour at the picked light
// direction so kinks at G1 breaks pop. Designers use both views in
// tandem during a body-line review — zebra for sweep continuity, light-
// line for the highlight crease.
//
// What this overlay does:
//   1. Listens for the `tools.lightLines` menu action AND the imperative
//      hook `window.__forgeOpenLightLines()`. Mounting the host installs
//      a public helper API on `window.__forgeLightLineHelper` so plugins
//      and e2e specs can drive the overlay without touching React.
//   2. On enable, walks the live r3f scene (`window.__forgeScene`) and
//      swaps every body mesh's material for the isophote shader from
//      `./isophoteShader.js`. The original material is stashed in
//      `userData.__lightLineOriginalMaterial` so disable restores it
//      cleanly. The shader's uniforms (`lightDir`, `lineDensity`,
//      `threshold`, `surfaceColor`) are mutated live by the panel's
//      sliders — no rebuild per change.
//   3. Renders a right-docked control panel (portal) with:
//        • azimuth slider (0 → 360°)
//        • elevation slider (-90 → 90°)
//        • line density slider (4 → 64)
//        • threshold slider (0.005 → 0.20)
//        • surface tint colour picker
//        • curvature gain slider (1 → 32, drives the soft→bold ramp)
//        • Reset + Disable buttons
//   4. Cooperates with foundation/ZebraStripes.js — if the user toggled
//      zebra on first, enabling the light-line view restores zebra's
//      stashed original before swapping in the isophote material. The
//      reverse case (zebra on a light-lined body) is handled in
//      ZebraStripes' own applyZebraToObject toggle path.
//
// Hard constraints from the slice brief:
//   - NO new npm / C++ / external deps.
//   - Viewport.jsx is NOT modified; we attach via `window.__forgeScene`
//     and `window.__forgeCamera` that RendererPublisher already exposes.
//   - Material-swap pattern (same as PUSH-86 zebra) so the analysis
//     reads on the real shaded body, no extra <Canvas> mount.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ISOPHOTE_DEFAULTS,
  buildIsophoteMaterial,
  updateIsophoteUniforms,
  applyIsophoteToObject,
  clearIsophoteFromObject,
  dirFromAzEl,
} from './isophoteShader.js';

// ---------------------------------------------------------------------------
// Constants — bus event names + storage key. The state is mirrored onto
// `window.__forgeLightLines` so plugins / Archie / the e2e spec can read
// the live uniforms without scraping the React tree.

export const FORGE_LIGHTLINE_EVENT = 'forge:light-lines-changed';
const STORAGE_KEY = 'forge.v4.lightLines';

// Defaults are re-exported through ISOPHOTE_DEFAULTS so the panel + the
// shader builder stay in lockstep. We compose the additional UI flags
// (visible, ambient) on top.
export const LIGHT_LINE_DEFAULTS = Object.freeze({
  ...ISOPHOTE_DEFAULTS,
  visible: false,
});

// ---------------------------------------------------------------------------
// Pure helpers — exported for the e2e spec / Archie tool calls / plugins.

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export function normaliseLightLineState(blob) {
  const b = (blob && typeof blob === 'object') ? blob : {};
  return {
    lineDensity:   clamp(b.lineDensity   ?? LIGHT_LINE_DEFAULTS.lineDensity,    1, 256),
    threshold:     clamp(b.threshold     ?? LIGHT_LINE_DEFAULTS.threshold,   0.001, 0.5),
    azimuth:       clamp(b.azimuth       ?? LIGHT_LINE_DEFAULTS.azimuth,        0, 360),
    elevation:     clamp(b.elevation     ?? LIGHT_LINE_DEFAULTS.elevation,    -90, 90),
    ambient:       clamp(b.ambient       ?? LIGHT_LINE_DEFAULTS.ambient,        0, 1),
    curvatureGain: clamp(b.curvatureGain ?? LIGHT_LINE_DEFAULTS.curvatureGain,  0, 128),
    surfaceColor:  typeof b.surfaceColor === 'string'
      ? b.surfaceColor
      : LIGHT_LINE_DEFAULTS.surfaceColor,
    visible:       Boolean(b.visible),
  };
}

function readStored() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normaliseLightLineState(JSON.parse(raw));
  } catch { return null; }
}
function writeStored(v) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch {}
}

// Publish state to the window mirror + bus. Single writer = the host
// effect; no plugin / e2e ever writes directly.
function publish(state) {
  if (typeof window === 'undefined') return;
  const norm = normaliseLightLineState(state);
  window.__forgeLightLines = norm;
  try {
    window.dispatchEvent(new CustomEvent(FORGE_LIGHTLINE_EVENT, { detail: norm }));
  } catch { /* fail-soft */ }
}

// ---------------------------------------------------------------------------
// Material lifecycle wrappers around isophoteShader.js. The overlay
// keeps a singleton material reference so slider scrubs only mutate
// uniforms — never rebuild. When disabling we dispose AND clear refs.

function ensureMaterial(state, ref) {
  if (!ref.current) {
    ref.current = buildIsophoteMaterial(state);
  } else {
    updateIsophoteUniforms(ref.current, state);
  }
  return ref.current;
}

function disposeMaterial(ref) {
  if (ref.current) {
    try { ref.current.dispose(); } catch {}
    ref.current = null;
  }
}

function enableOnScene(material) {
  if (typeof window === 'undefined') return { applied: 0 };
  const scene = window.__forgeScene;
  if (!scene) return { applied: 0 };
  return applyIsophoteToObject(scene, material);
}

function disableOnScene() {
  if (typeof window === 'undefined') return { restored: 0 };
  const scene = window.__forgeScene;
  if (!scene) return { restored: 0 };
  return clearIsophoteFromObject(scene);
}

// ---------------------------------------------------------------------------
// Styles. Same right-docked rail as LightingPanel — 320 px wide, z-index
// 1330 so it sits above viewport HUDs but below modal dialogs.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 320,
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
const SLIDER_LABEL = {
  display: 'flex', flexDirection: 'column', gap: 4,
};
const SLIDER_LABEL_TEXT = {
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};
const READOUT_GRID = {
  display: 'grid', gridTemplateColumns: '110px 1fr',
  columnGap: 8, rowGap: 4,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};

// ---------------------------------------------------------------------------
// Panel UI.

export function LightLineAnalysisPanel({ open, onClose }) {
  const initialState = () => {
    const stored = readStored();
    if (stored) return { ...stored, visible: false };
    if (typeof window !== 'undefined' && window.__forgeLightLines) {
      return normaliseLightLineState(window.__forgeLightLines);
    }
    return { ...LIGHT_LINE_DEFAULTS };
  };

  const [state, setState] = useState(initialState);
  // Singleton material — built on first enable, disposed on disable.
  const materialRef = useRef(null);
  // How many meshes wear the analysis material right now. Drives the
  // "applied N meshes" line so users see the swap landed.
  const [appliedCount, setAppliedCount] = useState(0);

  // Re-baseline on open.
  useEffect(() => {
    if (!open) return undefined;
    setState((s) => ({ ...initialState(), visible: s.visible }));
    return undefined;
  }, [open]);

  // Mutate live material on every uniform change. The visible-toggle
  // path is in onToggleVisible below — this just keeps the shader's
  // uniforms in sync while the overlay is already enabled.
  useEffect(() => {
    if (materialRef.current) {
      updateIsophoteUniforms(materialRef.current, state);
    }
    publish(state);
    writeStored(state);
    if (typeof window !== 'undefined') {
      window.__forgeLightLineMaterial = materialRef.current;
    }
  }, [state.lineDensity, state.threshold, state.azimuth, state.elevation,
      state.surfaceColor, state.ambient, state.curvatureGain, state.visible]);

  const onToggleVisible = useCallback(() => {
    setState((s) => {
      const next = { ...s, visible: !s.visible };
      if (next.visible) {
        const mat = ensureMaterial(next, materialRef);
        const { applied } = enableOnScene(mat);
        setAppliedCount(applied);
      } else {
        const { restored } = disableOnScene();
        setAppliedCount(0);
        disposeMaterial(materialRef);
        if (typeof window !== 'undefined') window.__forgeLightLineMaterial = null;
        // Soft hint to plugin layer that restoration happened.
        try {
          window.dispatchEvent(new CustomEvent(FORGE_LIGHTLINE_EVENT, {
            detail: { ...next, restored },
          }));
        } catch {}
      }
      return next;
    });
  }, []);

  // Re-apply the swap whenever the scene churns (a new body lands).
  // The host installs a `forge:bodies-changed` listener but the live
  // re-attach happens here so we always swap the freshest scene.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onBodies = () => {
      if (!state.visible) return;
      const mat = ensureMaterial(state, materialRef);
      const { applied } = enableOnScene(mat);
      setAppliedCount(applied);
    };
    window.addEventListener('forge:bodies-changed', onBodies);
    return () => window.removeEventListener('forge:bodies-changed', onBodies);
  }, [state.visible, state.lineDensity, state.threshold, state.azimuth,
      state.elevation, state.surfaceColor, state.ambient, state.curvatureGain]);

  // Slider handlers — each one mutates one field; the effect above
  // propagates the change to the shader uniform.
  const onSlider = (field, lo, hi) => (e) => {
    const v = Number(e?.target?.value);
    if (!Number.isFinite(v)) return;
    setState((s) => ({ ...s, [field]: clamp(v, lo, hi) }));
  };
  const onColor = useCallback((e) => {
    const v = e?.target?.value;
    if (typeof v !== 'string') return;
    setState((s) => ({ ...s, surfaceColor: v }));
  }, []);
  const onReset = useCallback(() => {
    setState((s) => ({ ...LIGHT_LINE_DEFAULTS, visible: s.visible }));
  }, []);

  // Computed unit-vector display for the user (and the e2e assertion).
  const dir = useMemo(
    () => dirFromAzEl(state.azimuth, state.elevation),
    [state.azimuth, state.elevation],
  );

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Light-line / Isophote analysis"
         data-testid="forge-light-lines-panel"
         data-visible={state.visible ? '1' : '0'}
         data-line-density={state.lineDensity}
         data-threshold={state.threshold}
         data-azimuth={state.azimuth}
         data-elevation={state.elevation}
         data-surface-color={state.surfaceColor}
         data-ambient={state.ambient}
         data-curvature-gain={state.curvatureGain}
         data-applied-count={appliedCount}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <strong style={{ fontSize: 13 }}>Light-line / Isophote</strong>
        <span style={{ flex: 1 }} />
        <button type="button"
                data-testid="forge-light-lines-close"
                aria-label="Close light-line panel"
                onClick={() => onClose?.()}
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)', lineHeight: 1.4 }}>
        Draws isophote contours at <code>dot(normal, light)</code> bands.
        Class-A QC: kinks at G1 breaks read as bold black lines; smooth
        transitions stay faint grey. Independent of <code>tools.zebra</code> —
        toggling one restores the other's underlying material.
      </div>

      {/* Enable / Disable button — primary control. */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button"
                onClick={onToggleVisible}
                data-testid="forge-light-lines-toggle"
                data-visible={state.visible ? '1' : '0'}
                style={ACTION_BTN(state.visible ? 'primary' : 'default')}>
          {state.visible ? 'Disable' : 'Enable'} light lines
        </button>
        <button type="button"
                onClick={onReset}
                data-testid="forge-light-lines-reset"
                title="Reset density / threshold / direction to defaults"
                style={ACTION_BTN('default')}>
          Reset
        </button>
      </div>

      {/* Azimuth slider. */}
      <label style={SLIDER_LABEL}>
        <span style={SLIDER_LABEL_TEXT}>
          Azimuth (°) <strong>{state.azimuth.toFixed(0)}°</strong>
        </span>
        <input type="range" min={0} max={360} step={1}
               value={state.azimuth}
               onChange={onSlider('azimuth', 0, 360)}
               data-testid="forge-light-lines-azimuth"
               data-azimuth={state.azimuth}
               aria-label="Light-line azimuth" />
      </label>

      {/* Elevation slider. */}
      <label style={SLIDER_LABEL}>
        <span style={SLIDER_LABEL_TEXT}>
          Elevation (°) <strong>{state.elevation.toFixed(0)}°</strong>
        </span>
        <input type="range" min={-90} max={90} step={1}
               value={state.elevation}
               onChange={onSlider('elevation', -90, 90)}
               data-testid="forge-light-lines-elevation"
               data-elevation={state.elevation}
               aria-label="Light-line elevation" />
      </label>

      {/* Line density slider. */}
      <label style={SLIDER_LABEL}>
        <span style={SLIDER_LABEL_TEXT}>
          Line density <strong>{state.lineDensity.toFixed(0)}</strong>
        </span>
        <input type="range" min={4} max={64} step={1}
               value={state.lineDensity}
               onChange={onSlider('lineDensity', 1, 256)}
               data-testid="forge-light-lines-density"
               data-density={state.lineDensity}
               aria-label="Light-line density" />
      </label>

      {/* Threshold slider. */}
      <label style={SLIDER_LABEL}>
        <span style={SLIDER_LABEL_TEXT}>
          Threshold (band half-width) <strong>{state.threshold.toFixed(3)}</strong>
        </span>
        <input type="range" min={0.005} max={0.20} step={0.005}
               value={state.threshold}
               onChange={onSlider('threshold', 0.001, 0.5)}
               data-testid="forge-light-lines-threshold"
               data-threshold={state.threshold}
               aria-label="Light-line threshold" />
      </label>

      {/* Curvature gain slider. */}
      <label style={SLIDER_LABEL}>
        <span style={SLIDER_LABEL_TEXT}>
          Curvature gain (soft→bold) <strong>{state.curvatureGain.toFixed(1)}</strong>
        </span>
        <input type="range" min={1} max={32} step={0.5}
               value={state.curvatureGain}
               onChange={onSlider('curvatureGain', 0, 128)}
               data-testid="forge-light-lines-curvature"
               data-curvature={state.curvatureGain}
               aria-label="Curvature gain" />
      </label>

      {/* Ambient slider. */}
      <label style={SLIDER_LABEL}>
        <span style={SLIDER_LABEL_TEXT}>
          Surface ambient <strong>{state.ambient.toFixed(2)}</strong>
        </span>
        <input type="range" min={0} max={1} step={0.02}
               value={state.ambient}
               onChange={onSlider('ambient', 0, 1)}
               data-testid="forge-light-lines-ambient"
               data-ambient={state.ambient}
               aria-label="Ambient" />
      </label>

      {/* Surface tint colour picker. */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...SLIDER_LABEL_TEXT, flex: 1 }}>
          Surface tint
        </span>
        <input type="color"
               value={state.surfaceColor}
               onChange={onColor}
               data-testid="forge-light-lines-surface-color"
               data-surface-color={state.surfaceColor}
               aria-label="Surface tint"
               style={{ width: 48, height: 28, padding: 0,
                        border: '1px solid var(--forge-rail-edge, #2a2d34)',
                        background: 'transparent', cursor: 'pointer',
                        borderRadius: 3 }} />
        <code data-testid="forge-light-lines-surface-color-hex"
              style={{ fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                       fontSize: 11, color: 'var(--forge-ink, #dadde2)' }}>
          {state.surfaceColor}
        </code>
      </label>

      {/* Live readout — same data-* mirror trick as LightingPanel so
          the e2e can assert without scraping inner text. */}
      <section data-testid="forge-light-lines-readout" style={READOUT_GRID}>
        <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Visible</div>
        <div data-testid="forge-light-lines-visible-readout"
             data-value={state.visible ? '1' : '0'}>
          {state.visible ? 'on' : 'off'}
        </div>
        <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Applied</div>
        <div data-testid="forge-light-lines-applied-readout"
             data-value={appliedCount}>
          {appliedCount} mesh{appliedCount === 1 ? '' : 'es'}
        </div>
        <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Direction</div>
        <div data-testid="forge-light-lines-direction-readout"
             data-dx={dir.x.toFixed(3)}
             data-dy={dir.y.toFixed(3)}
             data-dz={dir.z.toFixed(3)}>
          ({dir.x.toFixed(2)}, {dir.y.toFixed(2)}, {dir.z.toFixed(2)})
        </div>
      </section>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Host — listens for the `tools.lightLines` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the headless helpers on the window debug mirror.

export function LightLineAnalysisOverlayHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    // Hydrate the window mirror at mount so callers can read defaults
    // even before the panel is opened.
    if (!window.__forgeLightLines) {
      const initial = readStored() || { ...LIGHT_LINE_DEFAULTS };
      publish(initial);
    }

    // Imperative entry points.
    window.__forgeOpenLightLines  = () => setOpen(true);
    window.__forgeCloseLightLines = () => setOpen(false);

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.lightLines') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);

    // Public helper API — same pattern as PUSH-82 batch-rename. The
    // e2e spec asserts this is wired before the panel mounts.
    window.__forgeLightLineHelper = Object.freeze({
      buildIsophoteMaterial,
      updateIsophoteUniforms,
      applyIsophoteToObject,
      clearIsophoteFromObject,
      dirFromAzEl,
      normaliseLightLineState,
      DEFAULTS: LIGHT_LINE_DEFAULTS,
      EVENT_NAME: FORGE_LIGHTLINE_EVENT,
      STORAGE_KEY,
    });

    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenLightLines;  } catch {}
      try { delete window.__forgeCloseLightLines; } catch {}
    };
  }, []);

  return <LightLineAnalysisPanel open={open} onClose={() => setOpen(false)} />;
}

export default LightLineAnalysisPanel;
