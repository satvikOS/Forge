// Forge-280 — Wire rope sling capacity panel (ASME B30.9).
// Hierarchy: Tools menu → Machine design → Lifting & rigging → Wire rope sling.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const HITCHES = [
    { id: 'vertical', label: 'Vertical (factor 1.00)' },
    { id: 'choker',   label: 'Choker (factor 0.75)'   },
    { id: 'basket',   label: 'Basket double (factor 2.00)' },
];

export function WireRopeSlingWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [BS,   setBS  ] = useState(191200);   // N (≈ 1/2" IWRC EIPS)
    const [DF,   setDF  ] = useState(5);
    const [n,    setN   ] = useState(2);
    const [theta, setTheta] = useState(30);
    const [hitch, setHitch] = useState('vertical');
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenWireRopeSlingWorkbench  = () => setOpen(true);
        window.__forgeCloseWireRopeSlingWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenWireRopeSlingWorkbench;
            delete window.__forgeCloseWireRopeSlingWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.sling?.analyse({
                breakingStrengthN:       Number(BS),
                designFactor:            Number(DF),
                numberOfLegs:            Number(n),
                legAngleFromVerticalDeg: Number(theta),
                hitchType:               hitch,
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    const statusColour = (s) =>
        s === 'safe' ? '#3fb950' : s === 'caution' ? '#d29922' : '#f85149';

    return createPortal(
        <div data-testid="forge-sling-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Wire rope sling · ASME B30.9</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="BS (N) breaking" v={BS}    set={setBS}/>
            <Row label="DF design factor" v={DF}   set={setDF}/>
            <Row label="# legs (1-4)"    v={n}    set={setN}/>
            <Row label="θ (°) from vert" v={theta} set={setTheta}/>
            <div style={{ display: 'flex', alignItems: 'center', margin: '6px 0' }}>
                <span style={{ width: 130 }}>Hitch type</span>
                <select data-testid="forge-sling-hitch" value={hitch}
                        onChange={(e) => setHitch(e.target.value)}
                        style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                                 border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}>
                    {HITCHES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
            </div>

            <button data-testid="forge-sling-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute WLL</button>

            {error && <div data-testid="forge-sling-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-sling-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="WLL single leg" v={(result.singleLegWllN / 1000).toFixed(2) + ' kN'}/>
                    <Line k="Hitch factor"   v={result.hitchFactor.toFixed(2)}/>
                    <Line k="cos θ"          v={result.cosTheta.toFixed(4)}/>
                    <div data-testid="forge-sling-wll"
                         style={{ marginTop: 6, fontWeight: 700, fontSize: 14 }}>
                        Assembly WLL = {(result.assemblyWllN / 1000).toFixed(2)} kN
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: '#8b949e' }}>
                        ≈ {(result.assemblyWllN / 9806.65).toFixed(2)} tonnes
                    </div>
                    <div data-testid="forge-sling-status"
                         style={{ marginTop: 8, padding: '4px 8px', borderRadius: 4,
                                  background: statusColour(result.angleStatus),
                                  color: '#0d1117', fontWeight: 700, textAlign: 'center' }}>
                        {result.angleStatus.toUpperCase()} — θ = {theta}° from vertical
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
