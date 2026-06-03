// Forge-281 — Disc clutch/brake torque panel (Shigley §16-2).
// Hierarchy: Tools menu → Machine design → Power transmission → Disc brake/clutch.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const ASSUMPTIONS = [
    { id: 'uniform-wear',     label: 'Uniform wear (broken-in)' },
    { id: 'uniform-pressure', label: 'Uniform pressure (new)' },
];

export function DiscBrakeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Ro,  setRo ]   = useState(75);
    const [Ri,  setRi ]   = useState(30);
    const [mu,  setMu ]   = useState(0.32);
    const [F,   setF  ]   = useState(4500);
    const [n,   setN  ]   = useState(2);
    const [a,   setA  ]   = useState('uniform-wear');
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenDiscBrakeWorkbench  = () => setOpen(true);
        window.__forgeCloseDiscBrakeWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenDiscBrakeWorkbench;
            delete window.__forgeCloseDiscBrakeWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.discbrake?.analyse({
                outerRadiusMm:       Number(Ro),
                innerRadiusMm:       Number(Ri),
                frictionCoefficient: Number(mu),
                clampingForceN:      Number(F),
                numberOfFaces:       Number(n),
                assumption:          a,
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-discbrake-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Disc brake / clutch · Shigley §16</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="R_o (mm)"  v={Ro} set={setRo}/>
            <Row label="R_i (mm)"  v={Ri} set={setRi}/>
            <Row label="μ friction" v={mu} set={setMu}/>
            <Row label="F (N) clamp" v={F}  set={setF}/>
            <Row label="# faces"    v={n}  set={setN}/>
            <div style={{ display: 'flex', alignItems: 'center', margin: '6px 0' }}>
                <span style={{ width: 130 }}>Assumption</span>
                <select data-testid="forge-discbrake-assumption" value={a}
                        onChange={(e) => setA(e.target.value)}
                        style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                                 border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}>
                    {ASSUMPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
            </div>

            <button data-testid="forge-discbrake-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-discbrake-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-discbrake-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="R_mean"      v={result.meanRadiusMm.toFixed(1) + ' mm'}/>
                    <Line k="Contact A"  v={(result.contactAreaMm2 / 100).toFixed(1) + ' cm²'}/>
                    <Line k="p_avg"      v={result.averagePressureMPa.toFixed(3) + ' MPa'}/>
                    <Line k="p_max"      v={result.maxPressureMPa.toFixed(3) + ' MPa'}/>
                    <div data-testid="forge-discbrake-T"
                         style={{ marginTop: 6, fontWeight: 700, fontSize: 14 }}>
                        T = {result.torqueNm.toFixed(2)} N·m
                    </div>
                    <div data-testid="forge-discbrake-assumption-used"
                         style={{ marginTop: 4, fontSize: 11, color: '#8b949e' }}>
                        Assumption: {result.assumptionUsed}
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
