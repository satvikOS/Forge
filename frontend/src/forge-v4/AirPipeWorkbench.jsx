// Forge-314 — Compressed-air pipe sizing (CAGI method).
// Hierarchy: Tools menu → Fluids & HVAC → Pipe & duct flow → Compressed air.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function AirPipeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [P,    setP]    = useState(7);
    const [Q,    setQ]    = useState(20);
    const [vlim, setVlim] = useState(10);
    const [L,    setL]    = useState(100);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenAirPipeWorkbench  = () => setOpen(true);
        window.__forgeCloseAirPipeWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenAirPipeWorkbench;
            delete window.__forgeCloseAirPipeWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.airpipe?.analyse({
                supplyPressureBarGauge:  Number(P),
                freeAirDeliveryM3PerMin: Number(Q),
                velocityLimitMs:         Number(vlim),
                pipeLengthM:             Number(L),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-ap-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Compressed air · CAGI sizing</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="P (bar g) supply"        v={P}    set={setP}/>
            <Row label="Q_FAD (m³/min) free air" v={Q}    set={setQ}/>
            <Row label="V_limit (m/s) — 6-20"    v={vlim} set={setVlim}/>
            <Row label="L (m) pipe length"       v={L}    set={setL}/>

            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
                Mains 6-9 · branches 10-15 · drops 15-20 m/s
            </div>

            <button data-testid="forge-ap-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Size</button>

            {error && <div data-testid="forge-ap-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-ap-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="p_abs"            v={result.absolutePressureBar.toFixed(3) + ' bar'}/>
                    <Line k="ρ_air"            v={result.airDensityKgPerM3.toFixed(3) + ' kg/m³'}/>
                    <Line k="Q_line"           v={(result.actualVolumeFlowM3PerS * 60).toFixed(3) + ' m³/min'}/>
                    <Line k="D required"       v={result.requiredDiameterMm.toFixed(2) + ' mm'}/>
                    <div data-testid="forge-ap-DN"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        DN = {result.standardDN.toFixed(0)} mm
                    </div>
                    <div data-testid="forge-ap-V"
                         style={{ marginTop: 4, fontWeight: 700,
                                  color: result.actualVelocityMs > 20 ? '#f85149' :
                                         result.actualVelocityMs > 15 ? '#d29922' : '#3fb950' }}>
                        V_actual = {result.actualVelocityMs.toFixed(2)} m/s
                    </div>
                    <Line k="ΔP per 100 m"     v={result.pressureDropBarPer100m.toFixed(5) + ' bar'}/>
                    <div data-testid="forge-ap-dP"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        ΔP_total = {result.totalPressureDropBar.toFixed(4)} bar
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
