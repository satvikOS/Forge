// PUSH-136 (Slice 101 / Auto-dimensioning for drawings).
//
// Drawings consume HLR projections from `forge.drawings.projectView`; a
// real engineering drawing then needs *dimensions* — the width / height
// of the projected bounding box, the diameters of detected circular
// holes, and the key feature distances between hole centres. PUSH-136
// ships exactly that.
//
// Panel UI:
//   * Body picker (native bodies from window.__forgeBodies).
//   * View direction selector (front / top / right / iso).
//   * "Auto-dimension" button — runs the heuristics across all three
//     orthographic views (front, top, right) so the panel can recover
//     the body's full 3D extent (width / height / depth) regardless of
//     which 2D view is currently displayed.
//   * Output table of {kind, value, a, b, view} dimensions:
//       - kind: 'linear'  → bbox width/height/depth distance dim
//       - kind: 'radial'  → detected hole diameter
//   * Inline SVG preview of the primary projected view with dimension
//     annotations overlaid (extension lines + leader text).
//
// The math layer lives inline (one file per the surgical brief) but
// every helper is split into a pure function so the e2e + plugins +
// Archie tool calls can drive it via the helper API attached to
// `window.__forgeAutoDimHelper` without mounting React.
//
// Hard constraints (PUSH-136 brief):
//   * NO new npm packages, NO new C++ libs. Pure JS + the existing
//     window.forge.drawings.projectView surface.
//   * Real impl, no MVP, no stub: every dimension is computed from the
//     actual projected polylines; the SVG is renderable as-is.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).

import React, {
    useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const FORGE_AUTO_DIM_EVENT = 'forge:auto-dim-generated';

// All three orthographic views the panel scans so it can derive the
// full 3D extent regardless of which view the user has selected.
export const ORTHO_VIEWS = Object.freeze(['front', 'top', 'right']);

// Per-view bbox-axis labels in the kernel's projection convention:
//   front (look along -Y) → screen X = world X (width),  screen Y = world Z (depth)
//   top   (look down -Z)  → screen X = world X (width),  screen Y = world Y (height)
//   right (look along -X) → screen X = world Y (height), screen Y = world Z (depth)
// → from any 2 of {front, top, right} we recover width (X), height (Y),
// depth (Z) directly off the bbox spans.
export const VIEW_AXIS_LABELS = Object.freeze({
    front: { width: 'width', height: 'depth'  },
    top:   { width: 'width', height: 'height' },
    right: { width: 'height', height: 'depth' },
});

// Hole-detection tolerance: a polyline is classified as a circle when
// every vertex lies within HOLE_RADIUS_TOL of the centroid distance.
// Tight enough to reject squashed rectangles, loose enough to allow
// the typical 12-segment OCCT tessellation.
export const HOLE_RADIUS_TOL = 0.15;   // 15 % of mean radius
export const HOLE_MIN_VERTS  = 6;      // at least a hexagon
export const HOLE_MIN_RADIUS = 0.5;    // mm

// View directions exposed in the UI.
export const VIEW_DIRS = Object.freeze([
    { id: 'front', label: 'FRONT (-Y)' },
    { id: 'top',   label: 'TOP (+Z)'   },
    { id: 'right', label: 'RIGHT (+X)' },
    { id: 'iso',   label: 'ISO (1,1,1)' },
]);

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — exported so the e2e + plugins + Archie can drive the
// pipeline headlessly via window.__forgeAutoDimHelper.

/**
 * Compute the 2D bbox of an HLR view's visibleEdges. We deliberately
 * trust the kernel's pre-computed bbox when it's finite (the binding
 * fills v.minX..v.maxY off the same polylines we scan) but recompute
 * on the JS side as a defensive measure so a degenerate view object
 * still yields finite extents.
 *
 * @param {{bbox?: {minX, minY, maxX, maxY}, visibleEdges?: Array}} view
 * @returns {{minX, minY, maxX, maxY, width, height}|null}
 */
export function bboxOfView(view) {
    if (!view) return null;
    let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
    const bb = view.bbox;
    if (bb && Number.isFinite(bb.minX) && Number.isFinite(bb.maxX)
           && Number.isFinite(bb.minY) && Number.isFinite(bb.maxY)) {
        minX = bb.minX; minY = bb.minY; maxX = bb.maxX; maxY = bb.maxY;
    } else {
        const edges = Array.isArray(view.visibleEdges) ? view.visibleEdges : [];
        for (const pl of edges) {
            if (!Array.isArray(pl)) continue;
            for (const p of pl) {
                if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
                if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            }
        }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)
       || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
    return {
        minX, minY, maxX, maxY,
        width:  maxX - minX,
        height: maxY - minY,
    };
}

/**
 * Detect circular holes in an HLR view's visibleEdges. Each visible
 * polyline is treated as a candidate circle; we accept it when its
 * vertex spread is consistent with a circle (max deviation from the
 * mean radius < HOLE_RADIUS_TOL × meanRadius) and it has enough
 * vertices to be a real tessellated arc (HOLE_MIN_VERTS).
 *
 * Returns an array of {cx, cy, diameter, radius, edgeIndex}.
 */
export function detectHoles(view) {
    if (!view || !Array.isArray(view.visibleEdges)) return [];
    const out = [];
    for (let i = 0; i < view.visibleEdges.length; i += 1) {
        const pl = view.visibleEdges[i];
        if (!Array.isArray(pl) || pl.length < HOLE_MIN_VERTS) continue;
        // Compute centroid.
        let cx = 0, cy = 0, n = 0;
        for (const p of pl) {
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            cx += p.x; cy += p.y; n += 1;
        }
        if (n < HOLE_MIN_VERTS) continue;
        cx /= n; cy /= n;
        // Compute mean radius + max deviation.
        let rSum = 0, rMax = -Infinity, rMin = +Infinity;
        for (const p of pl) {
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            const dx = p.x - cx, dy = p.y - cy;
            const r = Math.sqrt(dx * dx + dy * dy);
            rSum += r;
            if (r > rMax) rMax = r;
            if (r < rMin) rMin = r;
        }
        const rMean = rSum / n;
        if (!Number.isFinite(rMean) || rMean < HOLE_MIN_RADIUS) continue;
        const dev = Math.max(Math.abs(rMax - rMean), Math.abs(rMin - rMean));
        if (dev / rMean > HOLE_RADIUS_TOL) continue;
        // Reject open polylines: a true tessellated circle has its
        // endpoints close together relative to the radius.
        const first = pl[0], last = pl[pl.length - 1];
        const closeDx = last.x - first.x, closeDy = last.y - first.y;
        const closeDist = Math.sqrt(closeDx * closeDx + closeDy * closeDy);
        if (closeDist / rMean > 0.5) continue;
        out.push({
            cx, cy,
            radius:   rMean,
            diameter: 2 * rMean,
            edgeIndex: i,
        });
    }
    return out;
}

/**
 * Run forge.drawings.projectView for one direction and return the view
 * object. Returns null when the kernel surface is missing or throws.
 */
export function projectOne(handle, direction) {
    const surface = (typeof window !== 'undefined') ? window.forge?.drawings : null;
    if (!surface || typeof surface.projectView !== 'function' || handle == null) return null;
    try { return surface.projectView(handle, direction); }
    catch { return null; }
}

/**
 * Compute the master "auto-dim" pass for a body: project all three
 * orthographic views, then aggregate:
 *   - 1 linear dim per principal axis (width / height / depth) from the
 *     2D bbox of the relevant view,
 *   - 1 radial dim per detected hole on the *selected* view,
 *   - 1 linear dim between adjacent hole centres on the selected view.
 *
 * Output is a deterministic list of {kind, value, a, b, view, label}.
 *   - kind  : 'linear' | 'radial'
 *   - value : the measured value (mm)
 *   - a, b  : drawing-space endpoints (the SVG preview uses these
 *             directly; for radial dims a = centre, b = perimeter point)
 *   - view  : which view the dim originated from
 *   - label : human-readable axis / Ø prefix
 */
export function runAutoDim(handle, primaryView = 'front') {
    if (handle == null) return { ok: false, error: 'no body handle', dims: [], views: {} };
    const views = {};
    for (const v of ORTHO_VIEWS) {
        const view = projectOne(handle, v);
        if (view) views[v] = view;
    }
    // Also project ISO if the user picked it as the primary view — we
    // still derive the linear dims from the ortho views, but the iso
    // projection lets the panel show it as the primary canvas.
    if (primaryView === 'iso') {
        const iso = projectOne(handle, 'iso');
        if (iso) views.iso = iso;
    }
    if (Object.keys(views).length === 0) {
        return { ok: false, error: 'forge.drawings.projectView unavailable', dims: [], views: {} };
    }
    const dims = [];

    // Linear dims: width (X) + height (Y) + depth (Z) derived from
    // any 2 of {front, top, right}. We emit ALL three even when the
    // primary view is "right" — the e2e brief states the auto-dim
    // pass must yield ≥3 dims with width=60, height=40, depth=30 from
    // a 60×40×30 box at the right view, which is exactly the full 3D
    // extent regardless of which ortho is shown.
    const widthVal  = pickWidth(views);
    const heightVal = pickHeight(views);
    const depthVal  = pickDepth(views);

    if (widthVal != null) {
        const bb = bboxOfView(views.front || views.top);
        const yMid = bb ? (bb.minY + bb.maxY) / 2 : 0;
        const x0 = bb ? bb.minX : 0, x1 = bb ? bb.maxX : widthVal;
        dims.push({
            kind: 'linear', axis: 'X', label: 'width',
            value: widthVal,
            a: { x: x0, y: yMid }, b: { x: x1, y: yMid },
            view: views.front ? 'front' : 'top',
        });
    }
    if (heightVal != null) {
        const bb = bboxOfView(views.top || views.right);
        // height = Y axis. On top view it's the screen Y span; on right
        // view it's the screen X span.
        if (views.top) {
            const yMid = bb ? (bb.minY + bb.maxY) / 2 : 0;
            const x0 = bb ? bb.minX : 0, x1 = bb ? bb.maxX : 0;
            void x0; void x1; // unused — y span chosen
            const xMid = bb ? (bb.minX + bb.maxX) / 2 : 0;
            dims.push({
                kind: 'linear', axis: 'Y', label: 'height',
                value: heightVal,
                a: { x: xMid, y: bb ? bb.minY : 0 },
                b: { x: xMid, y: bb ? bb.maxY : heightVal },
                view: 'top',
            });
        } else if (views.right) {
            const yMid = bb ? (bb.minY + bb.maxY) / 2 : 0;
            const x0 = bb ? bb.minX : 0, x1 = bb ? bb.maxX : heightVal;
            dims.push({
                kind: 'linear', axis: 'Y', label: 'height',
                value: heightVal,
                a: { x: x0, y: yMid }, b: { x: x1, y: yMid },
                view: 'right',
            });
        }
    }
    if (depthVal != null) {
        const bb = bboxOfView(views.front || views.right);
        const xMid = bb ? (bb.minX + bb.maxX) / 2 : 0;
        const y0 = bb ? bb.minY : 0, y1 = bb ? bb.maxY : depthVal;
        dims.push({
            kind: 'linear', axis: 'Z', label: 'depth',
            value: depthVal,
            a: { x: xMid, y: y0 }, b: { x: xMid, y: y1 },
            view: views.front ? 'front' : 'right',
        });
    }

    // Radial dims: detect holes on the primary view.
    const primary = views[primaryView] || views.front || views.top || views.right;
    if (primary) {
        const holes = detectHoles(primary);
        for (let i = 0; i < holes.length; i += 1) {
            const h = holes[i];
            dims.push({
                kind: 'radial',
                label: `Ø${h.diameter.toFixed(2)}`,
                value: h.diameter,
                a: { x: h.cx, y: h.cy },
                b: { x: h.cx + h.radius, y: h.cy },
                view: primaryView,
            });
        }
        // Key feature distance: nearest-pair distance between adjacent
        // hole centres on the primary view (only when ≥2 holes were
        // detected — single-hole bodies skip this entirely).
        if (holes.length >= 2) {
            // Sort by X then Y to make the "adjacent" pairing deterministic.
            const sorted = holes.slice().sort((u, v) =>
                (u.cx - v.cx) || (u.cy - v.cy));
            for (let i = 1; i < sorted.length; i += 1) {
                const u = sorted[i - 1], v = sorted[i];
                const dx = v.cx - u.cx, dy = v.cy - u.cy;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (!Number.isFinite(d) || d < 1e-6) continue;
                dims.push({
                    kind: 'linear', axis: 'pitch', label: 'hole-pitch',
                    value: d,
                    a: { x: u.cx, y: u.cy }, b: { x: v.cx, y: v.cy },
                    view: primaryView,
                });
            }
        }
    }

    return { ok: true, dims, views, primaryView };
}

// Helpers used by runAutoDim to pull each principal axis off the most
// reliable available view. The kernel convention:
//   front: width = bbox.X span, depth  = bbox.Y span
//   top  : width = bbox.X span, height = bbox.Y span
//   right: height = bbox.X span, depth = bbox.Y span
function pickWidth(views) {
    const v = views.front || views.top;
    const bb = bboxOfView(v);
    return bb ? bb.width : null;
}
function pickHeight(views) {
    if (views.top)   { const bb = bboxOfView(views.top);   return bb ? bb.height : null; }
    if (views.right) { const bb = bboxOfView(views.right); return bb ? bb.width  : null; }
    return null;
}
function pickDepth(views) {
    if (views.front) { const bb = bboxOfView(views.front); return bb ? bb.height : null; }
    if (views.right) { const bb = bboxOfView(views.right); return bb ? bb.height : null; }
    return null;
}

// ─────────────────────────────────────────────────────────────────────
// Helper API mirror — every contract the e2e + plugins call.

export const AUTO_DIM_HELPERS = Object.freeze({
    bboxOfView,
    detectHoles,
    projectOne,
    runAutoDim,
    ORTHO_VIEWS,
    HOLE_RADIUS_TOL,
    HOLE_MIN_VERTS,
    EVENT_NAME: FORGE_AUTO_DIM_EVENT,
});

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail vocabulary as the rest of the V4 panels.

const PANEL_STYLE = {
    position: 'fixed',
    right: 24,
    top: 96,
    width: 520,
    maxHeight: '82vh',
    background: '#181a1f',
    color: '#dadde2',
    border: '1px solid #2a2d34',
    borderRadius: 10,
    fontSize: 12,
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 6px 22px rgba(0,0,0,0.45)',
    zIndex: 952,
    display: 'flex',
    flexDirection: 'column',
};

const HEADER_STYLE = {
    padding: '8px 12px',
    borderBottom: '1px solid #2a2d34',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
};

const ROW_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0',
};

const BTN_PRIMARY = {
    padding: '6px 10px',
    background: '#2c4d2a',
    color: '#dfeedd',
    border: '1px solid #3a6738',
    borderRadius: 4,
    cursor: 'pointer',
    fontWeight: 600,
};

const BTN_DISABLED = {
    padding: '6px 10px',
    background: '#1a1c20',
    color: '#7a7d84',
    border: '1px solid #2a2d34',
    borderRadius: 4,
    cursor: 'not-allowed',
    fontWeight: 600,
};

// ─────────────────────────────────────────────────────────────────────
// AutoDimPanel — body picker, view direction selector, Auto-dimension
// button, output table, SVG preview.

export function AutoDimPanel({ open, onClose }) {
    const [bodies, setBodies] = useState(() => readBodiesSnapshot());
    const [bodyHandle, setBodyHandle] = useState(null);
    const [dir, setDir] = useState('front');
    const [result, setResult] = useState(null);  // {ok, dims, views, primaryView}
    const [error, setError] = useState(null);
    const [runStamp, setRunStamp] = useState(0);
    const lastDimsRef = useRef([]);

    // Refresh body list whenever the panel opens — picks up bodies seeded
    // after the host effect ran.
    useEffect(() => {
        if (!open) return undefined;
        const refresh = () => setBodies(readBodiesSnapshot());
        refresh();
        if (typeof window === 'undefined') return undefined;
        const onBodyChange = () => refresh();
        window.addEventListener('forge:bodies-changed', onBodyChange);
        window.addEventListener('forge:body-appended', onBodyChange);
        return () => {
            window.removeEventListener('forge:bodies-changed', onBodyChange);
            window.removeEventListener('forge:body-appended', onBodyChange);
        };
    }, [open]);

    // Auto-select the active or last body when the panel opens.
    useEffect(() => {
        if (!open) return;
        if (bodyHandle != null) return;
        if (!bodies.length) return;
        const sel = (typeof window !== 'undefined') ? window.__forgeSelection : null;
        if (sel && typeof sel.bodyHandle === 'number') {
            const match = bodies.find((b) => b.handle === sel.bodyHandle);
            if (match) { setBodyHandle(match.handle); return; }
        }
        setBodyHandle(bodies[bodies.length - 1].handle);
    }, [open, bodies, bodyHandle]);

    const onAutoDim = useCallback(() => {
        if (bodyHandle == null) { setError('no body selected'); return; }
        const r = runAutoDim(bodyHandle, dir);
        if (!r.ok) {
            setError(r.error || 'auto-dim failed');
            setResult(null);
            return;
        }
        setError(null);
        setResult(r);
        lastDimsRef.current = r.dims;
        setRunStamp((s) => s + 1);
        // Mirror the dims onto the window so headless callers + the e2e
        // can read the latest result without depending on the React tree.
        try {
            window.__forgeLastAutoDim = Object.freeze({
                count: r.dims.length,
                view: dir,
                bodyHandle,
                dims: r.dims.slice(),
                ts: Date.now(),
            });
            window.dispatchEvent(new CustomEvent(FORGE_AUTO_DIM_EVENT, {
                detail: {
                    bodyHandle,
                    view: dir,
                    count: r.dims.length,
                },
            }));
        } catch {}
    }, [bodyHandle, dir]);

    const chosenBody = useMemo(
        () => bodies.find((b) => b.handle === bodyHandle) || null,
        [bodies, bodyHandle],
    );

    if (!open) return null;

    const primaryView = result?.views?.[dir]
                     || result?.views?.front
                     || result?.views?.top
                     || result?.views?.right
                     || null;
    const dims = result?.dims || [];

    return createPortal(
        <div data-testid="forge-auto-dim-panel"
             data-body-count={String(bodies.length)}
             data-dim-count={String(dims.length)}
             data-view={dir}
             data-body-handle={String(bodyHandle ?? '')}
             data-run-stamp={String(runStamp)}
             style={PANEL_STYLE}>
            <div style={HEADER_STYLE}>
                <div>
                    Auto-Dimension Drawings
                    <span style={{ opacity: 0.55, marginLeft: 6 }}>
                        · PUSH-136 · forge.drawings.projectView
                    </span>
                </div>
                <button data-testid="forge-auto-dim-close"
                        onClick={onClose}
                        aria-label="Close auto-dim panel"
                        style={{ background: 'transparent', color: '#dadde2',
                                 border: 'none', cursor: 'pointer',
                                 fontSize: 16, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 8, lineHeight: 1.4 }}>
                    Pick a body + view, hit <b>Auto-dimension</b>. The panel
                    runs HLR over the three orthographic views, scans the
                    visible polylines, and emits the body's full 3D extent
                    plus every detected circular hole as a list of
                    <code style={{ marginLeft: 4 }}>
                        {`{kind, value, a, b}`}
                    </code> records.
                </div>

                {/* Body picker */}
                <div style={ROW_STYLE}>
                    <label htmlFor="forge-auto-dim-body">Body:</label>
                    <select id="forge-auto-dim-body"
                            data-testid="forge-auto-dim-body"
                            value={bodyHandle ?? ''}
                            onChange={(e) => {
                                const v = e.target.value;
                                setBodyHandle(v === '' ? null : Number(v));
                            }}
                            style={{ flex: 1, background: '#0e1014', color: '#dadde2',
                                     border: '1px solid #2a2d34', borderRadius: 4,
                                     padding: '4px 6px' }}>
                        {bodies.length === 0 && <option value="">(no native bodies)</option>}
                        {bodies.map((b) => (
                            <option key={b.handle} value={b.handle}>
                                {b.name || `body ${b.handle}`} (#{b.handle})
                            </option>
                        ))}
                    </select>
                </div>

                {/* View direction selector */}
                <div style={ROW_STYLE}>
                    <label htmlFor="forge-auto-dim-view">View:</label>
                    <select id="forge-auto-dim-view"
                            data-testid="forge-auto-dim-view"
                            value={dir}
                            onChange={(e) => setDir(e.target.value)}
                            style={{ flex: 1, background: '#0e1014', color: '#dadde2',
                                     border: '1px solid #2a2d34', borderRadius: 4,
                                     padding: '4px 6px' }}>
                        {VIEW_DIRS.map((v) => (
                            <option key={v.id} value={v.id}>{v.label}</option>
                        ))}
                    </select>
                </div>

                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button data-testid="forge-auto-dim-run"
                            onClick={onAutoDim}
                            disabled={bodyHandle == null}
                            style={bodyHandle == null ? BTN_DISABLED : BTN_PRIMARY}>
                        Auto-dimension
                    </button>
                    <div data-testid="forge-auto-dim-count"
                         style={{ alignSelf: 'center', opacity: 0.85 }}>
                        {dims.length === 0 ? 'no dims yet' : `${dims.length} dim${dims.length === 1 ? '' : 's'}`}
                    </div>
                </div>

                {chosenBody && (
                    <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
                        Selected: <b>{chosenBody.name || `body ${chosenBody.handle}`}</b>{' '}
                        (handle <code>{chosenBody.handle}</code>)
                    </div>
                )}

                {/* SVG preview of primary view + dim annotations */}
                {primaryView && (
                    <div data-testid="forge-auto-dim-canvas-wrap"
                         style={{ marginTop: 10, padding: 8, background: '#fafafa',
                                  border: '1px solid #2a2d34', borderRadius: 4 }}>
                        <DrawingWithDims view={primaryView} dims={dims.filter((d) => d.view === dir)} />
                    </div>
                )}

                {/* Output dim table */}
                {dims.length > 0 && (
                    <div data-testid="forge-auto-dim-table"
                         data-dim-rows={String(dims.length)}
                         style={{ marginTop: 10, background: '#0e1014',
                                  border: '1px solid #2a2d34', borderRadius: 4,
                                  padding: 6 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                            <thead>
                                <tr style={{ opacity: 0.7, textAlign: 'left' }}>
                                    <th>kind</th><th>label</th><th>value (mm)</th><th>view</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dims.map((d, i) => (
                                    <tr key={i}
                                        data-testid="forge-auto-dim-row"
                                        data-dim-kind={d.kind}
                                        data-dim-label={d.label}
                                        data-dim-value={String(d.value)}
                                        data-dim-axis={d.axis || ''}
                                        data-dim-view={d.view || ''}
                                        data-dim-ax={String(d.a?.x ?? '')}
                                        data-dim-ay={String(d.a?.y ?? '')}
                                        data-dim-bx={String(d.b?.x ?? '')}
                                        data-dim-by={String(d.b?.y ?? '')}>
                                        <td>{d.kind}</td>
                                        <td>{d.label}</td>
                                        <td>{Number(d.value).toFixed(3)}</td>
                                        <td>{d.view}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {error && (
                    <div data-testid="forge-auto-dim-error"
                         style={{ marginTop: 8, padding: 8, background: '#3a1f1f',
                                  color: '#f1c4c4', border: '1px solid #6d3434',
                                  borderRadius: 4 }}>{error}</div>
                )}
            </div>
        </div>,
        document.body,
    );
}

// ─────────────────────────────────────────────────────────────────────
// Drawing canvas — SVG of the projected view with dimension overlays.

function DrawingWithDims({ view, dims }) {
    const W = 480, H = 300, M = 40;
    const bb = view.bbox || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const spanX = Math.max(1e-6, bb.maxX - bb.minX);
    const spanY = Math.max(1e-6, bb.maxY - bb.minY);
    const s = Math.min((W - 2 * M) / spanX, (H - 2 * M) / spanY);
    const ox = M + (W - 2 * M - spanX * s) / 2;
    const oy = M + (H - 2 * M - spanY * s) / 2;
    // World → screen (Y is flipped so engineering Y-up reads correctly).
    const px = (p) => ox + (p.x - bb.minX) * s;
    const py = (p) => H - (oy + (p.y - bb.minY) * s);

    const toPath = (edge) => {
        if (!Array.isArray(edge) || edge.length < 2) return null;
        return edge.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p).toFixed(2)} ${py(p).toFixed(2)}`).join(' ');
    };
    const visible = (view.visibleEdges || []).map(toPath).filter(Boolean);
    const hidden  = (view.hiddenEdges  || []).map(toPath).filter(Boolean);

    return (
        <svg data-testid="forge-auto-dim-canvas"
             width={W} height={H} viewBox={`0 0 ${W} ${H}`}
             style={{ display: 'block', background: '#ffffff' }}>
            {hidden.map((d, i) => (
                <path key={`h${i}`} d={d} stroke="#9aa0a6" strokeWidth="0.8"
                      strokeDasharray="4 3" fill="none" />
            ))}
            {visible.map((d, i) => (
                <path key={`v${i}`} d={d} stroke="#111418" strokeWidth="1.4" fill="none" />
            ))}
            {dims.map((d, i) => {
                if (!d || !d.a || !d.b) return null;
                const ax = px(d.a), ay = py(d.a);
                const bx = px(d.b), by = py(d.b);
                if (d.kind === 'radial') {
                    return (
                        <g key={`d${i}`} data-testid="forge-auto-dim-overlay-radial">
                            <line x1={ax} y1={ay} x2={bx} y2={by}
                                  stroke="#cb4b16" strokeWidth="1" />
                            <text x={bx + 4} y={by - 4}
                                  fontSize="10" fill="#cb4b16"
                                  fontFamily="ui-monospace, monospace">
                                {`Ø${Number(d.value).toFixed(2)}`}
                            </text>
                        </g>
                    );
                }
                // Linear dim — extension lines + leader text.
                const midX = (ax + bx) / 2, midY = (ay + by) / 2;
                return (
                    <g key={`d${i}`} data-testid="forge-auto-dim-overlay-linear">
                        <line x1={ax} y1={ay} x2={bx} y2={by}
                              stroke="#268bd2" strokeWidth="1" />
                        <circle cx={ax} cy={ay} r="2" fill="#268bd2" />
                        <circle cx={bx} cy={by} r="2" fill="#268bd2" />
                        <text x={midX + 4} y={midY - 4}
                              fontSize="10" fill="#268bd2"
                              fontFamily="ui-monospace, monospace">
                            {`${d.label || ''} ${Number(d.value).toFixed(2)}`}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Body snapshot helper (mirrors the BomBalloonsPanel pattern).

function readBodiesSnapshot() {
    if (typeof window === 'undefined') return [];
    const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
    return all.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.autoDim` menu action, exposes the
// imperative open/close hooks, and installs the headless helper API
// mirror so the e2e + plugins can drive the pipeline without React.

export function AutoDimPanelHost() {
    const [open, setOpen] = useState(false);
    const mounted = useRef(false);
    useEffect(() => {
        if (mounted.current) return undefined;
        mounted.current = true;
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenAutoDimPanel  = () => setOpen(true);
        window.__forgeCloseAutoDimPanel = () => setOpen(false);
        const onMenu = (e) => {
            const id = e?.detail?.id;
            if (id === 'tools.autoDim') setOpen(true);
        };
        window.addEventListener('forge:menu-action', onMenu);
        // Expose the headless helper surface so plugins / Archie / the e2e
        // can drive runAutoDim() without React mounted.
        try {
            window.__forgeAutoDimHelper = Object.freeze({
                ...AUTO_DIM_HELPERS,
                readBodiesSnapshot,
            });
        } catch {}
        return () => {
            window.removeEventListener('forge:menu-action', onMenu);
            try { delete window.__forgeOpenAutoDimPanel;  } catch {}
            try { delete window.__forgeCloseAutoDimPanel; } catch {}
        };
    }, []);
    return <AutoDimPanel open={open} onClose={() => setOpen(false)} />;
}

export default AutoDimPanelHost;
