// Forge-310 — Block-shear rupture (AISC 360-22 §J4.3).
// Hierarchy: Tools menu → Structural → Connections → Block shear.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function BlockShearWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [agv, setAgv] = useState(2000);
    const [anv, setAnv] = useState(1600);
    const [ant, setAnt] = useState(250);
    const [ubs, setUbs] = useState(1.0);
    const [fy, setFy]   = useState(345);
    const [fu, setFu]   = useState(450);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenBlockShearWorkbench  = () => setOpen(true);
        window.__forgeCloseBlockShearWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenBlockShearWorkbench;
            delete window.__forgeCloseBlockShearWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.blockshear?.analyse({
                A_gv_mm2: Number(agv),
                A_nv_mm2: Number(anv),
                A_nt_mm2: Number(ant),
                U_bs:     Number(ubs),
                Fy_MPa:   Number(fy),
                Fu_MPa:   Number(fu),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-bs-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Block shear · AISC 360 §J4.3</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="A_gv (mm²) gross shear"   v={agv} set={setAgv}/>
            <Row label="A_nv (mm²) net shear"     v={anv} set={setAnv}/>
            <Row label="A_nt (mm²) net tension"   v={ant} set={setAnt}/>
            <Row label="U_bs (1=uniform, 0.5=non)" v={ubs} set={setUbs}/>
            <Row label="F_y (MPa)"                v={fy}  set={setFy}/>
            <Row label="F_u (MPa)"                v={fu}  set={setFu}/>

            <button data-testid="forge-bs-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Check</button>

            {error && <div data-testid="forge-bs-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-bs-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="Shear rupture"   v={(result.shearRuptureCapN / 1000).toFixed(1) + ' kN'}/>
                    <Line k="Shear yielding"  v={(result.shearYieldingCapN / 1000).toFixed(1) + ' kN'}/>
                    <Line k="Tension rupture" v={(result.tensionRuptureN / 1000).toFixed(1) + ' kN'}/>
                    <div data-testid="forge-bs-path"
                         style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4,
                                  background: '#1d2d3d', color: '#58a6ff',
                                  fontWeight: 700, textAlign: 'center' }}>
                        Governing: {result.governingPath === 1 ? 'shear rupture' : 'shear yielding'}
                    </div>
                    <div data-testid="forge-bs-Rn"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        R_n = {(result.nominalCapN / 1000).toFixed(1)} kN
                    </div>
                    <div data-testid="forge-bs-LRFD"
                         style={{ marginTop: 4, fontWeight: 700, color: '#3fb950' }}>
                        φR_n = {(result.LRFDcapN / 1000).toFixed(1)} kN  (φ = 0.75)
                    </div>
                    <div data-testid="forge-bs-ASD"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        R_n/Ω = {(result.ASDcapN / 1000).toFixed(1)} kN  (Ω = 2.00)
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
}

function Row({ label, v, set }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', margin: '5px 0' }}>
            <span style={{ width: 180 }}>{label}</span>
            <input type="number" value={v} onChange={(e) => set(e.target.value)}
                   style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                            border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}/>
        </div>
    );
}

function Line({ k, v }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span style={{ color: '#8b949e' }}>{k}</span>
            <span>{v}</span>
        </div>
    );
}
