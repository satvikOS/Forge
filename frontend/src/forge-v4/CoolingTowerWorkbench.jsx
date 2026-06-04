// Forge-308 — Cooling tower performance (ASHRAE HVAC Systems Ch 40).
// Hierarchy: Tools menu → Fluids & HVAC → Air & climate → Cooling tower.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function CoolingTowerWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Q,  setQ]  = useState(100);
    const [Ti, setTi] = useState(35);
    const [To, setTo] = useState(30);
    const [Tw, setTw] = useState(24);
    const [c,  setC]  = useState(4);
    const [d,  setD]  = useState(2e-5);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenCoolingTowerWorkbench  = () => setOpen(true);
        window.__forgeCloseCoolingTowerWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenCoolingTowerWorkbench;
            delete window.__forgeCloseCoolingTowerWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.coolingtower?.analyse({
                waterFlowLps:          Number(Q),
                inletTempC:            Number(Ti),
                outletTempC:           Number(To),
                wetBulbTempC:          Number(Tw),
                cyclesOfConcentration: Number(c),
                driftFraction:         Number(d),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-ct-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Cooling tower · range / approach / makeup</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="Q_w (L/s) water flow"      v={Q}  set={setQ}/>
            <Row label="T_in (°C) condenser ret"   v={Ti} set={setTi}/>
            <Row label="T_out (°C) supply"         v={To} set={setTo}/>
            <Row label="T_wb (°C) design wet bulb" v={Tw} set={setTw}/>
            <Row label="CoC cycles"                v={c}  set={setC}/>
            <Row label="Drift fraction (~2e-5)"    v={d}  set={setD}/>

            <button data-testid="forge-ct-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-ct-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-ct-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="Range"           v={result.rangeK.toFixed(2) + ' K'}/>
                    <div data-testid="forge-ct-approach"
                         style={{ fontWeight: 700,
                                  color: result.approachK < 3 ? '#f85149' :
                                         result.approachK < 5 ? '#d29922' : '#3fb950' }}>
                        Approach = {result.approachK.toFixed(2)} K
                    </div>
                    <div data-testid="forge-ct-Q"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        Q_rej = {result.heatRejectionKw.toFixed(1)} kW
                    </div>
                    <Line k="Evaporation"     v={result.evaporationLps.toFixed(4) + ' L/s ('
                                              + result.evaporationPercent.toFixed(2) + ' %)'}/>
                    <Line k="Bleed/blow-down" v={result.bleedLps.toFixed(4) + ' L/s'}/>
                    <Line k="Drift"           v={result.driftLps.toFixed(5) + ' L/s'}/>
                    <div data-testid="forge-ct-makeup"
                         style={{ marginTop: 6, fontWeight: 700, color: '#58a6ff' }}>
                        Make-up = {result.makeupLps.toFixed(3)} L/s ({result.makeupPercent.toFixed(2)} %)
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
