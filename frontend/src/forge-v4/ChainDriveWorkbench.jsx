// Forge-283 — Roller chain drive geometry panel.
// Hierarchy: Tools menu → Machine design → Power transmission → Chain drive.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function ChainDriveWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [p,  setP ]  = useState(19.05);
    const [N1, setN1]  = useState(17);
    const [N2, setN2]  = useState(51);
    const [C,  setC ]  = useState(500);
    const [n1, setNn]  = useState(1750);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenChainDriveWorkbench  = () => setOpen(true);
        window.__forgeCloseChainDriveWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenChainDriveWorkbench;
            delete window.__forgeCloseChainDriveWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.chain?.analyse({
                pitchMm:         Number(p),
                driverTeeth:     Number(N1),
                drivenTeeth:     Number(N2),
                centerDistanceMm: Number(C),
                driverSpeedRpm:  Number(n1),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-chain-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Roller chain drive · ANSI B29</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="Pitch p (mm)"    v={p}  set={setP}/>
            <Row label="N_1 (driver)"     v={N1} set={setN1}/>
            <Row label="N_2 (driven)"     v={N2} set={setN2}/>
            <Row label="C (mm) center"   v={C}  set={setC}/>
            <Row label="n_1 (rpm)"        v={n1} set={setNn}/>

            <button data-testid="forge-chain-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-chain-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-chain-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="d_1 (driver)"   v={result.driverPitchDiameterMm.toFixed(2) + ' mm'}/>
                    <Line k="d_2 (driven)"   v={result.drivenPitchDiameterMm.toFixed(2) + ' mm'}/>
                    <Line k="Ratio i"        v={result.speedRatio.toFixed(3)}/>
                    <Line k="n_2"            v={result.drivenSpeedRpm.toFixed(0) + ' rpm'}/>
                    <Line k="Chain v"        v={result.chainVelocityMs.toFixed(2) + ' m/s'}/>
                    <Line k="L raw"          v={result.approxLengthMm.toFixed(1) + ' mm ('
                                              + result.lengthInPitches.toFixed(2) + ' pitches)'}/>
                    <div data-testid="forge-chain-Lround"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        L = {result.lengthInPitchesRounded} pitches
                        ({(result.lengthInPitchesRounded * Number(p)).toFixed(1)} mm)
                    </div>
                    <div data-testid="forge-chain-Cfinal"
                         style={{ marginTop: 4, fontWeight: 700, color: '#58a6ff' }}>
                        C_final = {result.finalCenterDistanceMm.toFixed(1)} mm
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
