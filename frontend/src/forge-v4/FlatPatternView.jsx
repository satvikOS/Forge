// Forge-127 — Flat Pattern view (2D).
//
// Renders the developed sheet for the active body. The shell hands us a
// flat-pattern result from forge.sheetMetal.flatPattern (real geometry,
// not a placeholder): { wire, bbox: [minX,minY,maxX,maxY], formedHeight }.
//
// The view also reads the bend log via forge.sheetMetal.bends(shape) so
// every dashed bend line carries a real press-brake note:
//
//      UP 90°   R1.5   K0.44
//      DOWN 45° R2.0   K0.46
//
// Layout: SVG canvas centred on the part bbox, padded by 10% margin so
// dimensions and notes never collide with the panel chrome. Theme is
// driven by the same tokens used by the rest of forge-v4 so the
// pattern reads correctly under both --forge-theme=dark and =light.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import { bends as bendsOp, flatPattern as flatPatternOp } from './sheetMetalDispatch.js';
import { bendAllowance } from './kFactorTable.js';

// ─────────────────────────────────────── helpers ──

/**
 * Walk a wire handle and pull out the polyline segments. The native
 * sheetMetal API hands us a wire — we ask the kernel to sample it via
 * window.forge.tessellateWire if available, otherwise fall back to
 * walking edges by ID through window.forge.edges.points (both calls
 * are documented in the kernel facade).
 */
function tessellateWire(wireHandle) {
  if (typeof window === 'undefined' || !window.forge) return [];
  const f = window.forge;
  try {
    if (typeof f.tessellateWire === 'function') {
      const pts = f.tessellateWire(wireHandle);
      return Array.isArray(pts) ? pts : [];
    }
    if (typeof f.sheetMetal?.sampleWire === 'function') {
      return f.sheetMetal.sampleWire(wireHandle, 64) || [];
    }
    // Slice-12 fallback — sample the wire's edges into polylines via the
    // direct.edgeSegments API (the same one drawings/edge-pick use). Each
    // segment is { id, points: Float64Array[x0,y0,z0,x1,y1,z1,…] }. We take
    // (x,y) of every vertex (the flat pattern lives in the z=0
    // manufacturing plane) and concatenate them into one outline polyline
    // so the SVG renders the real developed boundary.
    if (typeof f.direct?.edgeSegments === 'function') {
      const segs = f.direct.edgeSegments(wireHandle, 0.25);
      if (Array.isArray(segs)) {
        const out = [];
        for (const seg of segs) {
          const pts = seg && seg.points ? seg.points : seg;
          if (!pts) continue;
          // Float64Array / Array of flat triples.
          if (typeof pts.length === 'number' && typeof pts[0] === 'number') {
            for (let i = 0; i + 2 < pts.length + 1; i += 3) {
              const x = pts[i], y = pts[i + 1];
              if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
            }
          } else if (Array.isArray(pts)) {
            for (const p of pts) {
              const x = Array.isArray(p) ? p[0] : p.x;
              const y = Array.isArray(p) ? p[1] : p.y;
              if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
            }
          }
        }
        return out;
      }
    }
  } catch {}
  return [];
}

function svgPath(points) {
  if (!Array.isArray(points) || points.length < 2) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) d += ` L ${points[i][0]} ${points[i][1]}`;
  return d;
}

function fitTransform(bbox, viewBoxSize) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return { scale: 1, dx: 0, dy: 0 };
  }
  const [minX, minY, maxX, maxY] = bbox;
  const w = Math.max(1e-6, maxX - minX);
  const h = Math.max(1e-6, maxY - minY);
  const pad = 0.10 * Math.max(w, h);
  const scale = Math.min((viewBoxSize - 2 * pad) / w, (viewBoxSize - 2 * pad) / h);
  const dx = -minX * scale + (viewBoxSize - w * scale) / 2;
  const dy = -minY * scale + (viewBoxSize - h * scale) / 2;
  return { scale, dx, dy };
}

/**
 * Format a bend note the way a press-brake operator reads it.
 * `bend` is the native sheetMetal.bends() record:
 *   { type, angle, radius, kFactor, line:[[x0,y0,z0],[x1,y1,z1]], direction }
 */
function bendNote(bend) {
  const dir = bend.direction === 'down' || bend.direction === 'DOWN' ? 'DOWN' : 'UP';
  const angleDeg = Number.isFinite(bend.angle)
    ? (bend.angle * 180 / Math.PI).toFixed(1)
    : '90.0';
  const r = (Number.isFinite(bend.radius) ? bend.radius : 1.5).toFixed(2);
  const k = (Number.isFinite(bend.kFactor) ? bend.kFactor : 0.44).toFixed(2);
  const ba = bendAllowance({
    angleDeg: Number(angleDeg),
    bendRadiusMm: Number(r),
    thicknessMm: bend.thickness || 1.5,
    k: Number(k),
  }).toFixed(2);
  return `${dir} ${angleDeg}°   R${r}   K${k}   BA ${ba}`;
}

function midpoint(line) {
  if (!Array.isArray(line) || line.length < 2) return [0, 0];
  const a = line[0];
  const b = line[1];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// ─────────────────────────────────────── component ──

export function FlatPatternView({
  shape, thickness = 1.5, bendRadius = 1.5, k,
  width = 720, height = 480, onClose,
} = {}) {
  const [data, setData] = useState({ loading: true });

  useEffect(() => {
    if (shape == null) {
      setData({ loading: false, empty: true });
      return;
    }
    const r = flatPatternOp({ shape, thickness, bendRadius, k });
    const list = bendsOp({ shape });
    if (r.ok && r.kind === 'native') {
      const outline = tessellateWire(r.handle);
      setData({
        loading: false,
        empty: false,
        bbox: r.bbox || [0, 0, 100, 60],
        wire: r.handle,
        outline,
        bends: Array.isArray(list?.bends) ? list.bends : [],
        formedHeight: r.formedHeight,
        kFactor: r.params?.kFactor,
        thickness: r.params?.thickness,
      });
    } else {
      setData({ loading: false, empty: true, reason: r.message || 'kernel-not-ready' });
    }
  }, [shape, thickness, bendRadius, k]);

  const VB = 1000;
  const { scale, dx, dy } = useMemo(() => fitTransform(data.bbox, VB), [data.bbox]);

  return (
    <section data-testid="forge-flat-pattern-view"
             aria-label="Flat pattern"
             style={{
               width, height,
               background: 'var(--forge-canvas)',
               color: 'var(--forge-ink)',
               border: '1px solid var(--forge-rail-edge)',
               borderRadius: 'var(--forge-radius-lg)',
               display: 'flex',
               flexDirection: 'column',
               overflow: 'hidden',
               font: 'inherit',
               fontSize: 12,
             }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: 'var(--forge-space-2) var(--forge-space-3)',
        background: 'var(--forge-canvas-2)',
        borderBottom: '1px solid var(--forge-rail-edge)',
      }}>
        <Icon name="pattern.linear" size={14} />
        <strong style={{ flex: 1 }}>Flat Pattern</strong>
        {data.bbox && (
          <span data-testid="forge-flat-pattern-bbox"
                style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                         color: 'var(--forge-ink-mute)' }}>
            {`${(data.bbox[2] - data.bbox[0]).toFixed(1)} × ${(data.bbox[3] - data.bbox[1]).toFixed(1)} mm`}
          </span>
        )}
        {onClose && (
          <button type="button" onClick={onClose}
                  data-testid="forge-flat-pattern-close"
                  aria-label="Close flat pattern"
                  style={{ background: 'transparent', border: 'none',
                           color: 'var(--forge-ink-mute)', cursor: 'pointer',
                           display: 'inline-flex', padding: 2 }}>
            <Icon name="select.clear" size={12} />
          </button>
        )}
      </header>

      <div style={{ flex: 1, position: 'relative',
                    background: 'var(--forge-canvas)' }}>
        {data.loading && (
          <div style={{ position: 'absolute', inset: 0,
                        display: 'grid', placeItems: 'center',
                        color: 'var(--forge-ink-mute)' }}>
            Developing pattern…
          </div>
        )}
        {!data.loading && data.empty && (
          <div data-testid="forge-flat-pattern-empty"
               style={{ position: 'absolute', inset: 0,
                        display: 'grid', placeItems: 'center',
                        gap: 6, color: 'var(--forge-ink-mute)',
                        textAlign: 'center' }}>
            <div>No flat pattern available.</div>
            <div style={{ fontSize: 11 }}>
              {data.reason === 'kernel-not-ready'
                ? 'forge kernel idle — pick a sheet body once the kernel loads.'
                : 'Build a Base Flange first, then add bends.'}
            </div>
          </div>
        )}
        {!data.loading && !data.empty && (
          <svg viewBox={`0 0 ${VB} ${VB}`}
               preserveAspectRatio="xMidYMid meet"
               style={{ width: '100%', height: '100%' }}>
            {/* graph paper grid */}
            <defs>
              <pattern id="forge-flat-grid"
                       width="50" height="50"
                       patternUnits="userSpaceOnUse">
                <path d="M 50 0 L 0 0 0 50"
                      fill="none"
                      stroke="var(--forge-rail-edge)"
                      strokeWidth="0.6"
                      opacity="0.4" />
              </pattern>
            </defs>
            <rect width={VB} height={VB} fill="url(#forge-flat-grid)" />
            <g transform={`translate(${dx} ${dy}) scale(${scale})`}>
              {/* part outline (solid) */}
              <path d={svgPath(data.outline)}
                    fill="var(--forge-accent-mute)"
                    stroke="var(--forge-accent)"
                    strokeWidth={1.5 / Math.max(scale, 0.001)}
                    data-testid="forge-flat-pattern-outline" />
              {/* bend lines (dash) */}
              {data.bends.map((b, i) => {
                const line = b.flatLine || b.line || [];
                if (!Array.isArray(line) || line.length < 2) return null;
                const [a, c] = line;
                const dirColor = b.direction === 'down' || b.direction === 'DOWN'
                  ? 'var(--forge-err)'
                  : 'var(--forge-ok)';
                return (
                  <g key={`bend-${i}`}
                     data-testid={`forge-flat-pattern-bend-${i}`}
                     data-bend-dir={(b.direction || 'up').toString().toLowerCase()}>
                    <line x1={a[0]} y1={a[1]} x2={c[0]} y2={c[1]}
                          stroke={dirColor}
                          strokeDasharray={`${4 / scale} ${3 / scale}`}
                          strokeWidth={1 / Math.max(scale, 0.001)} />
                  </g>
                );
              })}
            </g>
            {/* bend notes — drawn in viewBox (un-transformed) so font size
                stays readable regardless of part size. */}
            {data.bends.map((b, i) => {
              const line = b.flatLine || b.line || [];
              const mid = midpoint(line);
              const screen = [mid[0] * scale + dx, mid[1] * scale + dy];
              return (
                <text key={`note-${i}`}
                      data-testid={`forge-flat-pattern-note-${i}`}
                      x={screen[0]} y={screen[1] - 6}
                      fill="var(--forge-ink)"
                      fontFamily="var(--forge-mono)"
                      fontSize={11}
                      textAnchor="middle">
                  {bendNote({ ...b, thickness: data.thickness })}
                </text>
              );
            })}
          </svg>
        )}
      </div>

      <footer style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: 'var(--forge-space-2) var(--forge-space-3)',
        background: 'var(--forge-canvas-2)',
        borderTop: '1px solid var(--forge-rail-edge)',
        fontFamily: 'var(--forge-mono)',
        fontSize: 11,
        color: 'var(--forge-ink-mute)',
      }}>
        <span data-testid="forge-flat-pattern-bend-count">
          Bends: {data.bends ? data.bends.length : 0}
        </span>
        <span>Thickness: {(data.thickness || thickness).toFixed(2)} mm</span>
        <span>K-factor: {(data.kFactor || 0.44).toFixed(3)}</span>
        <span style={{ flex: 1 }} />
        <span>UP = green dash · DOWN = red dash</span>
      </footer>
    </section>
  );
}

export default FlatPatternView;

// ────────── self-mounting host (Slice-12) ──────────
// Mounted once in App.jsx. ForgeShellV4 dispatches a
// `forge:open-flat-pattern` window event (detail: { shape, thickness,
// bendRadius, k }) after a sheet.flatPattern / sheet.unfold op so the
// flat develops into a real, visible 2D drawing instead of an invisible
// wire body. Mirrors SurfacingPanelHost's open-via-window-hook pattern.
export function FlatPatternHost() {
  const [state, setState] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOpen = (e) => {
      const d = (e && e.detail) || {};
      if (d.shape == null) return;
      setState({
        shape: d.shape,
        thickness: typeof d.thickness === 'number' ? d.thickness : 1.5,
        bendRadius: typeof d.bendRadius === 'number' ? d.bendRadius : 1.5,
        k: d.k,
      });
    };
    window.addEventListener('forge:open-flat-pattern', onOpen);
    window.__forgeOpenFlatPattern = (d) => onOpen({ detail: d });
    return () => {
      window.removeEventListener('forge:open-flat-pattern', onOpen);
      delete window.__forgeOpenFlatPattern;
    };
  }, []);

  if (!state) return null;
  return createPortal(
    <div data-testid="forge-flat-pattern-host"
         style={{ position: 'fixed', right: 24, top: 96, zIndex: 940,
                  boxShadow: '0 6px 22px rgba(0,0,0,0.45)' }}>
      <FlatPatternView shape={state.shape} thickness={state.thickness}
                       bendRadius={state.bendRadius} k={state.k}
                       onClose={() => setState(null)} />
    </div>,
    document.body,
  );
}

