// Forge-290 — Worm gear drive panel (Shigley §13 / AGMA).
// Hierarchy: Tools menu → Machine design → Power transmission → Worm gear.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function WormGearWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [m,  setM]  = useState(4);
    const [Nw, setNw] = useState(2);
    const [Ng, setNg] = useState(50);
    const [dw, setDw] = useState(40);
    const [mu, setMu] = useState(0.04);
    const [nw, setNwSpeed] = useState(1750);
    const [Tw, setTw] = useState(10);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenWormGearWorkbench  = () => setOpen(true);
        window.__forgeCloseWormGearWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenWormGearWorkbench;
            delete window.__forgeCloseWormGearWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.wormgear?.analyse({
                moduleMm:            Number(m),
                wormStarts:          Number(Nw),
                gearTeeth:           Number(Ng),
                wormPitchDiameterMm: Number(dw),
                frictionCoefficient: Number(mu),
                inputSpeedRpm:       Number(nw),
                inputTorqueNm:       Number(Tw),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-wormgear-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Worm gear · Shigley §13 / AGMA</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="m (mm) module"     v={m}  set={setM}/>
            <Row label="N_w starts"        v={Nw} set={setNw}/>
            <Row label="N_g teeth"         v={Ng} set={setNg}/>
            <Row label="d_w (mm)"          v={dw} set={setDw}/>
            <Row label="μ friction"        v={mu} set={setMu}/>
            <Row label="n_w (rpm)"         v={nw} set={setNwSpeed}/>
            <Row label="T_w (N·m)"         v={Tw} set={setTw}/>

            <button data-testid="forge-wormgear-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-wormgear-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-wormgear-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="i ratio"     v={result.velocityRatio.toFixed(2)}/>
                    <Line k="Lead L"      v={result.leadMm.toFixed(2) + ' mm'}/>
                    <Line k="γ lead"      v={result.leadAngleDeg.toFixed(2) + '°'}/>
                    <Line k="φ friction" v={result.frictionAngleDeg.toFixed(2) + '°'}/>
                    <Line k="d_g"         v={result.gearPitchDiameterMm.toFixed(1) + ' mm'}/>
                    <Line k="C centre"   v={result.centreDistanceMm.toFixed(1) + ' mm'}/>
                    <Line k="V_s sliding" v={result.slidingVelocityMs.toFixed(2) + ' m/s'}/>
                    <div data-testid="forge-wormgear-eta"
                         style={{ marginTop: 6, fontWeight: 700,
                                  color: result.efficiencyPct > 80 ? '#3fb950' :
                                         result.efficiencyPct > 50 ? '#d29922' : '#f85149' }}>
                        η = {result.efficiencyPct.toFixed(1)} %
                    </div>
                    <Line k="n_g"         v={result.outputSpeedRpm.toFixed(1) + ' rpm'}/>
                    <div data-testid="forge-wormgear-T"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff', fontSize: 14 }}>
                        T_g = {result.outputTorqueNm.toFixed(1)} N·m
                    </div>
                    <div data-testid="forge-wormgear-lock"
                         style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4,
                                  background: result.selfLocking ? '#3fb950' : '#d29922',
                                  color: '#0d1117', fontWeight: 700, textAlign: 'center' }}>
                        {result.selfLocking
                            ? '🔒 Self-locking (φ > γ)'
                            : '⚠ Back-drives (φ ≤ γ)'}
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
            <span style={{ width: 140 }}>{label}</span>
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
