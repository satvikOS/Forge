// Forge-299 — Catenary cable sag-tension panel.
// Hierarchy: Tools menu → Structural → Loads & code → Catenary cable.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function CatenaryWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [L, setL] = useState(300);
    const [H, setH] = useState(30000);
    const [w, setW] = useState(18);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenCatenaryWorkbench  = () => setOpen(true);
        window.__forgeCloseCatenaryWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenCatenaryWorkbench;
            delete window.__forgeCloseCatenaryWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.catenary?.analyse({
                spanM:              Number(L),
                horizontalTensionN: Number(H),
                linearWeightNPerM:  Number(w),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-catenary-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Catenary cable · sag-tension</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="L (m) span"          v={L} set={setL}/>
            <Row label="H (N) horiz. tension" v={H} set={setH}/>
            <Row label="w (N/m) cable wt"     v={w} set={setW}/>

            <button data-testid="forge-catenary-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-catenary-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-catenary-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="c = H/w"        v={result.catenaryParameterM.toFixed(2) + ' m'}/>
                    <div data-testid="forge-catenary-sag"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        sag = {result.sagM.toFixed(3)} m
                    </div>
                    <Line k="sag parabolic" v={result.sagParabolicM.toFixed(3) + ' m'}/>
                    <div data-testid="forge-catenary-T"
                         style={{ marginTop: 6, fontWeight: 700,
                                  color: result.sagRatio > 0.10 ? '#f85149' :
                                         result.sagRatio > 0.05 ? '#d29922' : '#3fb950' }}>
                        T_max = {(result.maxTensionN / 1000).toFixed(2)} kN
                    </div>
                    <Line k="L cable"        v={result.cableLengthM.toFixed(3) + ' m'}/>
                    <div data-testid="forge-catenary-ratio"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        s/L = {(result.sagRatio * 100).toFixed(2)} %
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
