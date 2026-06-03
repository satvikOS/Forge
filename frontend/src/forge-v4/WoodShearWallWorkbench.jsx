// Forge-292 — Wood shear wall panel (NDS + SDPWS-21 §4).
// Hierarchy: Tools menu → Structural → Wood members → Wood shear wall.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function WoodShearWallWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [V,    setV]    = useState(15);
    const [b,    setB]    = useState(2.4);
    const [h,    setH]    = useState(3.0);
    const [vAllow, setVAllow] = useState(8.5);
    const [Ac,   setAc]   = useState(89 * 140);
    const [fc,   setFc]   = useState(12);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenWoodShearWallWorkbench  = () => setOpen(true);
        window.__forgeCloseWoodShearWallWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenWoodShearWallWorkbench;
            delete window.__forgeCloseWoodShearWallWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.woodshear?.analyse({
                shearLoadKN:            Number(V),
                wallLengthM:            Number(b),
                wallHeightM:            Number(h),
                allowableShearKNm:      Number(vAllow),
                chordAreaMm2:           Number(Ac),
                chordAllowableStressMPa: Number(fc),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-woodshear-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Wood shear wall · NDS + SDPWS</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="V (kN)"               v={V}      set={setV}/>
            <Row label="b (m) length"         v={b}      set={setB}/>
            <Row label="h (m) height"         v={h}      set={setH}/>
            <Row label="v_allow (kN/m)"       v={vAllow} set={setVAllow}/>
            <Row label="A_c (mm²) chord"      v={Ac}     set={setAc}/>
            <Row label="f_c,allow (MPa)"      v={fc}     set={setFc}/>

            <button data-testid="forge-woodshear-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Check Wall</button>

            {error && <div data-testid="forge-woodshear-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-woodshear-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <CheckRow k="v unit shear"     v={result.unitShearKNm.toFixed(2) + ' kN/m'}
                              dcr={result.shearDCR} ok={result.shearOK}/>
                    <CheckRow k="h/b aspect"      v={result.aspectRatio.toFixed(2)}
                              dcr={result.aspectRatio / 3.5} ok={result.aspectOK}
                              limit="≤ 3.5"/>
                    <CheckRow k="T = C chord"     v={result.chordForceKN.toFixed(1) + ' kN'}/>
                    <CheckRow k="σ_c chord stress" v={result.chordStressMPa.toFixed(2) + ' MPa'}
                              dcr={result.chordDCR} ok={result.chordOK}/>
                    <div data-testid="forge-woodshear-overall"
                         style={{ marginTop: 8, padding: '6px 10px', borderRadius: 4,
                                  background: result.overallOK ? '#3fb950' : '#f85149',
                                  color: '#0d1117', fontWeight: 700, textAlign: 'center', fontSize: 14 }}>
                        {result.overallOK ? '✓ Wall passes' : '✗ Wall FAILS'}
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

function CheckRow({ k, v, dcr, ok, limit }) {
    const color = ok === undefined ? '#c9d1d9' : ok ? '#3fb950' : '#f85149';
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span style={{ color: '#8b949e' }}>{k}</span>
            <span style={{ color }}>{v}{dcr !== undefined && ` (DCR ${dcr.toFixed(2)})`}{limit && ` ${limit}`}</span>
        </div>
    );
}
