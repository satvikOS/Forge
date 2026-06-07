// PUSH-172 (Slice-128) — 3D Print Slicing panel.
//
// A focused, self-contained slicing panel for FDM/SLA print prep.
// Picks a native body, tessellates it via window.forge.tessellate, then
// runs sliceMath.sliceMesh(positions, indices, zHeights) to produce
// per-layer contour polylines. Surfaces:
//   - Layer count
//   - Total perimeter length (sum over every contour of every layer)
//   - Inline SVG preview of one selected layer (slider over the layer
//     index)
//
// Manual UI NEVER posts to Archie's thread (per feedback-forge-manual-not-archie).
//
// Test surface:
//   data-testid="forge-slicing-panel"
//   data-testid="forge-slicing-body"
//   data-testid="forge-slicing-layer-height"
//   data-testid="forge-slicing-slice"
//   data-testid="forge-slicing-layer-count"
//   data-testid="forge-slicing-total-perimeter"
//   data-testid="forge-slicing-layer-index"
//   data-testid="forge-slicing-svg-container"
//   data-testid="forge-slicing-status"
//   data-testid="forge-slicing-close"
//
// Window APIs:
//   window.__forgeOpenSlicing(open?)         — open/close the panel
//   window.__forgeCloseSlicing()             — close
//   window.__forgeSlicingHelper              — frozen {sliceMesh, ...} surface
//   window.__forgeLastSlicingResult          — last { layerCount, totalPerimeter, contours }

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  sliceMesh, meshBounds, layerZHeights, layerBounds2D,
  totalPerimeterLength, polylineLength,
  LAYER_HEIGHTS, DEFAULT_LAYER_HEIGHT,
} from './sliceMath.js';

export const FORGE_SLICING_EVENT = 'forge:slicing-committed';

/* =====================================================================
 * body picking + helper surface
 * ===================================================================== */

function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
}
function defaultBody() {
  const nb = readNativeBodies();
  return nb.length ? nb[nb.length - 1] : null;
}

/**
 * Run the slice pipeline against a native body. Tessellates via
 * forge.tessellate, computes Z heights from the AABB, calls sliceMesh.
 * Returns { ok, layerCount, totalPerimeter, contours, bounds, zHeights }
 * on success, or { ok: false, error } on failure.
 */
export function runSlicingPipeline({ handle, layerHeight } = {}) {
  if (typeof window === 'undefined') return { ok: false, error: 'no-window' };
  const fn = window.forge && window.forge.tessellate;
  if (typeof fn !== 'function') return { ok: false, error: 'no-kernel' };
  const lh = Number(layerHeight);
  if (!Number.isFinite(lh) || lh <= 0) return { ok: false, error: 'bad-layer-height' };
  let mesh;
  try {
    // Match the tessellation tolerance used by the rest of the v4 shell.
    mesh = fn(handle, 0.1, 0.5);
  } catch (ex) {
    return { ok: false, error: String(ex && ex.message || ex) };
  }
  if (!mesh || !mesh.positions || mesh.positions.length === 0) {
    return { ok: false, error: 'empty-tessellation' };
  }
  const positions = mesh.positions;
  const indices   = mesh.indices || null;
  let bounds;
  try { bounds = meshBounds(positions); }
  catch (ex) { return { ok: false, error: String(ex && ex.message || ex) }; }
  const zHeights = layerZHeights(bounds, lh);
  const contours = sliceMesh(positions, indices, zHeights);
  const totalPerimeter = totalPerimeterLength(contours);
  return {
    ok: true,
    layerCount: zHeights.length,
    totalPerimeter,
    contours,
    bounds,
    zHeights,
    layerHeight: lh,
  };
}

if (typeof window !== 'undefined' && !window.__forgeSlicingHelper) {
  window.__forgeSlicingHelper = Object.freeze({
    runSlicingPipeline,
    readNativeBodies,
    sliceMesh,
    meshBounds,
    layerZHeights,
    totalPerimeterLength,
    polylineLength,
    layerBounds2D,
    LAYER_HEIGHTS,
    DEFAULT_LAYER_HEIGHT,
  });
}

/* =====================================================================
 * SVG builder for one layer
 * ===================================================================== */

const SVG_SIZE = 320;
const SVG_PAD  = 12;

/**
 * Build an inline SVG showing one layer's contour polylines. The bbox
 * of the layer is auto-fit into a (SVG_SIZE - 2*SVG_PAD) viewport.
 * Returns a plain JSX subtree.
 */
export function renderLayerSvg(layerContours, zValue) {
  if (!layerContours || layerContours.length === 0) {
    return (
      <svg width={SVG_SIZE} height={SVG_SIZE}
           viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
           data-empty="1">
        <rect width={SVG_SIZE} height={SVG_SIZE} fill="var(--forge-canvas-3, #1a1a1a)" />
        <text x={SVG_SIZE / 2} y={SVG_SIZE / 2}
              textAnchor="middle" fill="var(--forge-ink-mute, #888)"
              fontFamily="var(--forge-mono, monospace)" fontSize="12">
          (no contours)
        </text>
      </svg>
    );
  }
  const bb = layerBounds2D(layerContours);
  if (!bb) {
    return (
      <svg width={SVG_SIZE} height={SVG_SIZE}
           viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}>
        <rect width={SVG_SIZE} height={SVG_SIZE} fill="var(--forge-canvas-3, #1a1a1a)" />
      </svg>
    );
  }
  const w = Math.max(1e-6, bb.maxX - bb.minX);
  const h = Math.max(1e-6, bb.maxY - bb.minY);
  const drawSize = SVG_SIZE - 2 * SVG_PAD;
  const scale = Math.min(drawSize / w, drawSize / h);
  // Centre the contour in the viewport.
  const offX = SVG_PAD + (drawSize - w * scale) / 2;
  const offY = SVG_PAD + (drawSize - h * scale) / 2;
  // SVG Y increases downward; flip via (maxY - y).
  const toScreen = (pt) => [
    offX + (pt[0] - bb.minX) * scale,
    offY + (bb.maxY - pt[1]) * scale,
  ];

  return (
    <svg width={SVG_SIZE} height={SVG_SIZE}
         viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
         data-testid="forge-slicing-svg"
         data-bbox-w={w.toFixed(4)}
         data-bbox-h={h.toFixed(4)}
         data-poly-count={layerContours.length}
         data-z={zValue?.toFixed(4)}>
        <rect width={SVG_SIZE} height={SVG_SIZE} fill="var(--forge-canvas-3, #1a1a1a)" />
        {layerContours.map((poly, i) => {
          const screen = poly.map(toScreen);
          const d = screen.map((p, idx) => (idx === 0 ? 'M' : 'L') + p[0].toFixed(3) + ' ' + p[1].toFixed(3)).join(' ')
                  + (poly.open ? '' : ' Z');
          return (
            <path key={i} d={d}
                  data-poly-idx={i}
                  data-vert-count={poly.length}
                  data-open={poly.open ? '1' : '0'}
                  fill="none"
                  stroke={poly.open ? '#d57171' : '#7ad27a'}
                  strokeWidth="1.5" />
          );
        })}
    </svg>
  );
}

/* =====================================================================
 * Panel
 * ===================================================================== */

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

export function SlicingPanel({ open, onClose }) {
  const [body, setBody] = useState(() => defaultBody());
  const [layerHeight, setLayerHeight] = useState(DEFAULT_LAYER_HEIGHT);
  const [result, setResult] = useState(null);   // { layerCount, totalPerimeter, contours, bounds, zHeights }
  const [activeLayer, setActiveLayer] = useState(0);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setBody(defaultBody());
    const onBodies = () => setBody((b) => b ?? defaultBody());
    window.addEventListener('forge:bodies-changed', onBodies);
    return () => window.removeEventListener('forge:bodies-changed', onBodies);
  }, [open]);

  const slice = useCallback(() => {
    if (!body) { setStatus('no-body'); return; }
    const r = runSlicingPipeline({ handle: body.handle, layerHeight });
    if (!r.ok) {
      setStatus('error: ' + r.error);
      setResult(null);
      return;
    }
    setResult(r);
    setActiveLayer(Math.floor(r.layerCount / 2));   // centre layer = most visible.
    setStatus('ok ' + r.layerCount + ' layers · ' + r.totalPerimeter.toFixed(2) + ' mm perimeter');
    try {
      window.__forgeLastSlicingResult = {
        layerCount:     r.layerCount,
        totalPerimeter: r.totalPerimeter,
        layerHeight:    r.layerHeight,
        bounds:         r.bounds,
        ts:             Date.now(),
      };
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent(FORGE_SLICING_EVENT, {
        detail: {
          layerCount: r.layerCount,
          totalPerimeter: r.totalPerimeter,
          layerHeight: r.layerHeight,
        },
      }));
    } catch {}
  }, [body, layerHeight]);

  const activeContours = useMemo(() => {
    if (!result) return null;
    const idx = Math.max(0, Math.min(result.layerCount - 1, activeLayer));
    return result.contours[idx];
  }, [result, activeLayer]);

  const activeZ = useMemo(() => {
    if (!result) return null;
    const idx = Math.max(0, Math.min(result.layerCount - 1, activeLayer));
    return result.zHeights[idx];
  }, [result, activeLayer]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-slicing-panel"
         data-body-handle={body?.handle ?? ''}
         data-layer-count={result?.layerCount ?? ''}
         data-total-perimeter={result?.totalPerimeter?.toFixed(4) ?? ''}>
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>3D Print Slicing (FDM / SLA)</strong>
        <button onClick={onClose} data-testid="forge-slicing-close"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--forge-rail-edge)',
                  color: 'var(--forge-ink)', cursor: 'pointer',
                  padding: '2px 6px',
                }}>
          ×
        </button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)' }}>
        Body: <strong data-testid="forge-slicing-body">
          {body ? (body.name || `handle ${body.handle}`) : 'None'}
        </strong>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label htmlFor="forge-slicing-layer-height">Layer height (mm)</label>
        <select id="forge-slicing-layer-height"
                data-testid="forge-slicing-layer-height"
                value={layerHeight}
                onChange={(e) => setLayerHeight(Number(e.target.value))}
                style={{ width: 90 }}>
          {LAYER_HEIGHTS.map((h) => (
            <option key={h} value={h}>{h.toFixed(1)} mm</option>
          ))}
        </select>
      </div>

      <button onClick={slice}
              data-testid="forge-slicing-slice"
              style={{
                background: 'var(--forge-accent, #2c4d2a)', color: '#dfeedd',
                border: 'none', padding: '6px 12px', borderRadius: 4,
                cursor: 'pointer', fontWeight: 600,
              }}>
        Slice
      </button>

      {result && (
        <section style={{
          display: 'flex', flexDirection: 'column', gap: 6,
          fontFamily: 'var(--forge-mono, monospace)', fontSize: 11,
        }}>
          <div>
            Layer count: <strong data-testid="forge-slicing-layer-count">
              {result.layerCount}
            </strong>
          </div>
          <div>
            Total perimeter: <strong data-testid="forge-slicing-total-perimeter">
              {result.totalPerimeter.toFixed(3)}
            </strong> mm
          </div>
          <div>
            Bounding Z: {result.bounds.minZ.toFixed(2)} → {result.bounds.maxZ.toFixed(2)} mm
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label htmlFor="forge-slicing-layer-index">Layer #</label>
            <input id="forge-slicing-layer-index"
                   type="range" min="0" max={result.layerCount - 1}
                   value={activeLayer}
                   data-testid="forge-slicing-layer-index"
                   onChange={(e) => setActiveLayer(Number(e.target.value))}
                   style={{ flex: 1 }} />
            <span data-testid="forge-slicing-layer-index-value">
              {activeLayer}
            </span>
            <span data-testid="forge-slicing-layer-z">
              z={activeZ != null ? activeZ.toFixed(3) : '—'}
            </span>
          </div>
          <div data-testid="forge-slicing-svg-container"
               data-active-layer={activeLayer}
               data-active-poly-count={activeContours ? activeContours.length : 0}
               style={{
                 border: '1px solid var(--forge-rail-edge)',
                 borderRadius: 4,
                 background: 'var(--forge-canvas-3, #1a1a1a)',
                 alignSelf: 'center',
               }}>
            {renderLayerSvg(activeContours, activeZ)}
          </div>
        </section>
      )}

      {status && (
        <div data-testid="forge-slicing-status"
             style={{
               color: 'var(--forge-ink-mute)',
               fontFamily: 'var(--forge-mono, monospace)',
             }}>
          {status}
        </div>
      )}
    </div>
  );
}

/* =====================================================================
 * Host
 * ===================================================================== */

export function SlicingPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSlicing  = (b) => setOpen(b === undefined ? true : !!b);
    window.__forgeCloseSlicing = ()  => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.slicing') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SlicingPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SlicingPanel;
