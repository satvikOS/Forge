// Forge-302 — Steel beam web shear (AISC 360-22 §G2).
// Hierarchy: Tools menu → Structural → Steel members → Web shear.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const REGIMES = { 1: 'Yielding (C_v1=1)', 2: 'Inelastic buckling', 3: 'Elastic buckling' };

export function WebShearWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [d,  setD]  = useState(534);
    const [tw, setTw] = useState(11.4);
    const [tf, setTf] = useState(14.4);
    const [fy, setFy] = useState(345);
    const [E,  setE]  = useState(200000);
    const [a,  setA]  = useState(0);
    const [rolled, setRolled] = useState(true);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenWebShearWorkbench  = () => setOpen(true);
        window.__forgeCloseWebShearWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenWebShearWorkbench;
            delete window.__forgeCloseWebShearWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.webshear?.analyse({
                overallDepthMm:      Number(d),
                webThicknessMm:      Number(tw),
                flangeThicknessMm:   Number(tf),
                Fy_MPa:              Number(fy),
                E_MPa:               Number(E),
                stiffenerSpacingMm:  Number(a),
                compactRolled:       Boolean(rolled),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-webshear-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Web shear · AISC 360 §G2</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="d (mm) overall"          v={d}  set={setD}/>
            <Row label="t_w (mm) web"            v={tw} set={setTw}/>
            <Row label="t_f (mm) flange"         v={tf} set={setTf}/>
            <Row label="F_y (MPa)"               v={fy} set={setFy}/>
            <Row label="E (MPa)"                 v={E}  set={setE}/>
            <Row label="a (mm) stiffener spacing" v={a} set={setA}/>

            <label style={{ display: 'flex', alignItems: 'center', margin: '6px 0', fontSize: 12 }}>
                <input type="checkbox" checked={rolled}
                       data-testid="forge-webshear-rolled"
                       onChange={(e) => setRolled(e.target.checked)}
                       style={{ marginRight: 8 }}/>
                Rolled I-shape (φ=1.0 bonus when compact, §G2.1(a))
            </label>

            <button data-testid="forge-webshear-run" onClick={run}
                    style={{ marginTop: 6, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Check</button>

            {error && <div data-testid="forge-webshear-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-webshear-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="h clear"        v={result.clearWebDepthMm.toFixed(1) + ' mm'}/>
                    <Line k="h/t_w"          v={result.webSlenderness.toFixed(2)}/>
                    <Line k="k_v"            v={result.k_v.toFixed(2)}/>
                    <Line k="compact limit"  v={result.limitCompact.toFixed(2)}/>
                    <Line k="C_v1"           v={result.C_v1.toFixed(4)}/>
                    <div data-testid="forge-webshear-regime"
                         style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4,
                                  background: result.regime === 1 ? '#1d2d1d' :
                                              result.regime === 2 ? '#3d2d0d' : '#3d1d1d',
                                  color: result.regime === 1 ? '#3fb950' :
                                         result.regime === 2 ? '#d29922' : '#f85149',
                                  fontWeight: 700, textAlign: 'center' }}>
                        {REGIMES[result.regime]}
                    </div>
                    <div data-testid="forge-webshear-Vn"
                         style={{ marginTop: 8, fontWeight: 700 }}>
                        V_n = {(result.nominalShearN / 1000).toFixed(1)} kN
                    </div>
                    <div data-testid="forge-webshear-LRFD"
                         style={{ marginTop: 4, fontWeight: 700, color: '#3fb950' }}>
                        φV_n = {(result.LRFDshearN / 1000).toFixed(1)} kN  (φ = {result.phi.toFixed(2)})
                    </div>
                    <div data-testid="forge-webshear-ASD"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        V_n/Ω = {(result.ASDshearN / 1000).toFixed(1)} kN  (Ω = {result.omega.toFixed(2)})
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
