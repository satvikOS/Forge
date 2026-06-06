// PUSH-63 — Entity Properties panel for the active face / edge / body pick.
//
// Up through PUSH-58 the only place the renderer exposed "real engineering
// numbers" was the right-docked Mass Properties panel, and it was scoped to
// the whole body (volume / surface area / COM of the active body). The
// kernel has shipped per-face and per-edge introspection for ages —
// `forge.direct.inferFeature(handle, faceId)` returns the face's classified
// type / centroid / normal / planar area, and `forge.direct.edgeSegments
// (handle, deflection)` returns one polyline per edge — but neither was
// surfaced in the UI. Selecting a face or an edge revealed only the AIS
// highlight: no normal vector, no area, no edge length, nothing to feed a
// real engineering decision.
//
// PUSH-63 lights that data up. A small floating Properties panel reads
// `window.__forgeSelection` (the selection state shared with the
// CommandPalette + ArchieDock + ais-selection layer) and resolves the
// matching body from `window.__forgeBodies`, then:
//
//   • Face   → `forge.direct.inferFeature(handle, faceId)` → kind / label,
//              area (mm²), centroid (mm), outward normal (unit vector).
//   • Edge   → `forge.direct.edgeSegments(handle, 0.1)` → finds the entry
//              whose `id` equals the selected edgeId, sums the polyline
//              segment lengths to get the true OCCT edge length (mm), and
//              reports first / mid / last points.
//   • Body   → `forge.massProps(handle)` → volume / surface area / COM.
//
// The panel listens for `forge:selection-changed` (the same event the
// selection bus already broadcasts) and updates live whenever the pick
// changes, so flipping selection between a face and an edge swaps the
// readout instantly. No setState plumbing from window APIs — the panel
// reads the window globals on each event.
//
// Hard constraints honoured:
//   * No new npm packages, no new C++ libs.
//   * Real kernel calls only — no MVP, no stub, no fallback table.
//   * Reachable through the `tools.entityProps` menu action (Tools menu).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// ────────────── helpers ──────────────

function readSelection() {
  if (typeof window === 'undefined') return null;
  const s = window.__forgeSelection;
  if (!s || typeof s !== 'object') return null;
  return s;
}

function findBody(handle) {
  if (typeof window === 'undefined' || typeof handle !== 'number') return null;
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.find((b) => b && b.handle === handle) || null;
}

function bodyLabel(body, handle) {
  if (body) return body.name || body.id || `handle ${body.handle}`;
  if (typeof handle === 'number') return `handle ${handle}`;
  return '—';
}

// Sum the squared distances along a polyline of [x,y,z, x,y,z, …]
// Float32Array (the exact shape forge.direct.edgeSegments returns).
export function polylineLength(points) {
  if (!points || points.length < 6) return 0;
  let len = 0;
  for (let i = 0; i + 5 < points.length; i += 3) {
    const dx = points[i + 3] - points[i];
    const dy = points[i + 4] - points[i + 1];
    const dz = points[i + 5] - points[i + 2];
    len += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return len;
}

// Walk an edge polyline to length L/2 to find the parametric midpoint.
// Returns [x,y,z]; falls back to a straight average if the array is empty.
export function polylineMidpoint(points) {
  if (!points || points.length < 6) {
    if (!points || points.length < 3) return [0, 0, 0];
    return [points[0], points[1], points[2]];
  }
  const total = polylineLength(points);
  const half  = total / 2;
  let acc = 0;
  for (let i = 0; i + 5 < points.length; i += 3) {
    const dx = points[i + 3] - points[i];
    const dy = points[i + 4] - points[i + 1];
    const dz = points[i + 5] - points[i + 2];
    const d  = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (acc + d >= half && d > 0) {
      const t = (half - acc) / d;
      return [
        points[i]     + dx * t,
        points[i + 1] + dy * t,
        points[i + 2] + dz * t,
      ];
    }
    acc += d;
  }
  const last = points.length - 3;
  return [points[last], points[last + 1], points[last + 2]];
}

function endpoints(points) {
  if (!points || points.length < 3) return { first: [0, 0, 0], last: [0, 0, 0] };
  const last = points.length - 3;
  return {
    first: [points[0], points[1], points[2]],
    last:  [points[last], points[last + 1], points[last + 2]],
  };
}

// Convert a Float32Array (or typed-array-like) into a plain Array so React
// can compare it stably between renders. The kernel returns Float32Array
// from edgeSegments; we never mutate it.
function toArr(maybeTyped) {
  if (!maybeTyped) return [];
  if (Array.isArray(maybeTyped)) return maybeTyped;
  return Array.from(maybeTyped);
}

// ────────────── kernel-bound readers ──────────────

// Face: returns { kind, label, area, centroid:[3], normal:[3], radius } or null.
export function readFaceProps(handle, faceId) {
  if (typeof window === 'undefined') return null;
  const fn = window.forge?.direct?.inferFeature;
  if (typeof fn !== 'function') return null;
  if (typeof handle !== 'number' || typeof faceId !== 'number') return null;
  try {
    const r = fn(handle, faceId);
    if (!r) return null;
    return {
      kind:     String(r.kind || ''),
      label:    String(r.label || ''),
      area:     Number(r.area || 0),
      centroid: Array.isArray(r.centroid) ? Array.from(r.centroid) : [0, 0, 0],
      normal:   Array.isArray(r.normal)   ? Array.from(r.normal)   : [0, 0, 0],
      radius:   Number(r.radius || 0),
    };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

// Edge: returns { id, length, points:Array, first, mid, last } or null.
export function readEdgeProps(handle, edgeId) {
  if (typeof window === 'undefined') return null;
  const fn = window.forge?.direct?.edgeSegments;
  if (typeof fn !== 'function') return null;
  if (typeof handle !== 'number' || typeof edgeId !== 'number') return null;
  try {
    const segs = fn(handle, 0.1);
    if (!Array.isArray(segs) && !segs?.length) return null;
    let found = null;
    for (let i = 0; i < segs.length; ++i) {
      if (segs[i] && segs[i].id === edgeId) { found = segs[i]; break; }
    }
    if (!found) return { error: `edge ${edgeId} not found` };
    const pts = toArr(found.points);
    const { first, last } = endpoints(pts);
    return {
      id:     edgeId,
      length: polylineLength(pts),
      points: pts.length,
      first, last,
      mid:    polylineMidpoint(pts),
    };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

// Body: returns { volume, area, centerOfMass:[3] } or null.
export function readBodyProps(handle) {
  if (typeof window === 'undefined') return null;
  const fn = window.forge?.massProps;
  if (typeof fn !== 'function') return null;
  if (typeof handle !== 'number') return null;
  try {
    const r = fn(handle);
    return {
      volume:       Number(r?.volume || 0),
      area:         Number(r?.area || 0),
      centerOfMass: Array.isArray(r?.centerOfMass) ? Array.from(r.centerOfMass) : [0, 0, 0],
    };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

// ────────────── styles ──────────────

// Bottom-left floating chip, well clear of the right-docked panels
// (MassProps, Interference, MaterialsBrowser). Stays above the section
// control band but below the dialog layer.
const panelStyle = {
  position: 'fixed',
  left:   'calc(var(--forge-rail-w, 64px) + var(--forge-space-3))',
  bottom: 'calc(var(--forge-statusbar-h, 24px) + var(--forge-space-3))',
  width: 320,
  zIndex: 1300,
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius, 6px)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 6,
  color: 'var(--forge-ink)', fontSize: 12,
  maxHeight: '60vh', overflowY: 'auto',
};
const rowStyle = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr',
  columnGap: 8, rowGap: 4,
  fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const closeBtn = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 3,
};

function fmt(v, digits = 3) {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function fmtVec(v, digits = 3) {
  if (!Array.isArray(v) || v.length < 3) return '—';
  return `(${fmt(v[0], digits)}, ${fmt(v[1], digits)}, ${fmt(v[2], digits)})`;
}

// ────────────── panel ──────────────

export function EntityPropsPanel({ open, onClose }) {
  // The selection mirror we render from. We replicate the contents of
  // window.__forgeSelection (not the object identity) so React can re-render
  // even when callers mutate the same object — which is exactly what the
  // selection bus does to keep allocator pressure down.
  const [sel, setSel] = useState(() => readSelection());

  const refresh = useCallback(() => {
    const s = readSelection();
    setSel(s ? { ...s } : null);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    refresh();
    const onPick = () => refresh();
    window.addEventListener('forge:selection-changed', onPick);
    // Forge-184 / PUSH-32 emit this when the body list itself mutates
    // (drag-drop import, regen). Keep the panel honest about the
    // currently-selected body's properties when the body is replaced.
    window.addEventListener('forge:bodies-changed', onPick);
    return () => {
      window.removeEventListener('forge:selection-changed', onPick);
      window.removeEventListener('forge:bodies-changed', onPick);
    };
  }, [open, refresh]);

  // Mode = which entity flavour the panel is rendering. Drives both the
  // header label and the row block below. Falls through to 'none' when
  // the selection bus is empty.
  const mode = useMemo(() => {
    if (!sel) return 'none';
    if (sel.kind === 'face' && typeof sel.faceId === 'number') return 'face';
    if (sel.kind === 'edge' && typeof sel.edgeId === 'number') return 'edge';
    if (sel.kind === 'body' || typeof sel.bodyHandle === 'number'
        || (Array.isArray(sel.ids) && sel.ids.length > 0)) return 'body';
    return 'none';
  }, [sel]);

  // Resolve the active body handle regardless of which kind of selection
  // it lives under (face / edge embed it as `bodyHandle`; body selections
  // also carry the handle in `ids[0]`).
  const bodyHandle = useMemo(() => {
    if (!sel) return null;
    if (typeof sel.bodyHandle === 'number') return sel.bodyHandle;
    if (Array.isArray(sel.ids) && typeof sel.ids[0] === 'number') return sel.ids[0];
    return null;
  }, [sel]);

  const body = useMemo(() => findBody(bodyHandle), [bodyHandle]);

  // The three readers fire every time the panel re-renders. Caching is
  // pointless — `inferFeature` / `edgeSegments` / `massProps` are cheap on
  // typical e2e geometries and the user explicitly wants live values.
  const faceProps = useMemo(
    () => (mode === 'face') ? readFaceProps(bodyHandle, sel?.faceId) : null,
    [mode, bodyHandle, sel?.faceId, sel],
  );
  const edgeProps = useMemo(
    () => (mode === 'edge') ? readEdgeProps(bodyHandle, sel?.edgeId) : null,
    [mode, bodyHandle, sel?.edgeId, sel],
  );
  const bodyProps = useMemo(
    () => (mode === 'body') ? readBodyProps(bodyHandle) : null,
    [mode, bodyHandle, sel],
  );

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-entityprops-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', gap: 8 }}>
        <strong>Entity Properties</strong>
        <span data-testid="forge-entityprops-mode"
              style={{
                fontFamily: 'var(--forge-mono)', fontSize: 10,
                padding: '2px 6px',
                background: 'var(--forge-canvas)',
                border: '1px solid var(--forge-rail-edge)',
                borderRadius: 3,
                color: 'var(--forge-ink-mute)',
                textTransform: 'uppercase',
              }}>
          {mode === 'face' ? 'Face'
            : mode === 'edge' ? 'Edge'
            : mode === 'body' ? 'Body'
            : 'None'}
        </span>
        <button onClick={onClose}
                data-testid="forge-entityprops-close"
                style={closeBtn}>×</button>
      </header>

      <div data-testid="forge-entityprops-body"
           style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}>
        Body: <strong>{bodyLabel(body, bodyHandle)}</strong>
      </div>

      {mode === 'none' && (
        <div data-testid="forge-entityprops-empty"
             style={{ color: 'var(--forge-ink-mute)' }}>
          Select a face, edge, or body to see its real engineering properties.
        </div>
      )}

      {mode === 'face' && (
        <section data-testid="forge-entityprops-face" style={rowStyle}>
          {faceProps?.error ? (
            <>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Error</div>
              <div data-row="error" data-testid="forge-entityprops-face-error"
                   style={{ color: 'var(--forge-bad, #ff6363)' }}>
                {faceProps.error}
              </div>
            </>
          ) : (
            <>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Face ID</div>
              <div data-row="face-id" data-testid="forge-entityprops-face-id">
                {sel?.faceId ?? '—'}
              </div>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Type</div>
              <div data-row="type" data-testid="forge-entityprops-face-type">
                {faceProps?.label || faceProps?.kind || '—'}
              </div>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Area</div>
              <div data-row="area"
                   data-testid="forge-entityprops-face-area"
                   data-area-mm2={faceProps?.area ?? 0}>
                {fmt(faceProps?.area)} mm²
              </div>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Centroid</div>
              <div data-row="centroid"
                   data-testid="forge-entityprops-face-centroid">
                {fmtVec(faceProps?.centroid)}
              </div>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Normal</div>
              <div data-row="normal"
                   data-testid="forge-entityprops-face-normal">
                {fmtVec(faceProps?.normal, 4)}
              </div>
              {faceProps && Number.isFinite(faceProps.radius) && faceProps.radius > 0 && (
                <>
                  <div style={{ color: 'var(--forge-ink-mute)' }}>Radius</div>
                  <div data-row="radius"
                       data-testid="forge-entityprops-face-radius">
                    {fmt(faceProps.radius)} mm
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}

      {mode === 'edge' && (
        <section data-testid="forge-entityprops-edge" style={rowStyle}>
          {edgeProps?.error ? (
            <>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Error</div>
              <div data-row="error" data-testid="forge-entityprops-edge-error"
                   style={{ color: 'var(--forge-bad, #ff6363)' }}>
                {edgeProps.error}
              </div>
            </>
          ) : (
            <>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Edge ID</div>
              <div data-row="edge-id" data-testid="forge-entityprops-edge-id">
                {sel?.edgeId ?? '—'}
              </div>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Length</div>
              <div data-row="length"
                   data-testid="forge-entityprops-edge-length"
                   data-length-mm={edgeProps?.length ?? 0}>
                {fmt(edgeProps?.length)} mm
              </div>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Start</div>
              <div data-row="start"
                   data-testid="forge-entityprops-edge-start">
                {fmtVec(edgeProps?.first)}
              </div>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Midpoint</div>
              <div data-row="mid"
                   data-testid="forge-entityprops-edge-mid">
                {fmtVec(edgeProps?.mid)}
              </div>
              <div style={{ color: 'var(--forge-ink-mute)' }}>End</div>
              <div data-row="end"
                   data-testid="forge-entityprops-edge-end">
                {fmtVec(edgeProps?.last)}
              </div>
            </>
          )}
        </section>
      )}

      {mode === 'body' && (
        <section data-testid="forge-entityprops-body-rows" style={rowStyle}>
          {bodyProps?.error ? (
            <>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Error</div>
              <div data-row="error"
                   data-testid="forge-entityprops-body-error"
                   style={{ color: 'var(--forge-bad, #ff6363)' }}>
                {bodyProps.error}
              </div>
            </>
          ) : (
            <>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Volume</div>
              <div data-row="volume"
                   data-testid="forge-entityprops-body-volume"
                   data-volume-mm3={bodyProps?.volume ?? 0}>
                {fmt(bodyProps?.volume)} mm³
              </div>
              <div style={{ color: 'var(--forge-ink-mute)' }}>Area</div>
              <div data-row="area"
                   data-testid="forge-entityprops-body-area">
                {fmt(bodyProps?.area)} mm²
              </div>
              <div style={{ color: 'var(--forge-ink-mute)' }}>COM</div>
              <div data-row="com"
                   data-testid="forge-entityprops-body-com">
                {fmtVec(bodyProps?.centerOfMass)}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ────────────── host ──────────────

export function EntityPropsHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Imperative entry points so other surfaces (Archie, plugins) can
    // toggle the panel without round-tripping through the menu bus.
    window.__forgeOpenEntityProps  = () => setOpen(true);
    window.__forgeCloseEntityProps = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.entityProps') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <EntityPropsPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default EntityPropsPanel;
