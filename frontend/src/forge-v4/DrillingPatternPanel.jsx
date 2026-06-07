// PUSH-98 (Slice-66) — CAM Drilling Pattern panel.
//
// PUSH-46 already wired the basic CAM Manufacturing workbench (profile /
// pocket / drill / faceMill + simulateStock + cam.gcode), but driving a
// batched drilling op from the existing workbench requires walking the
// strategy picker → Add Op → tweak holes table → Generate flow for every
// single hole. This panel collapses that to a single dialog: pick a
// stock body, fill in N (x, y, depth, dia) rows, optionally Auto-Import
// every circular edge from a body's outline via forge.direct.edgeSegments
// (PUSH-31's pre-existing tessellated edge surface), then one click runs
// forge.cam.drill on the whole batch and emits real native G-code via
// forge.cam.gcode.toGcode.
//
// No new deps — the panel just composes window.forge.cam.drill (PUSH-13
// native kernel surface, see preload.js:197) + window.forge.cam.gcode.toGcode
// + window.forge.direct.edgeSegments (preload.js:1314). Auto-import treats
// any tessellated polyline whose vertices are co-planar at a single Z and
// roughly equidistant from a centroid as a circle.
//
// The panel does NOT post to Archie's thread and does NOT auto-open the
// Archie dock (the Forge-manual-not-Archie rule for manual UI clicks).

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

// Stable native-tool defaults — these mirror the catalogue in
// camDispatch.TOOL_LIBRARY (`dr3` / `dr5`). Inlined here so the panel can
// build a Tool spec without taking a dependency on the camDispatch module.
function nativeTool(diameter) {
    return {
        id: 314159 + Math.round(diameter * 100),
        name: `Drill Ø${diameter}`,
        diameter,
        fluteLength: Math.max(20, diameter * 6),
        helix: 30,
        flutes: 2,
        type: 'Drill',
    };
}

function nativeParams(diameter) {
    // Conservative carbide-drill numbers — feedZ scales with diameter,
    // RPM falls off with diameter, stepdown = 0.5×Ø (peck preset).
    return {
        feedXY:     0,
        feedZ:      120 + diameter * 8,
        spindleRPM: Math.max(800, 18000 / Math.max(2, diameter)),
        stepover:   0,
        stepdown:   Math.max(1.0, diameter * 0.5),
        coolant:    1.0,
    };
}

// Detect circular polylines from a tessellated edge segment array.
// A "circle" here is a closed polyline whose vertices are within ±5 %
// of the same radius from their centroid AND share a Z value to within
// 0.1 mm. Returns [{ x, y, z, diameter }, ...] in world coords.
function detectCirclesFromEdges(rawSegments) {
    if (!rawSegments) return [];
    // edgeSegments() returns either a Float64Array of (start.x, start.y,
    // start.z, end.x, end.y, end.z) tuples or a flat array of polyline
    // vertices grouped by edge. We accept both shapes by re-clustering on
    // shared endpoints — every distinct edge contributes one polyline.
    const polylines = clusterToPolylines(rawSegments);
    const out = [];
    for (const pts of polylines) {
        if (pts.length < 8) continue;                  // need enough samples
        // All Zs within tolerance?
        const zs = pts.map((p) => p[2]);
        const zMin = Math.min(...zs), zMax = Math.max(...zs);
        if (zMax - zMin > 0.15) continue;
        // Closed?
        const a = pts[0], b = pts[pts.length - 1];
        const closeDist = Math.hypot(a[0]-b[0], a[1]-b[1]);
        if (closeDist > 0.5) continue;
        // Centroid + radius variance.
        let cx = 0, cy = 0;
        for (const p of pts) { cx += p[0]; cy += p[1]; }
        cx /= pts.length; cy /= pts.length;
        const radii = pts.map((p) => Math.hypot(p[0]-cx, p[1]-cy));
        const rMean = radii.reduce((s, r) => s + r, 0) / radii.length;
        if (rMean < 0.5) continue;                     // too small to be a hole
        let rDev = 0;
        for (const r of radii) rDev = Math.max(rDev, Math.abs(r - rMean));
        if (rDev / rMean > 0.06) continue;             // not circular enough
        out.push({ x: +cx.toFixed(3), y: +cy.toFixed(3),
                   z: +((zMin + zMax) / 2).toFixed(3),
                   diameter: +(rMean * 2).toFixed(3) });
    }
    return out;
}

function clusterToPolylines(raw) {
    // Accept either a Float64Array / number[] of 6-tuples OR an
    // {edges:[{points:Float32Array,...}]} shape (some kernel revisions
    // wrap them differently). Normalise to an array of polylines, where
    // each polyline is a list of [x,y,z] points.
    if (raw && Array.isArray(raw.edges)) {
        const out = [];
        for (const e of raw.edges) {
            const pts = [];
            const arr = e.points || e.vertices || e.coords || [];
            for (let i = 0; i + 2 < arr.length; i += 3) {
                pts.push([arr[i], arr[i+1], arr[i+2]]);
            }
            if (pts.length > 0) out.push(pts);
        }
        return out;
    }
    // Flat segment soup — reassemble per-edge polylines by chaining
    // segments that share an endpoint (within 1 µm).
    const flat = ArrayBuffer.isView(raw) ? Array.from(raw)
                                          : Array.isArray(raw) ? raw : [];
    const segs = [];
    for (let i = 0; i + 5 < flat.length; i += 6) {
        segs.push([
            [flat[i], flat[i+1], flat[i+2]],
            [flat[i+3], flat[i+4], flat[i+5]],
        ]);
    }
    const used = new Array(segs.length).fill(false);
    const polylines = [];
    const eq = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]) < 1e-3;
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
                if (eq(tail, segs[j][0]))      { chain.push(segs[j][1]); used[j] = true; extended = true; }
                else if (eq(tail, segs[j][1])) { chain.push(segs[j][0]); used[j] = true; extended = true; }
                else if (eq(head, segs[j][0])) { chain.unshift(segs[j][1]); used[j] = true; extended = true; }
                else if (eq(head, segs[j][1])) { chain.unshift(segs[j][0]); used[j] = true; extended = true; }
            }
        }
        polylines.push(chain);
    }
    return polylines;
}

function formatHole(h) {
    return `x=${h.x.toFixed(2)} y=${h.y.toFixed(2)} d=${h.diameter.toFixed(1)} mm × ${h.depth.toFixed(1)} mm`;
}

export function DrillingPatternPanel({ onClose }) {
    const cam = typeof window !== 'undefined' && window.forge && window.forge.cam;
    const direct = typeof window !== 'undefined' && window.forge && window.forge.direct;

    const [bodies, setBodies] = useState(() =>
        (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies))
            ? window.__forgeBodies : []);
    const [stockId, setStockId] = useState(null);
    const [holes, setHoles] = useState([]);
    const [diameter, setDiameter] = useState(6);
    const [depth, setDepth] = useState(10);
    const [zTop, setZTop] = useState(30);
    const [peck, setPeck] = useState(true);
    const [toolpaths, setToolpaths] = useState(null);     // [{x,y,d, moveCount, cycleTimeSec, cutMm, error?}, …]
    const [gcode, setGcode] = useState('');
    const [error, setError] = useState(null);

    const bodiesRef = useRef(bodies);
    useEffect(() => { bodiesRef.current = bodies; }, [bodies]);

    // Pick up live body roster — the shell publishes __forgeBodies +
    // dispatches forge:bodies-changed whenever a primitive lands.
    useEffect(() => {
        const refresh = () => {
            if (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies)) {
                setBodies(window.__forgeBodies.slice());
            }
        };
        refresh();
        const onChange = () => refresh();
        if (typeof window !== 'undefined') {
            window.addEventListener('forge:bodies-changed', onChange);
            window.addEventListener('forge:body-added', onChange);
        }
        return () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('forge:bodies-changed', onChange);
                window.removeEventListener('forge:body-added', onChange);
            }
        };
    }, []);

    // First body is the default pick.
    useEffect(() => {
        if (!stockId && bodies.length > 0) setStockId(bodies[0].id);
    }, [bodies, stockId]);

    const stock = useMemo(
        () => bodies.find((b) => b.id === stockId) || null,
        [bodies, stockId],
    );

    const addHole = useCallback(() => {
        setHoles((prev) => [...prev, {
            x: 0, y: 0,
            depth: Number(depth) || 10,
            diameter: Number(diameter) || 6,
        }]);
    }, [depth, diameter]);

    const removeHole = useCallback((idx) => {
        setHoles((prev) => prev.filter((_, i) => i !== idx));
    }, []);

    const updateHole = useCallback((idx, key, value) => {
        setHoles((prev) => prev.map((h, i) =>
            i === idx ? { ...h, [key]: Number(value) || 0 } : h));
    }, []);

    const autoImport = useCallback(() => {
        if (!stock || !stock.handle) {
            setError('Pick a stock body before auto-import.');
            return;
        }
        if (!direct || typeof direct.edgeSegments !== 'function') {
            setError('window.forge.direct.edgeSegments unavailable (rebuild kernel).');
            return;
        }
        try {
            const raw = direct.edgeSegments(stock.handle, 0.05);
            const circles = detectCirclesFromEdges(raw);
            if (circles.length === 0) {
                setError(`No circular features detected on ${stock.name || stockId} (${stock.handle ? 'tessellated' : 'no handle'}).`);
                return;
            }
            setHoles(circles.map((c) => ({
                x: c.x, y: c.y,
                depth: Number(depth) || 10,
                diameter: c.diameter,
            })));
            setError(null);
        } catch (ex) {
            setError(`Auto-import failed: ${ex.message || ex}`);
        }
    }, [stock, stockId, direct, depth]);

    const generate = useCallback(() => {
        setGcode('');
        setToolpaths(null);
        if (!cam || typeof cam.drill !== 'function') {
            setError('window.forge.cam.drill unavailable (rebuild kernel).');
            return;
        }
        if (!stock || !stock.handle) {
            setError('Pick a stock body first.');
            return;
        }
        if (holes.length === 0) {
            setError('Add at least one hole.');
            return;
        }
        try {
            const results = [];
            const allMoves = [];
            // Group by diameter — one cam.drill call per Ø, since the tool
            // spec is per-batch. The kernel takes a holes[] of [x,y,z]
            // triples + the (zTop, zBottom) cycle limits.
            const byD = new Map();
            for (const h of holes) {
                const key = h.diameter.toFixed(3);
                if (!byD.has(key)) byD.set(key, []);
                byD.get(key).push(h);
            }
            for (const [keyD, batch] of byD.entries()) {
                const d = Number(keyD);
                const tool = nativeTool(d);
                const params = nativeParams(d);
                const maxDepth = Math.max(...batch.map((b) => b.depth));
                const zBottom = Number(zTop) - maxDepth;
                // cam.drill takes holes as [x,y,z] triples — the z is the
                // top reference; the cycle drives from zTop down to zBottom.
                const holesXYZ = batch.map((b) => [b.x, b.y, Number(zTop)]);
                const tp = cam.drill(stock.handle, holesXYZ, tool, params,
                                     Number(zTop), zBottom, !!peck);
                if (!tp || !tp.moveCount) {
                    results.push({
                        diameter: d,
                        holes: batch.length,
                        moveCount: 0,
                        cycleTimeSec: 0,
                        cutMm: 0,
                        error: 'kernel returned no toolpath',
                    });
                    continue;
                }
                results.push({
                    diameter: d,
                    holes: batch.length,
                    moveCount: tp.moveCount,
                    cycleTimeSec: tp.cycleTimeSec || 0,
                    cutMm: tp.estCuttingMm || 0,
                });
                allMoves.push(tp);
            }
            // Per-hole table — split out the batch results back to one row
            // per hole for the table at the bottom, since the user UI is a
            // hole-table-first one.
            const perHole = holes.map((h, idx) => {
                const batchRes = results.find((r) => Math.abs(r.diameter - h.diameter) < 1e-3);
                if (!batchRes || batchRes.error) {
                    return { idx, ...h, moveCount: 0, cycleTimeSec: 0,
                             error: batchRes && batchRes.error };
                }
                // The native drill cycle emits >= 4 moves per hole (rapid
                // to (x,y,zTop), feed-down, dwell-or-pause, retract). We
                // distribute the batch total evenly across the holes so the
                // per-row report is still meaningful.
                const perCount = Math.floor(batchRes.moveCount / batchRes.holes);
                const perCycle = batchRes.cycleTimeSec / batchRes.holes;
                return { idx, ...h, moveCount: perCount,
                         cycleTimeSec: +perCycle.toFixed(3) };
            });
            setToolpaths(perHole);
            // G-code via the native gcode.toGcode — concatenate per-batch
            // programs with a comment header per Ø so the operator can see
            // which block belongs to which tool.
            if (cam.gcode && typeof cam.gcode.toGcode === 'function') {
                const lines = [];
                for (let i = 0; i < allMoves.length; i++) {
                    const r = results.filter((x) => !x.error)[i];
                    lines.push(`(--- Drill Ø${r.diameter.toFixed(2)} mm · ${r.holes} hole${r.holes !== 1 ? 's' : ''} ---)`);
                    lines.push(cam.gcode.toGcode(allMoves[i], 'Fanuc', Number(zTop) + 5));
                    lines.push('');
                }
                setGcode(lines.join('\n'));
            }
            setError(null);
            // Publish results on window so the e2e can grab them.
            if (typeof window !== 'undefined') {
                window.__forgeDrillingPatternResults = perHole;
            }
        } catch (ex) {
            setError(`Drill generate failed: ${ex.message || ex}`);
        }
    }, [cam, stock, holes, zTop, peck]);

    const totalMoves = toolpaths
        ? toolpaths.reduce((s, t) => s + (t.moveCount || 0), 0) : 0;
    const totalSec = toolpaths
        ? toolpaths.reduce((s, t) => s + (t.cycleTimeSec || 0), 0) : 0;

    return createPortal(
        <div data-testid="forge-drilling-pattern-panel"
             style={{
                 position: 'fixed', right: 24, top: 96, width: 520, maxHeight: '82vh',
                 background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
                 borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
                 boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 952,
                 display: 'flex', flexDirection: 'column',
             }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>
                    Drilling Pattern{' '}
                    <span style={{ opacity: 0.55 }}>· PUSH-98 · forge.cam.drill</span>
                </div>
                <button data-testid="forge-drilling-pattern-close"
                        onClick={onClose}
                        aria-label="Close drilling pattern"
                        style={{ background: 'transparent', color: '#dadde2',
                                 border: 'none', cursor: 'pointer',
                                 fontSize: 16, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    Native CAM: {cam ? 'ready' : 'unavailable'} ·
                    direct edges: {direct && direct.edgeSegments ? 'ready' : 'unavailable'} ·
                    bodies: {bodies.length}
                </div>

                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ minWidth: 56 }}>Stock:</label>
                    <select data-testid="forge-drilling-pattern-stock"
                            value={stockId || ''}
                            onChange={(e) => setStockId(e.target.value)}
                            style={{ flex: 1, background: '#0e1014', color: '#dadde2',
                                     border: '1px solid #2a2d34', borderRadius: 4,
                                     padding: '3px 4px' }}>
                        <option value="">— pick a body —</option>
                        {bodies.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name || b.id} {b.toolId ? `· ${b.toolId}` : ''}
                            </option>
                        ))}
                    </select>
                </div>

                <div style={{ marginTop: 8, display: 'grid',
                              gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                    <NumField label="Default Ø" value={diameter}
                              onChange={setDiameter}
                              testid="forge-drilling-pattern-diameter" />
                    <NumField label="Depth" value={depth}
                              onChange={setDepth}
                              testid="forge-drilling-pattern-depth" />
                    <NumField label="Z top" value={zTop}
                              onChange={setZTop}
                              testid="forge-drilling-pattern-ztop" />
                </div>

                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox"
                               data-testid="forge-drilling-pattern-peck"
                               checked={peck}
                               onChange={(e) => setPeck(e.target.checked)} />
                        Peck cycle (G83)
                    </label>
                </div>

                <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                    <button data-testid="forge-drilling-pattern-add-hole"
                            onClick={addHole}
                            style={{ padding: '5px 10px', background: '#2c3a4d',
                                     color: '#dadde2', border: '1px solid #3a4d68',
                                     borderRadius: 4, cursor: 'pointer' }}>
                        + Add Hole
                    </button>
                    <button data-testid="forge-drilling-pattern-auto-import"
                            onClick={autoImport}
                            style={{ padding: '5px 10px', background: '#2c4d4a',
                                     color: '#dadde2', border: '1px solid #3a6863',
                                     borderRadius: 4, cursor: 'pointer' }}>
                        Auto-import circles
                    </button>
                    <button data-testid="forge-drilling-pattern-clear"
                            onClick={() => { setHoles([]); setToolpaths(null); setGcode(''); }}
                            style={{ padding: '5px 10px', background: '#3a2c34',
                                     color: '#dadde2', border: '1px solid #683a4d',
                                     borderRadius: 4, cursor: 'pointer' }}>
                        Clear
                    </button>
                </div>

                <div data-testid="forge-drilling-pattern-hole-count"
                     style={{ marginTop: 8, opacity: 0.7 }}>
                    Holes: {holes.length}
                </div>

                {holes.length > 0 && (
                    <table data-testid="forge-drilling-pattern-hole-table"
                           style={{ width: '100%', borderCollapse: 'collapse',
                                    marginTop: 4, fontSize: 11 }}>
                        <thead style={{ background: '#0e1014' }}>
                            <tr>
                                <th style={th}>#</th>
                                <th style={th}>X</th>
                                <th style={th}>Y</th>
                                <th style={th}>Ø</th>
                                <th style={th}>Depth</th>
                                <th style={th}>{' '}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {holes.map((h, i) => (
                                <tr key={i} data-testid={`forge-drilling-pattern-hole-row-${i}`}>
                                    <td style={td}>{i + 1}</td>
                                    <td style={td}>
                                        <NumCell value={h.x}
                                                 testid={`forge-drilling-pattern-hole-${i}-x`}
                                                 onChange={(v) => updateHole(i, 'x', v)} />
                                    </td>
                                    <td style={td}>
                                        <NumCell value={h.y}
                                                 testid={`forge-drilling-pattern-hole-${i}-y`}
                                                 onChange={(v) => updateHole(i, 'y', v)} />
                                    </td>
                                    <td style={td}>
                                        <NumCell value={h.diameter}
                                                 testid={`forge-drilling-pattern-hole-${i}-d`}
                                                 onChange={(v) => updateHole(i, 'diameter', v)} />
                                    </td>
                                    <td style={td}>
                                        <NumCell value={h.depth}
                                                 testid={`forge-drilling-pattern-hole-${i}-depth`}
                                                 onChange={(v) => updateHole(i, 'depth', v)} />
                                    </td>
                                    <td style={td}>
                                        <button data-testid={`forge-drilling-pattern-hole-${i}-remove`}
                                                onClick={() => removeHole(i)}
                                                style={{ background: 'transparent',
                                                         border: 'none',
                                                         color: '#dadde2',
                                                         cursor: 'pointer' }}>×</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                <button data-testid="forge-drilling-pattern-generate"
                        onClick={generate}
                        disabled={!cam || holes.length === 0 || !stock}
                        style={{ marginTop: 10, padding: '6px 12px',
                                 background: (cam && holes.length > 0 && stock) ? '#2c4d2a' : '#1a1c20',
                                 color: '#dfeedd',
                                 border: '1px solid #3a6738', borderRadius: 4,
                                 cursor: (cam && holes.length > 0 && stock) ? 'pointer' : 'not-allowed',
                                 fontWeight: 600 }}>
                    Generate G-code ({holes.length} hole{holes.length !== 1 ? 's' : ''})
                </button>

                {toolpaths && (
                    <div data-testid="forge-drilling-pattern-results"
                         style={{ marginTop: 10, borderTop: '1px solid #2a2d34',
                                  paddingTop: 8 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <strong>Toolpaths:</strong>
                            <span data-testid="forge-drilling-pattern-total-moves">
                                {totalMoves} moves
                            </span>
                            <span style={{ opacity: 0.6 }}>·</span>
                            <span data-testid="forge-drilling-pattern-total-time">
                                {totalSec.toFixed(2)} s cycle
                            </span>
                        </div>
                        <table data-testid="forge-drilling-pattern-results-table"
                               style={{ width: '100%', borderCollapse: 'collapse',
                                        marginTop: 4, fontSize: 11 }}>
                            <thead style={{ background: '#0e1014' }}>
                                <tr>
                                    <th style={th}>#</th>
                                    <th style={th}>X</th>
                                    <th style={th}>Y</th>
                                    <th style={th}>Ø</th>
                                    <th style={th}>moves</th>
                                    <th style={th}>cycle s</th>
                                </tr>
                            </thead>
                            <tbody>
                                {toolpaths.map((t, i) => (
                                    <tr key={i}
                                        data-testid={`forge-drilling-pattern-result-row-${i}`}>
                                        <td style={td}>{i + 1}</td>
                                        <td style={td}>{t.x.toFixed(2)}</td>
                                        <td style={td}>{t.y.toFixed(2)}</td>
                                        <td style={td}>{t.diameter.toFixed(2)}</td>
                                        <td style={td}
                                            data-testid={`forge-drilling-pattern-result-${i}-moves`}>
                                            {t.moveCount}
                                        </td>
                                        <td style={td}>{(t.cycleTimeSec || 0).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {gcode && (
                    <details data-testid="forge-drilling-pattern-gcode-section"
                             open style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer' }}>
                            G-code · {gcode.split('\n').length} lines
                        </summary>
                        <pre data-testid="forge-drilling-pattern-gcode"
                             style={{ fontSize: 10, lineHeight: 1.3, maxHeight: 200,
                                      overflow: 'auto', background: '#0e1014',
                                      border: '1px solid #2a2d34', borderRadius: 4,
                                      padding: 6, marginTop: 4 }}>{gcode}</pre>
                    </details>
                )}

                {error && (
                    <div data-testid="forge-drilling-pattern-error"
                         style={{ marginTop: 8, padding: 8,
                                  background: '#3a1f1f', color: '#f1c4c4',
                                  border: '1px solid #6d3434', borderRadius: 4 }}>
                        {error}
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

const th = { textAlign: 'left', padding: '3px 5px',
             borderBottom: '1px solid #2a2d34', fontWeight: 600 };
const td = { padding: '3px 5px', borderBottom: '1px solid #20232a' };

function NumField({ label, value, onChange, testid }) {
    return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ opacity: 0.7, fontSize: 10 }}>{label}</span>
            <input type="number"
                   data-testid={testid}
                   value={value}
                   onChange={(e) => onChange(Number(e.target.value))}
                   style={{ background: '#0e1014', color: '#dadde2',
                            border: '1px solid #2a2d34', borderRadius: 4,
                            padding: '3px 4px', width: '100%' }} />
        </label>
    );
}

function NumCell({ value, onChange, testid }) {
    return (
        <input type="number"
               data-testid={testid}
               value={value}
               onChange={(e) => onChange(Number(e.target.value))}
               style={{ background: '#0e1014', color: '#dadde2',
                        border: '1px solid #2a2d34', borderRadius: 3,
                        padding: '2px 3px', width: '100%',
                        fontSize: 11 }} />
    );
}

export function DrillingPatternPanelHost() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenDrillingPattern = () => setOpen(true);
        window.__forgeCloseDrillingPattern = () => setOpen(false);
        return () => {
            delete window.__forgeOpenDrillingPattern;
            delete window.__forgeCloseDrillingPattern;
        };
    }, []);
    if (!open) return null;
    return <DrillingPatternPanel onClose={() => setOpen(false)} />;
}

export default DrillingPatternPanelHost;
