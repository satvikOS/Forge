// Forge-293 — Crane hook stress check panel (DIN 15400 / ASME B30.10).
// Hierarchy: Tools menu → Machine design → Lifting & rigging → Crane hook.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function CraneHookWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [WLL, setWLL] = useState(50);
    const [ds,  setDs]  = useState(50);
    const [sa,  setSa]  = useState(80);
    const [Z,   setZ]   = useState(80000);
    const [L,   setL]   = useState(75);
    const [tha, setTha] = useState(130);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenCraneHookWorkbench  = () => setOpen(true);
        window.__forgeCloseCraneHookWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenCraneHookWorkbench;
            delete window.__forgeCloseCraneHookWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.hook?.analyse({
                wllKN:                    Number(WLL),
                shankDiameterMm:          Number(ds),
                shankAllowableStressMPa:  Number(sa),
                throatSectionModulusMm3:  Number(Z),
                throatMomentArmMm:        Number(L),
                throatAllowableStressMPa: Number(tha),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-hook-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Crane hook · DIN 15400 / ASME B30</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="WLL (kN)"             v={WLL} set={setWLL}/>
            <Row label="d_shank (mm)"         v={ds}  set={setDs}/>
            <Row label="σ_shank,allow (MPa)"  v={sa}  set={setSa}/>
            <Row label="Z_throat (mm³)"       v={Z}   set={setZ}/>
            <Row label="L_arm (mm)"           v={L}   set={setL}/>
            <Row label="σ_throat,allow (MPa)" v={tha} set={setTha}/>

            <button data-testid="forge-hook-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Check Hook</button>

            {error && <div data-testid="forge-hook-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-hook-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <CheckRow label="σ_shank"  value={result.shankStressMPa.toFixed(1) + ' MPa'}
                              dcr={result.shankDCR} ok={result.shankOK}/>
                    <Line k="Shank area"      v={result.shankAreaMm2.toFixed(0) + ' mm²'}/>
                    <CheckRow label="σ_throat" value={result.throatStressMPa.toFixed(1) + ' MPa'}
                              dcr={result.throatDCR} ok={result.throatOK}/>
                    <Line k="Throat moment"   v={(result.bendingMomentNmm / 1000).toFixed(1) + ' kN·mm'}/>
                    <Line k="Governing DCR"   v={result.governingDCR.toFixed(3)}/>
                    <div data-testid="forge-hook-overall"
                         style={{ marginTop: 8, padding: '6px 10px', borderRadius: 4,
                                  background: result.overallOK ? '#3fb950' : '#f85149',
                                  color: '#0d1117', fontWeight: 700, textAlign: 'center', fontSize: 14 }}>
                        {result.overallOK ? '✓ Hook passes' : '✗ Hook FAILS'}
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

function CheckRow({ label, value, dcr, ok }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span style={{ color: '#8b949e' }}>{label}</span>
            <span style={{ color: ok ? '#3fb950' : '#f85149' }}>
                {value} (DCR {dcr.toFixed(2)})
            </span>
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
