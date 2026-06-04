// Forge-297 — 1D soil consolidation panel (Terzaghi 1925).
// Hierarchy: Tools menu → Structural → Foundations → 1D consolidation.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function ConsolidationWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [H,    setH]    = useState(6);
    const [dbl,  setDbl]  = useState(false);
    const [cv,   setCv]   = useState(2);
    const [mv,   setMv]   = useState(0.5);
    const [dsig, setDsig] = useState(100);
    const [t,    setT]    = useState(10);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenConsolidationWorkbench  = () => setOpen(true);
        window.__forgeCloseConsolidationWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenConsolidationWorkbench;
            delete window.__forgeCloseConsolidationWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.consol?.analyse({
                soilDepthM:                     Number(H),
                doubleDrainage:                 dbl,
                coefficientOfConsolidationM2yr: Number(cv),
                volumeCompressibilityM2MN:      Number(mv),
                pressureIncreaseKPa:            Number(dsig),
                timeYears:                      Number(t),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-consol-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>1D consolidation · Terzaghi</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="H (m) clay depth"     v={H}    set={setH}/>
            <label style={{ display: 'flex', alignItems: 'center', margin: '5px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={dbl} data-testid="forge-consol-double"
                       onChange={(e) => setDbl(e.target.checked)} style={{ marginRight: 8 }}/>
                <span>Double drainage (sand both sides)</span>
            </label>
            <Row label="c_v (m²/year)"         v={cv}   set={setCv}/>
            <Row label="m_v (m²/MN)"           v={mv}   set={setMv}/>
            <Row label="Δσ' (kPa)"             v={dsig} set={setDsig}/>
            <Row label="t (years)"             v={t}    set={setT}/>

            <button data-testid="forge-consol-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute Settlement</button>

            {error && <div data-testid="forge-consol-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-consol-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="H_dr"        v={result.drainagePathM.toFixed(2) + ' m'}/>
                    <Line k="T_v"         v={result.timeFactor.toFixed(3)}/>
                    <Line k="S_∞ ultimate" v={result.ultimateSettlementMm.toFixed(1) + ' mm'}/>
                    <div data-testid="forge-consol-U"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        U = {result.degreeOfConsolidationPct.toFixed(1)} %
                    </div>
                    <div data-testid="forge-consol-S"
                         style={{ marginTop: 4, fontWeight: 700, color: '#3fb950', fontSize: 14 }}>
                        S(t) = {result.settlementAtTimeMm.toFixed(1)} mm
                    </div>
                    <div data-testid="forge-consol-t90"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        t₉₀ = {result.t90Years.toFixed(2)} years
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
