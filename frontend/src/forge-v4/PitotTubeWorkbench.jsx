// Forge-288 — Pitot tube velocity measurement panel.
// Hierarchy: Tools menu → Fluids & HVAC → Pipe & duct flow → Pitot tube.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function PitotTubeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [dp,  setDp]  = useState(150);     // Pa
    const [rho, setRho] = useState(1.20);    // kg/m³ (air STP)
    const [C,   setC]   = useState(1.0);
    const [A,   setA]   = useState(0.5);     // m²
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenPitotTubeWorkbench  = () => setOpen(true);
        window.__forgeClosePitotTubeWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenPitotTubeWorkbench;
            delete window.__forgeClosePitotTubeWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.pitot?.analyse({
                dynamicPressurePa: Number(dp),
                densityKgM3:       Number(rho),
                pitotCoefficient:  Number(C),
                flowAreaM2:        Number(A),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-pitot-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 380,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Pitot tube · incompressible</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="Δp (Pa)"      v={dp}  set={setDp}/>
            <Row label="ρ (kg/m³)"    v={rho} set={setRho}/>
            <Row label="C probe"      v={C}   set={setC}/>
            <Row label="A (m²)"        v={A}   set={setA}/>

            <button data-testid="forge-pitot-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-pitot-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-pitot-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <div data-testid="forge-pitot-v"
                         style={{ fontWeight: 700, fontSize: 16, color: '#3fb950' }}>
                        v = {result.velocityMs.toFixed(2)} m/s
                    </div>
                    <Line k="Velocity head h_v"  v={result.velocityHeadM.toFixed(3) + ' m of fluid'}/>
                    {result.volumeFlowM3S > 0 && (
                        <>
                            <Line k="Q"   v={result.volumeFlowM3S.toFixed(3) + ' m³/s ('
                                          + (result.volumeFlowM3S * 1000).toFixed(0) + ' L/s)'}/>
                            <Line k="ṁ"  v={result.massFlowKgS.toFixed(3) + ' kg/s'}/>
                        </>
                    )}
                </div>
            )}
        </div>,
        document.body
    );
}

function Row({ label, v, set }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', margin: '5px 0' }}>
            <span style={{ width: 140 }}>{label}</span>
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
