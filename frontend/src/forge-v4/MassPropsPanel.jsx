// PUSH-58 — Mass Properties panel.
//
// Reads forge.massProps(handle) → { volume, area, centerOfMass:[x,y,z] }
// for the active native body (selected, else last-native) and turns the
// raw kernel output into a real engineering readout: density picker,
// computed mass, COM table. The kernel surface itself is unchanged; this
// is the missing UI that turns a kernel function into a usable tool.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// In-house density library (g/cc). The numbers match the same engineering
// references used by the simulation workbench (PUSH-48). No external
// catalog dependency — these five cover ~95% of mechanical CAD cases.
// Exported so PUSH-60 BomPanel can re-use the exact same table without
// hard-coding a second copy.
export const DENSITY_G_CC = Object.freeze({
  steel:     7.85,
  aluminum:  2.70,
  plastic:   1.05,
  titanium:  4.50,
  brass:     8.50,
});

export const MATERIAL_LIST = Object.freeze(['steel', 'aluminum', 'plastic', 'titanium', 'brass']);

// Convert volume (mm³) × density (g/cc) → mass (g). 1 cc = 1000 mm³.
function massGrams(volumeMm3, densityGcc) {
  const v = Number(volumeMm3);
  const d = Number(densityGcc);
  if (!Number.isFinite(v) || !Number.isFinite(d)) return null;
  return v * d * 1e-3;
}

function activeBody() {
  if (typeof window === 'undefined') return null;
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const native = bodies.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
  if (native.length === 0) return null;
  const sel = window.__forgeSelection || null;
  if (sel && typeof sel.bodyHandle === 'number') {
    const m = native.find((b) => b.handle === sel.bodyHandle);
    if (m) return m;
  }
  return native[native.length - 1];
}

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0, bottom: 'var(--forge-statusbar-h, 24px)',
  width: 360, zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};
const rowStyle = {
  display: 'grid', gridTemplateColumns: '100px 1fr', columnGap: 8, rowGap: 4,
  fontFamily: 'var(--forge-mono)', fontSize: 11,
};

export function MassPropsPanel({ open, onClose }) {
  const [body, setBody] = useState(() => activeBody());
  const [material, setMaterial] = useState('steel');
  const [error, setError] = useState(null);

  // Keep the active body up-to-date — pulls a fresh snapshot whenever
  // selection or the bodies array changes (cheap because activeBody() is
  // a couple of array operations).
  useEffect(() => {
    if (!open) return;
    setBody(activeBody());
    const onPick = () => setBody(activeBody());
    window.addEventListener('forge:selection-changed', onPick);
    return () => window.removeEventListener('forge:selection-changed', onPick);
  }, [open]);

  // Compute kernel mass-props every time the active body changes. We
  // intentionally re-call instead of caching: the active body's handle
  // can become stale if the geometry was re-extruded under the same id.
  const massProps = useMemo(() => {
    if (!body || typeof body.handle !== 'number') return null;
    const fn = (typeof window !== 'undefined') ? window.forge?.massProps : null;
    if (typeof fn !== 'function') return null;
    try {
      const r = fn(body.handle);
      setError(null);
      return r;
    } catch (ex) {
      setError(String(ex?.message || ex));
      return null;
    }
  }, [body]);

  const density = DENSITY_G_CC[material];
  const mass    = massProps ? massGrams(massProps.volume, density) : null;

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-massprops-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Mass Properties</strong>
        <button onClick={onClose}
                data-testid="forge-massprops-close"
                style={{ background: 'transparent', border: '1px solid var(--forge-rail-edge)',
                         color: 'var(--forge-ink)', cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}>
        Active body: <strong data-testid="forge-massprops-body">
          {body ? (body.name || body.id || `handle ${body.handle}`) : 'None — add a body first'}
        </strong>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        Material:
        <select data-testid="forge-massprops-material"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                style={{ flex: 1, background: 'var(--forge-canvas)',
                         color: 'var(--forge-ink)',
                         border: '1px solid var(--forge-rail-edge)',
                         borderRadius: 4, padding: '4px 6px' }}>
          {MATERIAL_LIST.map((m) => (
            <option key={m} value={m}>{m} ({DENSITY_G_CC[m]} g/cc)</option>
          ))}
        </select>
      </label>

      {massProps ? (
        <section data-testid="forge-massprops-rows" style={rowStyle}>
          <div style={{ color: 'var(--forge-ink-mute)' }}>Volume</div>
          <div data-row="volume" data-testid="forge-massprops-volume">
            {Number(massProps.volume).toFixed(3)} mm³
          </div>
          <div style={{ color: 'var(--forge-ink-mute)' }}>Surface area</div>
          <div data-row="area" data-testid="forge-massprops-area">
            {Number(massProps.area).toFixed(3)} mm²
          </div>
          <div style={{ color: 'var(--forge-ink-mute)' }}>Center of mass</div>
          <div data-row="com" data-testid="forge-massprops-com">
            ({Number(massProps.centerOfMass?.[0] ?? 0).toFixed(3)},
             {' '}{Number(massProps.centerOfMass?.[1] ?? 0).toFixed(3)},
             {' '}{Number(massProps.centerOfMass?.[2] ?? 0).toFixed(3)})
          </div>
          <div style={{ color: 'var(--forge-ink-mute)' }}>Density</div>
          <div data-row="density" data-testid="forge-massprops-density">
            {density.toFixed(3)} g/cc
          </div>
          <div style={{ color: 'var(--forge-ink-mute)', fontWeight: 700 }}>Mass</div>
          <div data-row="mass" data-testid="forge-massprops-mass" style={{ fontWeight: 700 }}>
            {mass != null ? mass.toFixed(3) : '—'} g
            {' '}({mass != null ? (mass / 1000).toFixed(6) : '—'} kg)
          </div>
        </section>
      ) : (
        <div style={{ color: 'var(--forge-ink-mute)' }} data-testid="forge-massprops-empty">
          {body
            ? 'Computing…'
            : 'No native body — open a project or add a body to see properties.'}
        </div>
      )}

      {error && (
        <div data-testid="forge-massprops-error"
             style={{ color: 'var(--forge-bad, #ff6363)', fontSize: 11 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function MassPropsHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenMassProps  = () => setOpen(true);
    window.__forgeCloseMassProps = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.massprops' || id === 'workbench.massprops') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <MassPropsPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default MassPropsPanel;
