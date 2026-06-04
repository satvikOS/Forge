// Forge-301 — Wire rope FOS + bending fatigue (Shigley §17-7).
// Hierarchy: Tools menu → Lifting & rigging → Wire rope.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const CLASSES = ['6x19', '6x37', '6x61'];
const APPS = ['hoist', 'elevator', 'haulage', 'guy', 'track', 'mine'];

export function WireRopeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [cls,  setCls]  = useState('6x19');
    const [app,  setApp]  = useState('hoist');
    const [d,    setD]    = useState(19);
    const [W,    setW]    = useState(30000);
    const [D,    setDia]  = useState(646);
    const [g,    setG]    = useState(1.0);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenWireRopeWorkbench  = () => setOpen(true);
        window.__forgeCloseWireRopeWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenWireRopeWorkbench;
            delete window.__forgeCloseWireRopeWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.wirerope?.analyse({
                ropeClass: cls,
                applicationClass: app,
                nominalDiameterMm: Number(d),
                workingLoadN:      Number(W),
                sheaveDiameterMm:  Number(D),
                accelerationG:     Number(g),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-wirerope-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Wire rope · FOS & bending fatigue</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <RowSelect label="Rope class"        v={cls} set={setCls} options={CLASSES}/>
            <RowSelect label="Application"       v={app} set={setApp} options={APPS}/>
            <Row label="d_r (mm) nominal"        v={d}   set={setD}/>
            <Row label="W (N) working load"      v={W}   set={setW}/>
            <Row label="D (mm) sheave"           v={D}   set={setDia}/>
            <Row label="a/g acceleration"        v={g}   set={setG}/>

            <button data-testid="forge-wirerope-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-wirerope-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-wirerope-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="F_u breaking"     v={(result.breakingStrengthN / 1000).toFixed(1) + ' kN'}/>
                    <Line k="σ_b bending"      v={result.bendingStressMPa.toFixed(2) + ' MPa'}/>
                    <Line k="F_b equiv."       v={(result.equivalentBendingTensionN / 1000).toFixed(2) + ' kN'}/>
                    <Line k="F_tot total"      v={(result.totalEffectiveTensionN / 1000).toFixed(2) + ' kN'}/>
                    <div data-testid="forge-wirerope-FOS"
                         style={{ marginTop: 6, fontWeight: 700,
                                  color: result.strengthPasses ? '#3fb950' : '#f85149' }}>
                        FOS = {result.factorOfSafetyTotal.toFixed(2)} (req {result.recommendedFOS.toFixed(1)})
                    </div>
                    <div data-testid="forge-wirerope-Dd"
                         style={{ marginTop: 4, fontWeight: 700,
                                  color: result.sheavePasses ? '#3fb950' : '#f85149' }}>
                        D/d = {result.sheaveRatio.toFixed(1)} (min {result.recommendedMinSheaveRatio.toFixed(0)})
                    </div>
                    <div data-testid="forge-wirerope-pass"
                         style={{ marginTop: 8, padding: '6px 8px', borderRadius: 4,
                                  background: result.passes ? '#1d2d1d' : '#5a1d1d',
                                  color: result.passes ? '#3fb950' : '#f85149',
                                  fontWeight: 700, textAlign: 'center' }}>
                        {result.passes ? 'Rope sized OK' : 'Resize required'}
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
            <span style={{ width: 170 }}>{label}</span>
            <input type="number" value={v} onChange={(e) => set(e.target.value)}
                   style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                            border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}/>
        </div>
    );
}

function RowSelect({ label, v, set, options }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', margin: '5px 0' }}>
            <span style={{ width: 170 }}>{label}</span>
            <select value={v} onChange={(e) => set(e.target.value)}
                    style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                             border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
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
