// Forge-285 — AASHTO 93 flexible pavement panel.
// Hierarchy: Tools menu → Site & civil → Transportation → AASHTO pavement.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function AashtoPavementWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [W18, setW18] = useState(5e6);
    const [R,   setR]   = useState(95);
    const [S0,  setS0]  = useState(0.45);
    const [dPSI, setDPSI] = useState(1.7);
    const [Mr,  setMr]  = useState(5000);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenAashtoPavementWorkbench  = () => setOpen(true);
        window.__forgeCloseAashtoPavementWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenAashtoPavementWorkbench;
            delete window.__forgeCloseAashtoPavementWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.aashto?.analyse({
                w18Esals:       Number(W18),
                reliabilityPct: Number(R),
                overallStdDev:  Number(S0),
                deltaPSI:       Number(dPSI),
                subgradeMrPsi:  Number(Mr),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-aashto-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Pavement SN · AASHTO 1993</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="W_18 (ESALs)"   v={W18} set={setW18}/>
            <Row label="R reliability % " v={R} set={setR}/>
            <Row label="S_0"             v={S0}  set={setS0}/>
            <Row label="ΔPSI"           v={dPSI} set={setDPSI}/>
            <Row label="M_R (psi)"       v={Mr}  set={setMr}/>

            <button data-testid="forge-aashto-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Solve SN</button>

            {error && <div data-testid="forge-aashto-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-aashto-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="Z_R"           v={result.zR.toFixed(4)}/>
                    <Line k="log W_18"      v={result.logW18.toFixed(3)}/>
                    <Line k="N-R iterations" v={result.iterations.toString()}/>
                    <div data-testid="forge-aashto-sn"
                         style={{ marginTop: 6, fontWeight: 700, fontSize: 14, color: '#3fb950' }}>
                        SN = {result.structuralNumber.toFixed(2)}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: '#8b949e' }}>
                        Typical layer breakdown (SN = a_1·D_1 + a_2·m_2·D_2 + a_3·m_3·D_3,<br/>
                        a_1≈0.42 HMA, a_2≈0.14 base, a_3≈0.10 subbase)
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
