// Forge-282 — Reciprocating compressor sizing panel.
// Hierarchy: Tools menu → Fluids & HVAC → Air & climate → Reciprocating compressor.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function ReciprocatingCompressorWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [p1,   setP1]   = useState(100);     // kPa
    const [T1,   setT1]   = useState(300);     // K
    const [p2,   setP2]   = useState(800);     // kPa
    const [m,    setM ]   = useState(0.5);     // kg/s
    const [n,    setN ]   = useState(1.35);
    const [etaP, setEtaP] = useState(0.80);
    const [c,    setC ]   = useState(0.05);
    const [R,    setR ]   = useState(287);     // J/(kg·K)
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenReciprocatingCompressorWorkbench  = () => setOpen(true);
        window.__forgeCloseReciprocatingCompressorWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenReciprocatingCompressorWorkbench;
            delete window.__forgeCloseReciprocatingCompressorWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.compressor?.analyse({
                inletPressurePa:      Number(p1) * 1000,
                inletTemperatureK:    Number(T1),
                dischargePressurePa:  Number(p2) * 1000,
                massFlowKgS:          Number(m),
                polytropicIndexN:     Number(n),
                polytropicEfficiency: Number(etaP),
                clearanceRatioC:      Number(c),
                gasConstantJkgK:      Number(R),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-compressor-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Recip. compressor · polytropic</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="p_1 (kPa)"        v={p1}   set={setP1}/>
            <Row label="T_1 (K)"          v={T1}   set={setT1}/>
            <Row label="p_2 (kPa)"        v={p2}   set={setP2}/>
            <Row label="ṁ (kg/s)"        v={m}    set={setM}/>
            <Row label="n (polytropic)" v={n}    set={setN}/>
            <Row label="η_p"             v={etaP} set={setEtaP}/>
            <Row label="c clearance"    v={c}    set={setC}/>
            <Row label="R (J/kg·K)"     v={R}    set={setR}/>

            <button data-testid="forge-compressor-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-compressor-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-compressor-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="π = p_2/p_1"    v={result.pressureRatio.toFixed(2)}/>
                    <Line k="T_2"             v={result.dischargeTemperatureK.toFixed(1) + ' K'}/>
                    <Line k="ΔT"              v={result.temperatureRiseK.toFixed(1) + ' K'}/>
                    <Line k="H_polytropic"   v={(result.polytropicHeadJkg / 1000).toFixed(1) + ' kJ/kg'}/>
                    <Line k="H_isothermal"   v={(result.isothermalEquivalentHeadJkg / 1000).toFixed(1) + ' kJ/kg'}/>
                    <div data-testid="forge-compressor-etav"
                         style={{ marginTop: 6, fontWeight: 700,
                                  color: result.volumetricEfficiency > 0.8 ? '#3fb950' :
                                         result.volumetricEfficiency > 0.6 ? '#d29922' : '#f85149' }}>
                        η_v = {(result.volumetricEfficiency * 100).toFixed(1)} %
                    </div>
                    <div data-testid="forge-compressor-P"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff', fontSize: 14 }}>
                        P_brake = {(result.brakePowerW / 1000).toFixed(2)} kW
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
            <input type="number" step="0.05" value={v} onChange={(e) => set(e.target.value)}
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
