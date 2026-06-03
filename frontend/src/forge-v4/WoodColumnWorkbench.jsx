// Forge-274 — Wood column buckling panel (NDS 2018 §3.7).
// Hierarchy: Tools menu → Structural → Wood members → Wood column.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const COLUMN_TYPES = [
    { id: 'sawn',   label: 'Sawn lumber (c=0.8)' },
    { id: 'round',  label: 'Round timber pole/pile (c=0.85)' },
    { id: 'glulam', label: 'Glulam / SCL (c=0.9)' },
];

export function WoodColumnWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Fc,   setFc  ] = useState(6.62);
    const [Em,   setEm  ] = useState(4140);
    const [A,    setA   ] = useState(38 * 140);
    const [le,   setLe  ] = useState(2440);
    const [d,    setD   ] = useState(140);
    const [type, setType] = useState('sawn');
    const [cD,   setCD  ] = useState(1.0);
    const [cM,   setCM  ] = useState(1.0);
    const [cT,   setCT  ] = useState(1.0);
    const [cF,   setCF  ] = useState(1.0);
    const [cI,   setCI  ] = useState(1.0);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenWoodColumnWorkbench  = () => setOpen(true);
        window.__forgeCloseWoodColumnWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenWoodColumnWorkbench;
            delete window.__forgeCloseWoodColumnWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.woodcolumn?.analyse({
                referenceFcMPa:    Number(Fc),
                emin_MPa:          Number(Em),
                areaMm2:           Number(A),
                effectiveLengthMm: Number(le),
                leastDimensionMm:  Number(d),
                columnType:        type,
                cD: Number(cD), cM: Number(cM), cT: Number(cT),
                cF: Number(cF), cI: Number(cI),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-woodcolumn-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Wood column · NDS 2018 §3.7</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="F_c (MPa)"   v={Fc} set={setFc}/>
            <Row label="E_min (MPa)" v={Em} set={setEm}/>
            <Row label="A (mm²)"     v={A}  set={setA}/>
            <Row label="l_e (mm)"    v={le} set={setLe}/>
            <Row label="d_least (mm)" v={d} set={setD}/>
            <div style={{ display: 'flex', alignItems: 'center', margin: '6px 0' }}>
                <span style={{ width: 130 }}>Column type</span>
                <select data-testid="forge-woodcolumn-type" value={type}
                        onChange={(e) => setType(e.target.value)}
                        style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                                 border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}>
                    {COLUMN_TYPES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
            </div>

            <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
                <FactorRow label="C_D" v={cD} set={setCD}/>
                <FactorRow label="C_M" v={cM} set={setCM}/>
                <FactorRow label="C_t" v={cT} set={setCT}/>
                <FactorRow label="C_F" v={cF} set={setCF}/>
                <FactorRow label="C_i" v={cI} set={setCI}/>
            </div>

            <button data-testid="forge-woodcolumn-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-woodcolumn-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-woodcolumn-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="λ = l_e/d"  v={result.slendernessLeOverD.toFixed(2)}/>
                    <Line k="F*_c (MPa)" v={result.fStarCMPa.toFixed(3)}/>
                    <Line k="F_cE (MPa)" v={result.fcEMPa.toFixed(2)}/>
                    <Line k="α = F_cE/F*_c" v={result.alphaRatio.toFixed(3)}/>
                    <Line k="c"          v={result.cFactor.toFixed(2)}/>
                    <Line k="C_p"        v={result.cP.toFixed(4)}/>
                    <div data-testid="forge-woodcolumn-fcprime"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        F'_c = {result.fcPrimeMPa.toFixed(2)} MPa
                    </div>
                    <div data-testid="forge-woodcolumn-pallow"
                         style={{ marginTop: 4, fontWeight: 700, color: '#3fb950' }}>
                        P_allow = {(result.pAllowN / 1000).toFixed(2)} kN
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
