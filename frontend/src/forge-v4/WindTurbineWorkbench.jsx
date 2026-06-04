// Forge-315 — Wind turbine power output (Betz / actuator-disc).
// Hierarchy: Tools menu → MEP → Electrical → Wind turbine.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function WindTurbineWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [D,   setD]   = useState(100);
    const [V,   setV]   = useState(10);
    const [rho, setRho] = useState(1.225);
    const [cp,  setCp]  = useState(0.40);
    const [eta, setEta] = useState(0.95);
    const [rpm, setRpm] = useState(15);
    const [cf,  setCf]  = useState(0.30);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenWindTurbineWorkbench  = () => setOpen(true);
        window.__forgeCloseWindTurbineWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenWindTurbineWorkbench;
            delete window.__forgeCloseWindTurbineWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.windturbine?.analyse({
                rotorDiameterM:      Number(D),
                windSpeedMs:         Number(V),
                airDensityKgPerM3:   Number(rho),
                powerCoefficient:    Number(cp),
                generatorEfficiency: Number(eta),
                rotorSpeedRpm:       Number(rpm),
                capacityFactor:      Number(cf),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-wt-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Wind turbine · Betz / actuator-disc</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="D (m) rotor"            v={D}   set={setD}/>
            <Row label="V (m/s) wind"           v={V}   set={setV}/>
            <Row label="ρ (kg/m³) air"          v={rho} set={setRho}/>
            <Row label="C_P (≤ 0.593 Betz)"     v={cp}  set={setCp}/>
            <Row label="η drivetrain"           v={eta} set={setEta}/>
            <Row label="N (rpm, 0=skip λ)"      v={rpm} set={setRpm}/>
            <Row label="Capacity factor (0-1)"  v={cf}  set={setCf}/>

            <button data-testid="forge-wt-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-wt-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-wt-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="Swept area"      v={result.sweptAreaM2.toFixed(0) + ' m²'}/>
                    <Line k="P_wind avail"    v={(result.availableWindPowerW / 1e6).toFixed(3) + ' MW'}/>
                    <Line k="P_Betz ceiling"  v={(result.betzCeilingPowerW / 1e6).toFixed(3) + ' MW'}/>
                    <Line k="P_mech"          v={(result.mechanicalPowerW / 1e6).toFixed(3) + ' MW'}/>
                    <div data-testid="forge-wt-Pelec"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        P_elec = {(result.electricalPowerW / 1e6).toFixed(3)} MW
                    </div>
                    {result.tipSpeedRatio > 0 && (
                        <div data-testid="forge-wt-tsr"
                             style={{ marginTop: 4, fontWeight: 700,
                                      color: result.tipSpeedRatio < 5 || result.tipSpeedRatio > 10
                                             ? '#d29922' : '#58a6ff' }}>
                            λ = {result.tipSpeedRatio.toFixed(2)} {result.tipSpeedRatio < 5 || result.tipSpeedRatio > 10 ? '(off-design)' : ''}
                        </div>
                    )}
                    <div data-testid="forge-wt-AEP"
                         style={{ marginTop: 6, fontWeight: 700, color: '#58a6ff' }}>
                        AEP = {result.annualEnergyMWh.toFixed(0)} MWh
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
