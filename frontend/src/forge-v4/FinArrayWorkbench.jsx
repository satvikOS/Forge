// Forge-295 — Heat sink fin array panel (Incropera Ch.3 + Kern).
// Hierarchy: Tools menu → Fluids & HVAC → Heat transfer → Fin array.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function FinArrayWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [W,    setW]    = useState(60);
    const [b,    setB]    = useState(100);
    const [N,    setN]    = useState(10);
    const [t,    setT]    = useState(1);
    const [Lf,   setLf]   = useState(20);
    const [k,    setK]    = useState(200);
    const [h,    setH]    = useState(100);
    const [Tb,   setTb]   = useState(80);
    const [Tinf, setTinf] = useState(20);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenFinArrayWorkbench  = () => setOpen(true);
        window.__forgeCloseFinArrayWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenFinArrayWorkbench;
            delete window.__forgeCloseFinArrayWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const r = window.forge?.finarray?.analyse({
                baseWidthMm:               Number(W),
                baseLengthMm:              Number(b),
                finCount:                  Number(N),
                finThicknessMm:            Number(t),
                finLengthMm:               Number(Lf),
                materialConductivityWmK:   Number(k),
                convectionCoefficientWm2K: Number(h),
                baseTemperatureC:          Number(Tb),
                ambientTemperatureC:       Number(Tinf),
            });
            setResult(r);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-finarray-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Heat sink · fin array</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="W (mm) base width"  v={W} set={setW}/>
            <Row label="b (mm) base length"  v={b} set={setB}/>
            <Row label="N fins"              v={N} set={setN}/>
            <Row label="t (mm) thickness"    v={t} set={setT}/>
            <Row label="L_f (mm) length"     v={Lf} set={setLf}/>
            <Row label="k (W/m·K)"            v={k} set={setK}/>
            <Row label="h (W/m²·K)"          v={h} set={setH}/>
            <Row label="T_base (°C)"        v={Tb} set={setTb}/>
            <Row label="T_amb (°C)"          v={Tinf} set={setTinf}/>

            <button data-testid="forge-finarray-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-finarray-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-finarray-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="m"            v={result.finParameterPerM.toFixed(2) + ' m⁻¹'}/>
                    <Line k="L_c"          v={result.correctedLengthMm.toFixed(2) + ' mm'}/>
                    <Line k="η_f single"   v={(result.singleFinEfficiency * 100).toFixed(1) + ' %'}/>
                    <Line k="A_f total"   v={(result.totalFinAreaMm2 / 100).toFixed(1) + ' cm²'}/>
                    <Line k="A_b base"    v={(result.baseAreaMm2 / 100).toFixed(1) + ' cm²'}/>
                    <Line k="A_t exposed" v={(result.totalAreaMm2 / 100).toFixed(1) + ' cm²'}/>
                    <div data-testid="forge-finarray-eta-o"
                         style={{ marginTop: 6, fontWeight: 700 }}>
                        η_o = {(result.overallSurfaceEfficiency * 100).toFixed(1)} %
                    </div>
                    <Line k="R_t"          v={result.thermalResistanceKW.toFixed(3) + ' K/W'}/>
                    <div data-testid="forge-finarray-Q"
                         style={{ marginTop: 4, fontWeight: 700, color: '#3fb950', fontSize: 14 }}>
                        Q = {result.heatDissipatedW.toFixed(1)} W
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
