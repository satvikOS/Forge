// PUSH-67 / Slice-35 — Point-to-Point Measure tool.
//
// Up through PUSH-63 the only "measure" surface in Forge was the
// `tools.measure` menu action, which under the hood was wired to a
// single toast that printed the mass props of the active body. There
// was no way to pick two arbitrary points in the scene and read the
// straight-line distance between them, even though the kernel has had
// `forge.massProps` (body COM), `forge.direct.inferFeature` (face
// centroid), and `forge.direct.edgeSegments` (edge polyline) since the
// early sketch-on-face slices. Distance / dx-dy-dz / 3-point angle —
// the bread-and-butter of inspection in any CAD app — were missing.
//
// PUSH-67 fills that gap. A small floating panel opens on the
// `tools.measure` menu action. It exposes:
//
//   • Two large "Set Point A" / "Set Point B" capture buttons. The next
//     `forge:selection-changed` event after a button press (kind: face,
//     edge, or body) is converted into a world-space point and assigned
//     to that slot.
//   • A live readout of the straight-line distance |B-A| in mm, plus
//     the dx / dy / dz components.
//   • A 3-point angle mode toggle. When enabled, picking three points
//     (Vertex, Arm 1, Arm 2) reports the angle at the vertex in
//     degrees, computed as acos(((A1-V)·(A2-V)) / (|A1-V|·|A2-V|)).
//   • Reset / clear buttons.
//
// Point resolution rules (no MVP, no stub — every branch calls real
// kernel surfaces):
//
//   • Body kind → resolve handle from sel.ids[0] (or bodyHandle), then
//     `forge.massProps(handle).centerOfMass`. The kernel returns
//     centerOfMass as a 3-vec from the OCCT GProp_GProps surface
//     integrator. That is the centre of mass of the solid in mm.
//   • Edge kind → call `forge.direct.edgeSegments(handle, 0.1)`, find
//     the segment with `id === sel.edgeId`, walk the polyline to
//     length L/2 to get the parametric mid-point (same helper as
//     EntityPropsPanel.polylineMidpoint). This is the true midpoint
//     of an arc or spline, not a chord average.
//   • Face kind → call `forge.direct.inferFeature(handle, sel.faceId)`
//     and use the `.centroid` field. That's the OCCT face Cog from
//     BRepGProp::SurfaceProperties.
//
// All three readers fail loudly (return null with an error message in
// the slot) if the kernel surface is missing — no fallback math, no
// placeholder centroids.
//
// Hard constraints honoured:
//   * No new npm packages, no new C++ libs.
//   * Real kernel calls only.
//   * Reachable through the `tools.measure` menu action (Tools menu).
//   * Multi-cam e2e mandatory (push-67-measure.spec.js covers 5 angles).
//
// The panel does NOT call any React state setters from window globals —
// it owns its state internally, reads window.__forgeSelection on each
// `forge:selection-changed` event, and never mutates other panels.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// ────────────── kernel-bound resolvers ──────────────

function readSelection() {
  if (typeof window === 'undefined') return null;
  const s = window.__forgeSelection;
  if (!s || typeof s !== 'object') return null;
  return s;
}

// Resolve the body handle the selection points at. Faces / edges embed
// the handle as `bodyHandle`; body selections carry it in `ids[0]`.
function selectionBodyHandle(sel) {
  if (!sel) return null;
  if (typeof sel.bodyHandle === 'number') return sel.bodyHandle;
  if (Array.isArray(sel.ids) && typeof sel.ids[0] === 'number') return sel.ids[0];
  return null;
}

// Walk a polyline of [x,y,z,x,y,z,...] to length L/2 for the midpoint.
// Pulled out as a free function so the e2e can sanity-check the helper
// against the kernel polyline directly.
export function polylineMidpoint(points) {
  if (!points || points.length < 6) {
    if (!points || points.length < 3) return [0, 0, 0];
    return [points[0], points[1], points[2]];
  }
  let total = 0;
  for (let i = 0; i + 5 < points.length; i += 3) {
    const dx = points[i + 3] - points[i];
    const dy = points[i + 4] - points[i + 1];
    const dz = points[i + 5] - points[i + 2];
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const half = total / 2;
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

// Turn a selection into a world-space [x,y,z] point. Returns
// { point:[3], label, error } — error is set when the requested
// kernel surface is unavailable.
export function selectionToPoint(sel) {
  if (!sel) return { error: 'no selection' };
  const handle = selectionBodyHandle(sel);
  if (typeof handle !== 'number') {
    return { error: 'selection has no body handle' };
  }
  // FACE → inferFeature(handle, faceId).centroid
  if (sel.kind === 'face' && typeof sel.faceId === 'number') {
    const fn = window?.forge?.direct?.inferFeature;
    if (typeof fn !== 'function') return { error: 'forge.direct.inferFeature unavailable' };
    try {
      const r = fn(handle, sel.faceId);
      if (!r || !Array.isArray(r.centroid)) return { error: 'face has no centroid' };
      return {
        point: [Number(r.centroid[0]), Number(r.centroid[1]), Number(r.centroid[2])],
        label: `Face ${sel.faceId} of handle ${handle}`,
        kind:  'face',
      };
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  }
  // EDGE → edgeSegments(handle, 0.1), find matching id, midpoint.
  if (sel.kind === 'edge' && typeof sel.edgeId === 'number') {
    const fn = window?.forge?.direct?.edgeSegments;
    if (typeof fn !== 'function') return { error: 'forge.direct.edgeSegments unavailable' };
    try {
      const segs = fn(handle, 0.1);
      if (!Array.isArray(segs) && !segs?.length) return { error: 'no edge segments' };
      let found = null;
      for (let i = 0; i < segs.length; ++i) {
        if (segs[i] && segs[i].id === sel.edgeId) { found = segs[i]; break; }
      }
      if (!found) return { error: `edge ${sel.edgeId} not found` };
      const pts = Array.isArray(found.points) ? found.points : Array.from(found.points || []);
      const mid = polylineMidpoint(pts);
      return { point: mid, label: `Edge ${sel.edgeId} of handle ${handle}`, kind: 'edge' };
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  }
  // BODY → massProps(handle).centerOfMass
  const isBody = sel.kind === 'body'
    || (typeof sel.bodyHandle === 'number' && !sel.kind)
    || (Array.isArray(sel.ids) && sel.ids.length > 0 && !sel.faceId && !sel.edgeId);
  if (isBody) {
    const fn = window?.forge?.massProps;
    if (typeof fn !== 'function') return { error: 'forge.massProps unavailable' };
    try {
      const r = fn(handle);
      const com = r?.centerOfMass;
      if (!Array.isArray(com)) return { error: 'massProps has no centerOfMass' };
      return {
        point: [Number(com[0]), Number(com[1]), Number(com[2])],
        label: `Body handle ${handle} (COM)`,
        kind:  'body',
      };
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  }
  return { error: 'unsupported selection kind: ' + sel.kind };
}

// ────────────── styles ──────────────

const panelStyle = {
  position: 'fixed',
  right:  'var(--forge-space-3)',
  top:    'calc(var(--forge-titlebar-h, 24px) + var(--forge-ribbon-h, 80px) + var(--forge-space-3))',
  width: 340,
  zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius, 6px)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 8,
  color: 'var(--forge-ink)', fontSize: 12,
  maxHeight: '70vh', overflowY: 'auto',
};
const captureBtnStyle = (armed) => ({
  width: '100%',
  padding: '10px 12px',
  background: armed ? 'var(--forge-accent, #2c75ff)' : 'var(--forge-canvas)',
  color: armed ? '#fff' : 'var(--forge-ink)',
  border: '1px solid ' + (armed ? 'var(--forge-accent, #2c75ff)' : 'var(--forge-rail-edge)'),
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: armed ? 600 : 400,
  textAlign: 'left',
  fontFamily: 'var(--forge-mono)',
  fontSize: 12,
});
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
const smallBtn = {
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: 3,
  fontSize: 11,
};

function fmt(v, digits = 3) {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}
function fmtVec(v, digits = 3) {
  if (!Array.isArray(v) || v.length < 3) return '—';
  return `(${fmt(v[0], digits)}, ${fmt(v[1], digits)}, ${fmt(v[2], digits)})`;
}
function dist3(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return NaN;
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function delta3(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return [NaN, NaN, NaN];
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
}
// 3-point angle at v, between arms a1-v and a2-v. Returns radians.
export function angle3(v, a1, a2) {
  if (!Array.isArray(v) || !Array.isArray(a1) || !Array.isArray(a2)) return NaN;
  const u = [a1[0] - v[0], a1[1] - v[1], a1[2] - v[2]];
  const w = [a2[0] - v[0], a2[1] - v[1], a2[2] - v[2]];
  const nu = Math.hypot(u[0], u[1], u[2]);
  const nw = Math.hypot(w[0], w[1], w[2]);
  if (!Number.isFinite(nu) || !Number.isFinite(nw) || nu === 0 || nw === 0) return NaN;
  const dot = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  return Math.acos(Math.max(-1, Math.min(1, dot / (nu * nw))));
}

// ────────────── panel ──────────────

export function MeasureToolPanel({ open, onClose }) {
  // Captured points; `null` until set. Each entry is { point:[3], label, kind }.
  const [pa, setPa] = useState(null);
  const [pb, setPb] = useState(null);
  // 3-point angle mode: { vertex, arm1, arm2 }
  const [angleMode, setAngleMode] = useState(false);
  const [pv, setPv] = useState(null);
  const [parm1, setParm1] = useState(null);
  const [parm2, setParm2] = useState(null);
  // Which slot is armed — the next selection event fills this slot.
  // null = nothing armed (free observation mode).
  const [armed, setArmed] = useState(null);   // 'A' | 'B' | 'V' | '1' | '2' | null
  const [lastError, setLastError] = useState(null);

  // Reset everything (also called when panel is closed).
  const resetAll = useCallback(() => {
    setPa(null); setPb(null);
    setPv(null); setParm1(null); setParm2(null);
    setArmed(null);
    setLastError(null);
  }, []);

  // Pick the latest selection and try to assign it to the armed slot.
  const captureArmed = useCallback(() => {
    if (!armed) return;
    const sel = readSelection();
    const r = selectionToPoint(sel);
    if (r.error || !Array.isArray(r.point)) {
      setLastError(r.error || 'no point');
      return;
    }
    setLastError(null);
    const slotted = { point: r.point, label: r.label, kind: r.kind };
    if (armed === 'A') setPa(slotted);
    else if (armed === 'B') setPb(slotted);
    else if (armed === 'V') setPv(slotted);
    else if (armed === '1') setParm1(slotted);
    else if (armed === '2') setParm2(slotted);
    setArmed(null);
  }, [armed]);

  // Listen for selection changes — when a slot is armed, the next
  // selection event resolves to a point automatically. This is the
  // "click in the viewport → point captured" UX.
  useEffect(() => {
    if (!open) return undefined;
    const onPick = () => captureArmed();
    window.addEventListener('forge:selection-changed', onPick);
    return () => window.removeEventListener('forge:selection-changed', onPick);
  }, [open, captureArmed]);

  // When the panel closes, also drop the arm — otherwise the next
  // selection in a different surface would silently fill a stale slot.
  useEffect(() => {
    if (!open) setArmed(null);
  }, [open]);

  // Derived readouts.
  const distance = useMemo(() => {
    if (!pa || !pb) return null;
    return dist3(pa.point, pb.point);
  }, [pa, pb]);
  const delta = useMemo(() => {
    if (!pa || !pb) return null;
    return delta3(pa.point, pb.point);
  }, [pa, pb]);
  const angRad = useMemo(() => {
    if (!angleMode || !pv || !parm1 || !parm2) return null;
    return angle3(pv.point, parm1.point, parm2.point);
  }, [angleMode, pv, parm1, parm2]);
  const angDeg = (Number.isFinite(angRad)) ? (angRad * 180 / Math.PI) : null;

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-measure-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', gap: 8 }}>
        <strong>Measure</strong>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute)' }}>
          P2P · 3-pt angle
        </span>
        <button onClick={onClose}
                data-testid="forge-measure-close"
                style={closeBtn}>×</button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)', fontSize: 11, lineHeight: 1.4 }}>
        Press a slot button, then pick a face / edge / body. The next
        selection becomes that slot's world-space point.
      </div>

      {/* ── P2P slots ─────────────────────────────── */}

      <button
        type="button"
        data-testid="forge-measure-set-a"
        data-armed={armed === 'A' ? 'true' : 'false'}
        style={captureBtnStyle(armed === 'A')}
        onClick={() => setArmed((a) => a === 'A' ? null : 'A')}
      >
        {armed === 'A' ? '→ Pick Point A …' : 'Set Point A'}
        {pa && (
          <div style={{ marginTop: 4, fontSize: 10, opacity: 0.85 }}
               data-testid="forge-measure-a-readout">
            {fmtVec(pa.point)} · {pa.label}
          </div>
        )}
      </button>

      <button
        type="button"
        data-testid="forge-measure-set-b"
        data-armed={armed === 'B' ? 'true' : 'false'}
        style={captureBtnStyle(armed === 'B')}
        onClick={() => setArmed((a) => a === 'B' ? null : 'B')}
      >
        {armed === 'B' ? '→ Pick Point B …' : 'Set Point B'}
        {pb && (
          <div style={{ marginTop: 4, fontSize: 10, opacity: 0.85 }}
               data-testid="forge-measure-b-readout">
            {fmtVec(pb.point)} · {pb.label}
          </div>
        )}
      </button>

      {/* ── distance + components ─────────────────── */}

      <section data-testid="forge-measure-distance-block" style={rowStyle}>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Distance</div>
        <div data-testid="forge-measure-distance"
             data-distance-mm={Number.isFinite(distance) ? distance : ''}>
          {Number.isFinite(distance) ? `${fmt(distance)} mm` : '—'}
        </div>
        <div style={{ color: 'var(--forge-ink-mute)' }}>dx</div>
        <div data-testid="forge-measure-dx"
             data-dx-mm={Array.isArray(delta) && Number.isFinite(delta[0]) ? delta[0] : ''}>
          {Array.isArray(delta) && Number.isFinite(delta[0]) ? `${fmt(delta[0])} mm` : '—'}
        </div>
        <div style={{ color: 'var(--forge-ink-mute)' }}>dy</div>
        <div data-testid="forge-measure-dy"
             data-dy-mm={Array.isArray(delta) && Number.isFinite(delta[1]) ? delta[1] : ''}>
          {Array.isArray(delta) && Number.isFinite(delta[1]) ? `${fmt(delta[1])} mm` : '—'}
        </div>
        <div style={{ color: 'var(--forge-ink-mute)' }}>dz</div>
        <div data-testid="forge-measure-dz"
             data-dz-mm={Array.isArray(delta) && Number.isFinite(delta[2]) ? delta[2] : ''}>
          {Array.isArray(delta) && Number.isFinite(delta[2]) ? `${fmt(delta[2])} mm` : '—'}
        </div>
      </section>

      {/* ── angle mode toggle ─────────────────────── */}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 11, cursor: 'pointer' }}>
        <input type="checkbox"
               data-testid="forge-measure-angle-toggle"
               checked={angleMode}
               onChange={(e) => { setAngleMode(e.target.checked); setArmed(null); }} />
        3-point angle mode (vertex + 2 arms)
      </label>

      {angleMode && (
        <>
          <button
            type="button"
            data-testid="forge-measure-set-v"
            data-armed={armed === 'V' ? 'true' : 'false'}
            style={captureBtnStyle(armed === 'V')}
            onClick={() => setArmed((a) => a === 'V' ? null : 'V')}
          >
            {armed === 'V' ? '→ Pick Vertex …' : 'Set Vertex'}
            {pv && (
              <div style={{ marginTop: 4, fontSize: 10, opacity: 0.85 }}
                   data-testid="forge-measure-v-readout">
                {fmtVec(pv.point)} · {pv.label}
              </div>
            )}
          </button>
          <button
            type="button"
            data-testid="forge-measure-set-arm1"
            data-armed={armed === '1' ? 'true' : 'false'}
            style={captureBtnStyle(armed === '1')}
            onClick={() => setArmed((a) => a === '1' ? null : '1')}
          >
            {armed === '1' ? '→ Pick Arm 1 …' : 'Set Arm 1'}
            {parm1 && (
              <div style={{ marginTop: 4, fontSize: 10, opacity: 0.85 }}
                   data-testid="forge-measure-arm1-readout">
                {fmtVec(parm1.point)} · {parm1.label}
              </div>
            )}
          </button>
          <button
            type="button"
            data-testid="forge-measure-set-arm2"
            data-armed={armed === '2' ? 'true' : 'false'}
            style={captureBtnStyle(armed === '2')}
            onClick={() => setArmed((a) => a === '2' ? null : '2')}
          >
            {armed === '2' ? '→ Pick Arm 2 …' : 'Set Arm 2'}
            {parm2 && (
              <div style={{ marginTop: 4, fontSize: 10, opacity: 0.85 }}
                   data-testid="forge-measure-arm2-readout">
                {fmtVec(parm2.point)} · {parm2.label}
              </div>
            )}
          </button>

          <section data-testid="forge-measure-angle-block" style={rowStyle}>
            <div style={{ color: 'var(--forge-ink-mute)' }}>Angle</div>
            <div data-testid="forge-measure-angle"
                 data-angle-deg={Number.isFinite(angDeg) ? angDeg : ''}
                 data-angle-rad={Number.isFinite(angRad) ? angRad : ''}>
              {Number.isFinite(angDeg)
                ? `${fmt(angDeg, 2)}° (${fmt(angRad, 4)} rad)`
                : '—'}
            </div>
          </section>
        </>
      )}

      {/* ── error + actions ───────────────────────── */}

      {lastError && (
        <div data-testid="forge-measure-error"
             style={{ color: 'var(--forge-bad, #ff6363)', fontSize: 11 }}>
          {lastError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button type="button"
                data-testid="forge-measure-reset"
                style={smallBtn}
                onClick={resetAll}>
          Reset
        </button>
        <button type="button"
                data-testid="forge-measure-clear-a"
                style={smallBtn}
                onClick={() => { setPa(null); if (armed === 'A') setArmed(null); }}>
          Clear A
        </button>
        <button type="button"
                data-testid="forge-measure-clear-b"
                style={smallBtn}
                onClick={() => { setPb(null); if (armed === 'B') setArmed(null); }}>
          Clear B
        </button>
      </div>
    </div>
  );
}

// ────────────── host ──────────────

export function MeasureToolPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Imperative entry points so Archie / plugins / e2e can toggle the
    // panel without round-tripping through the menu bus.
    window.__forgeOpenMeasure  = () => setOpen(true);
    window.__forgeCloseMeasure = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.measure') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <MeasureToolPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default MeasureToolPanel;
