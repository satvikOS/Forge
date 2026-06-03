// Forge-294 — Air filter pressure drop + fan energy panel.
// Hierarchy: Tools menu → Fluids & HVAC → Air & climate → Air filter.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function AirFilterWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Q,   setQ]   = useState(2.36);
    const [A,   setA]   = useState(1.5);
    const [dpI, setDpI] = useState(75);
    const [dpF, setDpF] = useState(250);
    const [t,   setT]   = useState(8760);
    const [eta, setEta] = useState(0.55);
    const [rate, setRate] = useState(0.12);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenAirFilterWorkbench  = () => setOpen(true);
        window.__forgeCloseAirFilterWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenAirFilterWorkbench;
            delete window.__forgeCloseAirFilterWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.airfilter?.analyse({
                flowRateM3S:            Number(Q),
                faceAreaM2:             Number(A),
                initialPressureDropPa:  Number(dpI),
                finalPressureDropPa:    Number(dpF),
                runHours:               Number(t),
                fanEfficiency:          Number(eta),
                electricityRatePerKWh:  Number(rate),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-airfilter-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Air filter · Δp + energy</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="Q (m³/s)"           v={Q}    set={setQ}/>
            <Row label="A face (m²)"        v={A}    set={setA}/>
            <Row label="Δp_initial (Pa)"    v={dpI}  set={setDpI}/>
            <Row label="Δp_final (Pa)"      v={dpF}  set={setDpF}/>
            <Row label="t (hours)"          v={t}    set={setT}/>
            <Row label="η_fan"              v={eta}  set={setEta}/>
            <Row label="$ / kWh"            v={rate} set={setRate}/>

            <button data-testid="forge-airfilter-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-airfilter-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-airfilter-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <div data-testid="forge-airfilter-v"
                         style={{ fontWeight: 700,
                                  color: result.faceVelocityInRange ? '#3fb950' : '#f85149' }}>
                        v_face = {result.faceVelocityMs.toFixed(2)} m/s
                        {!result.faceVelocityInRange && ' ⚠'}
                    </div>
                    <div style={{ fontSize: 11, color: '#8b949e' }}>
                        {result.faceVelocityInRange
                            ? 'In ASHRAE 0.5-2.5 m/s recommended band'
                            : 'Outside 0.5-2.5 m/s — resize face area'}
                    </div>
                    <Line k="Δp avg"     v={result.averagePressureDropPa.toFixed(0) + ' Pa'}/>
                    <Line k="P_fan"      v={(result.fanPowerW).toFixed(0) + ' W ('
                                          + (result.fanPowerW/1000).toFixed(2) + ' kW)'}/>
                    <div data-testid="forge-airfilter-E"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950', fontSize: 14 }}>
                        Energy = {result.energyKWh.toFixed(0)} kWh
                    </div>
                    <div data-testid="forge-airfilter-cost"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        Cost = ${result.energyCost.toFixed(2)}
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
            <input type="number" step="0.01" value={v} onChange={(e) => set(e.target.value)}
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
