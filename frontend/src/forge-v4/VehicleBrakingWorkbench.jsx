// Forge-298 — Vehicle braking energy panel.
// Hierarchy: Tools menu → Site & civil → Transportation → Vehicle braking.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function VehicleBrakingWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [m,   setM]   = useState(1500);
    const [v0,  setV0]  = useState(100);
    const [a,   setA]   = useState(6);
    const [n,   setN]   = useState(4);
    const [md,  setMd]  = useState(5);
    const [cp,  setCp]  = useState(460);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenVehicleBrakingWorkbench  = () => setOpen(true);
        window.__forgeCloseVehicleBrakingWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenVehicleBrakingWorkbench;
            delete window.__forgeCloseVehicleBrakingWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.vehbrake?.analyse({
                vehicleMassKg:         Number(m),
                initialSpeedKmH:       Number(v0),
                decelerationMs2:       Number(a),
                brakeCount:            Number(n),
                discMassKg:            Number(md),
                discSpecificHeatJkgK:  Number(cp),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-vehbrake-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Vehicle braking · KE → heat</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="m (kg) vehicle"     v={m}  set={setM}/>
            <Row label="v_0 (km/h)"         v={v0} set={setV0}/>
            <Row label="a (m/s²) decel"     v={a}  set={setA}/>
            <Row label="n brake discs"      v={n}  set={setN}/>
            <Row label="m_disc (kg) each"   v={md} set={setMd}/>
            <Row label="c_p (J/kg·K)"        v={cp} set={setCp}/>

            <button data-testid="forge-vehbrake-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-vehbrake-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-vehbrake-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="v_0"          v={result.initialSpeedMs.toFixed(2) + ' m/s'}/>
                    <div data-testid="forge-vehbrake-KE"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        KE = {(result.initialKineticEnergyJ / 1000).toFixed(1)} kJ
                    </div>
                    <Line k="t_stop"        v={result.stopTimeS.toFixed(2) + ' s'}/>
                    <Line k="d_stop"        v={result.stopDistanceM.toFixed(1) + ' m'}/>
                    <Line k="F total"      v={(result.brakeForceTotalN / 1000).toFixed(1) + ' kN'}/>
                    <Line k="F/brake"      v={(result.brakeForcePerBrakeN / 1000).toFixed(2) + ' kN'}/>
                    <Line k="Q/brake"      v={(result.heatPerBrakeJ / 1000).toFixed(1) + ' kJ'}/>
                    <div data-testid="forge-vehbrake-T"
                         style={{ marginTop: 6, fontWeight: 700,
                                  color: result.discTemperatureRiseK > 200 ? '#f85149' :
                                         result.discTemperatureRiseK > 100 ? '#d29922' : '#3fb950' }}>
                        ΔT_disc = {result.discTemperatureRiseK.toFixed(1)} K
                    </div>
                    <div data-testid="forge-vehbrake-P"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        P_avg = {(result.averagePowerW / 1000).toFixed(1)} kW
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
