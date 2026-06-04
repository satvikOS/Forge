// Forge-303 — Hazen-Williams pipe friction (NFPA 13 / AWWA).
// Hierarchy: Tools menu → Fluids & HVAC → Pipe & duct flow → Hazen-Williams.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const REGIMES = { 1: 'Laminar — HW model invalid', 2: 'Transitional', 3: 'Turbulent' };

export function HazenWilliamsWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [L, setL] = useState(100);
    const [d, setD] = useState(100);
    const [Q, setQ] = useState(500);
    const [C, setC] = useState(120);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenHazenWilliamsWorkbench  = () => setOpen(true);
        window.__forgeCloseHazenWilliamsWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenHazenWilliamsWorkbench;
            delete window.__forgeCloseHazenWilliamsWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.hazenwilliams?.analyse({
                pipeLengthM:     Number(L),
                innerDiameterMm: Number(d),
                flowLpm:         Number(Q),
                hazenWilliamsC:  Number(C),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-hw-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Hazen-Williams · pipe friction</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="L (m) pipe length"    v={L} set={setL}/>
            <Row label="D (mm) inner dia"     v={d} set={setD}/>
            <Row label="Q (L/min) flow"       v={Q} set={setQ}/>
            <Row label="C coefficient"        v={C} set={setC}/>

            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
                steel 120 · DI 140 · PVC 150 · Cu 130 · old 80
            </div>

            <button data-testid="forge-hw-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-hw-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-hw-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="V velocity"      v={result.velocityMs.toFixed(3) + ' m/s'}/>
                    <Line k="Re ~"            v={result.reynoldsApprox.toExponential(2)}/>
                    <div data-testid="forge-hw-regime"
                         style={{ marginTop: 4, padding: '4px 8px', borderRadius: 4,
                                  background: result.regimeFlag === 3 ? '#1d2d1d' :
                                              result.regimeFlag === 2 ? '#3d2d0d' : '#3d1d1d',
                                  color: result.regimeFlag === 3 ? '#3fb950' :
                                         result.regimeFlag === 2 ? '#d29922' : '#f85149',
                                  fontWeight: 700, textAlign: 'center' }}>
                        {REGIMES[result.regimeFlag]}
                    </div>
                    <Line k="ΔP/L gradient"   v={result.pressureGradientKpaPerM.toFixed(4) + ' kPa/m'}/>
                    <div data-testid="forge-hw-dP"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        ΔP_total = {result.totalPressureLossKpa.toFixed(2)} kPa
                    </div>
                    <div data-testid="forge-hw-vhead"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        Velocity head = {result.velocityHeadKpa.toFixed(3)} kPa
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
            <span style={{ width: 160 }}>{label}</span>
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
