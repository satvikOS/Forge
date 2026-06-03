// Forge-275 — Janssen silo pressure panel (1895).
// Hierarchy: Tools menu → Structural → Foundations → Silo pressure.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function SiloPressureWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [gamma, setGamma] = useState(8);     // kN/m³
    const [R,     setR    ] = useState(2);     // m
    const [mu,    setMu   ] = useState(0.4);
    const [k,     setK    ] = useState(0.4);
    const [z,     setZ    ] = useState(10);    // m
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenSiloPressureWorkbench  = () => setOpen(true);
        window.__forgeCloseSiloPressureWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenSiloPressureWorkbench;
            delete window.__forgeCloseSiloPressureWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.silopressure?.analyse({
                bulkUnitWeightKnM3:      Number(gamma),
                hydraulicRadiusM:        Number(R),
                wallFrictionCoefficient: Number(mu),
                horizontalRatioK:        Number(k),
                depthM:                  Number(z),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-silopressure-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 380,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Janssen silo pressure</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="γ (kN/m³)"     v={gamma} set={setGamma}/>
            <Row label="R (m) hydraulic" v={R} set={setR}/>
            <Row label="μ wall friction"  v={mu} set={setMu}/>
            <Row label="k = σ_h/σ_v"     v={k} set={setK}/>
            <Row label="z (m) depth"     v={z} set={setZ}/>

            <button data-testid="forge-silopressure-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-silopressure-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-silopressure-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="z / z_c"    v={result.depthRatioToZc.toFixed(3)}/>
                    <div data-testid="forge-silopressure-pv"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        p_v(z) = {result.verticalPressureKPa.toFixed(2)} kPa
                    </div>
                    <div data-testid="forge-silopressure-pw"
                         style={{ fontWeight: 700, color: '#3fb950' }}>
                        p_w(z) = {result.wallPressureKPa.toFixed(2)} kPa
                    </div>
                    <Line k="τ_w(z)"     v={result.frictionStressKPa.toFixed(2) + ' kPa'}/>
                    <div style={{ marginTop: 8, padding: 6, background: '#0a0d12',
                                  borderRadius: 4, fontSize: 11 }}>
                        <div style={{ color: '#8b949e', marginBottom: 2 }}>Asymptotes (z → ∞)</div>
                        <Line k="p_v,∞"  v={result.asymptoticVerticalKPa.toFixed(1) + ' kPa'}/>
                        <Line k="p_w,∞"  v={result.asymptoticWallKPa.toFixed(1) + ' kPa'}/>
                        <Line k="τ_w,∞"  v={result.asymptoticFrictionKPa.toFixed(2) + ' kPa'}/>
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
            <span style={{ width: 140 }}>{label}</span>
            <input type="number" step="0.1" value={v} onChange={(e) => set(e.target.value)}
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
