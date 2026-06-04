// Forge-296 — Headed shear stud connector panel (AISC 360-22 §I8).
// Hierarchy: Tools menu → Structural → Connections → Headed shear stud.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function HeadedStudWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [d,   setD]   = useState(19);
    const [fc,  setFc]  = useState(28);
    const [wc,  setWc]  = useState(2400);
    const [Fu,  setFu]  = useState(415);
    const [Rg,  setRg]  = useState(1.0);
    const [Rp,  setRp]  = useState(0.75);
    const [n,   setN]   = useState(100);
    const [Vh,  setVh]  = useState(5000);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenHeadedStudWorkbench  = () => setOpen(true);
        window.__forgeCloseHeadedStudWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenHeadedStudWorkbench;
            delete window.__forgeCloseHeadedStudWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.headedstud?.analyse({
                studDiameterMm:           Number(d),
                concreteStrengthMPa:      Number(fc),
                concreteUnitWeightKgM3:   Number(wc),
                studUltimateStressMPa:    Number(Fu),
                groupFactorRg:            Number(Rg),
                positionFactorRp:         Number(Rp),
                studCount:                Number(n),
                requiredHorizShearKN:     Number(Vh),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-headedstud-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Headed shear stud · AISC §I8</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="d_sc (mm)"        v={d}  set={setD}/>
            <Row label="f'_c (MPa)"        v={fc} set={setFc}/>
            <Row label="w_c (kg/m³)"      v={wc} set={setWc}/>
            <Row label="F_u (MPa)"         v={Fu} set={setFu}/>
            <Row label="R_g group"         v={Rg} set={setRg}/>
            <Row label="R_p position"     v={Rp} set={setRp}/>
            <Row label="n studs"           v={n}  set={setN}/>
            <Row label="V_h (kN) demand"   v={Vh} set={setVh}/>

            <button data-testid="forge-headedstud-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Check Studs</button>

            {error && <div data-testid="forge-headedstud-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-headedstud-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="A_sc"           v={result.studAreaMm2.toFixed(1) + ' mm²'}/>
                    <Line k="E_c"            v={result.concreteModulusMPa.toFixed(0) + ' MPa'}/>
                    <Line k="Q_n,conc"       v={(result.qNominalConcreteN / 1000).toFixed(1) + ' kN'}/>
                    <Line k="Q_n,steel"      v={(result.qNominalSteelN / 1000).toFixed(1) + ' kN'}/>
                    <div data-testid="forge-headedstud-Qn"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        Q_n (single) = {(result.qNominalSingleN / 1000).toFixed(2)} kN
                    </div>
                    <Line k="ΣQ_n"           v={result.totalCapacityKN.toFixed(0) + ' kN'}/>
                    <Line k="DCR"             v={result.demandCapacityRatio.toFixed(3)}/>
                    <div data-testid="forge-headedstud-pass"
                         style={{ marginTop: 8, padding: '6px 10px', borderRadius: 4,
                                  background: result.passes ? '#3fb950' : '#f85149',
                                  color: '#0d1117', fontWeight: 700, textAlign: 'center', fontSize: 14 }}>
                        {result.passes ? '✓ Studs sufficient' : '✗ Need more studs'}
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
