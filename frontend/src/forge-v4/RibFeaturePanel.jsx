// PUSH-126 (Slice-94) — Rib (Stiffener) feature panel.
//
// Drives the existing native kernel op `forge.part.rib(sk, depth, thickness,
// neutralFaceId)` (electron/preload.js:1363, Features.cpp:660). A rib is a
// thin extruded web between two faces of a host body — used for stiffening
// plates and adding load-bearing crossbars without ballooning material.
//
// The panel builds a tiny 2-point sketch (a line in the XY plane) and feeds
// it to the kernel as the rib profile. Depth pulls it perpendicular to the
// sketch plane, thickness controls the rib wall.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

export const FORGE_RIB_FEATURE_EVENT = 'forge:rib-feature-built';

const DEFAULT_DEPTH_MM     = 10;
const DEFAULT_THICKNESS_MM = 2;
const DEFAULT_LINE         = Object.freeze({
  x0: 0, y0: 0,
  x1: 20, y1: 0,
});

function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
}
function defaultHost() {
  const nb = readNativeBodies();
  return nb.length ? nb[nb.length - 1] : null;
}

// Pure pipeline: open a sketch, add 2 points + 1 line, call kernel rib,
// return { ok, handle, error }. No React state; safe to drive headlessly.
export function runRibFeaturePipeline({ depth, thickness, line, neutralFaceId } = {}) {
  const w = typeof window !== 'undefined' ? window : null;
  if (!w || !w.forge) return { ok: false, error: 'no-kernel' };
  const sk = w.forge.sketcher;
  const part = w.forge.part;
  if (!sk || !part || typeof part.rib !== 'function') return { ok: false, error: 'no-rib-kernel' };
  const d = Number(depth ?? DEFAULT_DEPTH_MM);
  const t = Number(thickness ?? DEFAULT_THICKNESS_MM);
  const L = line || DEFAULT_LINE;
  if (!Number.isFinite(d) || d <= 0)  return { ok: false, error: 'bad-depth' };
  if (!Number.isFinite(t) || t <= 0)  return { ok: false, error: 'bad-thickness' };
  const x0 = Number(L.x0 ?? 0), y0 = Number(L.y0 ?? 0);
  const x1 = Number(L.x1 ?? 0), y1 = Number(L.y1 ?? 0);
  let skh = null;
  try {
    skh = sk.createSketch();
    const p0 = sk.addPoint(skh, x0, y0);
    const p1 = sk.addPoint(skh, x1, y1);
    sk.addLine(skh, p0, p1);
    if (typeof sk.solve === 'function') { try { sk.solve(skh); } catch {} }
    const handle = part.rib(skh, d, t, Number(neutralFaceId ?? 0));
    if (typeof handle !== 'number' || handle <= 0)
      return { ok: false, error: 'kernel-no-handle' };
    return { ok: true, handle };
  } catch (ex) {
    return { ok: false, error: String(ex?.message || ex) };
  } finally {
    if (skh != null && sk.destroySketch) { try { sk.destroySketch(skh); } catch {} }
  }
}

// Window helper API — module-load install so plugins / Archie / e2e can
// drive Apply without React.
if (typeof window !== 'undefined' && !window.__forgeRibFeatureHelper) {
  window.__forgeRibFeatureHelper = Object.freeze({
    runRibFeaturePipeline,
    readNativeBodies,
    defaultHost,
    DEFAULT_DEPTH_MM,
    DEFAULT_THICKNESS_MM,
    DEFAULT_LINE,
  });
}

const PANEL_W = 420;
const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0, bottom: 'var(--forge-statusbar-h, 24px)',
  width: PANEL_W, zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12, overflowY: 'auto',
};

export function RibFeaturePanel({ open, onClose }) {
  const [host, setHost]     = useState(() => defaultHost());
  const [depth, setDepth]   = useState(DEFAULT_DEPTH_MM);
  const [thick, setThick]   = useState(DEFAULT_THICKNESS_MM);
  const [line, setLine]     = useState(DEFAULT_LINE);
  const [log, setLog]       = useState([]);
  const [status, setStatus] = useState('');

  // Refresh host every time the panel opens — defaultHost() at mount may
  // have seen an empty scene, and bodies-changed events can fire before
  // the panel is up.
  useEffect(() => {
    if (!open) return;
    setHost(defaultHost());
    const onBodies = () => setHost(defaultHost());
    window.addEventListener('forge:bodies-changed', onBodies);
    return () => window.removeEventListener('forge:bodies-changed', onBodies);
  }, [open]);

  const nativeBodies = useMemo(() => readNativeBodies(), [open, host]);

  const apply = useCallback(() => {
    const r = runRibFeaturePipeline({ depth, thickness: thick, line });
    if (r.ok) {
      const id = `rib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        window.__forgeAppendBody?.({
          id, kind: 'native', handle: r.handle,
          toolId: 'part.rib',
          name: `Rib (d=${depth} t=${thick})`,
          params: { depth, thickness: thick, line },
        });
      } catch {}
      setStatus(`✓ rib handle=${r.handle}`);
      setLog((l) => [{ ts: Date.now(), ok: true, handle: r.handle, depth, thick }, ...l].slice(0, 10));
      try {
        window.dispatchEvent(new CustomEvent(FORGE_RIB_FEATURE_EVENT, {
          detail: { ok: true, handle: r.handle, depth, thick, line },
        }));
      } catch {}
    } else {
      setStatus(`✗ ${r.error}`);
      setLog((l) => [{ ts: Date.now(), ok: false, error: r.error }, ...l].slice(0, 10));
    }
  }, [depth, thick, line]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-rib-feature-panel"
         data-host-handle={host?.handle ?? ''}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Rib (Stiffener)</strong>
        <button onClick={onClose}
                data-testid="forge-rib-feature-close"
                style={{ background: 'transparent', border: '1px solid var(--forge-rail-edge)',
                         color: 'var(--forge-ink)', cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}>
        Host body: <strong data-testid="forge-rib-host-body">
          {host ? (host.name || `handle ${host.handle}`) : 'None — add a body first'}
        </strong>
        <span style={{ marginLeft: 8, color: 'var(--forge-ink-mute)' }}>
          ({nativeBodies.length} native)
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, alignItems: 'center' }}>
        <label>Depth mm</label>
        <input type="number" min="0.1" step="0.5" value={depth}
               data-testid="forge-rib-depth"
               onChange={(e) => setDepth(Math.max(0.1, Number(e.target.value) || DEFAULT_DEPTH_MM))} />
        <label>Thickness mm</label>
        <input type="number" min="0.1" step="0.1" value={thick}
               data-testid="forge-rib-thickness"
               onChange={(e) => setThick(Math.max(0.1, Number(e.target.value) || DEFAULT_THICKNESS_MM))} />
        <label>Line x0,y0</label>
        <div style={{ display: 'flex', gap: 4 }}>
          <input type="number" value={line.x0} data-testid="forge-rib-x0"
                 onChange={(e) => setLine({ ...line, x0: Number(e.target.value) || 0 })} />
          <input type="number" value={line.y0} data-testid="forge-rib-y0"
                 onChange={(e) => setLine({ ...line, y0: Number(e.target.value) || 0 })} />
        </div>
        <label>Line x1,y1</label>
        <div style={{ display: 'flex', gap: 4 }}>
          <input type="number" value={line.x1} data-testid="forge-rib-x1"
                 onChange={(e) => setLine({ ...line, x1: Number(e.target.value) || 0 })} />
          <input type="number" value={line.y1} data-testid="forge-rib-y1"
                 onChange={(e) => setLine({ ...line, y1: Number(e.target.value) || 0 })} />
        </div>
      </div>

      <button onClick={apply}
              data-testid="forge-rib-apply"
              style={{ background: 'var(--forge-accent, #2c4d2a)', color: '#dfeedd', border: 'none',
                       padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
        Apply rib
      </button>

      {status && (
        <div data-testid="forge-rib-status" style={{ color: 'var(--forge-ink-mute)', fontFamily: 'var(--forge-mono)' }}>
          {status}
        </div>
      )}

      {log.length > 0 && (
        <details open>
          <summary>History ({log.length})</summary>
          <ul style={{ fontSize: 11, fontFamily: 'var(--forge-mono)', listStyle: 'none', padding: 0 }}>
            {log.map((e) => (
              <li key={e.ts} data-row="log">
                {new Date(e.ts).toLocaleTimeString()} · {e.ok ? `✓ handle=${e.handle}` : `✗ ${e.error}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function RibFeaturePanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenRibFeature = (b) => setOpen(b === undefined ? true : !!b);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.ribFeature') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <RibFeaturePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default RibFeaturePanel;
