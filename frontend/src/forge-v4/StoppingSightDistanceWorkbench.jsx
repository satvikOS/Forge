// Forge-284 — Stopping sight distance panel (AASHTO Green Book).
// Hierarchy: Tools menu → Site & civil → Transportation → SSD.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function StoppingSightDistanceWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [V,    setV ]   = useState(80);     // km/h
    const [t,    setT ]   = useState(2.5);    // s
    const [f,    setF ]   = useState(0.35);
    const [G,    setG ]   = useState(0);      // %
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenStoppingSightDistanceWorkbench  = () => setOpen(true);
        window.__forgeCloseStoppingSightDistanceWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenStoppingSightDistanceWorkbench;
            delete window.__forgeCloseStoppingSightDistanceWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.ssd?.analyse({
                designSpeedKmH:      Number(V),
                perceptionTimeS:     Number(t),
                frictionCoefficient: Number(f),
                gradePct:            Number(G),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-ssd-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 380,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Stopping sight distance · AASHTO</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="V (km/h)"          v={V} set={setV}/>
            <Row label="t_perception (s)"  v={t} set={setT}/>
            <Row label="f friction"       v={f} set={setF}/>
            <Row label="Grade G (%)"       v={G} set={setG}/>

            <button data-testid="forge-ssd-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute SSD</button>

            {error && <div data-testid="forge-ssd-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-ssd-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="v (m/s)"         v={result.designSpeedMs.toFixed(2)}/>
                    <Line k="a effective"     v={result.effectiveDecelerationMs2.toFixed(2) + ' m/s²'}/>
                    <Line k="d_perception"    v={result.perceptionDistanceM.toFixed(1) + ' m'}/>
                    <Line k="d_braking"        v={result.brakingDistanceM.toFixed(1) + ' m'}/>
                    <div data-testid="forge-ssd-total"
                         style={{ marginTop: 6, fontWeight: 700, fontSize: 14 }}>
                        SSD = {result.totalSsdM.toFixed(1)} m
                    </div>
                    <div data-testid="forge-ssd-ft"
                         style={{ marginTop: 4, color: '#8b949e', fontSize: 11 }}>
                        = {result.totalSsdFt.toFixed(0)} ft
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
            <input type="number" step="0.1" value={v} onChange={(e) => set(e.target.value)}
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
