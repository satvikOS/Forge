// Forge-286 — Capstan / bollard friction (Eytelwein) panel.
// Hierarchy: Tools menu → Machine design → Lifting & rigging → Capstan friction.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function CapstanFrictionWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [T2,  setT2 ]  = useState(350);
    const [mu,  setMu ]  = useState(0.3);
    const [th,  setTh ]  = useState(1080);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenCapstanFrictionWorkbench  = () => setOpen(true);
        window.__forgeCloseCapstanFrictionWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenCapstanFrictionWorkbench;
            delete window.__forgeCloseCapstanFrictionWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.capstan?.analyse({
                holdingForceN:       Number(T2),
                frictionCoefficient: Number(mu),
                wrapAngleDeg:        Number(th),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-capstan-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 380,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Capstan friction · Eytelwein</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="T_2 (N) held"   v={T2} set={setT2}/>
            <Row label="μ friction"     v={mu} set={setMu}/>
            <Row label="θ wrap (deg)"  v={th} set={setTh}/>
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
                Hint: 360° = 1 turn; typical bollard wrap is 3-5 turns.
            </div>

            <button data-testid="forge-capstan-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-capstan-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-capstan-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="θ (rad)"  v={result.wrapAngleRad.toFixed(3)}/>
                    <Line k="Wraps"    v={(Number(th) / 360).toFixed(2)}/>
                    <div data-testid="forge-capstan-amp"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        T_1 / T_2 = {result.amplificationRatio.toFixed(2)}
                    </div>
                    <div data-testid="forge-capstan-T1"
                         style={{ marginTop: 4, fontWeight: 700, fontSize: 14, color: '#3fb950' }}>
                        Max T_1 = {(result.maxLoadN / 1000).toFixed(2)} kN
                    </div>
                    <Line k="Net lift" v={(result.mechanicalAdvantage * Number(T2) / 1000).toFixed(2) + ' kN'}/>
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
