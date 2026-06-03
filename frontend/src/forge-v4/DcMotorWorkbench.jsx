// Forge-279 — DC shunt motor analysis panel.
// Hierarchy: Tools menu → Electrical → DC machines → DC shunt motor.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function DcMotorWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Vt,  setVt ]   = useState(250);
    const [Ra,  setRa ]   = useState(0.2);
    const [Kp,  setKp ]   = useState(2.0);     // K_a·Φ
    const [TL,  setTL ]   = useState(50);
    const [Rf,  setRf ]   = useState(250);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenDcMotorWorkbench  = () => setOpen(true);
        window.__forgeCloseDcMotorWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenDcMotorWorkbench;
            delete window.__forgeCloseDcMotorWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.dcmotor?.analyse({
                supplyVoltageV:         Number(Vt),
                armatureResistanceOhms: Number(Ra),
                motorConstantVPerRadS:  Number(Kp),
                loadTorqueNm:           Number(TL),
                fieldResistanceOhms:    Number(Rf),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-dcmotor-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>DC shunt motor analysis</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="V_t (V)"      v={Vt} set={setVt}/>
            <Row label="R_a (Ω)"      v={Ra} set={setRa}/>
            <Row label="K_a·Φ (V·s/rad)" v={Kp} set={setKp}/>
            <Row label="T_L (Nm)"      v={TL} set={setTL}/>
            <Row label="R_f (Ω)"      v={Rf} set={setRf}/>

            <button data-testid="forge-dcmotor-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-dcmotor-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-dcmotor-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="I_a"           v={result.armatureCurrentA.toFixed(2) + ' A'}/>
                    <Line k="E_a"           v={result.backEmfV.toFixed(2) + ' V'}/>
                    <Line k="ω"             v={result.angularSpeedRadS.toFixed(2) + ' rad/s'}/>
                    <div data-testid="forge-dcmotor-rpm"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        n = {result.speedRpm.toFixed(1)} rpm
                    </div>
                    <Line k="n_0 (no-load)"  v={result.noLoadSpeedRpm.toFixed(1) + ' rpm'}/>
                    <Line k="T_stall"        v={result.stallTorqueNm.toFixed(0) + ' Nm'}/>
                    <Line k="Speed reg"      v={result.speedRegulationPct.toFixed(2) + ' %'}/>
                    <Line k="P_mech"         v={(result.mechanicalPowerW / 1000).toFixed(2) + ' kW'}/>
                    <Line k="P_in,arm"       v={(result.armatureInputPowerW / 1000).toFixed(2) + ' kW'}/>
                    <Line k="P_cu,arm"       v={result.armatureCopperLossW.toFixed(0) + ' W'}/>
                    <Line k="I_f / P_cu,fld" v={result.fieldCurrentA.toFixed(2) + ' A / ' + result.fieldCopperLossW.toFixed(0) + ' W'}/>
                    <div data-testid="forge-dcmotor-eta"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        η_armature = {(result.armatureEfficiency * 100).toFixed(2)} %
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
