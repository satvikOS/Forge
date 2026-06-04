// Forge-318 — Steel column base plate (AISC §J9 + DG1).
// Hierarchy: Tools menu → Structural → Steel members → Base plate.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function BasePlateWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Pu, setPu]   = useState(2000);
    const [B,  setB]    = useState(600);
    const [N,  setN]    = useState(600);
    const [d,  setD]    = useState(308);
    const [bf, setBf]   = useState(305);
    const [B2, setB2]   = useState(1200);
    const [N2, setN2]   = useState(1200);
    const [fc, setFc]   = useState(28);
    const [fy, setFy]   = useState(250);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenBasePlateWorkbench  = () => setOpen(true);
        window.__forgeCloseBasePlateWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenBasePlateWorkbench;
            delete window.__forgeCloseBasePlateWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.baseplate?.analyse({
                appliedAxialKn:     Number(Pu),
                plateWidthB_mm:     Number(B),
                plateLengthN_mm:    Number(N),
                columnDepthD_mm:    Number(d),
                columnFlangeBf_mm:  Number(bf),
                supportWidthB2_mm:  Number(B2),
                supportLengthN2_mm: Number(N2),
                fc_MPa:             Number(fc),
                Fy_MPa:             Number(fy),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-bp-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Base plate · AISC §J9 + DG1</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="P_u (kN) factored axial" v={Pu} set={setPu}/>
            <Row label="B (mm) plate width"      v={B}  set={setB}/>
            <Row label="N (mm) plate length"     v={N}  set={setN}/>
            <Row label="d (mm) column depth"     v={d}  set={setD}/>
            <Row label="b_f (mm) col flange"     v={bf} set={setBf}/>
            <Row label="B₂ (mm) support width"   v={B2} set={setB2}/>
            <Row label="N₂ (mm) support length"  v={N2} set={setN2}/>
            <Row label="f'_c (MPa)"              v={fc} set={setFc}/>
            <Row label="F_y (MPa) plate"         v={fy} set={setFy}/>

            <button data-testid="forge-bp-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Design</button>

            {error && <div data-testid="forge-bp-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-bp-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="A_1 plate"    v={result.A_1_mm2.toFixed(0) + ' mm²'}/>
                    <Line k="A_2 support"  v={result.A_2_mm2.toFixed(0) + ' mm²'}/>
                    <Line k="√(A_2/A_1)"   v={result.sqrtA2A1.toFixed(3) + (result.sqrtA2A1 === 2.0 ? ' (capped)' : '')}/>
                    <Line k="P_p"          v={result.bearingStrength_Pp_kN.toFixed(0) + ' kN'}/>
                    <div data-testid="forge-bp-phiPp"
                         style={{ marginTop: 6, fontWeight: 700,
                                  color: result.bearingPasses ? '#3fb950' : '#f85149' }}>
                        φP_p = {result.LRFD_phiPp_kN.toFixed(0)} kN
                    </div>
                    <Line k="P_p/Ω (ASD)"  v={result.ASD_PpOverOmega_kN.toFixed(0) + ' kN'}/>
                    <div style={{ marginTop: 8, color: '#8b949e', fontSize: 11 }}>Projections (DG1 §3)</div>
                    <Line k="m"           v={result.projection_m_mm.toFixed(1) + ' mm'}/>
                    <Line k="n"           v={result.projection_n_mm.toFixed(1) + ' mm'}/>
                    <Line k="n′"          v={result.thorntonLambda_nprime_mm.toFixed(1) + ' mm'}/>
                    <div data-testid="forge-bp-treq"
                         style={{ marginTop: 6, fontWeight: 700, color: '#58a6ff' }}>
                        t_req = {result.requiredPlateThickness_mm.toFixed(1)} mm
                    </div>
                    <div data-testid="forge-bp-passes"
                         style={{ marginTop: 8, padding: '4px 8px', borderRadius: 4,
                                  background: result.bearingPasses ? '#1d2d1d' : '#3d1d1d',
                                  color: result.bearingPasses ? '#3fb950' : '#f85149',
                                  fontWeight: 700, textAlign: 'center' }}>
                        Bearing {result.bearingPasses ? 'passes' : 'FAILS'}
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
