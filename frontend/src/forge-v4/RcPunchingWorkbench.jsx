// Forge-267 — RC slab punching-shear panel. Wires into the Tools menu
// (Structural → Concrete → Punching shear); not on the rail.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const LOCATIONS = [
    { id: 'interior', label: 'Interior column' },
    { id: 'edge',     label: 'Edge column'     },
    { id: 'corner',   label: 'Corner column'   },
];

export function RcPunchingWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [fc, setFc]         = useState(30);
    const [d,  setD ]         = useState(200);
    const [c1, setC1]         = useState(400);
    const [c2, setC2]         = useState(400);
    const [loc, setLoc]       = useState('interior');
    const [lam, setLam]       = useState(1.0);
    const [Vu, setVu]         = useState(600);  // kN
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenRcPunchingWorkbench  = () => setOpen(true);
        window.__forgeCloseRcPunchingWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenRcPunchingWorkbench;
            delete window.__forgeCloseRcPunchingWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.rcpunching?.analyse({
                concreteStrengthMPa: Number(fc),
                effectiveDepthMm:    Number(d),
                columnWidthMm:       Number(c1),
                columnDepthMm:       Number(c2),
                location:            loc,
                lambdaLightweight:   Number(lam),
                factoredShearN:      Number(Vu) * 1000,
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-rcpunching-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 380,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Punching shear · ACI 318-19</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="f'_c (MPa)"   v={fc} set={setFc}/>
            <Row label="d (mm)"        v={d}  set={setD}/>
            <Row label="c₁ (mm)"       v={c1} set={setC1}/>
            <Row label="c₂ (mm)"       v={c2} set={setC2}/>
            <div style={{ display: 'flex', alignItems: 'center', margin: '6px 0' }}>
                <span style={{ width: 130 }}>Location</span>
                <select data-testid="forge-rcpunching-location" value={loc}
                        onChange={(e) => setLoc(e.target.value)}
                        style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                                 border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}>
                    {LOCATIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
            </div>
            <Row label="λ (lightweight)" v={lam} set={setLam}/>
            <Row label="V_u (kN)"        v={Vu}  set={setVu}/>

            <button data-testid="forge-rcpunching-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-rcpunching-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-rcpunching-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="β_c"           v={result.betaC.toFixed(3)}/>
                    <Line k="b₀ (mm)"        v={result.criticalPerimeterMm.toFixed(0)}/>
                    <Line k="α_s"            v={result.alphaS.toFixed(0)}/>
                    <Line k="vc₁ (MPa)"      v={result.vc1MPa.toFixed(3)}/>
                    <Line k="vc₂ (MPa)"      v={result.vc2MPa.toFixed(3)}/>
                    <Line k="vc₃ (MPa)"      v={result.vc3MPa.toFixed(3)}/>
                    <div data-testid="forge-rcpunching-vc" style={{ marginTop: 6, fontWeight: 700 }}>
                        v_c = {result.vcMPa.toFixed(3)} MPa  →  φV_c = {(result.phiVcN / 1000).toFixed(1)} kN
                    </div>
                    <div data-testid="forge-rcpunching-dcr"
                         style={{ marginTop: 4, color: result.passes ? '#3fb950' : '#f85149', fontWeight: 700 }}>
                        DCR = {result.demandCapacityRatio.toFixed(3)} {result.passes ? '✓ pass' : '✗ FAIL'}
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
}

function Row({ label, v, set }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', margin: '6px 0' }}>
            <span style={{ width: 130 }}>{label}</span>
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
