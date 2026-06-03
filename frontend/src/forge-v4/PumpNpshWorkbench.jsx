// Forge-273 — Pump NPSH available panel (ANSI/HI 9.6).
// Hierarchy: Tools menu → Fluids & HVAC → Pipe & duct flow → Pump NPSH.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function PumpNpshWorkbenchHost() {
    const [open, setOpen] = useState(false);
    // Default: water 20 °C sea-level, flooded suction.
    const [pAtm, setPAtm] = useState(101.325);  // kPa
    const [pV,   setPV  ] = useState(2.339);    // kPa
    const [rho,  setRho ] = useState(998);      // kg/m³
    const [zs,   setZs  ] = useState(3);        // m (positive flooded)
    const [hf,   setHf  ] = useState(1.5);      // m
    const [npshr, setNpshr] = useState(4);      // m
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenPumpNpshWorkbench  = () => setOpen(true);
        window.__forgeClosePumpNpshWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenPumpNpshWorkbench;
            delete window.__forgeClosePumpNpshWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.pumpnpsh?.analyse({
                atmosphericPressurePa: Number(pAtm) * 1000,
                vapourPressurePa:      Number(pV)   * 1000,
                densityKgM3:           Number(rho),
                staticSuctionHeadM:    Number(zs),
                frictionHeadM:         Number(hf),
                requiredNpshM:         Number(npshr),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    const statusColour = (r) =>
        r.cavitating ? '#f85149' :
        r.marginalPerHi ? '#d29922' : '#3fb950';

    const statusText = (r) =>
        r.cavitating ? 'CAVITATING' :
        r.marginalPerHi ? 'MARGINAL (HI)' : 'SAFE';

    return createPortal(
        <div data-testid="forge-pumpnpsh-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 380,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Pump NPSH · ANSI/HI 9.6</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="p_atm (kPa)"   v={pAtm}  set={setPAtm}/>
            <Row label="p_v (kPa)"      v={pV}    set={setPV}/>
            <Row label="ρ (kg/m³)"      v={rho}   set={setRho}/>
            <Row label="z_s (m) ±"      v={zs}    set={setZs}/>
            <Row label="h_f (m)"        v={hf}    set={setHf}/>
            <Row label="NPSH_R (m)"     v={npshr} set={setNpshr}/>

            <button data-testid="forge-pumpnpsh-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute NPSH_A</button>

            {error && <div data-testid="forge-pumpnpsh-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-pumpnpsh-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="Pressure head"  v={result.pressureHeadM.toFixed(2) + ' m'}/>
                    <Line k="z_s contribution"  v={Number(zs).toFixed(2) + ' m'}/>
                    <Line k="−h_f"               v={(-Number(hf)).toFixed(2) + ' m'}/>
                    <div data-testid="forge-pumpnpsh-npsha"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        NPSH_A = {result.availableNpshM.toFixed(2)} m
                    </div>
                    <Line k="NPSH_R (input)"   v={Number(npshr).toFixed(2) + ' m'}/>
                    <Line k="margin"            v={result.marginM.toFixed(2) + ' m ('
                                                 + result.marginPct.toFixed(1) + ' %)'}/>
                    <div data-testid="forge-pumpnpsh-status"
                         style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4,
                                  background: statusColour(result), color: '#0d1117',
                                  fontWeight: 700, textAlign: 'center' }}>
                        {statusText(result)}
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
