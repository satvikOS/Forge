// Forge-306 — HVAC sensible + latent coil load (ASHRAE Fund. Ch 18).
// Hierarchy: Tools menu → Fluids & HVAC → Air & climate → Coil load.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function CoolingLoadWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Q,   setQ]   = useState(1000);
    const [Ts,  setTs]  = useState(13);
    const [Tr,  setTr]  = useState(26);
    const [Ws,  setWs]  = useState(0.0085);
    const [Wr,  setWr]  = useState(0.011);
    const [P,   setP]   = useState(0);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenCoolingLoadWorkbench  = () => setOpen(true);
        window.__forgeCloseCoolingLoadWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenCoolingLoadWorkbench;
            delete window.__forgeCloseCoolingLoadWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.coolingload?.analyse({
                airflowLps:       Number(Q),
                tSupplyC:         Number(Ts),
                tReturnC:         Number(Tr),
                wSupplyKgPerKg:   Number(Ws),
                wReturnKgPerKg:   Number(Wr),
                atmPressureKPa:   Number(P),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-cload-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>HVAC coil load · sensible + latent</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="Q (L/s) airflow"          v={Q}  set={setQ}/>
            <Row label="T_supply (°C)"            v={Ts} set={setTs}/>
            <Row label="T_return (°C)"            v={Tr} set={setTr}/>
            <Row label="ω_supply (kg/kg)"         v={Ws} set={setWs}/>
            <Row label="ω_return (kg/kg)"         v={Wr} set={setWr}/>
            <Row label="p_atm (kPa, 0=ρ=1.20)"    v={P}  set={setP}/>

            <button data-testid="forge-cload-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-cload-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-cload-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="ṁ"               v={result.massFlowKgPerS.toFixed(3) + ' kg/s'}/>
                    <Line k="Q_sensible"      v={result.sensibleLoadKw.toFixed(2) + ' kW'}/>
                    <Line k="Q_latent"        v={result.latentLoadKw.toFixed(2) + ' kW'}/>
                    <div data-testid="forge-cload-total"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        Q_total = {Math.abs(result.totalLoadKw).toFixed(2)} kW
                    </div>
                    <div data-testid="forge-cload-shr"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        SHR = {result.sensibleHeatRatio.toFixed(3)}
                    </div>
                    <div data-testid="forge-cload-mode"
                         style={{ marginTop: 8, padding: '4px 8px', borderRadius: 4,
                                  background: result.modeName === 'cooling' ? '#1d2d3d' : '#3d2d0d',
                                  color: result.modeName === 'cooling' ? '#58a6ff' : '#d29922',
                                  fontWeight: 700, textAlign: 'center' }}>
                        Mode: {result.modeName.toUpperCase()}
                    </div>
                    <Line k="Δh (kJ/kg dry)"  v={result.enthalpyDifferenceKjKg.toFixed(2)}/>
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
