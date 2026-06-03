// Forge-271 — Anchor bolt shear capacity panel (ACI 318-19 §17.7).
// Hierarchy: Tools menu → Structural → Connections → Anchor bolt shear.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function AnchorShearWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Ase,  setAse ] = useState(283);
    const [futa, setFuta] = useState(830);
    const [fya,  setFya ] = useState(660);
    const [da,   setDa  ] = useState(19.05);
    const [le,   setLe  ] = useState(150);
    const [fc,   setFc  ] = useState(30);
    const [ca1,  setCa1 ] = useState(150);
    const [ca2,  setCa2 ] = useState(1000);
    const [ha,   setHa  ] = useState(300);
    const [lam,  setLam ] = useState(1.0);
    const [cracked, setCracked] = useState(true);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenAnchorShearWorkbench  = () => setOpen(true);
        window.__forgeCloseAnchorShearWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenAnchorShearWorkbench;
            delete window.__forgeCloseAnchorShearWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.anchorshear?.analyse({
                effectiveShearAreaMm2: Number(Ase),
                steelUltimateMPa:      Number(futa),
                steelYieldMPa:         Number(fya),
                anchorDiameterMm:      Number(da),
                loadBearingLengthMm:   Number(le),
                concreteStrengthMPa:   Number(fc),
                edgeDistanceCa1Mm:     Number(ca1),
                edgeDistanceCa2Mm:     Number(ca2),
                memberThicknessHaMm:   Number(ha),
                lambdaLightweight:     Number(lam),
                crackedConcrete:       cracked,
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-anchorshear-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Anchor bolt shear · ACI 318-19 §17.7</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="A_se,V (mm²)"   v={Ase}  set={setAse}/>
            <Row label="f_uta (MPa)"    v={futa} set={setFuta}/>
            <Row label="f_ya (MPa)"     v={fya}  set={setFya}/>
            <Row label="d_a (mm)"        v={da}   set={setDa}/>
            <Row label="l_e (mm)"        v={le}   set={setLe}/>
            <Row label="f'_c (MPa)"     v={fc}   set={setFc}/>
            <Row label="c_a1 (mm)"       v={ca1}  set={setCa1}/>
            <Row label="c_a2 (mm)"       v={ca2}  set={setCa2}/>
            <Row label="h_a (mm)"        v={ha}   set={setHa}/>
            <Row label="λ"              v={lam}  set={setLam}/>
            <label style={{ display: 'flex', alignItems: 'center', margin: '5px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={cracked} data-testid="forge-anchorshear-cracked"
                       onChange={(e) => setCracked(e.target.checked)} style={{ marginRight: 8 }}/>
                <span>Cracked concrete</span>
            </label>

            <button data-testid="forge-anchorshear-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-anchorshear-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-anchorshear-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="f_uta (capped)"  v={result.cappedFutaMPa.toFixed(0) + ' MPa'}/>
                    <Line k="φV_sa (steel)"    v={(result.phiSteelN     / 1000).toFixed(1) + ' kN'}/>
                    <Line k="A_Vc / A_Vco"    v={(result.aVcMm2 / result.aVcoMm2).toFixed(3)}/>
                    <Line k="ψ_ed,V"           v={result.psiEdV.toFixed(3)}/>
                    <Line k="ψ_c,V"            v={result.psiCV.toFixed(2)}/>
                    <Line k="ψ_h,V"            v={result.psiHV.toFixed(3)}/>
                    <Line k="V_b"              v={(result.vBN          / 1000).toFixed(2) + ' kN'}/>
                    <Line k="φV_cb (breakout)" v={(result.phiBreakoutN / 1000).toFixed(1) + ' kN'}/>
                    <div data-testid="forge-anchorshear-governing"
                         style={{ marginTop: 6, fontWeight: 700, color: '#58a6ff' }}>
                        φV_n = {(result.phiGoverningN / 1000).toFixed(1)} kN
                    </div>
                    <div data-testid="forge-anchorshear-mode"
                         style={{ marginTop: 4, fontWeight: 600,
                                  color: result.governingMode === 'steel' ? '#3fb950' : '#d29922' }}>
                        Governs: {result.governingMode.toUpperCase()}
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
            <span style={{ width: 150 }}>{label}</span>
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
