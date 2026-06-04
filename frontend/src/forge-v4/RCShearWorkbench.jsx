// Forge-307 — Reinforced concrete shear (ACI 318-19 §22.5).
// Hierarchy: Tools menu → Structural → Concrete → RC shear.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function RCShearWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [b, setB] = useState(300);
    const [d, setD] = useState(400);
    const [fc, setFc] = useState(28);
    const [av, setAv] = useState(142);
    const [s, setS] = useState(200);
    const [fyt, setFyt] = useState(420);
    const [lam, setLam] = useState(1.0);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenRCShearWorkbench  = () => setOpen(true);
        window.__forgeCloseRCShearWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenRCShearWorkbench;
            delete window.__forgeCloseRCShearWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.rcshear?.analyse({
                widthMm:           Number(b),
                effectiveDepthMm:  Number(d),
                fc_MPa:            Number(fc),
                shearReinfAreaMm2: Number(av),
                stirrupSpacingMm:  Number(s),
                fyt_MPa:           Number(fyt),
                lambda:            Number(lam),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-rcsh-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>RC shear · ACI 318-19 §22.5</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="b (mm) width"        v={b}   set={setB}/>
            <Row label="d (mm) eff. depth"   v={d}   set={setD}/>
            <Row label="f'_c (MPa)"          v={fc}  set={setFc}/>
            <Row label="A_v (mm²) legs"      v={av}  set={setAv}/>
            <Row label="s (mm) spacing"      v={s}   set={setS}/>
            <Row label="f_yt (MPa)"          v={fyt} set={setFyt}/>
            <Row label="λ (1=NW, 0.75=LW)"   v={lam} set={setLam}/>

            <button data-testid="forge-rcsh-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Check</button>

            {error && <div data-testid="forge-rcsh-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-rcsh-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="V_c concrete"     v={result.Vc_kN.toFixed(2) + ' kN'}/>
                    <Line k="V_s stirrups"     v={result.Vs_kN.toFixed(2) + ' kN'}/>
                    <Line k="V_n,max crushing" v={result.VnMax_kN.toFixed(2) + ' kN'}/>
                    <div data-testid="forge-rcsh-Vn"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        V_n = {result.Vn_kN.toFixed(2)} kN
                    </div>
                    <div data-testid="forge-rcsh-phiVn"
                         style={{ marginTop: 4, fontWeight: 700, color: '#3fb950' }}>
                        φV_n = {result.phiVn_kN.toFixed(2)} kN  (φ = {result.phi.toFixed(2)})
                    </div>
                    <Line k="s_max limit"     v={result.maxStirrupSpacingMm.toFixed(0) + ' mm'}/>
                    <div data-testid="forge-rcsh-spacing"
                         style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4,
                                  background: result.spacingMeetsLimit ? '#1d2d1d' : '#3d1d1d',
                                  color: result.spacingMeetsLimit ? '#3fb950' : '#f85149',
                                  fontWeight: 700, textAlign: 'center' }}>
                        Spacing {result.spacingMeetsLimit ? 'within limit' : 'EXCEEDS limit'}
                    </div>
                    {result.crushingControls && (
                        <div data-testid="forge-rcsh-crush"
                             style={{ marginTop: 4, padding: '4px 8px', borderRadius: 4,
                                      background: '#3d1d1d', color: '#f85149',
                                      fontWeight: 700, textAlign: 'center' }}>
                            ⚠ Web crushing controls — enlarge section
                        </div>
                    )}
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
