// Forge-317 — Stormwater detention basin (Modified Rational Method).
// Hierarchy: Tools menu → Site & civil → Hydrology → Detention basin.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function DetentionBasinWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [A,    setA]    = useState(10);
    const [Cpre, setCpre] = useState(0.30);
    const [Cpost,setCpost]= useState(0.75);
    const [i,    setI]    = useState(50);
    const [a,    setAlpha]= useState(1.0);
    const [Tc,   setTc]   = useState(20);
    const [Td,   setTd]   = useState(60);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenDetentionBasinWorkbench  = () => setOpen(true);
        window.__forgeCloseDetentionBasinWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenDetentionBasinWorkbench;
            delete window.__forgeCloseDetentionBasinWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.detention?.analyse({
                areaHa:                  Number(A),
                runoffCoeffPre:          Number(Cpre),
                runoffCoeffPost:         Number(Cpost),
                designIntensityMmHr:     Number(i),
                allowableReleaseRatio:   Number(a),
                timeOfConcentrationMin:  Number(Tc),
                designStormDurationMin:  Number(Td),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-db-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Detention basin · Modified Rational</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="A (ha) area"                     v={A}     set={setA}/>
            <Row label="C_pre runoff coeff"              v={Cpre}  set={setCpre}/>
            <Row label="C_post runoff coeff"             v={Cpost} set={setCpost}/>
            <Row label="i (mm/hr) design intensity"      v={i}     set={setI}/>
            <Row label="α release ratio (1.0=pre-dev)"   v={a}     set={setAlpha}/>
            <Row label="T_c (min) concentration"         v={Tc}    set={setTc}/>
            <Row label="T_d (min) storm duration"        v={Td}    set={setTd}/>

            <button data-testid="forge-db-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Size</button>

            {error && <div data-testid="forge-db-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-db-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="Q_pre"        v={result.preDevQM3PerS.toFixed(4) + ' m³/s'}/>
                    <Line k="Q_post"       v={result.postDevQM3PerS.toFixed(4) + ' m³/s'}/>
                    <Line k="Q_release"    v={result.allowableReleaseQM3PerS.toFixed(4) + ' m³/s'}/>
                    <div data-testid="forge-db-V"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        V_storage = {result.detentionVolumeM3.toFixed(0)} m³
                    </div>
                    <div data-testid="forge-db-Vacre"
                         style={{ marginTop: 2, fontSize: 11, color: '#8b949e' }}>
                        = {result.detentionVolumeAcreFt.toFixed(3)} acre-ft
                    </div>
                    <div data-testid="forge-db-required"
                         style={{ marginTop: 8, padding: '4px 8px', borderRadius: 4,
                                  background: result.detentionRequired ? '#3d1d1d' : '#1d2d1d',
                                  color: result.detentionRequired ? '#f85149' : '#3fb950',
                                  fontWeight: 700, textAlign: 'center' }}>
                        {result.detentionRequired ? 'Detention REQUIRED' : 'No detention needed'}
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
            <span style={{ width: 200 }}>{label}</span>
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
