// PUSH-05 — Drawings HLR workbench (forge::drawings).
//
// Wraps the new HLR API (projectView, sectionView, emitDXF, emitSVG)
// shipped by the kernel agent. Distinct from the legacy
// Forge-90/130 DrawingsWorkbench.jsx; uses
// __forgeOpenDrawingsHLRWorkbench to avoid collision.
//
// Manual UI only — never posts to Archie, never opens dock.
//
// PUSH-62 — Live Section view panel.
//   Adds a Mode toggle ("projection" vs "section"). In section mode
//   the existing "Project view" button calls
//   forge.drawings.projectSection(handle, dir, plane, hatchSpec) and
//   converts the legacy packed-Float32 ProjectedView bucket shape
//   (visible / visibleStarts / visibleCount, hidden / cut / hatch …)
//   into the same View2D shape (visibleEdges / hiddenEdges / bbox)
//   the DrawingCanvas + emitDXF + Save DXF pipeline already speak —
//   so the section silhouette + cut wires + hatch lines render
//   immediately and Save DXF lands a real .dxf on disk that downstream
//   CAD tools can ingest. The hatch lines merge into visibleEdges so
//   the existing renderer paints them; cut/hatch counts surface on a
//   small section-status report.

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

const VIEW_DIRS = [
    { id: 'front', label: 'FRONT (-Y)' },
    { id: 'top',   label: 'TOP (+Z)' },
    { id: 'right', label: 'RIGHT (+X)' },
    { id: 'iso',   label: 'ISO (1,1,1)' },
];

// PUSH-62 — map a UI axis pick to the cutting-plane normal we feed the
// kernel. The plane normal points "out of" the cut face; for axis-aligned
// cuts the unit basis vector is the natural choice. (Origin is supplied
// as `[0, 0, offset]` style by the caller — the normal vector determines
// the cut direction.)
function axisToNormal(axis) {
    if (axis === 'X') return [1, 0, 0];
    if (axis === 'Y') return [0, 1, 0];
    return [0, 0, 1]; // Z (default)
}

function axisToOrigin(axis, offset) {
    const o = Number.isFinite(offset) ? offset : 0;
    if (axis === 'X') return [o, 0, 0];
    if (axis === 'Y') return [0, o, 0];
    return [0, 0, o]; // Z
}

// PUSH-62 — unpack the legacy packed-Float32 bucket the
// projectSection / projectShape kernel binding emits
// (Float32Array `verts` of x,y pairs + Uint32Array `starts` of
// per-polyline offsets) into the array-of-{x,y}-polylines shape the
// View2D-speaking renderer + emitDXF expect.
//
//   verts  = Float32Array[2 * totalVerts]  // x0,y0, x1,y1, x2,y2 …
//   starts = Uint32Array[count + 1]        // starts[i] is the vertex
//                                          // index where polyline i
//                                          // begins; starts[count]
//                                          // is the sentinel total.
function unpackBucket(verts, starts, count) {
    const polylines = [];
    if (!verts || !starts) return polylines;
    const n = Number(count || 0);
    for (let i = 0; i < n; i += 1) {
        const a = Number(starts[i]);
        const b = Number(starts[i + 1]);
        const pl = [];
        for (let j = a; j < b; j += 1) {
            pl.push({ x: verts[2 * j], y: verts[2 * j + 1] });
        }
        if (pl.length >= 2) polylines.push(pl);
    }
    return polylines;
}

// PUSH-62 — convert a packed ProjectedView (output of
// forge.drawings.projectSection) into the View2D shape used by
// DrawingCanvas + emitDXF. Section semantics:
//   • silhouette outline + visible edges → visibleEdges (drawn solid)
//   • cut wires (the actual section silhouette) → visibleEdges (heavy)
//   • hatch lines → visibleEdges (the spec calls for "treat hatch
//     edges as red 0.3 lines or merge into visible"; we merge so the
//     existing single-style canvas renders them without touching the
//     shared DrawingCanvas implementation)
//   • hidden edges → hiddenEdges (drawn dashed grey, unchanged)
// We also synthesise the {minX,minY,maxX,maxY} bbox required by the
// canvas + downstream emitters by scanning every emitted point.
function packedSectionToView2D(packed) {
    if (!packed) return null;
    const visibleBuckets = [
        unpackBucket(packed.visible, packed.visibleStarts, packed.visibleCount),
        unpackBucket(packed.outline, packed.outlineStarts, packed.outlineCount),
        unpackBucket(packed.cut,     packed.cutStarts,     packed.cutCount),
        unpackBucket(packed.hatch,   packed.hatchStarts,   packed.hatchCount),
    ];
    const visibleEdges = [];
    for (const b of visibleBuckets) for (const pl of b) visibleEdges.push(pl);
    const hiddenEdges = unpackBucket(packed.hidden, packed.hiddenStarts, packed.hiddenCount);

    let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
    const scan = (pl) => {
        for (const p of pl) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
    };
    for (const pl of visibleEdges) scan(pl);
    for (const pl of hiddenEdges)  scan(pl);
    if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }

    return {
        visibleEdges,
        hiddenEdges,
        bbox: { minX, minY, maxX, maxY },
        // Section-only counts so the report block can surface them.
        _sectionCutCount:   unpackBucket(packed.cut,   packed.cutStarts,   packed.cutCount).length,
        _sectionHatchCount: unpackBucket(packed.hatch, packed.hatchStarts, packed.hatchCount).length,
    };
}

// Slice-11 — render an HLR projection as a real 2D engineering drawing.
// Visible edges = solid black; hidden edges = dashed grey. Y is flipped
// (drawing Y-up) and the view is scaled to fit a fixed canvas with margin.
function DrawingCanvas({ view }) {
    const W = 480, H = 300, M = 16;
    const bb = view.bbox || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const spanX = Math.max(1e-6, bb.maxX - bb.minX);
    const spanY = Math.max(1e-6, bb.maxY - bb.minY);
    const s = Math.min((W - 2 * M) / spanX, (H - 2 * M) / spanY);
    const ox = M + (W - 2 * M - spanX * s) / 2;
    const oy = M + (H - 2 * M - spanY * s) / 2;
    // World (x,y) → canvas px, flipping Y so up is up.
    const px = (p) => ox + (p.x - bb.minX) * s;
    const py = (p) => H - (oy + (p.y - bb.minY) * s);
    const toPath = (edge) => {
        if (!Array.isArray(edge) || edge.length < 2) return null;
        return edge.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p).toFixed(2)} ${py(p).toFixed(2)}`).join(' ');
    };
    const visible = (view.visibleEdges || []).map(toPath).filter(Boolean);
    const hidden = (view.hiddenEdges || []).map(toPath).filter(Boolean);
    return (
        <svg data-testid="forge-drawingshlr-canvas"
             width={W} height={H} viewBox={`0 0 ${W} ${H}`}
             style={{ display: 'block', background: '#ffffff' }}>
            {hidden.map((d, i) => (
                <path key={`h${i}`} d={d} stroke="#9aa0a6" strokeWidth="0.8"
                      strokeDasharray="4 3" fill="none" />
            ))}
            {visible.map((d, i) => (
                <path key={`v${i}`} d={d} stroke="#111418" strokeWidth="1.4" fill="none" />
            ))}
        </svg>
    );
}


export function DrawingsHLRWorkbench({ onClose }) {
    const surface = typeof window !== 'undefined' && window.forge && window.forge.drawings;

    const [box, setBox]   = useState(null);
    const [modelName, setModelName] = useState(null);
    const [usingSample, setUsingSample] = useState(false);
    const [dir, setDir]   = useState('front');
    const [view, setView] = useState(null);
    const [dxf, setDxf]   = useState('');
    const [svg, setSvg]   = useState('');
    const [error, setError] = useState(null);
    // PUSH-62 — Section mode + cutting-plane editor state.
    const [mode, setMode]       = useState('projection'); // 'projection' | 'section'
    const [secAxis, setSecAxis] = useState('Z');
    const [secOffset, setSecOffset] = useState(0);

    // Slice-11 — project the REAL current model. Prefer the
    // selected/last native body in the live scene; only fall back to a
    // sample box when the scene is empty so the workbench is never blank.
    useEffect(() => {
        if (!surface) return;
        const bodies = (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies))
            ? window.__forgeBodies.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number')
            : [];
        // Honour an explicit body selection if one exists.
        let chosen = null;
        const sel = (typeof window !== 'undefined' && window.__forgeSelection) || null;
        if (sel && typeof sel.bodyHandle === 'number') {
            chosen = bodies.find((b) => b.handle === sel.bodyHandle) || null;
        }
        if (!chosen && bodies.length) chosen = bodies[bodies.length - 1];
        if (chosen) {
            setBox(chosen.handle);
            setModelName(chosen.name || `body ${chosen.handle}`);
            setUsingSample(false);
        } else if (window.forge.makeBox) {
            try {
                setBox(window.forge.makeBox(100, 60, 40));
                setModelName('sample 100×60×40 box');
                setUsingSample(true);
            } catch { /* ignore */ }
        }
    }, [surface]);

    const projectInto = useCallback((handle, direction) => {
        if (!surface || !surface.projectView || handle == null) {
            setError('drawings.projectView unavailable');
            return null;
        }
        try {
            const v = surface.projectView(handle, direction);
            setView(v);
            setError(null);
            // Auto-emit the SVG so the projection renders as an actual
            // drawing immediately (not just edge counts).
            if (surface.emitSVG) {
                try { setSvg(surface.emitSVG(v)); } catch { setSvg(''); }
            }
            return v;
        } catch (ex) { setError(String(ex.message || ex)); return null; }
    }, [surface]);

    // PUSH-62 — Section-mode project: call the legacy packed-Float32
    // projectSection binding, convert it into the View2D shape the
    // renderer + emitDXF speak, and surface it via the same setView
    // pipeline so the DrawingCanvas + Save DXF flow Just Work without
    // touching any other file.
    const projectSectionInto = useCallback((handle, direction, axis, offset) => {
        if (!surface || !surface.projectSection || handle == null) {
            setError('drawings.projectSection unavailable');
            return null;
        }
        const off = Number(offset);
        const plane = {
            origin: axisToOrigin(axis, Number.isFinite(off) ? off : 0),
            normal: axisToNormal(axis),
        };
        const hatchSpec = { angle: 45, spacing: 4, thickness: 0.4 };
        try {
            const packed = surface.projectSection(handle, direction, plane, hatchSpec);
            const v = packedSectionToView2D(packed);
            setView(v);
            setError(null);
            if (v && surface.emitSVG) {
                try { setSvg(surface.emitSVG(v)); } catch { setSvg(''); }
            }
            return v;
        } catch (ex) { setError(String(ex.message || ex)); return null; }
    }, [surface]);

    // Auto-project once the model handle is known, and whenever the view
    // direction changes — so opening the workbench shows a drawing at once.
    // PUSH-62: only auto-runs the projection branch; entering Section
    // mode is an explicit user action, so we don't re-cut on every dir
    // change until the user clicks Project view.
    useEffect(() => {
        if (box != null && mode === 'projection') projectInto(box, dir);
    }, [box, dir, mode, projectInto]);

    const onProject = useCallback(() => {
        if (mode === 'section') {
            projectSectionInto(box, dir, secAxis, secOffset);
        } else {
            projectInto(box, dir);
        }
    }, [mode, projectInto, projectSectionInto, box, dir, secAxis, secOffset]);

    const onEmitDXF = useCallback(() => {
        if (!surface || !surface.emitDXF || !view) return;
        try { setDxf(surface.emitDXF([view], [])); }
        catch (ex) { setError(String(ex.message || ex)); }
    }, [surface, view]);

    const onEmitSVG = useCallback(() => {
        if (!surface || !surface.emitSVG || !view) return;
        try { setSvg(surface.emitSVG(view)); }
        catch (ex) { setError(String(ex.message || ex)); }
    }, [surface, view]);

    // PUSH-55 — save the projected view as a real .dxf file. Builds the
    // DXF string fresh from the current view (and any future dim payload)
    // via the kernel emit, prompts the user for a location via the
    // Electron save dialog, then writes the bytes through writeBlob.
    // Surfaces window.__forgeLastDxfPath so an e2e can inspect the result.
    const [saveNote, setSaveNote] = useState(null);
    const onSaveDXF = useCallback(async () => {
        if (!surface || !surface.emitDXF || !view) return;
        const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
        if (!dialog || typeof dialog.saveFile !== 'function' || typeof dialog.writeBlob !== 'function') {
            setError('forge.dialog.saveFile / writeBlob unavailable — cannot write DXF');
            return;
        }
        let dxfStr;
        try {
            dxfStr = surface.emitDXF([view], []);
        } catch (ex) {
            setError(String(ex.message || ex));
            return;
        }
        if (!dxfStr || dxfStr.length < 16) {
            setError('emitDXF returned an empty payload — projection has no edges');
            return;
        }
        const filepath = await dialog.saveFile({
            title: 'Save DXF', defaultPath: `${modelName || 'sheet'}.dxf`,
            filters: [{ name: 'AutoCAD DXF', extensions: ['dxf'] }],
        });
        if (!filepath) { setSaveNote('Save DXF · canceled'); return; }
        try {
            const bytes = new TextEncoder().encode(dxfStr);
            const res = await dialog.writeBlob(filepath, bytes);
            if (res && res.ok) {
                try { window.__forgeLastDxfPath = filepath; } catch {}
                setSaveNote(`Saved · ${filepath.split('/').pop()} (${res.bytes} B)`);
                setError(null);
            } else {
                setError(`writeBlob failed${res?.error ? ' · ' + res.error : ''}`);
            }
        } catch (ex) {
            setError(`writeBlob threw: ${ex.message}`);
        }
    }, [surface, view, modelName]);

    return createPortal(
        <div data-testid="forge-drawingshlr-panel" style={{
            position: 'fixed', right: 24, top: 96, width: 520, maxHeight: '82vh',
            background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
            borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 950,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>Drawings (HLR) <span style={{ opacity: 0.55 }}>· PUSH-05 · forge::drawings</span></div>
                <button onClick={onClose} aria-label="Close drawings HLR"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    {usingSample
                        ? 'Scene empty — showing sample 100 × 60 × 40 box. '
                        : `Projecting: ${modelName ?? '—'} (handle ${box ?? '—'}). `}
                    Native HLR via HLRBRep_Algo + DXF R12 / SVG emit.
                </div>

                {/* PUSH-62 — Mode toggle. Section reveals the cutting-plane editor. */}
                <div style={{ marginTop: 4 }}>
                    <label>Mode: </label>
                    <select data-testid="forge-drawingshlr-mode"
                        value={mode} onChange={(e) => setMode(e.target.value)}
                        style={{ background: '#0e1014', color: '#dadde2',
                                 border: '1px solid #2a2d34', borderRadius: 4 }}>
                        <option value="projection">Projection (HLR)</option>
                        <option value="section">Section (cutting plane)</option>
                    </select>
                </div>

                <div style={{ marginTop: 4 }}>
                    <label>View direction: </label>
                    <select data-testid="forge-drawingshlr-direction"
                        value={dir} onChange={(e) => setDir(e.target.value)}
                        style={{ background: '#0e1014', color: '#dadde2',
                                 border: '1px solid #2a2d34', borderRadius: 4 }}>
                        {VIEW_DIRS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                </div>

                {/* PUSH-62 — cutting-plane editor (axis + offset). Only
                    visible in section mode so projection mode UI stays
                    pixel-identical to PUSH-05. */}
                {mode === 'section' && (
                    <div data-testid="forge-drawingshlr-section-controls" style={{
                        marginTop: 6, padding: 6, background: '#0e1014',
                        border: '1px solid #2a2d34', borderRadius: 4,
                        display: 'flex', gap: 8, alignItems: 'center',
                    }}>
                        <label>Axis: </label>
                        <select data-testid="forge-drawingshlr-section-axis"
                            value={secAxis} onChange={(e) => setSecAxis(e.target.value)}
                            style={{ background: '#0e1014', color: '#dadde2',
                                     border: '1px solid #2a2d34', borderRadius: 4 }}>
                            <option value="X">X (YZ-plane cut)</option>
                            <option value="Y">Y (XZ-plane cut)</option>
                            <option value="Z">Z (XY-plane cut)</option>
                        </select>
                        <label>Offset (mm): </label>
                        <input data-testid="forge-drawingshlr-section-offset"
                            type="number" step="0.5"
                            value={secOffset}
                            onChange={(e) => setSecOffset(parseFloat(e.target.value))}
                            style={{ width: 70, background: '#0e1014', color: '#dadde2',
                                     border: '1px solid #2a2d34', borderRadius: 4,
                                     padding: '2px 4px' }} />
                    </div>
                )}

                <button data-testid="forge-drawingshlr-project" onClick={onProject}
                    style={{ marginTop: 6, padding: '6px 10px', background: '#2c4d2a',
                             color: '#dfeedd', border: '1px solid #3a6738',
                             borderRadius: 4, cursor: 'pointer' }}>
                    {mode === 'section' ? 'Project section' : 'Project view'}
                </button>

                {view && (
                    <div data-testid="forge-drawingshlr-view-report" style={{
                        marginTop: 8, padding: 6, background: '#0e1014',
                        border: '1px solid #2a2d34', borderRadius: 4,
                    }}>
                        <div>Visible edges: <span data-testid="forge-drawingshlr-visible-count">{view.visibleEdges?.length ?? 0}</span></div>
                        <div>Hidden edges: <span data-testid="forge-drawingshlr-hidden-count">{view.hiddenEdges?.length ?? 0}</span></div>
                        {/* PUSH-62 — section-only counters, surfaced only when
                            the active view came from projectSection. */}
                        {mode === 'section' && (
                            <>
                                <div>Cut wires: <span data-testid="forge-drawingshlr-cut-count">{view._sectionCutCount ?? 0}</span></div>
                                <div>Hatch lines: <span data-testid="forge-drawingshlr-hatch-count">{view._sectionHatchCount ?? 0}</span></div>
                            </>
                        )}
                        <div>BBox: <span data-testid="forge-drawingshlr-bbox">
                            x [{view.bbox?.minX?.toFixed(1)} → {view.bbox?.maxX?.toFixed(1)}]
                            y [{view.bbox?.minY?.toFixed(1)} → {view.bbox?.maxY?.toFixed(1)}]
                        </span></div>
                    </div>
                )}

                {/* Slice-11 — render the projection as an ACTUAL drawing:
                    visible edges as solid lines, hidden edges as dashed,
                    in a flipped-Y (engineering) coordinate frame. */}
                {view && view.bbox && (
                    <div data-testid="forge-drawingshlr-canvas-wrap" style={{
                        marginTop: 8, padding: 8, background: '#fafafa',
                        border: '1px solid #2a2d34', borderRadius: 4,
                    }}>
                        <DrawingCanvas view={view} />
                    </div>
                )}

                <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                    <button data-testid="forge-drawingshlr-emit-dxf" onClick={onEmitDXF}
                        disabled={!view}
                        style={{ flex: 1, padding: '4px 8px',
                                 background: view ? '#2c3a4d' : '#1a1c20',
                                 color: '#dadde2', border: '1px solid #3a3d44',
                                 borderRadius: 4, cursor: view ? 'pointer' : 'not-allowed' }}>
                        Emit DXF
                    </button>
                    <button data-testid="forge-drawingshlr-emit-svg" onClick={onEmitSVG}
                        disabled={!view}
                        style={{ flex: 1, padding: '4px 8px',
                                 background: view ? '#2c3a4d' : '#1a1c20',
                                 color: '#dadde2', border: '1px solid #3a3d44',
                                 borderRadius: 4, cursor: view ? 'pointer' : 'not-allowed' }}>
                        Emit SVG
                    </button>
                    <button data-testid="forge-drawingshlr-save-dxf" onClick={onSaveDXF}
                        disabled={!view}
                        style={{ flex: 1, padding: '4px 8px',
                                 background: view ? '#2c4d2a' : '#1a1c20',
                                 color: '#dfeedd', border: '1px solid #3a6738',
                                 borderRadius: 4, cursor: view ? 'pointer' : 'not-allowed' }}>
                        Save DXF…
                    </button>
                </div>
                {saveNote && (
                    <div data-testid="forge-drawingshlr-save-note" style={{
                        marginTop: 6, padding: '4px 6px', background: '#1d2b1f',
                        border: '1px solid #2f4a32', borderRadius: 4, color: '#cfe2ce',
                        fontSize: 11,
                    }}>{saveNote}</div>
                )}

                {dxf && (
                    <details data-testid="forge-drawingshlr-dxf-section" open style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer' }}>DXF · {dxf.length} bytes</summary>
                        <pre data-testid="forge-drawingshlr-dxf" style={{
                            fontSize: 10, lineHeight: 1.3, maxHeight: 200, overflow: 'auto',
                            background: '#0e1014', border: '1px solid #2a2d34', borderRadius: 4,
                            padding: 6, marginTop: 4,
                        }}>{dxf}</pre>
                    </details>
                )}

                {svg && (
                    <details data-testid="forge-drawingshlr-svg-section" open style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer' }}>SVG · {svg.length} bytes</summary>
                        <pre data-testid="forge-drawingshlr-svg" style={{
                            fontSize: 10, lineHeight: 1.3, maxHeight: 200, overflow: 'auto',
                            background: '#0e1014', border: '1px solid #2a2d34', borderRadius: 4,
                            padding: 6, marginTop: 4,
                        }}>{svg}</pre>
                    </details>
                )}

                {error && (
                    <div data-testid="forge-drawingshlr-error" style={{
                        marginTop: 8, padding: 8, background: '#3a1f1f', color: '#f1c4c4',
                        border: '1px solid #6d3434', borderRadius: 4,
                    }}>{error}</div>
                )}
            </div>
        </div>,
        document.body,
    );
}

export function DrawingsHLRWorkbenchHost() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenDrawingsHLRWorkbench = () => setOpen(true);
        window.__forgeCloseDrawingsHLRWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenDrawingsHLRWorkbench;
            delete window.__forgeCloseDrawingsHLRWorkbench;
        };
    }, []);

    if (!open) return null;
    return <DrawingsHLRWorkbench onClose={() => setOpen(false)} />;
}

export default DrawingsHLRWorkbenchHost;
