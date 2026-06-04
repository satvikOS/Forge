// Forge-305 — Hertz point contact (Shigley §3-19).
// Hierarchy: Tools menu → Mechanical → Stress & buckling → Hertz point contact.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function HertzPointWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [F,  setF]  = useState(1000);
    const [R1, setR1] = useState(6);
    const [R2, setR2] = useState(1e9);
    const [E1, setE1] = useState(200000);
    const [E2, setE2] = useState(200000);
    const [v1, setV1] = useState(0.3);
    const [v2, setV2] = useState(0.3);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenHertzPointWorkbench  = () => setOpen(true);
        window.__forgeCloseHertzPointWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenHertzPointWorkbench;
            delete window.__forgeCloseHertzPointWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.hertzpoint?.analyse({
                normalForceN: Number(F),
                radius1Mm:    Number(R1),
                radius2Mm:    Number(R2),
                E1_MPa:       Number(E1),
                E2_MPa:       Number(E2),
                nu1:          Number(v1),
                nu2:          Number(v2),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-hpt-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Hertz point contact · spherical</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="F (N) normal"        v={F}  set={setF}/>
            <Row label="R₁ (mm)"             v={R1} set={setR1}/>
            <Row label="R₂ (mm) — 1e9=plane" v={R2} set={setR2}/>
            <Row label="E₁ (MPa)"            v={E1} set={setE1}/>
            <Row label="E₂ (MPa)"            v={E2} set={setE2}/>
            <Row label="ν₁"                  v={v1} set={setV1}/>
            <Row label="ν₂"                  v={v2} set={setV2}/>

            <button data-testid="forge-hpt-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-hpt-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-hpt-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="E* effective"   v={(result.effectiveModulusMPa / 1000).toFixed(2) + ' GPa'}/>
                    <Line k="R* effective"   v={result.effectiveRadiusMm.toFixed(3) + ' mm'}/>
                    <Line k="a contact"      v={result.contactRadiusMm.toFixed(4) + ' mm'}/>
                    <div data-testid="forge-hpt-pmax"
                         style={{ marginTop: 6, fontWeight: 700,
                                  color: result.maxPressureMPa > 4000 ? '#f85149' :
                                         result.maxPressureMPa > 2000 ? '#d29922' : '#3fb950' }}>
                        p_max = {result.maxPressureMPa.toFixed(0)} MPa
                    </div>
                    <Line k="p_mean"         v={result.meanPressureMPa.toFixed(0) + ' MPa'}/>
                    <Line k="δ approach"     v={result.mutualApproachMm.toFixed(5) + ' mm'}/>
                    <div data-testid="forge-hpt-tau"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        τ_max = {result.maxShearStressMPa.toFixed(0)} MPa
                    </div>
                    <Line k="z τ_max depth"  v={result.depthOfMaxShearMm.toFixed(4) + ' mm'}/>
                </div>
            )}
        </div>,
        document.body
    );
}

function Row({ label, v, set }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', margin: '5px 0' }}>
            <span style={{ width: 170 }}>{label}</span>
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
