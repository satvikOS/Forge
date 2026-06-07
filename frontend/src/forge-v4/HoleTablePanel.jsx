// PUSH-135 (Slice-100) — Hole table auto-from-features for drawings.
//
// Drives window.forge.direct.edgeSegments(handle, 0.1) — the existing
// PUSH-31 tessellated-edge surface (preload.js:1314) — to detect every
// circular edge on a picked body, group co-axial pairs by (centre Z,
// diameter), and emit an ASME-style hole table:
//
//      Tag │  X  │  Y  │  Ø  │ Qty
//      ─────┼─────┼─────┼─────┼─────
//        A │ 10  │ 20  │ 6.0 │  2
//        B │ 30  │ 15  │ 8.0 │  1
//        …
//
// Each tag (A, B, C, …) is a unique hole class — a circle of diameter Ø
// appearing Qty times at distinct (x, y) positions across all faces.
// The position written into the table is the projected (x, y) of the
// representative top-most circle.
//
// The detector treats a "circle" as a closed tessellated polyline whose
// vertices are within ±5 % of the same radius from their centroid AND
// share a Z value to within 0.1 mm. We use a 0.1 mm deflection
// argument to edgeSegments (PUSH-135 spec) — finer than the PUSH-98
// drilling pattern panel's 0.05 since hole-table detection only needs
// to count circles, not feed cycle G-code.
//
// Co-axial circles (same X/Y, different Z) are grouped per-tag so the
// table reflects one row per unique hole class, not one row per
// tessellated curve. That matches the ASME Y14.5 convention.
//
// SVG annotation preview renders a top-down projection of every
// detected hole with its tag label, so the drafter can sanity-check
// before stamping the table on the drawing sheet.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

export const FORGE_HOLE_TABLE_EVENT = 'forge:hole-table-built';

const DEFAULT_DEFLECTION = 0.1;
const MIN_RADIUS_MM      = 0.5;     // < 1 mm Ø rejected as noise
const RADIUS_TOL_PCT     = 0.06;    // ±6 % radius variance for "circle"
const Z_TOL_MM           = 0.15;    // co-planar tolerance
const CLOSE_DIST_MM      = 0.5;     // polyline endpoint snap
const XY_GROUP_TOL_MM    = 0.5;     // same-axis hole tolerance
const DIA_GROUP_TOL_MM   = 0.25;    // same-class diameter tolerance
const MIN_SAMPLES        = 8;

function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
}

function defaultBody() {
  const nb = readNativeBodies();
  return nb.length ? nb[nb.length - 1] : null;
}

// ── Geometry helpers ────────────────────────────────────────────────
//
// edgeSegments() returns either a Float64Array / number[] of 6-tuples
// (start.x, start.y, start.z, end.x, end.y, end.z) OR an
// { edges:[{ points:Float32Array,... }] } envelope on newer kernels.
// We accept both shapes here just like the PUSH-98 drilling-pattern
// detector does. Returns an array of [x,y,z] polylines.
function clusterToPolylines(raw) {
  if (raw && Array.isArray(raw.edges)) {
    const out = [];
    for (const e of raw.edges) {
      const pts = [];
      const arr = e.points || e.vertices || e.coords || [];
      for (let i = 0; i + 2 < arr.length; i += 3) {
        pts.push([arr[i], arr[i + 1], arr[i + 2]]);
      }
      if (pts.length > 0) out.push(pts);
    }
    return out;
  }
  const flat = ArrayBuffer.isView(raw) ? Array.from(raw)
              : Array.isArray(raw)     ? raw : [];
  const segs = [];
  for (let i = 0; i + 5 < flat.length; i += 6) {
    segs.push([
      [flat[i],     flat[i + 1], flat[i + 2]],
      [flat[i + 3], flat[i + 4], flat[i + 5]],
    ]);
  }
  const used = new Array(segs.length).fill(false);
  const polylines = [];
  const eq = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-3;
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain = [segs[i][0], segs[i][1]];
    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const head = chain[0];
        const tail = chain[chain.length - 1];
        if      (eq(tail, segs[j][0])) { chain.push(segs[j][1]);     used[j] = true; extended = true; }
        else if (eq(tail, segs[j][1])) { chain.push(segs[j][0]);     used[j] = true; extended = true; }
        else if (eq(head, segs[j][0])) { chain.unshift(segs[j][1]);  used[j] = true; extended = true; }
        else if (eq(head, segs[j][1])) { chain.unshift(segs[j][0]);  used[j] = true; extended = true; }
      }
    }
    polylines.push(chain);
  }
  return polylines;
}

// Detect circular polylines. A circle here has:
//   * ≥8 samples
//   * closed (first ↔ last vertex within 0.5 mm)
//   * all Z values within 0.15 mm of each other (planar in XY)
//   * radius constant: max |r - rMean| / rMean ≤ 6 %
// Returns [{ x, y, z, diameter }, ...] in world coords.
export function detectCirclesFromEdges(rawSegments) {
  if (!rawSegments) return [];
  const polylines = clusterToPolylines(rawSegments);
  const out = [];
  for (const pts of polylines) {
    if (pts.length < MIN_SAMPLES) continue;
    const zs = pts.map((p) => p[2]);
    const zMin = Math.min(...zs), zMax = Math.max(...zs);
    if (zMax - zMin > Z_TOL_MM) continue;
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > CLOSE_DIST_MM) continue;
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    const radii = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
    const rMean = radii.reduce((s, r) => s + r, 0) / radii.length;
    if (rMean < MIN_RADIUS_MM) continue;
    let rDev = 0;
    for (const r of radii) rDev = Math.max(rDev, Math.abs(r - rMean));
    if (rDev / rMean > RADIUS_TOL_PCT) continue;
    out.push({
      x: +cx.toFixed(3), y: +cy.toFixed(3),
      z: +((zMin + zMax) / 2).toFixed(3),
      diameter: +(rMean * 2).toFixed(3),
    });
  }
  return out;
}

// Group co-axial circles into hole classes. Two circles belong to the
// same hole (and therefore contribute exactly one feature, not two) if
// their XY centres match within XY_GROUP_TOL_MM AND their diameters
// match within DIA_GROUP_TOL_MM — that catches both faces of a single
// thru-hole. After per-hole de-dup, we group all unique holes by Ø
// into ASME hole classes (A, B, C, …) ordered by descending Ø then
// ascending X.
//
// Returns:
//   { rows:[{ tag, x, y, diameter, qty, holes:[{x,y,z,diameter}] }, ...],
//     holes:[{x,y,z,diameter,tag}, ...] }
export function buildHoleTable(circles) {
  if (!Array.isArray(circles) || circles.length === 0) {
    return { rows: [], holes: [] };
  }
  // Step 1 — collapse co-axial duplicates.
  const uniq = [];
  for (const c of circles) {
    const hit = uniq.find((u) =>
      Math.hypot(u.x - c.x, u.y - c.y) <= XY_GROUP_TOL_MM &&
      Math.abs(u.diameter - c.diameter) <= DIA_GROUP_TOL_MM);
    if (hit) {
      // Keep the higher-Z representative (top face is what the drawing
      // typically dimensions from). Track the lowest Z so we can
      // report depth in a future revision.
      if (c.z > hit.z) { hit.z = c.z; hit.x = c.x; hit.y = c.y; }
    } else {
      uniq.push({ ...c });
    }
  }
  // Step 2 — class by diameter (then position for stable ordering).
  const classes = [];
  for (const u of uniq) {
    const cls = classes.find((k) =>
      Math.abs(k.diameter - u.diameter) <= DIA_GROUP_TOL_MM);
    if (cls) {
      cls.holes.push(u);
    } else {
      classes.push({ diameter: u.diameter, holes: [u] });
    }
  }
  // Sort: largest Ø first (typical ASME convention puts thru-bolts
  // before small drill-holes). Tie-break by mean X for determinism.
  classes.sort((a, b) => {
    if (Math.abs(a.diameter - b.diameter) > 1e-3) return b.diameter - a.diameter;
    const ax = a.holes.reduce((s, h) => s + h.x, 0) / a.holes.length;
    const bx = b.holes.reduce((s, h) => s + h.x, 0) / b.holes.length;
    return ax - bx;
  });
  // Step 3 — tag + collapse each class into one row.
  const TAGS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const rows = classes.map((cls, i) => {
    const tag = i < TAGS.length ? TAGS[i] : `Z${i - TAGS.length + 1}`;
    // Sort holes inside the class by x then y for the table layout.
    cls.holes.sort((a, b) => (a.x - b.x) || (a.y - b.y));
    const rep = cls.holes[0];
    return {
      tag,
      x: rep.x, y: rep.y,
      diameter: +cls.diameter.toFixed(3),
      qty: cls.holes.length,
      holes: cls.holes.slice(),
    };
  });
  // Annotated flat holes — every hole carries the tag of its class so
  // the SVG preview can label each circle.
  const holes = [];
  for (const r of rows) {
    for (const h of r.holes) holes.push({ ...h, tag: r.tag });
  }
  return { rows, holes };
}

// Pure pipeline — read edges, detect, group. Used by the panel's Scan
// button AND by the window helper API so e2e / Archie / plugins can
// drive scanning without React.
export function runHoleTableScan(handle, deflection = DEFAULT_DEFLECTION) {
  const w = typeof window !== 'undefined' ? window : null;
  if (!w || !w.forge || !w.forge.direct || typeof w.forge.direct.edgeSegments !== 'function') {
    return { ok: false, error: 'no-edge-segments-kernel' };
  }
  if (typeof handle !== 'number' || handle <= 0) {
    return { ok: false, error: 'bad-handle' };
  }
  try {
    const raw = w.forge.direct.edgeSegments(handle, deflection);
    const circles = detectCirclesFromEdges(raw);
    const table   = buildHoleTable(circles);
    return { ok: true, deflection, handle,
             circlesRaw: circles.length, ...table };
  } catch (ex) {
    return { ok: false, error: String(ex?.message || ex) };
  }
}

// Window helper API — installed at module load.
if (typeof window !== 'undefined' && !window.__forgeHoleTableHelper) {
  window.__forgeHoleTableHelper = Object.freeze({
    runHoleTableScan,
    detectCirclesFromEdges,
    buildHoleTable,
    readNativeBodies,
    defaultBody,
    DEFAULT_DEFLECTION,
  });
}

// ── Panel ───────────────────────────────────────────────────────────

const PANEL_W = 520;
const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0, bottom: 'var(--forge-statusbar-h, 24px)',
  width: PANEL_W, zIndex: 1330,
  background: 'var(--forge-canvas-2, #181a1f)',
  color: 'var(--forge-ink, #dadde2)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 10px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 6px)',
  fontSize: 12, overflowY: 'auto',
  fontFamily: 'system-ui, sans-serif',
};

const th = { textAlign: 'left', padding: '4px 6px',
             borderBottom: '1px solid #2a2d34', fontWeight: 600,
             fontSize: 11, background: '#0e1014' };
const td = { padding: '3px 6px', borderBottom: '1px solid #20232a',
             fontSize: 11, fontFamily: 'var(--forge-mono, ui-monospace, monospace)' };

export function HoleTablePanel({ open, onClose }) {
  const [body, setBody]         = useState(() => defaultBody());
  const [bodies, setBodies]     = useState(() => readNativeBodies());
  const [deflection, setDef]    = useState(DEFAULT_DEFLECTION);
  const [result, setResult]     = useState(null); // { rows, holes, circlesRaw }
  const [status, setStatus]     = useState('');
  const [error, setError]       = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => {
      const nb = readNativeBodies();
      setBodies(nb);
      setBody((cur) => {
        if (cur && nb.find((b) => b.handle === cur.handle)) return cur;
        return nb.length ? nb[nb.length - 1] : null;
      });
    };
    refresh();
    const onBodies = () => refresh();
    window.addEventListener('forge:bodies-changed', onBodies);
    window.addEventListener('forge:body-added',     onBodies);
    return () => {
      window.removeEventListener('forge:bodies-changed', onBodies);
      window.removeEventListener('forge:body-added',     onBodies);
    };
  }, [open]);

  const scan = useCallback(() => {
    setError(null); setStatus('Scanning…');
    if (!body || typeof body.handle !== 'number') {
      setError('Pick a body first.');
      setStatus(''); setResult(null);
      return;
    }
    const r = runHoleTableScan(body.handle, Number(deflection) || DEFAULT_DEFLECTION);
    if (!r.ok) {
      setError(r.error || 'scan-failed');
      setStatus(''); setResult(null);
      return;
    }
    setResult(r);
    setStatus(`✓ ${r.rows.length} class${r.rows.length === 1 ? '' : 'es'} · ${r.holes.length} hole${r.holes.length === 1 ? '' : 's'} (${r.circlesRaw} circular edge${r.circlesRaw === 1 ? '' : 's'} detected)`);
    if (typeof window !== 'undefined') {
      window.__forgeHoleTable = { handle: body.handle, ...r };
    }
    try {
      window.dispatchEvent(new CustomEvent(FORGE_HOLE_TABLE_EVENT, {
        detail: { ok: true, handle: body.handle, rows: r.rows, holes: r.holes },
      }));
    } catch {}
  }, [body, deflection]);

  // SVG annotation preview — top-down view; auto-fit to detected holes.
  const svg = useMemo(() => {
    if (!result || result.holes.length === 0) return null;
    const xs = result.holes.map((h) => h.x);
    const ys = result.holes.map((h) => h.y);
    const rs = result.holes.map((h) => h.diameter / 2);
    const minX = Math.min(...xs.map((v, i) => v - rs[i])) - 4;
    const maxX = Math.max(...xs.map((v, i) => v + rs[i])) + 4;
    const minY = Math.min(...ys.map((v, i) => v - rs[i])) - 4;
    const maxY = Math.max(...ys.map((v, i) => v + rs[i])) + 4;
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    return { minX, minY, w, h };
  }, [result]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-hole-table-panel"
         data-body-handle={body?.handle ?? ''}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Hole Table <span style={{ opacity: 0.55, fontWeight: 400 }}>
          · PUSH-135 · ASME Y14.5
        </span></strong>
        <button onClick={onClose}
                data-testid="forge-hole-table-close"
                aria-label="Close hole table"
                style={{ background: 'transparent', color: 'inherit',
                         border: '1px solid #2a2d34', cursor: 'pointer',
                         padding: '2px 8px', borderRadius: 3, fontSize: 14 }}>
          ×
        </button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute, #8a8f99)', lineHeight: 1.4 }}>
        Picks every circular edge on a body via
        <code style={{ margin: '0 4px' }}>forge.direct.edgeSegments(handle, {deflection})</code>
        and groups co-axial pairs into one ASME hole class per Ø.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, alignItems: 'center' }}>
        <label>Body</label>
        <select data-testid="forge-hole-table-body"
                value={body?.handle ?? ''}
                onChange={(e) => {
                  const h = Number(e.target.value);
                  setBody(bodies.find((b) => b.handle === h) || null);
                }}
                style={{ background: '#0e1014', color: 'inherit',
                         border: '1px solid #2a2d34', borderRadius: 4,
                         padding: '3px 4px' }}>
          <option value="">— pick a body —</option>
          {bodies.map((b) => (
            <option key={b.id || b.handle} value={b.handle}>
              {b.name || `handle ${b.handle}`}{b.toolId ? ` · ${b.toolId}` : ''}
            </option>
          ))}
        </select>

        <label>Deflection</label>
        <input type="number" min="0.01" step="0.05" value={deflection}
               data-testid="forge-hole-table-deflection"
               onChange={(e) => setDef(Math.max(0.01, Number(e.target.value) || DEFAULT_DEFLECTION))}
               style={{ background: '#0e1014', color: 'inherit',
                        border: '1px solid #2a2d34', borderRadius: 4,
                        padding: '3px 4px' }} />
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={scan}
                data-testid="forge-hole-table-scan"
                disabled={!body}
                style={{ flex: 1, background: body ? '#2c4d2a' : '#1a1c20',
                         color: '#dfeedd',
                         border: '1px solid #3a6738', borderRadius: 4,
                         padding: '6px 12px',
                         cursor: body ? 'pointer' : 'not-allowed',
                         fontWeight: 600 }}>
          Scan body
        </button>
        <button onClick={() => { setResult(null); setStatus(''); setError(null); }}
                data-testid="forge-hole-table-clear"
                style={{ background: '#3a2c34', color: 'inherit',
                         border: '1px solid #683a4d', borderRadius: 4,
                         padding: '6px 10px', cursor: 'pointer' }}>
          Clear
        </button>
      </div>

      {status && (
        <div data-testid="forge-hole-table-status"
             style={{ color: 'var(--forge-ink-mute, #8a8f99)',
                      fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
          {status}
        </div>
      )}

      {error && (
        <div data-testid="forge-hole-table-error"
             style={{ padding: 6, background: '#3a1f1f', color: '#f1c4c4',
                      border: '1px solid #6d3434', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {result && result.rows.length > 0 && (
        <>
          <table data-testid="forge-hole-table-rows"
                 style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
            <thead>
              <tr>
                <th style={th}>Tag</th>
                <th style={th}>X</th>
                <th style={th}>Y</th>
                <th style={th}>Ø</th>
                <th style={th}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.tag} data-testid={`forge-hole-table-row-${r.tag}`}>
                  <td style={{ ...td, fontWeight: 700 }}>{r.tag}</td>
                  <td style={td} data-testid={`forge-hole-table-row-${r.tag}-x`}>
                    {r.x.toFixed(2)}
                  </td>
                  <td style={td} data-testid={`forge-hole-table-row-${r.tag}-y`}>
                    {r.y.toFixed(2)}
                  </td>
                  <td style={td} data-testid={`forge-hole-table-row-${r.tag}-d`}>
                    Ø{r.diameter.toFixed(2)}
                  </td>
                  <td style={td} data-testid={`forge-hole-table-row-${r.tag}-qty`}>
                    {r.qty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {svg && (
            <div data-testid="forge-hole-table-preview"
                 style={{ marginTop: 8, background: '#0e1014',
                          border: '1px solid #2a2d34', borderRadius: 4,
                          padding: 6 }}>
              <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4 }}>
                Annotation preview · top-down · mm
              </div>
              <svg viewBox={`${svg.minX} ${svg.minY} ${svg.w} ${svg.h}`}
                   width="100%" height="220"
                   data-testid="forge-hole-table-svg"
                   style={{ background: '#161a20',
                            border: '1px solid #2a2d34', borderRadius: 3 }}>
                {/* Crosshair grid centred on origin */}
                <line x1={svg.minX} y1={0} x2={svg.minX + svg.w} y2={0}
                      stroke="#2a2d34" strokeWidth={svg.w / 600} />
                <line x1={0} y1={svg.minY} x2={0} y2={svg.minY + svg.h}
                      stroke="#2a2d34" strokeWidth={svg.h / 600} />
                {result.holes.map((h, i) => {
                  const r = h.diameter / 2;
                  const labelOff = Math.max(r * 1.2, svg.w / 30);
                  return (
                    <g key={i} data-testid={`forge-hole-table-mark-${h.tag}-${i}`}>
                      <circle cx={h.x} cy={-h.y} r={r}
                              fill="none" stroke="#5fb86a"
                              strokeWidth={Math.max(svg.w, svg.h) / 240} />
                      <line x1={h.x - r * 1.1} y1={-h.y}
                            x2={h.x + r * 1.1} y2={-h.y}
                            stroke="#5fb86a"
                            strokeWidth={Math.max(svg.w, svg.h) / 600} />
                      <line x1={h.x} y1={-h.y - r * 1.1}
                            x2={h.x} y2={-h.y + r * 1.1}
                            stroke="#5fb86a"
                            strokeWidth={Math.max(svg.w, svg.h) / 600} />
                      <text x={h.x + labelOff} y={-h.y - labelOff * 0.3}
                            fontSize={Math.max(svg.w, svg.h) / 18}
                            fill="#dadde2"
                            fontFamily="var(--forge-mono, ui-monospace, monospace)">
                        {h.tag}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </>
      )}

      {result && result.rows.length === 0 && !error && (
        <div data-testid="forge-hole-table-empty"
             style={{ padding: 8, opacity: 0.7, fontStyle: 'italic' }}>
          No circular edges detected at deflection {deflection}.
          Try a body with through-holes, or tighten the deflection.
        </div>
      )}
    </div>
  );
}

export function HoleTablePanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenHoleTable  = (b) => setOpen(b === undefined ? true : !!b);
    window.__forgeCloseHoleTable = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.holeTable') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      delete window.__forgeOpenHoleTable;
      delete window.__forgeCloseHoleTable;
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <HoleTablePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default HoleTablePanel;
