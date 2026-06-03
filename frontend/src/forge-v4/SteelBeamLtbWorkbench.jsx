// Forge-270 — Steel beam LTB panel (AISC 360-22 §F2).
// Hierarchy: Tools menu → Structural → Steel members → Steel beam LTB.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function SteelBeamLtbWorkbenchHost() {
    const [open, setOpen] = useState(false);
    // Default W18×50 (Fy = 345 MPa, E = 200 000 MPa).
    const [Fy,  setFy ]  = useState(345);
    const [E,   setE  ]  = useState(200000);
    const [Sx,  setSx ]  = useState(1376e3);
    const [Zx,  setZx ]  = useState(1557e3);
    const [J,   setJ  ]  = useState(0.788e6);
    const [ry,  setRy ]  = useState(41.4);
    const [rts, setRts]  = useState(49.0);
    const [ho,  setHo ]  = useState(442);
    const [c,   setC  ]  = useState(1.0);
    const [Lb,  setLb ]  = useState(3000);
    const [Cb,  setCb ]  = useState(1.0);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenSteelBeamLtbWorkbench  = () => setOpen(true);
        window.__forgeCloseSteelBeamLtbWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenSteelBeamLtbWorkbench;
            delete window.__forgeCloseSteelBeamLtbWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.steelbeam?.analyse({
                yieldMPa:           Number(Fy),
                elasticModulusMPa:  Number(E),
                sectionModulusXMm3: Number(Sx),
                plasticModulusXMm3: Number(Zx),
                torsionConstantMm4: Number(J),
                radiusYMm:          Number(ry),
                radiusTsMm:         Number(rts),
                distanceBetweenFlangeCentroidsMm: Number(ho),
                warpingCoefficient: Number(c),
                unbracedLengthMm:   Number(Lb),
                cb:                 Number(Cb),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    const regimeColour = (r) =>
        r === 'plastic' ? '#3fb950' :
        r === 'inelastic-LTB' ? '#d29922' : '#f85149';

    return createPortal(
        <div data-testid="forge-steelbeam-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Steel beam LTB · AISC 360-22 §F2</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="F_y (MPa)"    v={Fy}  set={setFy}/>
            <Row label="E (MPa)"      v={E}   set={setE}/>
            <Row label="S_x (mm³)"     v={Sx}  set={setSx}/>
            <Row label="Z_x (mm³)"     v={Zx}  set={setZx}/>
            <Row label="J (mm⁴)"       v={J}   set={setJ}/>
            <Row label="r_y (mm)"      v={ry}  set={setRy}/>
            <Row label="r_ts (mm)"     v={rts} set={setRts}/>
            <Row label="h_o (mm)"      v={ho}  set={setHo}/>
            <Row label="c (warping)"  v={c}   set={setC}/>
            <Row label="L_b (mm)"      v={Lb}  set={setLb}/>
            <Row label="C_b"          v={Cb}  set={setCb}/>

            <button data-testid="forge-steelbeam-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Check LTB</button>

            {error && <div data-testid="forge-steelbeam-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-steelbeam-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <div data-testid="forge-steelbeam-regime"
                         style={{ marginBottom: 6, padding: '4px 8px', borderRadius: 4,
                                  background: regimeColour(result.regime), color: '#0d1117',
                                  fontWeight: 700, textAlign: 'center' }}>
                        {result.regime.toUpperCase()}
                    </div>
                    <Line k="M_p"      v={(result.mPlasticNmm   / 1e6).toFixed(1) + ' kN·m'}/>
                    <Line k="L_p"      v={result.lpMm.toFixed(0) + ' mm'}/>
                    <Line k="L_r"      v={result.lrMm.toFixed(0) + ' mm'}/>
                    {result.fCrMPa > 0 && <Line k="F_cr" v={result.fCrMPa.toFixed(1) + ' MPa'}/>}
                    <Line k="M_n"      v={(result.mNnominalNmm  / 1e6).toFixed(1) + ' kN·m'}/>
                    <div data-testid="forge-steelbeam-phimn"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        φM_n = {(result.phiMnNmm / 1e6).toFixed(1)} kN·m (LRFD)
                    </div>
                    <Line k="M_n/Ω (ASD)" v={(result.mnOverOmegaNmm / 1e6).toFixed(1) + ' kN·m'}/>
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
