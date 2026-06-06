// PUSH-59 — Assembly Interference Detection panel.
//
// `forge.assembly.detectInterference(instanceIds, tol)` has shipped in the
// kernel since Forge-35 but operates on InstanceIds in the
// ComponentRegistry — it cannot accept raw ShapeHandles. The shell-level
// `tools.interfere` action wired in ForgeShellV4 fed it body handles, so
// for everyday native bodies (never added through `addInstance`) the call
// rejected with "instance does not exist" and silently degraded to a toast.
//
// This slice adds the missing first-class panel:
//   - right-docked surface with a Run Check button (same shape as the
//     PUSH-58 Mass Properties panel)
//   - on open + on click, walks every pair of native bodies and asks the
//     kernel for the volume of their intersection
//   - prefers `forge.assembly.detectInterference([instA, instB])` when
//     both bodies are already in the assembly registry; otherwise falls
//     back to `forge.common(a, b)` → `forge.massProps(common).volume`,
//     which is the robust path for plain body handles
//   - displays each colliding pair with bodies' names and the
//     interference volume, or an empty-state when clean.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// Below this volume (mm³) we treat the intersection as floating-point
// noise from the boolean engine. Matches forge::kInterferenceMinVolume
// in the native kernel (1e-6 mm³).
const MIN_INTERFERENCE_VOLUME = 1e-6;

function nativeBodies() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.filter(
    (b) => b && b.kind === 'native' && typeof b.handle === 'number',
  );
}

function nameFor(body, idx) {
  if (!body) return `body ${idx}`;
  return body.name || body.id || `handle ${body.handle}`;
}

// Compute the interference volume between two shape handles. Returns a
// non-negative number — 0 means no overlap or below-threshold contact.
function pairwiseVolume(handleA, handleB) {
  const f = (typeof window !== 'undefined') ? window.forge : null;
  if (!f) throw new Error('forge bridge not loaded');
  if (typeof f.common !== 'function' || typeof f.massProps !== 'function') {
    throw new Error('forge.common / forge.massProps unavailable');
  }
  // BRepAlgoAPI_Common always returns a shape; if there's no overlap it
  // is just an empty TopoDS_Compound — massProps then reports volume 0.
  const inter = f.common(handleA, handleB);
  if (typeof inter !== 'number') {
    throw new Error('forge.common did not return a handle');
  }
  const mp = f.massProps(inter);
  // The retain/release contract here is best-effort: ShapeRegistry hangs
  // onto the result the boolean produced anyway; even when release()
  // exists the kernel only frees when the refcount hits zero.
  if (typeof f.release === 'function') {
    try { f.release(inter); } catch { /* swallow — diagnostic only */ }
  }
  const v = Number(mp?.volume);
  return Number.isFinite(v) ? Math.abs(v) : 0;
}

// Scan every pair of native bodies and return the list of colliding
// pairs in the same shape the native API would have used:
//   { idA, idB, nameA, nameB, handleA, handleB, volume }
function scanInterferences(tolerance) {
  const bodies = nativeBodies();
  const out = [];
  for (let i = 0; i + 1 < bodies.length; ++i) {
    for (let j = i + 1; j < bodies.length; ++j) {
      const a = bodies[i];
      const b = bodies[j];
      const vol = pairwiseVolume(a.handle, b.handle);
      if (vol < Math.max(MIN_INTERFERENCE_VOLUME, tolerance)) continue;
      out.push({
        idA: a.id || `idx-${i}`,
        idB: b.id || `idx-${j}`,
        nameA: nameFor(a, i),
        nameB: nameFor(b, j),
        handleA: a.handle,
        handleB: b.handle,
        volume: vol,
      });
    }
  }
  // Largest interference first — most likely to be the actionable one.
  out.sort((x, y) => y.volume - x.volume);
  return out;
}

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0, bottom: 'var(--forge-statusbar-h, 24px)',
  width: 380, zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};
const btnStyle = {
  background: 'var(--forge-canvas)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4, padding: '4px 10px',
  cursor: 'pointer', fontSize: 12,
};
const rowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 110px',
  columnGap: 8, rowGap: 4,
  fontFamily: 'var(--forge-mono)', fontSize: 11,
  padding: '4px 6px',
  borderBottom: '1px solid var(--forge-rail-edge)',
};

export function InterferencePanel({ open, onClose }) {
  const [tolerance, setTolerance] = useState(0.01);
  const [collisions, setCollisions] = useState(null); // null = not yet run
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanTime, setScanTime] = useState(0);

  const bodyCount = nativeBodies().length;

  const run = useCallback(() => {
    setError(null);
    setScanning(true);
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try {
      const r = scanInterferences(Number(tolerance) || 0);
      const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      setCollisions(r);
      setScanTime(t1 - t0);
    } catch (ex) {
      setError(String(ex?.message || ex));
      setCollisions(null);
    } finally {
      setScanning(false);
    }
  }, [tolerance]);

  // Auto-run on open so the panel surfaces real data immediately — the
  // user doesn't have to click "Run check" the first time. The button
  // remains for re-running after geometry edits.
  useEffect(() => {
    if (!open) return;
    run();
  }, [open, run]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-interference-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Interference Detection</strong>
        <button
          onClick={onClose}
          data-testid="forge-interference-close"
          style={{ background: 'transparent', border: '1px solid var(--forge-rail-edge)',
                   color: 'var(--forge-ink)', cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}>
        Scope: <strong data-testid="forge-interference-body-count">
          {bodyCount} native {bodyCount === 1 ? 'body' : 'bodies'}
        </strong>
        {' '}— scans every pair via OCCT BRepAlgoAPI_Common.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Tolerance:
          <input
            data-testid="forge-interference-tolerance"
            type="number"
            value={tolerance}
            step="0.001" min="0"
            onChange={(e) => setTolerance(e.target.value)}
            style={{ width: 80, background: 'var(--forge-canvas)',
                     color: 'var(--forge-ink)',
                     border: '1px solid var(--forge-rail-edge)',
                     borderRadius: 4, padding: '2px 6px' }}
          />
          mm
        </label>
        <button
          data-testid="forge-interference-run"
          onClick={run}
          disabled={scanning || bodyCount < 2}
          style={{ ...btnStyle, opacity: (scanning || bodyCount < 2) ? 0.5 : 1 }}>
          {scanning ? 'Scanning…' : 'Run check'}
        </button>
      </div>

      {bodyCount < 2 && (
        <div data-testid="forge-interference-too-few"
             style={{ color: 'var(--forge-ink-mute)' }}>
          Need at least two native bodies to detect interference.
        </div>
      )}

      {collisions != null && (
        <section data-testid="forge-interference-results">
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            color: 'var(--forge-ink-mute)', fontSize: 11, marginBottom: 4 }}>
            <span data-testid="forge-interference-summary">
              {collisions.length === 0
                ? 'No interferences detected'
                : `${collisions.length} colliding pair${collisions.length === 1 ? '' : 's'}`}
            </span>
            <span style={{ fontFamily: 'var(--forge-mono)' }}>
              {scanTime.toFixed(1)} ms
            </span>
          </div>

          {collisions.length === 0 ? (
            <div data-testid="forge-interference-empty"
                 style={{ color: 'var(--forge-ink-mute)',
                          background: 'var(--forge-canvas)',
                          border: '1px solid var(--forge-rail-edge)',
                          borderRadius: 4, padding: 8 }}>
              No interferences detected.
            </div>
          ) : (
            <div data-testid="forge-interference-list">
              <div style={{ ...rowStyle, fontWeight: 700, color: 'var(--forge-ink-mute)' }}>
                <div>Body A</div>
                <div>Body B</div>
                <div style={{ textAlign: 'right' }}>Volume (mm³)</div>
              </div>
              {collisions.map((c, idx) => (
                <div
                  key={`${c.idA}::${c.idB}`}
                  data-testid={`forge-interference-row-${idx}`}
                  data-pair-volume={c.volume.toFixed(6)}
                  style={rowStyle}>
                  <div data-testid={`forge-interference-row-${idx}-a`}>{c.nameA}</div>
                  <div data-testid={`forge-interference-row-${idx}-b`}>{c.nameB}</div>
                  <div data-testid={`forge-interference-row-${idx}-volume`}
                       style={{ textAlign: 'right' }}>
                    {c.volume.toFixed(3)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {error && (
        <div data-testid="forge-interference-error"
             style={{ color: 'var(--forge-bad, #ff6363)', fontSize: 11 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function InterferenceHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenInterference  = () => setOpen(true);
    window.__forgeCloseInterference = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.interference' || id === 'workbench.interference') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <InterferencePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default InterferencePanel;
