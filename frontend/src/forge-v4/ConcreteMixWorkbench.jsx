// Forge-312 — Concrete mix design (ACI 211.1 absolute-volume method).
// Hierarchy: Tools menu → Structural → Concrete → Mix design.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function ConcreteMixWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [fc, setFc]     = useState(30);
    const [sl, setSl]     = useState(100);
    const [dm, setDm]     = useState(25);
    const [air, setAir]   = useState(0.015);
    const [sgc, setSgc]   = useState(3.15);
    const [sgs, setSgs]   = useState(2.65);
    const [sga, setSga]   = useState(2.70);
    const [drd, setDrd]   = useState(1600);
    const [fm, setFm]     = useState(2.6);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenConcreteMixWorkbench  = () => setOpen(true);
        window.__forgeCloseConcreteMixWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenConcreteMixWorkbench;
            delete window.__forgeCloseConcreteMixWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.concretemix?.analyse({
                targetStrengthMPa:      Number(fc),
                slumpMm:                Number(sl),
                maxAggregateSizeMm:     Number(dm),
                airContentFraction:     Number(air),
                cementSpecificGravity:  Number(sgc),
                sandSpecificGravity:    Number(sgs),
                coarseSpecificGravity:  Number(sga),
                coarseDryRoddedDensity: Number(drd),
                coarseFinenessModulus:  Number(fm),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-cm-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Concrete mix · ACI 211.1</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="f'_c (MPa) target"      v={fc}  set={setFc}/>
            <Row label="Slump (mm)"             v={sl}  set={setSl}/>
            <Row label="Max agg (mm)"           v={dm}  set={setDm}/>
            <Row label="Air content (fraction)" v={air} set={setAir}/>
            <Row label="SG cement"              v={sgc} set={setSgc}/>
            <Row label="SG sand"                v={sgs} set={setSgs}/>
            <Row label="SG coarse"              v={sga} set={setSga}/>
            <Row label="ρ_DRD coarse (kg/m³)"   v={drd} set={setDrd}/>
            <Row label="FM coarse"              v={fm}  set={setFm}/>

            <button data-testid="forge-cm-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Proportion</button>

            {error && <div data-testid="forge-cm-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-cm-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <div data-testid="forge-cm-wc"
                         style={{ fontWeight: 700, color: '#58a6ff' }}>
                        w/c = {result.waterCementRatio.toFixed(3)}
                    </div>
                    <div style={{ marginTop: 6, color: '#8b949e', fontSize: 11 }}>Batch per m³ of concrete</div>
                    <Line k="Water"           v={result.waterDemandKg.toFixed(1) + ' kg'}/>
                    <Line k="Cement"          v={result.cementMassKg.toFixed(1) + ' kg'}/>
                    <Line k="Sand"            v={result.sandMassKg.toFixed(1) + ' kg'}/>
                    <Line k="Coarse agg"      v={result.coarseAggregateMassKg.toFixed(1) + ' kg'}/>
                    <Line k="Air"             v={(result.airVolumeM3 * 100).toFixed(1) + ' %'}/>
                    <div data-testid="forge-cm-unit"
                         style={{ marginTop: 6, fontWeight: 700, color: '#3fb950' }}>
                        Fresh unit wt = {result.freshUnitWeightKgPerM3.toFixed(0)} kg/m³
                    </div>
                    <div style={{ marginTop: 6, color: '#8b949e', fontSize: 11 }}>
                        Volumes: cement {(result.cementVolumeM3*100).toFixed(1)}%, water {(result.waterVolumeM3*100).toFixed(1)}%,
                        coarse {(result.coarseVolumeM3*100).toFixed(1)}%, sand {(result.sandVolumeM3*100).toFixed(1)}%
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
            <span style={{ width: 180 }}>{label}</span>
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
