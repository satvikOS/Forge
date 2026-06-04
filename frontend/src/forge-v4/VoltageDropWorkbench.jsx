// Forge-304 — Cable voltage drop (NEC 215.2 / IEC 60364).
// Hierarchy: Tools menu → MEP → Electrical → Voltage drop.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const CONDS  = ['copper', 'aluminum'];
const PHASES = ['single', 'three'];

export function VoltageDropWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [cond, setCond]   = useState('copper');
    const [phase, setPhase] = useState('single');
    const [A,    setA]      = useState(21.15);
    const [I,    setI]      = useState(50);
    const [L,    setL]      = useState(30);
    const [V,    setV]      = useState(240);
    const [pf,   setPf]     = useState(1.0);
    const [T,    setT]      = useState(75);
    const [X,    setX]      = useState(0);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenVoltageDropWorkbench  = () => setOpen(true);
        window.__forgeCloseVoltageDropWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenVoltageDropWorkbench;
            delete window.__forgeCloseVoltageDropWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.voltagedrop?.analyse({
                conductor:        cond,
                phaseSystem:      phase,
                crossSectionMm2:  Number(A),
                currentA:         Number(I),
                oneWayLengthM:    Number(L),
                nominalVoltageV:  Number(V),
                powerFactor:      Number(pf),
                conductorTempC:   Number(T),
                reactancePerMOhm: Number(X),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-vdrop-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Voltage drop · NEC 215.2</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <RowSel label="Conductor"          v={cond}  set={setCond}  options={CONDS}/>
            <RowSel label="Phase system"       v={phase} set={setPhase} options={PHASES}/>
            <Row label="A (mm²) cross-section" v={A}  set={setA}/>
            <Row label="I (A) load"            v={I}  set={setI}/>
            <Row label="L (m) one-way"         v={L}  set={setL}/>
            <Row label="V (V) nominal"         v={V}  set={setV}/>
            <Row label="PF cos φ"              v={pf} set={setPf}/>
            <Row label="T (°C) conductor"      v={T}  set={setT}/>
            <Row label="X (Ω/m) reactance"     v={X}  set={setX}/>

            <button data-testid="forge-vdrop-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>

            {error && <div data-testid="forge-vdrop-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-vdrop-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Line k="R per m"       v={(result.resistancePerMOhm * 1000).toFixed(4) + ' mΩ/m'}/>
                    <Line k="V_drop"        v={result.voltageDropV.toFixed(3) + ' V'}/>
                    <div data-testid="forge-vdrop-pct"
                         style={{ marginTop: 6, fontWeight: 700,
                                  color: result.voltageDropPercent <= 3 ? '#3fb950' :
                                         result.voltageDropPercent <= 5 ? '#d29922' : '#f85149' }}>
                        Drop = {result.voltageDropPercent.toFixed(2)} %
                    </div>
                    <Line k="P_loss"        v={result.powerLossKw.toFixed(3) + ' kW'}/>
                    <div data-testid="forge-vdrop-feeder"
                         style={{ marginTop: 8, padding: '4px 8px', borderRadius: 4,
                                  background: result.meetsFeederLimit ? '#1d2d1d' : '#3d1d1d',
                                  color: result.meetsFeederLimit ? '#3fb950' : '#f85149',
                                  fontWeight: 700, textAlign: 'center' }}>
                        Feeder ≤ 3 %: {result.meetsFeederLimit ? 'pass' : 'fail'}
                    </div>
                    <div data-testid="forge-vdrop-combined"
                         style={{ marginTop: 4, padding: '4px 8px', borderRadius: 4,
                                  background: result.meetsCombinedLimit ? '#1d2d1d' : '#3d1d1d',
                                  color: result.meetsCombinedLimit ? '#3fb950' : '#f85149',
                                  fontWeight: 700, textAlign: 'center' }}>
                        Combined ≤ 5 %: {result.meetsCombinedLimit ? 'pass' : 'fail'}
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
            <span style={{ width: 170 }}>{label}</span>
            <input type="number" value={v} onChange={(e) => set(e.target.value)}
                   style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                            border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}/>
        </div>
    );
}

function RowSel({ label, v, set, options }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', margin: '5px 0' }}>
            <span style={{ width: 170 }}>{label}</span>
            <select value={v} onChange={(e) => set(e.target.value)}
                    style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                             border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
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
