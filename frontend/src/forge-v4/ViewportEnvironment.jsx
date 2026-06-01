// Forge-97 — viewport environment.
//
// Lightweight r3f wrapper that stacks the three pieces a polished PBR
// viewport actually needs:
//
//   1. drei <Environment preset="studio"/> — the 5500K HDRI that drives
//      every metallic reflection. Without an env map, MeshPhysicalMaterial
//      with metalness=1.0 looks flat black, which is the #1 reason
//      "engineering" viewports look like trash.
//
//   2. drei <ContactShadows/> — soft AO-ish disc beneath the model so the
//      hero body reads as resting on the grid, not floating.
//
//   3. ACES tone-mapping + exposure slider — bridges the HDRI's >1.0
//      values into the [0,1] display range without burning highlights.
//
// Exposes:
//   - <ViewportEnvironment ...>{...}</ViewportEnvironment> — drops the
//     environment + contact shadows inside an existing r3f <Canvas>.
//   - ViewportEnvironmentProvider — React context that lets HUD
//     controls (e.g. an exposure slider) read/write the exposure
//     without prop-drilling through the scene tree.
//   - ExposureSlider — a tiny floating slider component the host shell
//     can drop into a viewport overlay.
//
// Mounted at the call site (e.g. inside the <Canvas>) so it doesn't
// touch ForgeShellV4.jsx or Viewport.jsx — the deliverable contract
// requires both files stay untouched.

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';

/* ----------------------------- context ----------------------------- */

const ViewportEnvironmentContext = createContext({
  exposure: 1.0,
  setExposure: () => {},
  envPreset: 'studio',
  setEnvPreset: () => {},
  contactShadows: true,
  setContactShadows: () => {},
});

const STORAGE_KEY = 'forge.v4.viewportEnv';

function readStored() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeStored(v) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch {}
}

export function ViewportEnvironmentProvider({ children }) {
  const initial = readStored() || {};
  const [exposure, setExposureRaw] = useState(
    typeof initial.exposure === 'number' ? initial.exposure : 1.0);
  const [envPreset, setEnvPresetRaw] = useState(initial.envPreset || 'studio');
  const [contactShadows, setContactShadowsRaw] = useState(
    typeof initial.contactShadows === 'boolean' ? initial.contactShadows : true);

  // Persist on change.
  useEffect(() => {
    writeStored({ exposure, envPreset, contactShadows });
  }, [exposure, envPreset, contactShadows]);

  // Expose a global window setter so manual e2e drives + Archie can
  // poke the exposure without React mounting / context plumbing. This
  // is read-only from the user's perspective — only Archie or the
  // HUD slider should call it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeViewportEnv = {
      get exposure() { return exposure; },
      setExposure: (v) => setExposureRaw(clamp(Number(v) || 0, 0, 3)),
      get envPreset() { return envPreset; },
      setEnvPreset: (p) => setEnvPresetRaw(String(p || 'studio')),
      get contactShadows() { return contactShadows; },
      setContactShadows: (b) => setContactShadowsRaw(!!b),
    };
    return () => {
      try { delete window.__forgeViewportEnv; } catch {}
    };
  }, [exposure, envPreset, contactShadows]);

  const value = useMemo(() => ({
    exposure, setExposure: (v) => setExposureRaw(clamp(Number(v) || 0, 0, 3)),
    envPreset, setEnvPreset: setEnvPresetRaw,
    contactShadows, setContactShadows: setContactShadowsRaw,
  }), [exposure, envPreset, contactShadows]);

  return (
    <ViewportEnvironmentContext.Provider value={value}>
      {children}
    </ViewportEnvironmentContext.Provider>
  );
}

export function useViewportEnvironment() {
  return useContext(ViewportEnvironmentContext);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ----------------------------- scene piece ----------------------------- */

/**
 * Drop inside an r3f <Canvas>. Lazy-imports drei + three so SSR and the
 * non-r3f Forge shell tests don't crash.
 *
 * Props:
 *   - children          slot for additional scene content (rare)
 *   - preset            drei Environment preset override (default: context)
 *   - withContactShadows boolean override (default: context)
 *   - shadowPosition    [x,y,z] base for ContactShadows (default: [0, -5, 0]
 *                       to match Viewport.jsx grid plane)
 */
export function ViewportEnvironment({ children,
                                      preset,
                                      withContactShadows,
                                      shadowPosition = [0, -5, 0] } = {}) {
  const ctx = useViewportEnvironment();
  const [parts, setParts] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [drei, r3f, three] = await Promise.all([
          import('@react-three/drei'),
          import('@react-three/fiber'),
          import('three'),
        ]);
        if (!cancelled) setParts({ drei, r3f, three });
      } catch (err) {
        console.warn('[forge.v4.viewportEnv] r3f load failed:', err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!parts) return null;
  const { Environment, ContactShadows } = parts.drei;
  const useThree = parts.r3f.useThree;
  const THREE = parts.three;
  const usePreset = preset || ctx.envPreset || 'studio';
  const showShadows = (withContactShadows ?? ctx.contactShadows) !== false;

  return (
    <>
      <Environment preset={usePreset} background={false} />
      <ToneMappingApplier useThree={useThree} THREE={THREE}
                          exposure={ctx.exposure} />
      {showShadows && (
        <ContactShadows position={shadowPosition} opacity={0.55}
                        scale={120} blur={2.4} far={40}
                        resolution={1024} frames={1} />
      )}
      {children}
    </>
  );
}

/* Applies ACES + the live exposure value to the renderer. Sits inside
   the Canvas so it can grab gl via useThree. */
function ToneMappingApplier({ useThree, THREE, exposure }) {
  const { gl } = useThree();
  useEffect(() => {
    if (!gl) return;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
    if ('outputColorSpace' in gl) {
      gl.outputColorSpace = THREE.SRGBColorSpace;
    } else if ('outputEncoding' in gl) {
      gl.outputEncoding = THREE.sRGBEncoding;
    }
  }, [gl, exposure]);
  return null;
}

/* ----------------------------- HUD slider ----------------------------- */

/**
 * A small floating exposure slider — mount anywhere in the React tree
 * (NOT inside the Canvas). Reads/writes the context.
 */
export function ExposureSlider({ style = {} } = {}) {
  const { exposure, setExposure } = useViewportEnvironment();
  return (
    <div data-testid="forge-exposure-slider"
         style={{
           display: 'inline-flex', alignItems: 'center', gap: 6,
           padding: '4px 8px',
           background: 'var(--forge-surface, rgba(20,22,27,0.85))',
           border: '1px solid var(--forge-rail-edge, #1d2027)',
           borderRadius: 4,
           fontSize: 10,
           fontFamily: 'var(--forge-mono, ui-monospace, Menlo)',
           color: 'var(--forge-ink-mute, #757a85)',
           pointerEvents: 'auto',
           ...style,
         }}>
      <span aria-hidden="true">EV</span>
      <input type="range"
             aria-label="HDR exposure"
             min={0} max={2.5} step={0.05}
             value={exposure}
             onChange={(e) => setExposure(Number(e.target.value))}
             style={{ width: 90 }} />
      <span style={{ color: 'var(--forge-ink, #ebecef)', minWidth: 28,
                     textAlign: 'right' }}>
        {exposure.toFixed(2)}
      </span>
    </div>
  );
}

export default ViewportEnvironment;
