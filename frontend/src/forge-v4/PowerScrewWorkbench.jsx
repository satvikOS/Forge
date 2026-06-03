// Forge-269 — Power screw torque & efficiency panel (Shigley §8-2).
// Hierarchy: Tools menu → Machine design → Fasteners & joints → Power screw.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const THREAD_TYPES = [
    { id: 'square', label: 'Square thread' },
    { id: 'acme',   label: 'ACME / trapezoidal (α=14.5°)' },
];

export function PowerScrewWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [F,  setF ]   = useState(6400);  // N
    const [dm, setDm]   = useState(30);    // mm
    const [L,  setL ]   = useState(4);     // mm
    const [mu, setMu]   = useState(0.08);
    const [muc, setMuc] = useState(0.08);
    const [dc,  setDc]  = useState(40);    // mm
    const [tt,  setTt]  = useState('square');
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenPowerScrewWorkbench  = () => setOpen(true);
        window.__forgeClosePowerScrewWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenPowerScrewWorkbench;
            delete window.__forgeClosePowerScrewWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.powerscrew?.analyse({
                axialForceN:         Number(F),
                meanDiameterMm:      Number(dm),
                leadMm:              Number(L),
                threadFriction:      Number(mu),
                collarFriction:      Number(muc),
                collarMeanDiameterMm: Number(dc),
                threadType:          tt,
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-powerscrew-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Power screw · Shigley §8-2</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="F (N)"           v={F}  set={setF}/>
            <Row label="d_m (mm)"         v={dm} set={setDm}/>
            <Row label="Lead (mm)"        v={L}  set={setL}/>
            <Row label="μ (thread)"       v={mu} set={setMu}/>
            <Row label="μ_c (collar)"     v={muc} set={setMuc}/>
            <Row label="d_c (mm)"         v={dc} set={setDc}/>
            <div style={{ display: 'flex', alignItems: 'center', margin: '6px 0' }}>
                <span style={{ width: 130 }}>Thread type</span>
                <select data-testid="forge-powerscrew-type" value={tt}
                        onChange={(e) => setTt(e.target.value)}
                        style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                                 border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}>
                    {THREAD_TYPES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
            </div>

            <button data-testid="forge-powerscrew-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-powerscrew-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-powerscrew-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="Lead angle λ"      v={result.leadAngleDeg.toFixed(3) + '°'}/>
                    <Line k="Friction angle φ"  v={result.frictionAngleDeg.toFixed(3) + '°'}/>
                    <Line k="μ_eff"             v={result.effectiveFriction.toFixed(4)}/>
                    <Line k="T_raise (screw)"   v={result.raiseTorqueNm.toFixed(2) + ' N·m'}/>
                    <Line k="T_lower (screw)"   v={result.lowerTorqueNm.toFixed(2) + ' N·m'}/>
                    <Line k="T_collar"          v={result.collarTorqueNm.toFixed(2) + ' N·m'}/>
                    <div data-testid="forge-powerscrew-traise"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        T_raise total = {result.totalRaiseTorqueNm.toFixed(2)} N·m
                    </div>
                    <Line k="T_lower total"     v={result.totalLowerTorqueNm.toFixed(2) + ' N·m'}/>
                    <div data-testid="forge-powerscrew-eta"
                         style={{ marginTop: 4, fontWeight: 700,
                                  color: result.efficiencyPct > 50 ? '#3fb950' :
                                         result.efficiencyPct > 30 ? '#d29922' : '#f85149' }}>
                        η = {result.efficiencyPct.toFixed(1)}%
                    </div>
                    <div data-testid="forge-powerscrew-lock"
                         style={{ marginTop: 4, fontWeight: 600,
                                  color: result.selfLocking ? '#3fb950' : '#d29922' }}>
                        {result.selfLocking ? '🔒 Self-locking' : '⚠ Back-drives (not self-locking)'}
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
