// Forge-287 — Earthwork prismoidal volume panel.
// Hierarchy: Tools menu → Site & civil → Earthworks → Prismoidal volume.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function PrismoidalWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [L,    setL ]   = useState(20);
    const [A1,   setA1]   = useState(50);
    const [Am,   setAm]   = useState(80);
    const [A2,   setA2]   = useState(110);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenPrismoidalWorkbench  = () => setOpen(true);
        window.__forgeClosePrismoidalWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenPrismoidalWorkbench;
            delete window.__forgeClosePrismoidalWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.prismoidal?.analyse({
                lengthM:      Number(L),
                areaStartM2:  Number(A1),
                areaMiddleM2: Number(Am),
                areaEndM2:    Number(A2),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-prismoidal-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Earthwork volume · Prismoidal</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="L (m)"    v={L}  set={setL}/>
            <Row label="A_1 (m²)" v={A1} set={setA1}/>
            <Row label="A_m (m²) middle" v={Am} set={setAm}/>
            <Row label="A_2 (m²)" v={A2} set={setA2}/>

            <button data-testid="forge-prismoidal-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute Volume</button>

            {error && <div data-testid="forge-prismoidal-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-prismoidal-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <div data-testid="forge-prismoidal-V"
                         style={{ fontWeight: 700, fontSize: 16, color: '#3fb950' }}>
                        V = {result.prismoidalVolumeM3.toFixed(1)} m³
                    </div>
                    <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
                        ≈ {result.prismoidalVolumeCubicYards.toFixed(1)} cu yd
                    </div>
                    <Line k="V_AEA"      v={result.averageEndAreaVolumeM3.toFixed(1) + ' m³'}/>
                    <Line k="ΔV"         v={result.differenceM3.toFixed(1) + ' m³'}/>
                    <Line k="AEA error" v={result.aeaErrorPct.toFixed(2) + ' %'}/>
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
