// Forge-289 — Circular pipe Manning partial-flow panel (storm sewer).
// Hierarchy: Tools menu → Site & civil → Hydrology → Circular pipe partial flow.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function CircularPipeFlowWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [D, setD] = useState(1.0);
    const [d, setDepth] = useState(0.5);
    const [n, setN] = useState(0.013);
    const [S, setS] = useState(0.005);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenCircularPipeFlowWorkbench  = () => setOpen(true);
        window.__forgeCloseCircularPipeFlowWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenCircularPipeFlowWorkbench;
            delete window.__forgeCloseCircularPipeFlowWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.circpipe?.analyse({
                pipeDiameterM: Number(D),
                waterDepthM:   Number(d),
                manningN:      Number(n),
                slope:         Number(S),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-circpipe-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Storm sewer · circular pipe Manning</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="D (m)"        v={D} set={setD}/>
            <Row label="d (m) depth" v={d} set={setDepth}/>
            <Row label="n Manning"    v={n} set={setN}/>
            <Row label="S slope"      v={S} set={setS}/>
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
                n: 0.013 concrete, 0.011 PVC, 0.024 corrugated metal.
            </div>

            <button data-testid="forge-circpipe-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-circpipe-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-circpipe-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="d/D"       v={result.depthRatio.toFixed(3)}/>
                    <Line k="θ (rad)"  v={result.centralAngleRad.toFixed(3)}/>
                    <Line k="A (m²)"   v={result.flowAreaM2.toFixed(4)}/>
                    <Line k="P (m)"    v={result.wettedPerimeterM.toFixed(4)}/>
                    <Line k="R (m)"    v={result.hydraulicRadiusM.toFixed(4)}/>
                    <div data-testid="forge-circpipe-V"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        V = {result.velocityMs.toFixed(2)} m/s
                    </div>
                    <div data-testid="forge-circpipe-Q"
                         style={{ marginTop: 4, fontWeight: 700, color: '#3fb950', fontSize: 14 }}>
                        Q = {result.dischargeM3S.toFixed(3)} m³/s
                        ({result.dischargeLs.toFixed(0)} L/s)
                    </div>
                    <div style={{ marginTop: 8, padding: 6, background: '#0a0d12',
                                  borderRadius: 4, fontSize: 11 }}>
                        <div style={{ color: '#8b949e', marginBottom: 2 }}>Camp curve ratios</div>
                        <Line k="A / A_full"  v={result.areaRatio.toFixed(3)}/>
                        <Line k="V / V_full"  v={result.velocityRatio.toFixed(3)}/>
                        <Line k="Q / Q_full"  v={result.dischargeRatio.toFixed(3)}/>
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
            <span style={{ width: 130 }}>{label}</span>
            <input type="number" step="0.001" value={v} onChange={(e) => set(e.target.value)}
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
