// Forge-291 — Bevel gear pair panel (Tredgold + AGMA 2003).
// Hierarchy: Tools menu → Machine design → Power transmission → Bevel gear.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function BevelGearWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [m,  setM]  = useState(4);
    const [Np, setNp] = useState(20);
    const [Ng, setNg] = useState(40);
    const [F,  setF]  = useState(25);
    const [phi, setPhi] = useState(20);
    const [Tp, setTp] = useState(50);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenBevelGearWorkbench  = () => setOpen(true);
        window.__forgeCloseBevelGearWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenBevelGearWorkbench;
            delete window.__forgeCloseBevelGearWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.bevelgear?.analyse({
                moduleMm:         Number(m),
                pinionTeeth:      Number(Np),
                gearTeeth:        Number(Ng),
                faceWidthMm:      Number(F),
                pressureAngleDeg: Number(phi),
                pinionTorqueNm:   Number(Tp),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-bevelgear-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Bevel gear · Shigley §15 + AGMA</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="m (mm) module"  v={m}  set={setM}/>
            <Row label="N_p teeth"      v={Np} set={setNp}/>
            <Row label="N_g teeth"      v={Ng} set={setNg}/>
            <Row label="F (mm) face"    v={F}  set={setF}/>
            <Row label="φ_n (°)"        v={phi} set={setPhi}/>
            <Row label="T_p (N·m)"      v={Tp} set={setTp}/>

            <button data-testid="forge-bevelgear-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-bevelgear-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-bevelgear-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="i ratio"        v={result.gearRatio.toFixed(3)}/>
                    <Line k="γ_p / γ_g"     v={result.pinionConeAngleDeg.toFixed(2) + '° / '
                                              + result.gearConeAngleDeg.toFixed(2) + '°'}/>
                    <Line k="d_p / d_g"     v={result.pinionPitchDiameterMm.toFixed(1) + ' / '
                                              + result.gearPitchDiameterMm.toFixed(1) + ' mm'}/>
                    <Line k="Cone dist R"   v={result.coneDistanceMm.toFixed(2) + ' mm'}/>
                    <Line k="r_m (pinion)"  v={result.pinionMeanRadiusMm.toFixed(2) + ' mm'}/>
                    <Line k="N_ep / N_eg" v={result.equivalentPinionTeeth.toFixed(1) + ' / '
                                              + result.equivalentGearTeeth.toFixed(1)}/>
                    <div style={{ marginTop: 8, padding: 6, background: '#0a0d12',
                                  borderRadius: 4, fontSize: 11 }}>
                        <div style={{ color: '#8b949e', marginBottom: 2 }}>Pinion force components (at r_m)</div>
                        <div data-testid="forge-bevelgear-Wt"
                             style={{ fontWeight: 700, color: '#3fb950' }}>
                            W_t = {result.tangentialForceN.toFixed(0)} N
                        </div>
                        <Line k="W_r radial"  v={result.radialForceN.toFixed(0) + ' N'}/>
                        <Line k="W_a axial"   v={result.axialForceN.toFixed(0) + ' N'}/>
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
