// PUSH-147 (Slice-107) — Bolt Hole PCD pattern wizard.
//
// Real OCCT pipeline: forge.makeCylinder(holeDia/2, plateH*1.5) ->
// forge.translate(cyl, R·cos(θ), R·sin(θ), zMin-1) -> chained forge.cut.
// Same pattern that StandardPartsLibrary.makePlanetaryGearmotor uses
// around line 670. Standard counts: ISO 7005-1 / DIN 2501 / ANSI B16.5
// / JIS B 2220 all use 4 / 6 / 8 / 12.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export const FORGE_BOLT_PATTERN_EVENT = 'forge:bolt-pattern-applied';

const STANDARD_COUNTS = [4, 6, 8, 12];

function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
}
function defaultPlate() {
  const nb = readNativeBodies();
  return nb.length ? nb[nb.length - 1] : null;
}

// Pull the plate's Z extents from its bounding box (so we can size the
// drill cylinders to definitely pass through).
function plateExtents(handle) {
  if (typeof window === 'undefined') return { zMin: -5, zMax: 5, h: 10 };
  try {
    const m = window.forge?.massProps?.(handle);
    // massProps gives volume + COM, not bbox. We need actual extents —
    // tessellate and walk positions for min/max Z.
    const tess = window.forge?.tessellate?.(handle, 0.5, 0.5);
    if (tess && tess.positions && tess.positions.length >= 3) {
      let zMin = +Infinity, zMax = -Infinity;
      for (let i = 2; i < tess.positions.length; i += 3) {
        const z = tess.positions[i];
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
      }
      if (Number.isFinite(zMin) && Number.isFinite(zMax)) {
        return { zMin, zMax, h: zMax - zMin };
      }
    }
    return { zMin: -5, zMax: 5, h: 10 };
  } catch {
    return { zMin: -5, zMax: 5, h: 10 };
  }
}

// Headless pipeline: cut N evenly-spaced holes through a plate at PCD.
export function runBoltPatternPipeline({ plateHandle, count, pcd, holeDia }) {
  const w = typeof window !== 'undefined' ? window : null;
  if (!w?.forge) return { ok: false, error: 'no-kernel' };
  const f = w.forge;
  if (typeof f.makeCylinder !== 'function' || typeof f.translate !== 'function' || typeof f.cut !== 'function') {
    return { ok: false, error: 'no-cylinder-cut-kernel' };
  }
  const N = Math.max(1, Math.floor(count));
  const R = Number(pcd) / 2;
  const r = Number(holeDia) / 2;
  if (!Number.isFinite(R) || R <= 0) return { ok: false, error: 'bad-pcd' };
  if (!Number.isFinite(r) || r <= 0) return { ok: false, error: 'bad-dia' };
  const { zMin, h } = plateExtents(plateHandle);
  const drillH = Math.max(h * 1.5, h + 4);
  const drillZBase = zMin - 1;

  let current = plateHandle;
  try {
    for (let i = 0; i < N; i += 1) {
      const theta = (2 * Math.PI * i) / N;
      const cx = R * Math.cos(theta);
      const cy = R * Math.sin(theta);
      const cyl = f.makeCylinder(r, drillH);
      const placed = f.translate(cyl, cx, cy, drillZBase);
      current = f.cut(current, placed);
      if (typeof current !== 'number' || current <= 0) {
        return { ok: false, error: 'kernel-cut-failed', atHole: i };
      }
    }
    return { ok: true, handle: current, count: N };
  } catch (ex) {
    return { ok: false, error: String(ex?.message || ex) };
  }
}

if (typeof window !== 'undefined' && !window.__forgeBoltPatternHelper) {
  window.__forgeBoltPatternHelper = Object.freeze({
    runBoltPatternPipeline, plateExtents, readNativeBodies, STANDARD_COUNTS,
  });
}

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0, bottom: 'var(--forge-statusbar-h, 24px)',
  width: 420, zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 8,
  color: 'var(--forge-ink)', fontSize: 12, overflowY: 'auto',
};

export function BoltPatternPanel({ open, onClose }) {
  const [plate, setPlate] = useState(() => defaultPlate());
  const [count, setCount] = useState(6);
  const [pcd, setPcd] = useState(70);
  const [holeDia, setHoleDia] = useState(6);
  const [status, setStatus] = useState('');
  const [log, setLog] = useState([]);

  useEffect(() => {
    if (!open) return;
    setPlate(defaultPlate());
    const onBodies = () => setPlate((p) => p ?? defaultPlate());
    window.addEventListener('forge:bodies-changed', onBodies);
    return () => window.removeEventListener('forge:bodies-changed', onBodies);
  }, [open]);

  const nativeBodies = useMemo(() => readNativeBodies(), [open, plate]);

  const apply = useCallback(() => {
    if (!plate) { setStatus('no-plate'); return; }
    const r = runBoltPatternPipeline({
      plateHandle: plate.handle, count, pcd, holeDia,
    });
    if (r.ok) {
      try {
        // Replace plate in bodies array with drilled version.
        const before = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        const next = before.map((b) => b.handle === plate.handle
          ? { ...b, handle: r.handle, name: `${b.name || 'Plate'} +${count}×Ø${holeDia}` }
          : b);
        if (typeof window.__forgeSetBodies === 'function') window.__forgeSetBodies(next);
        else window.__forgeBodies = next;
        window.dispatchEvent(new CustomEvent('forge:bodies-changed', { detail: { kind: 'bolt-pattern' } }));
      } catch {}
      setStatus(`✓ ${r.count} holes cut → handle=${r.handle}`);
      setLog((l) => [{ ts: Date.now(), ok: true, count, pcd, holeDia, handle: r.handle }, ...l].slice(0, 10));
      try {
        window.dispatchEvent(new CustomEvent(FORGE_BOLT_PATTERN_EVENT, {
          detail: { ok: true, handle: r.handle, count, pcd, holeDia, plateHandle: plate.handle },
        }));
      } catch {}
    } else {
      setStatus(`✗ ${r.error}`);
      setLog((l) => [{ ts: Date.now(), ok: false, error: r.error }, ...l].slice(0, 10));
    }
  }, [plate, count, pcd, holeDia]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-bolt-pattern-panel"
         data-plate-handle={plate?.handle ?? ''}
         data-count={count}>
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Bolt Pattern (PCD)</strong>
        <button onClick={onClose} data-testid="forge-bolt-pattern-close"
                style={{ background: 'transparent', border: '1px solid var(--forge-rail-edge)',
                         color: 'var(--forge-ink)', cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)' }}>
        Plate: <strong data-testid="forge-bolt-pattern-plate">
          {plate ? (plate.name || `handle ${plate.handle}`) : 'None — add a body'}
        </strong>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label>Count:</label>
        {STANDARD_COUNTS.map((c) => (
          <button key={c} onClick={() => setCount(c)}
                  data-testid={`forge-bolt-pattern-count-${c}`}
                  style={{
                    background: count === c ? 'var(--forge-accent, #2c4d2a)' : 'var(--forge-canvas)',
                    color: count === c ? '#dfeedd' : 'var(--forge-ink)',
                    border: '1px solid var(--forge-rail-edge)',
                    padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                  }}>
            {c}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, alignItems: 'center' }}>
        <label>PCD Ø mm</label>
        <input type="number" min="1" step="1" value={pcd}
               data-testid="forge-bolt-pattern-pcd"
               onChange={(e) => setPcd(Number(e.target.value) || pcd)} />
        <label>Hole Ø mm</label>
        <input type="number" min="0.1" step="0.5" value={holeDia}
               data-testid="forge-bolt-pattern-hole-dia"
               onChange={(e) => setHoleDia(Number(e.target.value) || holeDia)} />
      </div>

      <button onClick={apply}
              data-testid="forge-bolt-pattern-apply"
              style={{ background: 'var(--forge-accent, #2c4d2a)', color: '#dfeedd', border: 'none',
                       padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
        Apply
      </button>

      {status && (
        <div data-testid="forge-bolt-pattern-status"
             style={{ color: 'var(--forge-ink-mute)', fontFamily: 'var(--forge-mono)' }}>
          {status}
        </div>
      )}

      {log.length > 0 && (
        <details open>
          <summary>History ({log.length})</summary>
          <ul style={{ fontSize: 11, fontFamily: 'var(--forge-mono)', listStyle: 'none', padding: 0 }}>
            {log.map((e) => (
              <li key={e.ts}>
                {new Date(e.ts).toLocaleTimeString()} ·{' '}
                {e.ok ? `✓ ${e.count} holes PCD=${e.pcd} Ø=${e.holeDia} → ${e.handle}`
                      : `✗ ${e.error}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function BoltPatternPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBoltPattern = (b) => setOpen(b === undefined ? true : !!b);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.boltPattern') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <BoltPatternPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BoltPatternPanel;
