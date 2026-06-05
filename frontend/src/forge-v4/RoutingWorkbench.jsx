// PUSH-09 — Routing (piping + cable) workbench. Pure frontend; no deps.
//
// Route editor: user enters route segments as a JSON list of {x,y,z} nodes.
// The workbench picks a pipe / cable spec, auto-inserts elbows at every
// internal vertex whose bend angle exceeds the spec's minBendAngle, and
// computes BOM rollup (length, mass, cost).
//
// Specs are real engineering data:
//   - ASME B36.10M Sch40 carbon steel pipe (already in StandardPartsCatalog)
//   - PVC Sch40 (ASTM D1785)
//   - Copper Type L tubing (ASTM B88)
//   - Flexible UL 12 AWG / 4 AWG cable (with min bend radius 4×OD)
//
// Inserted into the scene via dispatch of `forge:insert-route` so the
// viewport (or future kernel-side BRepOffsetAPI_MakePipeShell when wired)
// can render the actual swept solid.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export const PIPE_SPECS = [
    // Carbon steel Sch 40 per ASME B36.10M (od, wall in mm; massPerM kg/m).
    { id: 'cs-sch40-1/2',   label: 'Carbon steel 1/2" Sch40',    type: 'pipe',  od: 21.34, wall: 2.77, massPerM: 1.27, minBendRadiusMult: 5, costUSDPerM: 4.20 },
    { id: 'cs-sch40-3/4',   label: 'Carbon steel 3/4" Sch40',    type: 'pipe',  od: 26.67, wall: 2.87, massPerM: 1.69, minBendRadiusMult: 5, costUSDPerM: 5.50 },
    { id: 'cs-sch40-1',     label: 'Carbon steel 1" Sch40',      type: 'pipe',  od: 33.40, wall: 3.38, massPerM: 2.50, minBendRadiusMult: 5, costUSDPerM: 7.10 },
    { id: 'cs-sch40-2',     label: 'Carbon steel 2" Sch40',      type: 'pipe',  od: 60.32, wall: 3.91, massPerM: 5.43, minBendRadiusMult: 5, costUSDPerM: 16.00 },
    { id: 'cs-sch40-4',     label: 'Carbon steel 4" Sch40',      type: 'pipe',  od: 114.30,wall: 6.02, massPerM: 16.07,minBendRadiusMult: 5, costUSDPerM: 38.00 },
    // PVC Sch 40 per ASTM D1785.
    { id: 'pvc-sch40-1',    label: 'PVC 1" Sch40',                type: 'pipe',  od: 33.40, wall: 3.38, massPerM: 0.46, minBendRadiusMult: 8, costUSDPerM: 1.20 },
    { id: 'pvc-sch40-2',    label: 'PVC 2" Sch40',                type: 'pipe',  od: 60.32, wall: 3.91, massPerM: 1.01, minBendRadiusMult: 8, costUSDPerM: 2.80 },
    // Copper Type L per ASTM B88.
    { id: 'cu-l-3/4',       label: 'Copper Type L 3/4"',          type: 'pipe',  od: 22.22, wall: 1.02, massPerM: 0.59, minBendRadiusMult: 4, costUSDPerM: 14.30 },
    { id: 'cu-l-1',         label: 'Copper Type L 1"',            type: 'pipe',  od: 28.58, wall: 1.27, massPerM: 0.95, minBendRadiusMult: 4, costUSDPerM: 19.20 },
];

export const CABLE_SPECS = [
    // Flexible UL listed multi-stranded copper THWN per NEC.
    { id: 'thwn-12awg',     label: 'THWN-2 12 AWG',               type: 'cable', od: 3.84,  massPerM: 0.062, minBendRadiusMult: 4, costUSDPerM: 0.85,  ampacity: 25 },
    { id: 'thwn-10awg',     label: 'THWN-2 10 AWG',               type: 'cable', od: 4.67,  massPerM: 0.093, minBendRadiusMult: 4, costUSDPerM: 1.15,  ampacity: 35 },
    { id: 'thwn-8awg',      label: 'THWN-2 8 AWG',                type: 'cable', od: 6.20,  massPerM: 0.149, minBendRadiusMult: 4, costUSDPerM: 2.20,  ampacity: 50 },
    { id: 'thwn-4awg',      label: 'THWN-2 4 AWG',                type: 'cable', od: 9.40,  massPerM: 0.373, minBendRadiusMult: 6, costUSDPerM: 5.50,  ampacity: 95 },
    { id: 'thwn-1/0awg',    label: 'THWN-2 1/0 AWG',              type: 'cable', od: 12.95, massPerM: 0.594, minBendRadiusMult: 6, costUSDPerM: 9.20,  ampacity: 150 },
];

const ALL_SPECS = [...PIPE_SPECS, ...CABLE_SPECS];

// Compute polyline length, mass, cost, count of bends that exceed the spec's
// minimum bend angle (so an elbow fitting must be inserted at that vertex).
export function analyseRoute(nodes, specId) {
    const spec = ALL_SPECS.find((s) => s.id === specId);
    if (!spec) throw new Error(`RoutingWorkbench: spec ${specId} not found`);
    if (!Array.isArray(nodes) || nodes.length < 2) {
        return { length_m: 0, mass_kg: 0, cost_USD: 0, segmentCount: 0, elbows: [], spec };
    }
    let totalLen_mm = 0;
    const elbows = [];
    for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        totalLen_mm += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    for (let i = 1; i < nodes.length - 1; i++) {
        const a = nodes[i - 1], b = nodes[i], c = nodes[i + 1];
        const v1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
        const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
        const m1 = Math.sqrt(v1.x*v1.x + v1.y*v1.y + v1.z*v1.z);
        const m2 = Math.sqrt(v2.x*v2.x + v2.y*v2.y + v2.z*v2.z);
        if (m1 < 1e-9 || m2 < 1e-9) continue;
        const dot = (v1.x*v2.x + v1.y*v2.y + v1.z*v2.z) / (m1 * m2);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot))); // rad
        if (angle > 1 * Math.PI / 180) {
            elbows.push({
                index: i,
                location: { ...b },
                deflection_deg: angle * 180 / Math.PI,
                bendRadius_mm: spec.minBendRadiusMult * spec.od,
            });
        }
    }
    const length_m = totalLen_mm / 1000;
    const mass_kg = length_m * spec.massPerM;
    const cost_USD = length_m * spec.costUSDPerM;
    return {
        length_m, mass_kg, cost_USD,
        segmentCount: nodes.length - 1,
        elbows,
        spec,
    };
}

if (typeof window !== 'undefined') {
    window.forge = window.forge || {};
    window.forge.routing = {
        pipeSpecs:  () => PIPE_SPECS.slice(),
        cableSpecs: () => CABLE_SPECS.slice(),
        analyse:    analyseRoute,
        insert:     (nodes, specId) => {
            const report = analyseRoute(nodes, specId);
            try {
                window.dispatchEvent(new CustomEvent('forge:insert-route', { detail: { nodes, report } }));
            } catch {}
            return report;
        },
    };
}

export function RoutingWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [specId, setSpecId] = useState('cs-sch40-1');
    const [nodesCsv, setNodesCsv] = useState('0,0,0\n200,0,0\n200,150,0\n200,150,80');
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        window.__forgeOpenRoutingWorkbench  = () => setOpen(true);
        window.__forgeCloseRoutingWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenRoutingWorkbench; delete window.__forgeCloseRoutingWorkbench; };
    }, []);

    const nodes = useMemo(() => {
        return nodesCsv.split('\n').filter((s) => s.trim()).map((line) => {
            const [x, y, z] = line.split(',').map(Number);
            return { x, y, z };
        });
    }, [nodesCsv]);

    const run = () => {
        try {
            const r = analyseRoute(nodes, specId);
            setReport(r);
            setError(null);
            window.dispatchEvent(new CustomEvent('forge:insert-route', { detail: { nodes, report: r } }));
        } catch (e) { setError(String(e.message || e)); setReport(null); }
    };

    if (!open) return null;

    return createPortal(
        <div data-testid="forge-route-panel"
             style={{ position: 'fixed', top: 90, right: 24, width: 520,
                      background: '#161b22', color: '#c9d1d9',
                      border: '1px solid #30363d', borderRadius: 8, padding: 14,
                      zIndex: 7000, fontFamily: 'system-ui, sans-serif', fontSize: 13,
                      boxShadow: '0 14px 40px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>Routing (piping &amp; cable)</strong>
                <button onClick={() => setOpen(false)} style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ marginBottom: 8 }}>
                <label>Spec:</label>
                <select data-testid="forge-route-spec" value={specId} onChange={(e) => setSpecId(e.target.value)}
                        style={{ width: '100%', background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '6px 8px' }}>
                    <optgroup label="Pipes">
                        {PIPE_SPECS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </optgroup>
                    <optgroup label="Cables">
                        {CABLE_SPECS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </optgroup>
                </select>
            </div>
            <div style={{ marginBottom: 8 }}>
                <label>Route nodes (one per line: x,y,z mm):</label>
                <textarea data-testid="forge-route-nodes" value={nodesCsv} onChange={(e) => setNodesCsv(e.target.value)}
                          rows={6}
                          style={{ width: '100%', boxSizing: 'border-box', background: '#0d1117', color: '#c9d1d9',
                                   border: '1px solid #30363d', borderRadius: 4, padding: 6,
                                   fontFamily: 'monospace', fontSize: 12 }}/>
            </div>
            <button data-testid="forge-route-analyse" onClick={run}
                    style={{ width: '100%', background: '#238636', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 14px', cursor: 'pointer' }}>
                Analyse + insert
            </button>
            {error && <div data-testid="forge-route-error" style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}
            {report && (
                <div data-testid="forge-route-report" style={{ marginTop: 10, padding: 10, background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, fontSize: 12 }}>
                    <div>spec: <strong>{report.spec.label}</strong></div>
                    <div>length: <span data-testid="forge-route-length">{report.length_m.toFixed(3)}</span> m</div>
                    <div>mass:   <span data-testid="forge-route-mass">{report.mass_kg.toFixed(3)}</span> kg</div>
                    <div>cost:   <span data-testid="forge-route-cost">${report.cost_USD.toFixed(2)}</span></div>
                    <div>segments: {report.segmentCount}  ·  elbows required: <span data-testid="forge-route-elbows">{report.elbows.length}</span></div>
                    {report.elbows.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                            {report.elbows.map((e, i) => (
                                <div key={i} style={{ fontSize: 11, color: '#8b949e' }}>
                                    elbow {i + 1}: vtx {e.index} at ({e.location.x},{e.location.y},{e.location.z})  Δ={e.deflection_deg.toFixed(1)}°  R={e.bendRadius_mm.toFixed(1)} mm
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>,
        document.body
    );
}
