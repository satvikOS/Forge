// PUSH-165 (Slice-121) — Level-of-Detail (LOD) mesh generator panel.
//
// Body picker → three deflection-keyed snapshots:
//
//   * Fine   0.1 mm  → "High"
//   * Med    0.5 mm  → "Med"
//   * Coarse 2.0 mm  → "Low"
//
// All three calls go through window.forge.tessellate(handle, defl, ang)
// in COARSE → FINE order so OCCT actually re-meshes each step. The
// resulting three meshes live on the panel + window.__forgeLodMeshes
// keyed by handle so the viewport can swap based on camera distance.
//
// A distance-band slider lets the user tune the near + med thresholds
// (default 50 mm / 200 mm — same as lodScheduler.js DIST_BUCKETS) and a
// live "Active LOD" chip shows what selectLodByDistance() resolves at
// the current camera distance.
//
// Pure math lives in lodMath.js. This file is React + DOM glue only.
//
// Reachable via:
//   * `tools.lodMesh` menu action,
//   * `window.__forgeOpenLodMesh(true|false)`,
//   * `window.__forgeLodMathHelper.computeLods(handle)` (headless).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  computeLods,
  selectLodByDistance,
  validateLodTriCountsDecrease,
  LOD_DEFLECTIONS,
  LOD_LEVELS,
  LOD_ORDER_DISPLAY,
  LOD_ORDER_COARSE_TO_FINE,
  LOD_ANGULAR_DEFLECTION,
  DEFAULT_LOD_BANDS,
} from './lodMath.js';

const PANEL_W = 480;

// ────────────────────────────────────────────────────────────────────
// Body snapshot — every native OCCT body in window.__forgeBodies.

function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.filter(
    (b) => b && b.kind === 'native' && typeof b.handle === 'number',
  );
}

function defaultBody() {
  const nb = readNativeBodies();
  return nb.length ? nb[nb.length - 1] : null;
}

// ────────────────────────────────────────────────────────────────────
// Publish the per-handle LOD store + the active-LOD picker so the
// viewport (and Archie via __forgeLodMeshes[handle].mesh) can read
// them without a React subscription.

function persistLodResult(handle, result) {
  if (typeof window === 'undefined') return;
  try {
    if (!window.__forgeLodMeshes || typeof window.__forgeLodMeshes !== 'object') {
      window.__forgeLodMeshes = {};
    }
    const meshes = {};
    for (const level of result.levels || []) {
      meshes[level.id] = {
        deflection:  level.deflection,
        triCount:    level.triCount,
        vertexCount: level.vertexCount,
      };
    }
    window.__forgeLodMeshes[handle] = {
      handle,
      triCounts:    result.triCounts,
      vertexCounts: result.vertexCounts,
      levels:       meshes,
      computedAt:   Date.now(),
    };
    window.__forgeLastLodResult = result;
    try {
      window.dispatchEvent(new CustomEvent('forge:lod-computed', {
        detail: { handle, triCounts: result.triCounts },
      }));
    } catch {}
  } catch { /* ignore — sealed window in some test envs */ }
}

// ────────────────────────────────────────────────────────────────────
// Styles.

function panelStyle() {
  return {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
    right: 0,
    width: PANEL_W,
    maxWidth: '96vw',
    height: 'calc(100vh - var(--forge-topbar-h, 40px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 24px))',
    background: 'var(--forge-canvas-2, #161b22)',
    borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
    boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
    display: 'flex', flexDirection: 'column',
    fontSize: 12,
    color: 'var(--forge-ink, #dadde2)',
    zIndex: 1300,
    padding: 0,
  };
}

const HEADER_BTN = {
  background: 'var(--forge-canvas, #0e1117)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  color: 'var(--forge-ink, #dadde2)',
  font: 'inherit', fontSize: 11,
  padding: '4px 10px',
  cursor: 'pointer',
};

const PRIMARY_BTN = {
  ...HEADER_BTN,
  background: 'var(--forge-accent-mute, #1f3a72)',
  borderColor: 'var(--forge-accent-rim, #3a7afe)',
  fontWeight: 600,
};

const ROW_CELL = {
  padding: '6px 10px',
  fontFamily: 'var(--forge-mono, ui-monospace, SF Mono, Menlo, monospace)',
  fontSize: 11,
};

// ────────────────────────────────────────────────────────────────────
// Panel.

export function LodMeshPanel({ open, onClose }) {
  const [bodies, setBodies]     = useState(() => readNativeBodies());
  const [body,   setBody]       = useState(() => defaultBody());
  const [nearMaxMm, setNearMax] = useState(DEFAULT_LOD_BANDS.nearMaxMm);
  const [medMaxMm,  setMedMax]  = useState(DEFAULT_LOD_BANDS.medMaxMm);
  const [previewDistMm, setPreviewDistMm] = useState(75);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('');
  const [busy,   setBusy]   = useState(false);

  // Refresh body list when the panel opens + when the scene changes.
  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => {
      const nb = readNativeBodies();
      setBodies(nb);
      setBody((prev) => {
        if (prev && nb.find((b) => b.handle === prev.handle)) return prev;
        return nb.length ? nb[nb.length - 1] : null;
      });
    };
    refresh();
    window.addEventListener('forge:bodies-changed', refresh);
    return () => window.removeEventListener('forge:bodies-changed', refresh);
  }, [open]);

  const bands = useMemo(() => ({ nearMaxMm, medMaxMm }), [nearMaxMm, medMaxMm]);

  const activeLodId = useMemo(
    () => selectLodByDistance(previewDistMm, bands),
    [previewDistMm, bands],
  );

  const onSelectBody = useCallback((handleStr) => {
    const h = Number(handleStr);
    const found = bodies.find((b) => b.handle === h);
    setBody(found || null);
    setResult(null);
    setStatus('');
  }, [bodies]);

  const onCompute = useCallback(async () => {
    if (!body) {
      setStatus('error: no body selected');
      setResult(null);
      return;
    }
    setBusy(true);
    setStatus(`computing 3 LODs for ${body.name || body.handle}…`);
    // Let React flush the busy state before the (synchronous) kernel call.
    await Promise.resolve();
    let r;
    try {
      r = computeLods(body.handle);
    } catch (ex) {
      setBusy(false);
      setStatus(`error: ${ex?.message || ex}`);
      setResult(null);
      return;
    }
    setBusy(false);
    if (!r || !r.ok) {
      setStatus(`error: ${r?.error || 'computeLods failed'}`);
      setResult(null);
      return;
    }
    persistLodResult(body.handle, r);
    setResult(r);
    const validate = validateLodTriCountsDecrease(r.triCounts);
    if (validate.ok) {
      setStatus(`✓ 3 LODs · ${r.triCounts.fine}/${r.triCounts.med}/${r.triCounts.coarse} tris`);
    } else {
      setStatus(`⚠ ties — ${validate.reason}`);
    }
  }, [body]);

  if (!open) return null;

  return createPortal(
    <aside
      role="region"
      aria-label="LOD mesh generator"
      data-testid="forge-lod-mesh-panel"
      data-body-handle={body?.handle ?? ''}
      data-active-lod={activeLodId}
      style={panelStyle()}>

      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px',
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        background: 'var(--forge-canvas, #0e1117)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>LOD Mesh Generator</span>
        <span data-testid="forge-lod-mesh-active-chip" style={{
          fontFamily: 'var(--forge-mono, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
          borderRadius: 'var(--forge-radius-pill, 10px)',
        }}>
          active = {activeLodId}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onCompute}
                disabled={busy || !body}
                data-testid="forge-lod-mesh-compute"
                style={PRIMARY_BTN}>
          {busy ? 'Computing…' : 'Compute LODs'}
        </button>
        <button type="button"
                onClick={onClose}
                aria-label="Close LOD mesh panel"
                data-testid="forge-lod-mesh-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute, #9aa1ab)',
                  cursor: 'pointer', fontSize: 16, padding: 2,
                }}>
          ×
        </button>
      </header>

      {/* Body picker + distance bands */}
      <section style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: '12px 14px',
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{
            fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Body
          </span>
          <select
            data-testid="forge-lod-mesh-body-picker"
            value={body?.handle ?? ''}
            onChange={(e) => onSelectBody(e.target.value)}
            style={{
              background: 'var(--forge-canvas, #0e1117)',
              color: 'var(--forge-ink, #dadde2)',
              border: '1px solid var(--forge-rail-edge, #2a2d34)',
              borderRadius: 3,
              padding: '4px 6px',
              fontFamily: 'var(--forge-mono, monospace)',
              fontSize: 11,
            }}>
            {bodies.length === 0 && (
              <option value="">(no native bodies)</option>
            )}
            {bodies.map((b) => (
              <option key={b.id || b.handle} value={b.handle}>
                {b.name || b.id || `handle ${b.handle}`} (h={b.handle})
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{
            fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Distance bands (mm)
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 96, fontSize: 11 }}>Near &lt; {nearMaxMm}</span>
            <input type="range" min="10" max="500" step="5"
                   value={nearMaxMm}
                   onChange={(e) => setNearMax(Number(e.target.value) || 0)}
                   data-testid="forge-lod-mesh-near-slider"
                   style={{ flex: 1 }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 96, fontSize: 11 }}>Med &lt; {medMaxMm}</span>
            <input type="range" min="50" max="2000" step="10"
                   value={medMaxMm}
                   onChange={(e) => setMedMax(Number(e.target.value) || 0)}
                   data-testid="forge-lod-mesh-med-slider"
                   style={{ flex: 1 }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 96, fontSize: 11 }}>Preview dist {previewDistMm}</span>
            <input type="range" min="0" max="2500" step="5"
                   value={previewDistMm}
                   onChange={(e) => setPreviewDistMm(Number(e.target.value) || 0)}
                   data-testid="forge-lod-mesh-preview-slider"
                   style={{ flex: 1 }} />
          </label>
        </div>
      </section>

      {/* LOD table */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        background: 'var(--forge-canvas, #0e1117)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{
              position: 'sticky', top: 0,
              background: 'var(--forge-canvas-2, #161b22)',
              borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
            }}>
              <th style={{
                ...ROW_CELL,
                textAlign: 'left',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
              }}>LOD</th>
              <th style={{
                ...ROW_CELL,
                textAlign: 'right',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
              }}>Deflection (mm)</th>
              <th style={{
                ...ROW_CELL,
                textAlign: 'right',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
              }}>Triangles</th>
              <th style={{
                ...ROW_CELL,
                textAlign: 'right',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
              }}>Vertices</th>
            </tr>
          </thead>
          <tbody>
            {LOD_LEVELS.map((spec) => {
              const r = result?.levels?.find((l) => l.id === spec.id);
              const tri = r?.triCount ?? 0;
              const vtx = r?.vertexCount ?? 0;
              const isActive = activeLodId === spec.id;
              return (
                <tr
                  key={spec.id}
                  data-testid={`forge-lod-mesh-row-${spec.id}`}
                  data-lod-id={spec.id}
                  data-tri-count={tri}
                  data-vertex-count={vtx}
                  data-deflection={spec.deflection}
                  data-active={isActive ? '1' : '0'}
                  style={{
                    borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
                    background: isActive
                      ? 'var(--forge-accent-mute, #1f3a72)'
                      : 'transparent',
                  }}>
                  <td style={{ ...ROW_CELL, fontWeight: 600 }}
                      data-testid={`forge-lod-mesh-label-${spec.id}`}>
                    {spec.label} <span style={{
                      color: 'var(--forge-ink-mute, #9aa1ab)',
                      fontWeight: 400,
                    }}>({spec.id})</span>
                  </td>
                  <td style={{ ...ROW_CELL, textAlign: 'right' }}>
                    {spec.deflection.toFixed(2)}
                  </td>
                  <td style={{ ...ROW_CELL, textAlign: 'right', fontWeight: 600 }}
                      data-testid={`forge-lod-mesh-tri-${spec.id}`}>
                    {tri}
                  </td>
                  <td style={{ ...ROW_CELL, textAlign: 'right' }}
                      data-testid={`forge-lod-mesh-vtx-${spec.id}`}>
                    {vtx}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {status && (
          <div data-testid="forge-lod-mesh-status"
               style={{
                 padding: '8px 12px',
                 fontSize: 11,
                 fontFamily: 'var(--forge-mono, monospace)',
                 color: /^error|^⚠/.test(status)
                   ? 'var(--forge-err, #ff6363)'
                   : 'var(--forge-ok, #4caf50)',
               }}>
            {status}
          </div>
        )}
      </div>

    </aside>,
    document.body,
  );
}

// ────────────────────────────────────────────────────────────────────
// Self-mounting host. Listens for `tools.lodMesh` menu action and
// exposes window.__forgeOpenLodMesh(true|false) so callers can drive
// the panel without ForgeShellV4 needing a new case.

export function LodMeshPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenLodMesh = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseLodMesh = () => setOpen(false);

    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.lodMesh') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenLodMesh; } catch {}
      try { delete window.__forgeCloseLodMesh; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <LodMeshPanel
      open={open}
      onClose={() => setOpen(false)} />
  );
}

export default LodMeshPanel;
