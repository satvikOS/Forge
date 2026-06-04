// Forge-313 — Steam pipe sizing (Spirax Sarco method).
// Hierarchy: Tools menu → Fluids & HVAC → Pipe & duct flow → Steam pipe.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function SteamPipeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [P,    setP]    = useState(7);
    const [mdot, setMdot] = useState(1000);
    const [vlim, setVlim] = useState(30);
    const [L,    setL]    = useState(100);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenSteamPipeWorkbench  = () => setOpen(true);
        window.__forgeCloseSteamPipeWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenSteamPipeWorkbench;
            delete window.__forgeCloseSteamPipeWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.steampipe?.analyse({
                steamPressureBarGauge: Number(P),
                steamMassFlowKgPerH:   Number(mdot),
                velocityLimitMs:       Number(vlim),
                pipeLengthM:           Number(L),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-stp-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Steam pipe · Spirax Sarco method</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="P (bar g) gauge"        v={P}    set={setP}/>
            <Row label="ṁ (kg/h) mass flow"     v={mdot} set={setMdot}/>
            <Row label="V_limit (m/s) — 25-40"  v={vlim} set={setVlim}/>
            <Row label="L (m) pipe length"      v={L}    set={setL}/>

            <button data-testid="forge-stp-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Size</button>

            {error && <div data-testid="forge-stp-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-stp-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="T_sat"             v={result.saturationTempC.toFixed(1) + ' °C'}/>
                    <Line k="v_g spec. vol"     v={result.specificVolumeM3PerKg.toFixed(4) + ' m³/kg'}/>
                    <Line k="D required"        v={result.requiredDiameterMm.toFixed(1) + ' mm'}/>
                    <div data-testid="forge-stp-DN"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        DN = {result.standardDN.toFixed(0)} mm
                    </div>
                    <div data-testid="forge-stp-V"
                         style={{ marginTop: 4, fontWeight: 700,
                                  color: result.actualVelocityMs > 40 ? '#f85149' :
                                         result.actualVelocityMs > 30 ? '#d29922' : '#3fb950' }}>
                        V_actual = {result.actualVelocityMs.toFixed(2)} m/s
                    </div>
                    <Line k="ΔP per 100 m"      v={result.pressureDropBarPer100m.toFixed(4) + ' bar'}/>
                    <div data-testid="forge-stp-dP"
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
