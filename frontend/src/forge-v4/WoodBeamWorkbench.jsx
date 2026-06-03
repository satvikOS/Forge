// Forge-272 — Wood beam bending panel (NDS 2018 §3.3 + §4.3).
// Hierarchy: Tools menu → Structural → Wood members → Wood beam bending.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function WoodBeamWorkbenchHost() {
    const [open, setOpen] = useState(false);
    // Default DF-L No.2 2×12 joist (38 × 286 mm dressed).
    const [Fb,  setFb ]  = useState(6.21);
    const [Em,  setEm ]  = useState(4480);
    const [b,   setB  ]  = useState(38);
    const [d,   setD  ]  = useState(286);
    const [le,  setLe ]  = useState(2000);
    const [cD,  setCD ]  = useState(1.15);
    const [cM,  setCM ]  = useState(1.0);
    const [cT,  setCT ]  = useState(1.0);
    const [cF,  setCF ]  = useState(1.0);
    const [cFu, setCFu]  = useState(1.0);
    const [cI,  setCI ]  = useState(1.0);
    const [cR,  setCR ]  = useState(1.15);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenWoodBeamWorkbench  = () => setOpen(true);
        window.__forgeCloseWoodBeamWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenWoodBeamWorkbench;
            delete window.__forgeCloseWoodBeamWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.woodbeam?.analyse({
                referenceFbMPa:    Number(Fb),
                emin_MPa:          Number(Em),
                widthMm:           Number(b),
                depthMm:           Number(d),
                effectiveLengthMm: Number(le),
                cD: Number(cD), cM: Number(cM), cT: Number(cT),
                cF: Number(cF), cFu: Number(cFu),
                cI: Number(cI), cR: Number(cR),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-woodbeam-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Wood beam · NDS 2018 §3.3</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="F_b (MPa)"   v={Fb} set={setFb}/>
            <Row label="E_min (MPa)" v={Em} set={setEm}/>
            <Row label="b (mm)"      v={b}  set={setB}/>
            <Row label="d (mm)"      v={d}  set={setD}/>
            <Row label="l_e (mm)"    v={le} set={setLe}/>

            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
                <FactorRow label="C_D" v={cD} set={setCD}/>
                <FactorRow label="C_M" v={cM} set={setCM}/>
                <FactorRow label="C_t" v={cT} set={setCT}/>
                <FactorRow label="C_F" v={cF} set={setCF}/>
                <FactorRow label="C_fu" v={cFu} set={setCFu}/>
                <FactorRow label="C_i" v={cI} set={setCI}/>
                <FactorRow label="C_r" v={cR} set={setCR}/>
            </div>

            <button data-testid="forge-woodbeam-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-woodbeam-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-woodbeam-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="S_x (mm³)"      v={result.sectionModulusMm3.toFixed(0)}/>
                    <Line k="F*_b (MPa)"     v={result.fbStarMPa.toFixed(3)}/>
                    <Line k="R_B"           v={result.slendernessRb.toFixed(2)}/>
                    <Line k="F_bE (MPa)"     v={result.fbEMPa.toFixed(2)}/>
                    <Line k="α (F_bE/F*_b)" v={result.alphaRatio.toFixed(3)}/>
                    <Line k="C_L"           v={result.cL.toFixed(4)}/>
                    <div data-testid="forge-woodbeam-fbprime"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        F'_b = {result.fbPrimeMPa.toFixed(2)} MPa
                    </div>
                    <div data-testid="forge-woodbeam-mallow"
                         style={{ marginTop: 4, fontWeight: 700, color: '#3fb950' }}>
                        M_allow = {(result.mAllowNmm / 1e6).toFixed(2)} kN·m
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
            <input type="number" value={v} onChange={(e) => set(e.target.value)}
                   style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                            border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}/>
        </div>
    );
}

function FactorRow({ label, v, set }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ width: 40, fontSize: 12, color: '#8b949e' }}>{label}</span>
            <input type="number" step="0.05" value={v} onChange={(e) => set(e.target.value)}
                   style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                            border: '1px solid #30363d', borderRadius: 4, padding: '3px', fontSize: 12 }}/>
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
