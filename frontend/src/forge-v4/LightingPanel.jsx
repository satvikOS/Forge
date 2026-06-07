// PUSH-75 (Slice-43) — Lighting / Environment controls PANEL.
//
// Up through PUSH-74 the Forge viewport seated its three lights with
// hard-coded intensities (ambient ~0.5, directional ~1.0) and a fixed
// dark-grey background colour. There was no UI to dial them, so users
// trying to debug a black-metal body or to match a brand-spec background
// had to crack open the React tree.
//
// PUSH-75 ships a real right-docked Lighting *panel* with:
//   • Ambient intensity slider (0 → 2)
//   • Key (directional) intensity slider (0 → 2)
//   • Key-light direction — azimuth (0 → 360°) + elevation (-90° → 90°)
//   • Background colour picker (HTML5 colour input)
//   • Live numeric readouts
//   • Reset-to-defaults button
//   • localStorage persistence under `forge.v4.lighting`
//   • Reachable through `tools.lightingEnv` menu action (the existing
//     `tools.lighting` slot is owned by Forge-253's electrical Lighting
//     Design workbench — distinct namespace so neither panel hijacks
//     the other's menu).
//
// Per spec we DO NOT touch Viewport.jsx — the panel writes its full
// state into the global `window.__forgeLighting` and emits
// `forge:lighting-changed` so any future viewport subscriber can pick
// it up. The contract shape:
//
//   window.__forgeLighting = {
//     ambient:   number,   // 0–2
//     key:       number,   // 0–2
//     azimuth:   number,   // 0–360 (degrees, CCW from +X around +Y)
//     elevation: number,   // -90–90 (degrees, +up)
//     background: string,  // CSS hex colour, e.g. '#1e1e1e'
//   }
//
// Constraints honoured (PUSH-75 brief):
//   * NO new npm packages, NO new C++ libs — React + native HTML inputs.
//   * No MVP, no stub — sliders are real, persistence is real, the bus
//     fires on every state change, defaults match the in-tree Viewport.
//   * Surgical edits to Menus.jsx + App.jsx (one new entry + one mount).
//   * Viewport.jsx is NOT modified.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// ────────────── defaults ──────────────

// Defaults chosen to match the existing Viewport lighting feel:
//   ambient 0.5 + key 1.0 — gentle fill + a clearly directional rim.
//   azimuth 45° + elevation 30° — three-quarter studio key.
//   background #1e1e1e — the same dark grey ForgeShellV4 uses today.
export const LIGHTING_DEFAULTS = Object.freeze({
  ambient:    0.5,
  key:        1.0,
  azimuth:    45,
  elevation:  30,
  background: '#1e1e1e',
});

const STORAGE_KEY = 'forge.v4.lighting';

// ────────────── helpers ──────────────

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Background colour input only accepts `#rrggbb`. We normalise on read
// so stale `forge.v4.lighting` entries from earlier formats (e.g. CSS
// colour names from a future palette) don't crash the HTML5 picker.
function normaliseColour(c) {
  if (typeof c !== 'string') return LIGHTING_DEFAULTS.background;
  const trimmed = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1], g = trimmed[2], b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return LIGHTING_DEFAULTS.background;
}

// Normalise a partial blob into the canonical lighting state. Used at
// load (localStorage) and at publish (defensive clamp so external
// callers can't push out-of-range values onto the global).
export function normaliseLighting(blob) {
  const b = (blob && typeof blob === 'object') ? blob : {};
  return {
    ambient:    clamp(Number(b.ambient   ?? LIGHTING_DEFAULTS.ambient),   0, 2),
    key:        clamp(Number(b.key       ?? LIGHTING_DEFAULTS.key),       0, 2),
    azimuth:    clamp(Number(b.azimuth   ?? LIGHTING_DEFAULTS.azimuth),   0, 360),
    elevation:  clamp(Number(b.elevation ?? LIGHTING_DEFAULTS.elevation), -90, 90),
    background: normaliseColour(b.background ?? LIGHTING_DEFAULTS.background),
  };
}

function readStored() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normaliseLighting(parsed);
  } catch { return null; }
}
function writeStored(v) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch {}
}

// Single source of truth for the global + bus event. The panel is the
// only writer, so the contract stays single-writer. The viewport (or any
// future subscriber) is the reader.
function publish(lighting) {
  if (typeof window === 'undefined') return;
  const norm = normaliseLighting(lighting);
  window.__forgeLighting = norm;
  window.dispatchEvent(new CustomEvent('forge:lighting-changed', { detail: norm }));
}

// ────────────── styles ──────────────

// Right-docked column. Same shelf rules as SectionPlanePanel /
// BodyColorsPanel / ActivityLog — z-index 1330 keeps it above the
// viewport overlays but below modal dialogs.
const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 320,
  zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};
const rowStyle = {
  display: 'grid', gridTemplateColumns: '100px 1fr',
  columnGap: 8, rowGap: 4,
  fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const closeBtn = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const resetBtn = {
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', cursor: 'pointer',
  padding: '4px 10px', borderRadius: 3, fontSize: 11,
};

// ────────────── panel ──────────────

export function LightingPanel({ open, onClose }) {
  // On (re-)open: prefer persisted state from localStorage; fall back to
  // any live global state already in place; otherwise factory defaults.
  // This means a user who closes & re-opens the panel sees the lighting
  // they last set, not the cold defaults.
  const initialState = () => {
    const stored = readStored();
    if (stored) return stored;
    if (typeof window !== 'undefined' && window.__forgeLighting) {
      return normaliseLighting(window.__forgeLighting);
    }
    return { ...LIGHTING_DEFAULTS };
  };

  const [state, setState] = useState(initialState);

  // Publish + persist on every state change. Combined into one effect so
  // a fast scrub through the sliders doesn't fan out to two re-render
  // passes per value tick.
  useEffect(() => {
    publish(state);
    writeStored(state);
  }, [state.ambient, state.key, state.azimuth, state.elevation, state.background]);

  // When the panel re-opens, snap the in-panel state back to whatever
  // the persisted store currently believes — matches MassProps's "fresh
  // on open" feel.
  useEffect(() => {
    if (!open) return undefined;
    setState(initialState());
    return undefined;
  }, [open]);

  const onAmbient = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (!Number.isFinite(v)) return;
    setState((s) => ({ ...s, ambient: clamp(v, 0, 2) }));
  }, []);
  const onKey = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (!Number.isFinite(v)) return;
    setState((s) => ({ ...s, key: clamp(v, 0, 2) }));
  }, []);
  const onAzimuth = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (!Number.isFinite(v)) return;
    setState((s) => ({ ...s, azimuth: clamp(v, 0, 360) }));
  }, []);
  const onElevation = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (!Number.isFinite(v)) return;
    setState((s) => ({ ...s, elevation: clamp(v, -90, 90) }));
  }, []);
  const onBackground = useCallback((e) => {
    const v = e?.target?.value;
    if (typeof v !== 'string') return;
    setState((s) => ({ ...s, background: normaliseColour(v) }));
  }, []);
  const onReset = useCallback(() => {
    setState({ ...LIGHTING_DEFAULTS });
  }, []);

  // Computed unit vector for the key-light direction. Display only —
  // proves to the user the azimuth/elevation maths are doing what they
  // think. Y-up convention to match three.js + the viewport's frame.
  const dir = useMemo(() => {
    const az = (state.azimuth * Math.PI) / 180;
    const el = (state.elevation * Math.PI) / 180;
    const x = Math.cos(el) * Math.cos(az);
    const z = Math.cos(el) * Math.sin(az);
    const y = Math.sin(el);
    return { x, y, z };
  }, [state.azimuth, state.elevation]);

  if (!open) return null;

  return (
    <div style={panelStyle}
         data-testid="forge-lighting-panel"
         data-ambient={state.ambient}
         data-key={state.key}
         data-azimuth={state.azimuth}
         data-elevation={state.elevation}
         data-background={state.background}>
      <header style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', gap: 8 }}>
        <strong>Lighting &amp; Environment</strong>
        <button onClick={onClose}
                data-testid="forge-lighting-close"
                style={closeBtn}>×</button>
      </header>

      <div data-testid="forge-lighting-intro"
           style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}>
        Tune ambient + key intensity, key direction, and background
        colour. Changes persist (localStorage <code>forge.v4.lighting</code>)
        and broadcast <code>forge:lighting-changed</code>.
      </div>

      {/* Ambient intensity */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: 'var(--forge-ink-mute)' }}>
          Ambient intensity <strong>{state.ambient.toFixed(2)}</strong>
        </span>
        <input type="range"
               min={0} max={2} step={0.05}
               value={state.ambient}
               onChange={onAmbient}
               data-testid="forge-lighting-ambient"
               data-ambient={state.ambient}
               aria-label="Ambient intensity" />
      </label>

      {/* Key (directional) intensity */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: 'var(--forge-ink-mute)' }}>
          Key (directional) intensity <strong>{state.key.toFixed(2)}</strong>
        </span>
        <input type="range"
               min={0} max={2} step={0.05}
               value={state.key}
               onChange={onKey}
               data-testid="forge-lighting-key"
               data-key={state.key}
               aria-label="Key light intensity" />
      </label>

      {/* Direction — azimuth */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: 'var(--forge-ink-mute)' }}>
          Azimuth (°) <strong>{state.azimuth.toFixed(0)}°</strong>
        </span>
        <input type="range"
               min={0} max={360} step={1}
               value={state.azimuth}
               onChange={onAzimuth}
               data-testid="forge-lighting-azimuth"
               data-azimuth={state.azimuth}
               aria-label="Key light azimuth" />
      </label>

      {/* Direction — elevation */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: 'var(--forge-ink-mute)' }}>
          Elevation (°) <strong>{state.elevation.toFixed(0)}°</strong>
        </span>
        <input type="range"
               min={-90} max={90} step={1}
               value={state.elevation}
               onChange={onElevation}
               data-testid="forge-lighting-elevation"
               data-elevation={state.elevation}
               aria-label="Key light elevation" />
      </label>

      {/* Background colour */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--forge-ink-mute)', flex: 1 }}>
          Background colour
        </span>
        <input type="color"
               value={state.background}
               onChange={onBackground}
               data-testid="forge-lighting-background"
               data-background={state.background}
               aria-label="Background colour"
               style={{ width: 48, height: 28, padding: 0,
                        border: '1px solid var(--forge-rail-edge)',
                        background: 'transparent', cursor: 'pointer',
                        borderRadius: 3 }} />
        <code style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                       color: 'var(--forge-ink)' }}
              data-testid="forge-lighting-background-hex">
          {state.background}
        </code>
      </label>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button"
                onClick={onReset}
                data-testid="forge-lighting-reset"
                style={resetBtn}>
          Reset to defaults
        </button>
      </div>

      {/* Live readout block. The data-* attributes mirror the React
          state, making them stable assertion targets for the e2e — the
          panel's data-* attrs themselves also work, but having a
          dedicated readout strip keeps the readout visible to the user
          AND machine-readable. */}
      <section data-testid="forge-lighting-readout" style={rowStyle}>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Ambient</div>
        <div data-row="ambient"
             data-testid="forge-lighting-ambient-readout"
             data-value={state.ambient}>
          {state.ambient.toFixed(2)}
        </div>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Key</div>
        <div data-row="key"
             data-testid="forge-lighting-key-readout"
             data-value={state.key}>
          {state.key.toFixed(2)}
        </div>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Azimuth</div>
        <div data-row="azimuth"
             data-testid="forge-lighting-azimuth-readout"
             data-value={state.azimuth}>
          {state.azimuth.toFixed(0)}°
        </div>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Elevation</div>
        <div data-row="elevation"
             data-testid="forge-lighting-elevation-readout"
             data-value={state.elevation}>
          {state.elevation.toFixed(0)}°
        </div>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Background</div>
        <div data-row="background"
             data-testid="forge-lighting-background-readout"
             data-value={state.background}>
          {state.background}
        </div>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Direction</div>
        <div data-row="direction"
             data-testid="forge-lighting-direction-readout"
             data-dx={dir.x.toFixed(3)}
             data-dy={dir.y.toFixed(3)}
             data-dz={dir.z.toFixed(3)}>
          ({dir.x.toFixed(2)}, {dir.y.toFixed(2)}, {dir.z.toFixed(2)})
        </div>
      </section>
    </div>
  );
}

// ────────────── host ──────────────

export function LightingPanelHost() {
  // Whether the panel is currently visible. The host owns this state so
  // the panel can be opened/closed by Archie / palette / the menu without
  // forcing a remount.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    // Boot-time hydrate: write the stored (or default) lighting onto the
    // global the instant the host mounts — so downstream consumers can
    // read window.__forgeLighting without waiting for the panel to be
    // opened. This is the same pattern the ActivityLog host uses to
    // surface its ring buffer reader before the panel renders.
    if (!window.__forgeLighting) {
      const initial = readStored() || { ...LIGHTING_DEFAULTS };
      publish(initial);
    }

    // Imperative entry points (Archie / plugins / e2e).
    window.__forgeOpenLighting  = () => setOpen(true);
    window.__forgeCloseLighting = () => setOpen(false);

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.lightingEnv') {
        // Re-publish the canonical state on every open so subscribers
        // who came online after the initial mount (or e2e harnesses
        // that wiped the global between tests) immediately observe a
        // truthy window.__forgeLighting.
        const live = window.__forgeLighting
          ? normaliseLighting(window.__forgeLighting)
          : (readStored() || { ...LIGHTING_DEFAULTS });
        publish(live);
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <LightingPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default LightingPanel;
