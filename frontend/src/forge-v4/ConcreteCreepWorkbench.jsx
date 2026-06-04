// Forge-316 — Concrete creep + shrinkage (ACI 209R-92).
// Hierarchy: Tools menu → Structural → Concrete → Creep & shrinkage.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function ConcreteCreepWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [sig,   setSig]   = useState(10);
    const [Ec,    setEc]    = useState(30000);
    const [H,     setH]     = useState(50);
    const [tla,   setTla]   = useState(28);
    const [t,     setT]     = useState(10000);
    const [phiU,  setPhiU]  = useState(0);
    const [eshU,  setEshU]  = useState(0);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenConcreteCreepWorkbench  = () => setOpen(true);
        window.__forgeCloseConcreteCreepWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenConcreteCreepWorkbench;
            delete window.__forgeCloseConcreteCreepWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.concretecreep?.analyse({
                sustainedStressMPa:      Number(sig),
                concreteModulusMPa:      Number(Ec),
                ambientHumidityPercent:  Number(H),
                loadingAgeDays:          Number(tla),
                timeAfterLoadingDays:    Number(t),
                ultimateCreepCoeff:      Number(phiU),
                ultimateShrinkageStrain: Number(eshU),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-cr-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Creep + shrinkage · ACI 209R-92</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="σ_sus (MPa)"            v={sig}  set={setSig}/>
            <Row label="E_c (MPa)"              v={Ec}   set={setEc}/>
            <Row label="H (% ambient RH)"       v={H}    set={setH}/>
            <Row label="t_la (days at loading)" v={tla}  set={setTla}/>
            <Row label="t (days after loading)" v={t}    set={setT}/>
            <Row label="φ_u override (0=ACI)"   v={phiU} set={setPhiU}/>
            <Row label="ε_sh,u override (0=ACI)" v={eshU} set={setEshU}/>

            <button data-testid="forge-cr-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-cr-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-cr-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="γ_h,creep"        v={result.humidityFactorCreep.toFixed(3)}/>
                    <Line k="γ_h,shrink"       v={result.humidityFactorShrink.toFixed(3)}/>
                    <Line k="γ_la"             v={result.loadAgeFactor.toFixed(3)}/>
                    <Line k="φ_u applied"      v={result.appliedUltimateCreep.toFixed(3)}/>
                    <Line k="ε_sh,u (µε)"      v={(result.appliedUltimateShrink * 1e6).toFixed(0)}/>
                    <div data-testid="forge-cr-phi"
                         style={{ marginTop: 6, fontWeight: 700, color: '#d29922' }}>
                        φ(t,t₀) = {result.creepCoefficient.toFixed(3)}
                    </div>
                    <div data-testid="forge-cr-eps_sh"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        ε_sh = {(result.shrinkageStrain * 1e6).toFixed(0)} µε
                    </div>
                    <Line k="ε_inst (µε)"      v={(result.instantaneousStrain * 1e6).toFixed(0)}/>
                    <Line k="ε_creep (µε)"     v={(result.creepStrain * 1e6).toFixed(0)}/>
                    <div data-testid="forge-cr-total"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        ε_total = {(result.totalLongTermStrain * 1e6).toFixed(0)} µε
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
            <span style={{ width: 200 }}>{label}</span>
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
