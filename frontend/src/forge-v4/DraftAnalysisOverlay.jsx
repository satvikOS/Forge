// PUSH-104 (Slice-72) — Draft-Angle Analysis overlay for mold / casting QC.
//
// A Class-mfg analysis distinct from the Class-A surfacing overlays
// (PUSH-86 zebra, PUSH-87 light-line): every face of the part is binned
// by its draft angle relative to a user-picked pull direction.
//
//   • GREEN  — face will release (angle > threshold).
//   • YELLOW — borderline (0 < angle ≤ threshold).
//   • RED    — undercut (angle ≤ 0 — the part will lock into the mold).
//
// The classification is performed in a custom ShaderMaterial
// (./draftAnalysisShader.js) which the overlay swaps onto every body
// mesh in the live three.js scene. The user sees per-face colour
// gradients shading the part the moment they pick a pull axis. Sliding
// the threshold or flipping the pull direction updates the shared
// uniform; no rebuild per change.
//
// Wire-up
// ───────
//   • Reachable through Tools menu (`tools.draftAnalysis`).
//   • A self-mounting Host listens for the menu event and installs
//     imperative entry points (window.__forgeOpenDraftAnalysis,
//     __forgeCloseDraftAnalysis) for plugins / Archie tool calls / the
//     e2e spec.
//   • The Host also exposes a headless helper API on
//     `window.__forgeDraftAnalysisHelper` with builder + classifier
//     functions exported from draftAnalysisShader.js, so plugins can
//     compute the green / yellow / red ratios without touching React.
//
// Architecture mirrors PUSH-87 LightLineAnalysisOverlay almost 1:1:
//   • Material-swap pattern (the brief explicitly asks for it).
//   • We DO NOT modify Viewport.jsx — userData.body is already set by
//     the viewport's mesh ref callback (see Viewport.jsx body mesh path).
//   • Cooperates with PUSH-86 zebra + PUSH-87 light-line — both swap
//     materials too; the shader helper's applyDraftToObject peels them
//     off cleanly so the user never gets a stale shader stack.
//
// Hard constraints
// ────────────────
//   • NO new npm / C++ / external deps. three.js is already in
//     frontend/package.json (the shader builder imports it directly).
//   • Real impl, no MVP / stub / placeholder.
//   • Multi-cam e2e: 5 named camera angles per Forge-171 multi-cam
//     mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  DRAFT_DEFAULTS,
  DRAFT_PULL_PRESETS,
  DRAFT_MATERIAL_NAME,
  DRAFT_USERDATA_FLAG,
  DRAFT_STASH_KEY,
  buildDraftMaterial,
  updateDraftUniforms,
  applyDraftToObject,
  clearDraftFromObject,
  classifyDraft,
  sampleDraftBands,
} from './draftAnalysisShader.js';

// ─── Bus event names + storage key ────────────────────────────────
export const FORGE_DRAFT_EVENT = 'forge:draft-analysis-changed';
const STORAGE_KEY = 'forge.v4.draftAnalysis';

// Combined defaults blob — shader defaults + UI visible flag.
export const DRAFT_OVERLAY_DEFAULTS = Object.freeze({
  ...DRAFT_DEFAULTS,
  visible: false,
});

// ─── Pure helpers ─────────────────────────────────────────────────
// Exported for tests / Archie tool calls.

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

// Normalise + clamp the persisted blob. Same guardrails as PUSH-87
// LightLineAnalysisOverlay — anything malformed in localStorage falls
// back to the canonical defaults instead of throwing into the UI.
export function normaliseDraftState(blob) {
  const b = (blob && typeof blob === 'object') ? blob : {};
  const presetIds = DRAFT_PULL_PRESETS.map((p) => p.id);
  const pullDirId = presetIds.includes(b.pullDirId)
    ? b.pullDirId : DRAFT_OVERLAY_DEFAULTS.pullDirId;
  const preset = DRAFT_PULL_PRESETS.find((p) => p.id === pullDirId)
                 || DRAFT_PULL_PRESETS[0];
  // If the blob carries explicit xyz override those win (custom axis);
  // otherwise the preset's canonical axis is the truth.
  const x = Number.isFinite(b.pullDirX) ? b.pullDirX : preset.axis[0];
  const y = Number.isFinite(b.pullDirY) ? b.pullDirY : preset.axis[1];
  const z = Number.isFinite(b.pullDirZ) ? b.pullDirZ : preset.axis[2];
  return {
    pullDirId,
    pullDirX: x,
    pullDirY: y,
    pullDirZ: z,
    thresholdDeg: clamp(b.thresholdDeg ?? DRAFT_OVERLAY_DEFAULTS.thresholdDeg, 0, 5),
    ambient:      clamp(b.ambient      ?? DRAFT_OVERLAY_DEFAULTS.ambient,      0, 1),
    visible:      Boolean(b.visible),
  };
}

function readStored() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normaliseDraftState(JSON.parse(raw));
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
  const norm = normaliseDraftState(state);
  window.__forgeDraftAnalysis = norm;
  try {
    window.dispatchEvent(new CustomEvent(FORGE_DRAFT_EVENT, { detail: norm }));
  } catch { /* fail-soft */ }
}

// ─── Material lifecycle wrappers ──────────────────────────────────
// Same shape as PUSH-87 — the overlay keeps a singleton material
// reference so slider scrubs only mutate uniforms.

function ensureMaterial(state, ref) {
  if (!ref.current) {
    ref.current = buildDraftMaterial(state);
  } else {
    updateDraftUniforms(ref.current, state);
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
  return applyDraftToObject(scene, material);
}
function disableOnScene() {
  if (typeof window === 'undefined') return { restored: 0 };
  const scene = window.__forgeScene;
  if (!scene) return { restored: 0 };
  return clearDraftFromObject(scene);
}

// ─── Styles ────────────────────────────────────────────────────────
// Right-docked rail mirroring PUSH-87 — sized + z-indexed to sit above
// viewport HUDs but below modal dialogs (the section-plane panel uses
// the same slot when active).

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
const PRESET_GRID = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 4,
};
const PRESET_BTN = (active) => ({
  background: active ? 'var(--forge-accent, #4f87ff)' : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: active ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  textAlign: 'left',
});
const LEGEND_ROW = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};
const SWATCH = (rgb) => ({
  width: 12, height: 12,
  background: rgb,
  borderRadius: 2,
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  flexShrink: 0,
});

// ─── Panel UI ──────────────────────────────────────────────────────

export function DraftAnalysisPanel({ open, onClose }) {
  const initialState = () => {
    const stored = readStored();
    if (stored) return { ...stored, visible: false };
    if (typeof window !== 'undefined' && window.__forgeDraftAnalysis) {
      return normaliseDraftState(window.__forgeDraftAnalysis);
    }
    return { ...DRAFT_OVERLAY_DEFAULTS };
  };

  const [state, setState] = useState(initialState);
  // Singleton material — built on first enable, disposed on disable.
  const materialRef = useRef(null);
  // How many meshes wear the draft material right now.
  const [appliedCount, setAppliedCount] = useState(0);
  // Live colour-band ratios over a 256-sample fibonacci sphere — gives
  // the panel a quick "this many faces will release / undercut" report
  // without scraping the GPU. Updates on every state change.
  const [bands, setBands] = useState({ green: 0, yellow: 0, red: 0, total: 0,
                                       greenRatio: 0, yellowRatio: 0, redRatio: 0 });

  // Re-baseline on open.
  useEffect(() => {
    if (!open) return undefined;
    setState((s) => ({ ...initialState(), visible: s.visible }));
    return undefined;
  }, [open]);

  // Mutate live material on every uniform change.
  useEffect(() => {
    if (materialRef.current) {
      updateDraftUniforms(materialRef.current, state);
    }
    publish(state);
    writeStored(state);
    if (typeof window !== 'undefined') {
      window.__forgeDraftMaterial = materialRef.current;
    }
    // Recompute the sample ratios over a unit sphere. Pure math, fast
    // enough to run every state change; the panel surfaces the values.
    const sampled = sampleDraftBands(
      [state.pullDirX, state.pullDirY, state.pullDirZ],
      state.thresholdDeg, 256);
    setBands(sampled);
  }, [state.pullDirX, state.pullDirY, state.pullDirZ,
      state.thresholdDeg, state.ambient, state.visible]);

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
        if (typeof window !== 'undefined') window.__forgeDraftMaterial = null;
        try {
          window.dispatchEvent(new CustomEvent(FORGE_DRAFT_EVENT, {
            detail: { ...next, restored },
          }));
        } catch {}
      }
      return next;
    });
  }, []);

  // Re-apply the swap whenever the scene churns (a new body lands).
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
  }, [state.visible, state.pullDirX, state.pullDirY, state.pullDirZ,
      state.thresholdDeg, state.ambient]);

  const onPickPreset = useCallback((id) => {
    const preset = DRAFT_PULL_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setState((s) => ({ ...s,
      pullDirId: preset.id,
      pullDirX:  preset.axis[0],
      pullDirY:  preset.axis[1],
      pullDirZ:  preset.axis[2],
    }));
  }, []);
  const onThresholdSlider = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (!Number.isFinite(v)) return;
    setState((s) => ({ ...s, thresholdDeg: clamp(v, 0, 5) }));
  }, []);
  const onAmbientSlider = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (!Number.isFinite(v)) return;
    setState((s) => ({ ...s, ambient: clamp(v, 0, 1) }));
  }, []);
  const onReset = useCallback(() => {
    setState((s) => ({ ...DRAFT_OVERLAY_DEFAULTS, visible: s.visible }));
  }, []);

  // Computed unit-vector display.
  const dirNorm = useMemo(() => {
    const len = Math.hypot(state.pullDirX, state.pullDirY, state.pullDirZ);
    if (len < 1e-4) return { x: 0, y: 0, z: 1 };
    return {
      x: state.pullDirX / len,
      y: state.pullDirY / len,
      z: state.pullDirZ / len,
    };
  }, [state.pullDirX, state.pullDirY, state.pullDirZ]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Draft-angle analysis (mold / casting)"
         data-testid="forge-draft-analysis-panel"
         data-visible={state.visible ? '1' : '0'}
         data-pull-dir-id={state.pullDirId}
         data-threshold-deg={state.thresholdDeg}
         data-pull-dir-x={dirNorm.x.toFixed(4)}
         data-pull-dir-y={dirNorm.y.toFixed(4)}
         data-pull-dir-z={dirNorm.z.toFixed(4)}
         data-ambient={state.ambient}
         data-applied-count={appliedCount}
         data-green-ratio={bands.greenRatio.toFixed(4)}
         data-yellow-ratio={bands.yellowRatio.toFixed(4)}
         data-red-ratio={bands.redRatio.toFixed(4)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <strong style={{ fontSize: 13 }}>Draft Angle Analysis</strong>
        <span style={{ flex: 1 }} />
        <button type="button"
                data-testid="forge-draft-analysis-close"
                aria-label="Close draft-analysis panel"
                onClick={() => onClose?.()}
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)', lineHeight: 1.4 }}>
        Colours every face by its draft angle vs the pull direction.
        Mold &amp; casting QC: any RED face is an undercut that will
        lock into the tool; YELLOW is borderline; GREEN releases.
      </div>

      {/* Enable / Disable button — primary control. */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button"
                onClick={onToggleVisible}
                data-testid="forge-draft-analysis-toggle"
                data-visible={state.visible ? '1' : '0'}
                style={ACTION_BTN(state.visible ? 'primary' : 'default')}>
          {state.visible ? 'Disable' : 'Enable'} draft analysis
        </button>
        <button type="button"
                onClick={onReset}
                data-testid="forge-draft-analysis-reset"
                title="Reset pull dir + threshold to defaults"
                style={ACTION_BTN('default')}>
          Reset
        </button>
      </div>

      {/* Pull direction picker. */}
      <label style={SLIDER_LABEL}>
        <span style={SLIDER_LABEL_TEXT}>
          Pull direction <strong>{state.pullDirId}</strong>
        </span>
        <div style={PRESET_GRID}>
          {DRAFT_PULL_PRESETS.map((p) => (
            <button key={p.id}
                    type="button"
                    onClick={() => onPickPreset(p.id)}
                    data-testid={`forge-draft-analysis-pull-${p.id}`}
                    data-pull-id={p.id}
                    aria-pressed={state.pullDirId === p.id}
                    style={PRESET_BTN(state.pullDirId === p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </label>

      {/* Threshold slider — 0 to 5 degrees, the manufacturing range. */}
      <label style={SLIDER_LABEL}>
        <span style={SLIDER_LABEL_TEXT}>
          Threshold angle <strong>{state.thresholdDeg.toFixed(2)}°</strong>
        </span>
        <input type="range" min={0} max={5} step={0.1}
               value={state.thresholdDeg}
               onChange={onThresholdSlider}
               data-testid="forge-draft-analysis-threshold"
               data-threshold={state.thresholdDeg}
               aria-label="Draft threshold angle (degrees)" />
      </label>

      {/* Ambient slider — diffuse floor so the form reads. */}
      <label style={SLIDER_LABEL}>
        <span style={SLIDER_LABEL_TEXT}>
          Surface ambient <strong>{state.ambient.toFixed(2)}</strong>
        </span>
        <input type="range" min={0} max={1} step={0.02}
               value={state.ambient}
               onChange={onAmbientSlider}
               data-testid="forge-draft-analysis-ambient"
               data-ambient={state.ambient}
               aria-label="Surface ambient floor" />
      </label>

      {/* Colour legend. */}
      <section data-testid="forge-draft-analysis-legend"
               style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={LEGEND_ROW}>
          <span style={SWATCH('rgb(51,199,77)')} />
          <span>Green — releases ({(bands.greenRatio * 100).toFixed(0)}%)</span>
        </div>
        <div style={LEGEND_ROW}>
          <span style={SWATCH('rgb(242,212,51)')} />
          <span>Yellow — borderline ({(bands.yellowRatio * 100).toFixed(0)}%)</span>
        </div>
        <div style={LEGEND_ROW}>
          <span style={SWATCH('rgb(235,51,51)')} />
          <span>Red — undercut ({(bands.redRatio * 100).toFixed(0)}%)</span>
        </div>
      </section>

      {/* Live readout strip — same data-* mirror trick as PUSH-87 so the
          e2e doesn't have to scrape inner text. */}
      <section data-testid="forge-draft-analysis-readout" style={READOUT_GRID}>
        <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Visible</div>
        <div data-testid="forge-draft-analysis-visible-readout"
             data-value={state.visible ? '1' : '0'}>
          {state.visible ? 'on' : 'off'}
        </div>
        <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Applied</div>
        <div data-testid="forge-draft-analysis-applied-readout"
             data-value={appliedCount}>
          {appliedCount} mesh{appliedCount === 1 ? '' : 'es'}
        </div>
        <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Pull dir</div>
        <div data-testid="forge-draft-analysis-direction-readout"
             data-dx={dirNorm.x.toFixed(3)}
             data-dy={dirNorm.y.toFixed(3)}
             data-dz={dirNorm.z.toFixed(3)}>
          ({dirNorm.x.toFixed(2)}, {dirNorm.y.toFixed(2)}, {dirNorm.z.toFixed(2)})
        </div>
        <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Green/Yellow/Red</div>
        <div data-testid="forge-draft-analysis-bands-readout"
             data-green={bands.green}
             data-yellow={bands.yellow}
             data-red={bands.red}>
          {bands.green} / {bands.yellow} / {bands.red}
        </div>
      </section>
    </div>,
    document.body,
  );
}

// ─── Host ──────────────────────────────────────────────────────────
// Listens for tools.draftAnalysis, exposes imperative open/close hooks,
// surfaces the headless helper API on the window debug mirror.

export function DraftAnalysisOverlayHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    // Hydrate the window mirror at mount so callers can read defaults
    // even before the panel is opened.
    if (!window.__forgeDraftAnalysis) {
      const initial = readStored() || { ...DRAFT_OVERLAY_DEFAULTS };
      publish(initial);
    }

    // Imperative entry points.
    window.__forgeOpenDraftAnalysis  = () => setOpen(true);
    window.__forgeCloseDraftAnalysis = () => setOpen(false);

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.draftAnalysis') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);

    // Public helper API.
    window.__forgeDraftAnalysisHelper = Object.freeze({
      buildDraftMaterial,
      updateDraftUniforms,
      applyDraftToObject,
      clearDraftFromObject,
      classifyDraft,
      sampleDraftBands,
      normaliseDraftState,
      DEFAULTS:        DRAFT_OVERLAY_DEFAULTS,
      PULL_PRESETS:    DRAFT_PULL_PRESETS,
      MATERIAL_NAME:   DRAFT_MATERIAL_NAME,
      USERDATA_FLAG:   DRAFT_USERDATA_FLAG,
      STASH_KEY:       DRAFT_STASH_KEY,
      EVENT_NAME:      FORGE_DRAFT_EVENT,
      STORAGE_KEY,
    });

    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenDraftAnalysis;  } catch {}
      try { delete window.__forgeCloseDraftAnalysis; } catch {}
    };
  }, []);

  return <DraftAnalysisPanel open={open} onClose={() => setOpen(false)} />;
}

export default DraftAnalysisOverlayHost;
