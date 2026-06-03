// Forge-268 — Anchor bolt tension capacity panel (ACI 318-19 Ch.17).
// Hierarchy: Tools menu → Structural → Connections → Anchor bolt tension.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function AnchorBoltWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Ase,   setAse]   = useState(283);   // mm²
    const [futa,  setFuta]  = useState(830);   // MPa
    const [fya,   setFya]   = useState(660);   // MPa
    const [hef,   setHef]   = useState(150);   // mm
    const [fc,    setFc]    = useState(30);    // MPa
    const [ca,    setCa]    = useState(300);   // mm
    const [Abrg,  setAbrg]  = useState(287);   // mm²
    const [lam,   setLam]   = useState(1.0);
    const [cracked, setCracked] = useState(true);
    const [castIn,  setCastIn]  = useState(true);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenAnchorBoltWorkbench  = () => setOpen(true);
        window.__forgeCloseAnchorBoltWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenAnchorBoltWorkbench;
            delete window.__forgeCloseAnchorBoltWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.anchorbolt?.analyse({
                effectiveTensileAreaMm2: Number(Ase),
                steelUltimateMPa: Number(futa),
                steelYieldMPa:    Number(fya),
                embedmentDepthMm: Number(hef),
                concreteStrengthMPa: Number(fc),
                minEdgeDistanceMm: Number(ca),
                bearingAreaMm2:    Number(Abrg),
                lambdaLightweight: Number(lam),
                crackedConcrete:   cracked,
                castInAnchor:      castIn,
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-anchorbolt-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Anchor bolt tension · ACI 318-19 Ch.17</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="A_se,N (mm²)"    v={Ase}  set={setAse}/>
            <Row label="f_uta (MPa)"     v={futa} set={setFuta}/>
            <Row label="f_ya (MPa)"      v={fya}  set={setFya}/>
            <Row label="h_ef (mm)"       v={hef}  set={setHef}/>
            <Row label="f'_c (MPa)"      v={fc}   set={setFc}/>
            <Row label="c_a,min (mm)"    v={ca}   set={setCa}/>
            <Row label="A_brg (mm²)"     v={Abrg} set={setAbrg}/>
            <Row label="λ (lightweight)" v={lam}  set={setLam}/>
            <Toggle label="Cracked concrete"
                    checked={cracked} onChange={setCracked} testid="forge-anchorbolt-cracked"/>
            <Toggle label="Cast-in anchor"
                    checked={castIn} onChange={setCastIn} testid="forge-anchorbolt-castin"/>

            <button data-testid="forge-anchorbolt-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-anchorbolt-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-anchorbolt-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="f_uta (capped)"   v={result.cappedFutaMPa.toFixed(0) + ' MPa'}/>
                    <Line k="φN_sa (steel)"     v={(result.phiSteelN / 1000).toFixed(1) + ' kN'}/>
                    <Line k="A_Nc / A_Nco"     v={(result.aNcMm2 / result.aNcoMm2).toFixed(3)}/>
                    <Line k="ψ_ed,N"            v={result.psiEdN.toFixed(3)}/>
                    <Line k="ψ_c,N · ψ_c,P"    v={result.psiCN.toFixed(2) + ' · ' + result.psiCP.toFixed(2)}/>
                    <Line k="N_b"               v={(result.nBN / 1000).toFixed(1) + ' kN'}/>
                    <Line k="φN_cb (breakout)" v={(result.phiBreakoutN / 1000).toFixed(1) + ' kN'}/>
                    <Line k="φN_pn (pullout)"  v={(result.phiPulloutN  / 1000).toFixed(1) + ' kN'}/>
                    <div data-testid="forge-anchorbolt-governing"
                         style={{ marginTop: 6, fontWeight: 700, color: '#58a6ff' }}>
                        φN_n = {(result.phiGoverningN / 1000).toFixed(1)} kN
                    </div>
                    <div data-testid="forge-anchorbolt-mode"
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

function Toggle({ label, checked, onChange, testid }) {
    return (
        <label style={{ display: 'flex', alignItems: 'center', margin: '5px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
                   data-testid={testid}
                   style={{ marginRight: 8 }}/>
            <span>{label}</span>
        </label>
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
