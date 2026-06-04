// Forge-309 — Mononobe-Okabe seismic earth pressure (M-O 1924/1929).
// Hierarchy: Tools menu → Structural → Foundations → Seismic earth pressure.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function MononobeOkabeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [phi, setPhi]   = useState(30);
    const [delta, setDelta] = useState(20);
    const [i, setI]       = useState(0);
    const [beta, setBeta] = useState(0);
    const [kh, setKh]     = useState(0.2);
    const [kv, setKv]     = useState(0);
    const [gamma, setGamma] = useState(18);
    const [H, setH]       = useState(6);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenMononobeOkabeWorkbench  = () => setOpen(true);
        window.__forgeCloseMononobeOkabeWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenMononobeOkabeWorkbench;
            delete window.__forgeCloseMononobeOkabeWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.mokabe?.analyse({
                soilFrictionAngleDeg:   Number(phi),
                wallFrictionAngleDeg:   Number(delta),
                backfillSlopeDeg:       Number(i),
                wallTiltDeg:            Number(beta),
                horizontalSeismicCoeff: Number(kh),
                verticalSeismicCoeff:   Number(kv),
                soilUnitWeightKnPerM3:  Number(gamma),
                wallHeightM:            Number(H),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-mo-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Mononobe-Okabe · seismic earth pressure</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="φ (°) soil friction"    v={phi}   set={setPhi}/>
            <Row label="δ (°) wall friction"    v={delta} set={setDelta}/>
            <Row label="i (°) backfill slope"   v={i}     set={setI}/>
            <Row label="β (°) wall tilt"        v={beta}  set={setBeta}/>
            <Row label="k_h horizontal seismic" v={kh}    set={setKh}/>
            <Row label="k_v vertical seismic"   v={kv}    set={setKv}/>
            <Row label="γ (kN/m³) soil"         v={gamma} set={setGamma}/>
            <Row label="H (m) wall height"      v={H}     set={setH}/>

            <button data-testid="forge-mo-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-mo-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-mo-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="θ inertia"    v={result.seismicInertiaAngleDeg.toFixed(2) + '°'}/>
                    <Line k="K_a static"   v={result.staticKa.toFixed(4)}/>
                    <Line k="K_AE seismic" v={result.seismicKae.toFixed(4)}/>
                    <Line k="P_a static"   v={result.staticForceKnPerM.toFixed(1) + ' kN/m'}/>
                    <div data-testid="forge-mo-PAE"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        P_AE = {result.totalSeismicForceKnPerM.toFixed(1)} kN/m
                    </div>
                    <div data-testid="forge-mo-dP"
                         style={{ marginTop: 4, fontWeight: 700,
                                  color: result.seismicIncrementKnPerM > result.staticForceKnPerM * 0.5
                                         ? '#f85149' : '#d29922' }}>
                        ΔP_dyn = {result.seismicIncrementKnPerM.toFixed(1)} kN/m
                        ({(100 * result.seismicIncrementKnPerM / result.staticForceKnPerM).toFixed(0)} % of P_a)
                    </div>
                    <div data-testid="forge-mo-ybar"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        y_bar = {result.pointOfApplicationFromBaseM.toFixed(2)} m
                        ({(100 * result.pointOfApplicationFromBaseM / H).toFixed(0)} % of H)
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
