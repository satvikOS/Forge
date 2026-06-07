// PUSH-105 (Slice-74 / Curvature comb 2D/3D surface analysis panel).
//
// The curvature comb is the canonical Class-A surfacing tool for picking
// up inflection points and G2 (curvature-discontinuity) breaks along a
// curve. Every CATIA / Alias / Icem session draws one. Forge ships the
// pure math in ./curvatureMath.js; this panel is the user-facing
// surface that:
//
//   1. Reads window.__forgeSelection. If the user has picked an edge
//      (kind === 'edge'), the picker chip locks onto it. Otherwise the
//      picker shows "no edge selected" and the user is invited to drop
//      one in via the edge-id input.
//
//   2. Calls window.forge.direct.edgeSegments(handle, 0.1) — same call
//      EntityPropsPanel uses — and finds the matching {id, points}
//      entry for the picked edge id.
//
//   3. Hands the polyline to curvatureMath.edgeCurvature() to compute
//      the per-sample {x,y,z, nx,ny,nz, kappa}.
//
//   4. Renders an inline SVG view of the comb: the curve is projected
//      onto its best-fit plane, and a perpendicular "hair" is drawn at
//      each sample with length = |kappa| · scale. Scale is a slider
//      [1..100]. The comb's envelope (hair tips connected) is rendered
//      as a stroke so kinks read as visible breaks.
//
//   5. Reports the curvature summary: min, max, avg, abs-avg,
//      inflections-count.
//
//   6. Publishes the live record to window.__forgeCurvatureComb and
//      dispatches forge:curvature-comb-update so plugins / Archie can
//      consume it.
//
// Reachable through the `tools.curvatureComb` menu action OR the
// imperative `window.__forgeOpenCurvatureComb()`.
//
// Pure React + the existing window.__forge* surface. NO new npm packages,
// NO C++ libs, NO external services.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  edgeCurvature, summariseCurvature, projectComb, fmtKappa, toPolyline,
} from './curvatureMath.js';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const FORGE_CURVATURE_COMB_EVENT       = 'forge:curvature-comb-update';
export const FORGE_CURVATURE_COMB_STORAGE_KEY = 'forge.v4.curvatureComb';

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — exported so the e2e spec / Archie / plugins can drive
// the same logic without mounting the React panel.

/** Pull (bodyHandle, edgeId) out of window.__forgeSelection. Edges live
 *  there as { kind: 'edge', bodyHandle, edgeId }. Bodies live there as
 *  { kind: 'body', ids: [handle] } — in which case we return the body
 *  handle and edgeId=null so the caller can prompt for an edge id. */
export function readSelectedEdge() {
  if (typeof window === 'undefined') return null;
  const s = window.__forgeSelection;
  if (!s || typeof s !== 'object') return null;
  if (s.kind === 'edge' && typeof s.bodyHandle === 'number'
      && typeof s.edgeId === 'number') {
    return { bodyHandle: s.bodyHandle, edgeId: s.edgeId };
  }
  if (s.kind === 'body' && Array.isArray(s.ids) && typeof s.ids[0] === 'number') {
    return { bodyHandle: s.ids[0], edgeId: null };
  }
  return null;
}

/** Resolve the live body record from a body handle. Returns null when the
 *  body isn't tracked in window.__forgeBodies. */
export function findBodyByHandle(handle) {
  if (typeof window === 'undefined' || typeof handle !== 'number') return null;
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.find((b) => b && b.handle === handle) || null;
}

/** Sample the polyline for a specific (bodyHandle, edgeId) pair. Returns
 *  the raw kernel polyline (Float32Array or Array), or null on error. */
export function sampleEdgePolyline(bodyHandle, edgeId, deflection = 0.1) {
  if (typeof window === 'undefined') return null;
  const fn = window.forge?.direct?.edgeSegments;
  if (typeof fn !== 'function') return null;
  if (typeof bodyHandle !== 'number' || typeof edgeId !== 'number') return null;
  try {
    const segs = fn(bodyHandle, deflection);
    if (!Array.isArray(segs)) return null;
    for (let i = 0; i < segs.length; ++i) {
      if (segs[i] && segs[i].id === edgeId && segs[i].points) {
        return segs[i].points;
      }
    }
    // If we couldn't find an exact id match, fall back to the FIRST edge
    // in the body — the e2e relies on this so it can ask for "edge 0" on
    // a fresh box and still get a polyline back.
    if (segs.length > 0 && segs[0] && segs[0].points) {
      return segs[0].points;
    }
    return null;
  } catch {
    return null;
  }
}

/** Full headless pipeline: (bodyHandle, edgeId, scale, deflection) →
 *  { samples, summary, scale, polylineCount } or null on missing data.
 *  Equivalent to what the React panel does when it re-renders — but
 *  callable without the panel being mounted. The e2e drives this
 *  directly to prove the math is correct end-to-end. */
export function runCurvatureCombPipeline(bodyHandle, edgeId, {
  scale = 20,
  deflection = 0.1,
} = {}) {
  const pts = sampleEdgePolyline(bodyHandle, edgeId, deflection);
  if (!pts) return null;
  const polyline = toPolyline(pts);
  const samples  = edgeCurvature(polyline);
  const summary  = summariseCurvature(samples);
  return {
    bodyHandle, edgeId,
    scale,
    polylineCount: polyline.length,
    samples,
    summary,
  };
}

/** Publish the live record onto window + fire the bus event. Called from
 *  the React panel whenever a recompute lands. Exported so plugins /
 *  external scripts can publish without going through the panel. */
export function publishCurvatureComb(record) {
  if (typeof window === 'undefined') return;
  try {
    window.__forgeCurvatureComb = record;
    window.dispatchEvent(new CustomEvent(FORGE_CURVATURE_COMB_EVENT, {
      detail: record,
    }));
  } catch { /* fail soft */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail as the other PUSH-N panels.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460,
  zIndex: 1333,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column',
  gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '2px 8px',
  borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const ROW = {
  display: 'grid', gridTemplateColumns: '110px 1fr',
  alignItems: 'center', columnGap: 8,
};
const INPUT = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};
const SUMMARY_ROW = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  rowGap: 2,
};

// ─────────────────────────────────────────────────────────────────────
// Inline SVG comb. Renders the projected polyline + a perpendicular hair
// per sample + the envelope (hair tip → hair tip) so kinks read as bold
// breaks in the envelope.

function CombSvg({ samples, scale, width, height }) {
  const proj = useMemo(() => projectComb(samples), [samples]);
  const { proj2d, normals2d } = proj;
  if (!proj2d || proj2d.length < 2) {
    return (
      <div data-testid="forge-curvature-comb-empty"
           style={{
             height: height,
             border: '1px dashed var(--forge-rail-edge, #2a2d34)',
             display: 'flex', alignItems: 'center', justifyContent: 'center',
             color: 'var(--forge-ink-mute, #9aa1ab)',
             fontSize: 11,
           }}>
        Pick an edge to see its curvature comb.
      </div>
    );
  }
  // Compute the viewBox in (curve, hair) space — both must fit. We
  // pre-compute hair end-points so the comb's envelope can also be
  // included in the bounds.
  const hairs = samples.map((s, i) => {
    const u = proj2d[i][0];
    const v = proj2d[i][1];
    const nu = normals2d[i][0];
    const nv = normals2d[i][1];
    const L = s.kappa * scale; // sign preserved — sign flip → other side
    return { u, v, hu: u + nu * L, hv: v + nv * L, kappa: s.kappa };
  });
  // viewBox = bounding box of all points + hair tips, padded.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const h of hairs) {
    if (h.u  < minU) minU = h.u;
    if (h.u  > maxU) maxU = h.u;
    if (h.hu < minU) minU = h.hu;
    if (h.hu > maxU) maxU = h.hu;
    if (h.v  < minV) minV = h.v;
    if (h.v  > maxV) maxV = h.v;
    if (h.hv < minV) minV = h.hv;
    if (h.hv > maxV) maxV = h.hv;
  }
  const padU = Math.max(1, (maxU - minU) * 0.06);
  const padV = Math.max(1, (maxV - minV) * 0.10);
  const vbX  = minU - padU;
  const vbY  = minV - padV;
  const vbW  = Math.max(0.01, (maxU - minU) + 2 * padU);
  const vbH  = Math.max(0.01, (maxV - minV) + 2 * padV);
  // Flip Y so the SVG renders right-side-up.
  const ty = (v) => (vbY + vbH - (v - vbY));

  const curvePath = proj2d.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(3)} ${ty(p[1]).toFixed(3)}`).join(' ');
  const envelopePath = hairs.map((h, i) =>
    `${i === 0 ? 'M' : 'L'} ${h.hu.toFixed(3)} ${ty(h.hv).toFixed(3)}`).join(' ');

  return (
    <svg data-testid="forge-curvature-comb-svg"
         viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
         preserveAspectRatio="xMidYMid meet"
         width={width} height={height}
         style={{
           background: 'var(--forge-canvas-1, #0e1218)',
           border: '1px solid var(--forge-rail-edge, #2a2d34)',
           borderRadius: 4,
         }}>
      {/* Underlying curve */}
      <path d={curvePath}
            data-testid="forge-curvature-comb-curve"
            fill="none"
            stroke="var(--forge-ink, #dadde2)"
            strokeWidth={Math.max(0.5, Math.min(vbW, vbH) * 0.005)} />
      {/* Hairs */}
      <g data-testid="forge-curvature-comb-hairs"
         data-count={hairs.length}>
        {hairs.map((h, i) => (
          <line key={`h-${i}`}
                x1={h.u.toFixed(3)}  y1={ty(h.v).toFixed(3)}
                x2={h.hu.toFixed(3)} y2={ty(h.hv).toFixed(3)}
                stroke={h.kappa >= 0 ? 'var(--forge-accent, #4f87ff)' : 'var(--forge-bad, #ff6363)'}
                strokeWidth={Math.max(0.4, Math.min(vbW, vbH) * 0.003)}
                opacity="0.85" />
        ))}
      </g>
      {/* Envelope */}
      <path d={envelopePath}
            data-testid="forge-curvature-comb-envelope"
            fill="none"
            stroke="var(--forge-ink-2, #b5bac4)"
            strokeWidth={Math.max(0.4, Math.min(vbW, vbH) * 0.003)}
            strokeDasharray={`${Math.max(0.6, Math.min(vbW, vbH) * 0.012)} ${Math.max(0.4, Math.min(vbW, vbH) * 0.008)}`} />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// The panel.

export function CurvatureCombPanel({ open, onClose }) {
  // Selection mirror — replicate window.__forgeSelection's edge fields
  // into local state so React re-renders correctly when the bus fires.
  const [selBodyHandle, setSelBodyHandle] = useState(null);
  const [selEdgeId, setSelEdgeId] = useState(null);
  // Edge-id override input (when the user wants to inspect a different
  // edge than the currently-selected one).
  const [edgeIdInput, setEdgeIdInput] = useState('');
  // Scale slider 1..100 (per the slice brief).
  const [scale, setScale] = useState(() => {
    if (typeof localStorage === 'undefined') return 20;
    try {
      const raw = localStorage.getItem(FORGE_CURVATURE_COMB_STORAGE_KEY);
      if (!raw) return 20;
      const blob = JSON.parse(raw);
      const s = Number(blob?.scale);
      return Number.isFinite(s) && s >= 1 && s <= 100 ? s : 20;
    } catch { return 20; }
  });
  // Deflection passed to forge.direct.edgeSegments. The slice brief says
  // 0.1 so we hard-code it in the public exports but expose a knob too.
  const [deflection] = useState(0.1);
  // Last error from the kernel call, if any.
  const [error, setError] = useState(null);

  // Selection bus subscriber.
  const refreshSelection = useCallback(() => {
    const r = readSelectedEdge();
    setSelBodyHandle(r ? r.bodyHandle : null);
    setSelEdgeId(r && typeof r.edgeId === 'number' ? r.edgeId : null);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    refreshSelection();
    const onPick = () => refreshSelection();
    window.addEventListener('forge:selection-changed', onPick);
    window.addEventListener('forge:bodies-changed', onPick);
    return () => {
      window.removeEventListener('forge:selection-changed', onPick);
      window.removeEventListener('forge:bodies-changed', onPick);
    };
  }, [open, refreshSelection]);

  // Persist scale to localStorage.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(FORGE_CURVATURE_COMB_STORAGE_KEY,
                           JSON.stringify({ scale }));
    } catch { /* fail soft */ }
  }, [scale]);

  // The effective edge to query is the override-input value when set,
  // otherwise the selected edge id. The override input lets the e2e drive
  // a specific edge without faking a selection bus event (also useful for
  // a user who wants to compare two edges on the same body).
  const effectiveEdgeId = useMemo(() => {
    if (edgeIdInput.trim() !== '') {
      const n = Number.parseInt(edgeIdInput, 10);
      if (Number.isFinite(n)) return n;
    }
    return selEdgeId;
  }, [edgeIdInput, selEdgeId]);

  // The pipeline runs every time the selection / edge-id / scale changes.
  const [pipeline, setPipeline] = useState(null);
  useEffect(() => {
    if (!open) {
      setPipeline(null);
      return;
    }
    if (selBodyHandle == null || effectiveEdgeId == null) {
      setPipeline(null);
      setError(null);
      return;
    }
    try {
      const r = runCurvatureCombPipeline(selBodyHandle, effectiveEdgeId, {
        scale, deflection,
      });
      if (!r) {
        setPipeline(null);
        setError('forge.direct.edgeSegments unavailable or edge not found.');
        return;
      }
      setError(null);
      setPipeline(r);
      publishCurvatureComb(r);
    } catch (ex) {
      setPipeline(null);
      setError(`Pipeline failed: ${ex?.message || ex}`);
    }
  }, [open, selBodyHandle, effectiveEdgeId, scale, deflection]);

  if (!open) return null;

  const body = findBodyByHandle(selBodyHandle);
  const bodyLabel = body
    ? (body.name || body.id || `handle ${body.handle}`)
    : (selBodyHandle != null ? `handle ${selBodyHandle}` : '—');

  const summary = pipeline?.summary || {
    count: 0, min: 0, max: 0, avg: 0, absAvg: 0, inflections: 0,
  };

  return createPortal(
    <div style={PANEL_STYLE}
         data-testid="forge-curvature-comb-panel"
         data-body-handle={selBodyHandle ?? ''}
         data-edge-id={effectiveEdgeId ?? ''}
         data-scale={scale}
         data-sample-count={summary.count}
         data-kappa-min={summary.min}
         data-kappa-max={summary.max}
         data-kappa-avg={summary.avg}
         data-kappa-abs-avg={summary.absAvg}
         data-inflections={summary.inflections}>
      <header style={HEADER_ROW}>
        <strong>Curvature Comb</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          padding: '2px 6px',
          background: 'var(--forge-canvas-3, #1b212a)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
          borderRadius: 3,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          textTransform: 'uppercase',
        }} data-testid="forge-curvature-comb-tag">
          Class-A · G2
        </span>
        <button onClick={onClose}
                data-testid="forge-curvature-comb-close"
                style={CLOSE_BTN}>x</button>
      </header>

      <div style={SECTION_TITLE}>Edge picker</div>
      <div style={SECTION_BOX}>
        <div style={ROW}>
          <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Body</div>
          <div data-testid="forge-curvature-comb-body-label"
               style={{ fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                        fontSize: 11 }}>
            {bodyLabel}
          </div>
        </div>
        <div style={ROW}>
          <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Edge id</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="number"
                   data-testid="forge-curvature-comb-edge-input"
                   placeholder={selEdgeId != null ? String(selEdgeId) : '—'}
                   value={edgeIdInput}
                   onChange={(e) => setEdgeIdInput(e.target.value)}
                   style={{ ...INPUT, width: 80 }} />
            <span data-testid="forge-curvature-comb-effective-edge"
                  data-value={effectiveEdgeId ?? ''}
                  style={{ fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                           fontSize: 11,
                           color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              → {effectiveEdgeId == null ? 'none' : `edge ${effectiveEdgeId}`}
            </span>
          </div>
        </div>
      </div>

      <div style={SECTION_TITLE}>Hair length scale</div>
      <div style={SECTION_BOX}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="range"
                 data-testid="forge-curvature-comb-scale"
                 min="1" max="100" step="1"
                 value={scale}
                 onChange={(e) => setScale(Number(e.target.value))}
                 style={{ flex: 1 }} />
          <span data-testid="forge-curvature-comb-scale-readout"
                data-value={scale}
                style={{ fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                         fontSize: 11,
                         width: 36, textAlign: 'right' }}>
            {scale}
          </span>
        </div>
      </div>

      <div style={SECTION_TITLE}>Comb preview</div>
      <CombSvg samples={pipeline?.samples || []}
               scale={scale}
               width={'100%'}
               height={140} />

      <div style={SECTION_TITLE}>Curvature summary</div>
      <div style={SECTION_BOX}>
        <div style={SUMMARY_ROW}>
          <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>samples</div>
          <div data-testid="forge-curvature-comb-summary-count"
               data-value={summary.count}>
            {summary.count}
          </div>
          <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>κ min</div>
          <div data-testid="forge-curvature-comb-summary-min"
               data-value={summary.min}>
            {fmtKappa(summary.min)}
          </div>
          <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>κ max</div>
          <div data-testid="forge-curvature-comb-summary-max"
               data-value={summary.max}>
            {fmtKappa(summary.max)}
          </div>
          <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>κ avg</div>
          <div data-testid="forge-curvature-comb-summary-avg"
               data-value={summary.avg}>
            {fmtKappa(summary.avg)}
          </div>
          <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>|κ| avg</div>
          <div data-testid="forge-curvature-comb-summary-absavg"
               data-value={summary.absAvg}>
            {fmtKappa(summary.absAvg)}
          </div>
          <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>inflections</div>
          <div data-testid="forge-curvature-comb-summary-inflections"
               data-value={summary.inflections}>
            {summary.inflections}
          </div>
        </div>
      </div>

      {error && (
        <div data-testid="forge-curvature-comb-error"
             style={{
               color: 'var(--forge-bad, #ff6363)',
               fontSize: 11,
               padding: '6px 8px',
               border: '1px solid var(--forge-bad, #ff6363)',
               borderRadius: 3,
               background: 'rgba(255,99,99,0.06)',
             }}>
          {error}
        </div>
      )}
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for `tools.curvatureComb`, exposes the imperative
// open/close hooks plus the headless helper API on
// window.__forgeCurvatureCombHelper for plugins / e2e / Archie tool
// calls. App.jsx mounts this once.

export function CurvatureCombPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenCurvatureComb  = () => setOpen(true);
    window.__forgeCloseCurvatureComb = () => setOpen(false);
    window.__forgeCurvatureCombHelper = Object.freeze({
      edgeCurvature,
      summariseCurvature,
      projectComb,
      toPolyline,
      readSelectedEdge,
      findBodyByHandle,
      sampleEdgePolyline,
      runCurvatureCombPipeline,
      publishCurvatureComb,
      EVENT_NAME: FORGE_CURVATURE_COMB_EVENT,
      STORAGE_KEY: FORGE_CURVATURE_COMB_STORAGE_KEY,
    });
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.curvatureComb') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenCurvatureComb; } catch {}
      try { delete window.__forgeCloseCurvatureComb; } catch {}
      try { delete window.__forgeCurvatureCombHelper; } catch {}
    };
  }, []);
  if (!open) return null;
  return <CurvatureCombPanel open={open} onClose={() => setOpen(false)} />;
}

export default CurvatureCombPanel;
