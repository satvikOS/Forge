// Forge-300 — Drum brake (short-shoe block-on-drum, Shigley §16-3) panel.
// Hierarchy: Tools menu → Power transmission → Brakes & clutches → Drum brake.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function DrumBrakeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [P,  setP]  = useState(200);
    const [c,  setC]  = useState(0.300);
    const [a,  setA]  = useState(0.150);
    const [r,  setR]  = useState(0.125);
    const [mu, setMu] = useState(0.4);
    const [selfE, setSelfE] = useState(true);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenDrumBrakeWorkbench  = () => setOpen(true);
        window.__forgeCloseDrumBrakeWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenDrumBrakeWorkbench;
            delete window.__forgeCloseDrumBrakeWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.drumbrake?.analyse({
                leverForceP_N:    Number(P),
                leverLength_c_m:  Number(c),
                contactArm_a_m:   Number(a),
                drumRadius_r_m:   Number(r),
                friction_mu:      Number(mu),
                selfEnergizing:   Boolean(selfE),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-drumbrake-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Drum brake · short shoe (Shigley §16-3)</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="P (N) lever force"     v={P}  set={setP}/>
            <Row label="c (m) lever arm"       v={c}  set={setC}/>
            <Row label="a (m) contact arm"     v={a}  set={setA}/>
            <Row label="r (m) drum radius"     v={r}  set={setR}/>
            <Row label="μ friction"            v={mu} set={setMu}/>

            <label style={{ display: 'flex', alignItems: 'center', margin: '6px 0', fontSize: 12 }}>
                <input type="checkbox" checked={selfE}
                       data-testid="forge-drumbrake-self"
                       onChange={(e) => setSelfE(e.target.checked)}
                       style={{ marginRight: 8 }}/>
                Self-energizing rotation
            </label>

            <button data-testid="forge-drumbrake-run" onClick={run}
                    style={{ marginTop: 6, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-drumbrake-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-drumbrake-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="N normal"          v={result.normalForceN.toFixed(2) + ' N'}/>
                    <Line k="F friction"        v={result.frictionForceN.toFixed(2) + ' N'}/>
                    <div data-testid="forge-drumbrake-T"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        T = {result.brakingTorqueNm.toFixed(2)} N·m
                    </div>
                    <div data-testid="forge-drumbrake-MA"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        Gain T/(P·r) = {result.mechanicalAdvantage.toFixed(2)}
                    </div>
                    <Line k="a − μr margin"     v={result.selfLockingMargin.toFixed(4) + ' m'}/>
                    {selfE && (
                        <div data-testid="forge-drumbrake-lock"
                             style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4,
                                      background: result.selfLockingMargin < 0.02 ? '#5a1d1d' : '#1d2d1d',
                                      color: result.selfLockingMargin < 0.02 ? '#f85149' : '#3fb950',
                                      fontWeight: 700, textAlign: 'center' }}>
                            {result.selfLockingMargin < 0.02
                              ? '⚠ Approaching self-lock'
                              : 'Safe margin from self-lock'}
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
            <span style={{ width: 160 }}>{label}</span>
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
