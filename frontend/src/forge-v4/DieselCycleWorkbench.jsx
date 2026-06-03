// Forge-277 — Air-standard Diesel cycle panel.
// Hierarchy: Tools menu → Fluids & HVAC → Combustion → Diesel cycle.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function DieselCycleWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [r,    setR  ]  = useState(18);
    const [rc,   setRc ]  = useState(2);
    const [T1,   setT1 ]  = useState(300);
    const [p1,   setP1 ]  = useState(100);
    const [gam,  setGam]  = useState(1.4);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenDieselCycleWorkbench  = () => setOpen(true);
        window.__forgeCloseDieselCycleWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenDieselCycleWorkbench;
            delete window.__forgeCloseDieselCycleWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.diesel?.analyse({
                compressionRatio:   Number(r),
                cutoffRatio:        Number(rc),
                intakeTemperatureK: Number(T1),
                intakePressureKPa:  Number(p1),
                specificHeatRatio:  Number(gam),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-diesel-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Diesel cycle · air-standard</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="r (compression)" v={r}   set={setR}/>
            <Row label="r_c (cutoff)"     v={rc}  set={setRc}/>
            <Row label="T_1 (K)"          v={T1}  set={setT1}/>
            <Row label="p_1 (kPa)"        v={p1}  set={setP1}/>
            <Row label="γ"               v={gam} set={setGam}/>

            <button data-testid="forge-diesel-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute Cycle</button>

            {error && <div data-testid="forge-diesel-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-diesel-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                                  gap: '2px 8px', marginBottom: 6 }}>
                        <span style={{ color: '#8b949e' }}>State</span>
                        <span style={{ color: '#8b949e' }}>T (K)</span>
                        <span style={{ color: '#8b949e' }}>p (kPa)</span>
                        <span>1 (intake)</span><span>{T1}</span><span>{p1}</span>
                        <span>2 (TDC)</span><span>{result.t2K.toFixed(0)}</span><span>{result.p2KPa.toFixed(0)}</span>
                        <span>3 (cutoff)</span><span>{result.t3K.toFixed(0)}</span><span>{result.p3KPa.toFixed(0)}</span>
                        <span>4 (BDC)</span><span>{result.t4K.toFixed(0)}</span><span>{result.p4KPa.toFixed(0)}</span>
                    </div>
                    <Line k="c_v / c_p"      v={result.cVKJkgK.toFixed(3) + ' / ' + result.cPKJkgK.toFixed(3) + ' kJ/(kg·K)'}/>
                    <Line k="q_in (c_p ΔT)"  v={result.qInKJkg.toFixed(1) + ' kJ/kg'}/>
                    <Line k="q_out (c_v ΔT)" v={result.qOutKJkg.toFixed(1) + ' kJ/kg'}/>
                    <div data-testid="forge-diesel-wnet"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        w_net = {result.wNetKJkg.toFixed(1)} kJ/kg
                    </div>
                    <div data-testid="forge-diesel-eta"
                         style={{ marginTop: 4, fontWeight: 700, color: '#3fb950' }}>
                        η_th = {(result.thermalEfficiency * 100).toFixed(2)} %
                    </div>
                    <div data-testid="forge-diesel-mep"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        MEP = {result.meanEffectivePressureKPa.toFixed(0)} kPa
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
