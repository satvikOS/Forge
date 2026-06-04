// Forge-311 — Steel section classification (AISC 360-22 Table B4.1b).
// Hierarchy: Tools menu → Structural → Steel members → Section classification.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const CLASS_COLOUR = {
    'compact':     '#3fb950',
    'non-compact': '#d29922',
    'slender':     '#f85149',
};

export function SectionClassWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [bf, setBf] = useState(210);
    const [tf, setTf] = useState(14.4);
    const [d,  setD]  = useState(534);
    const [tw, setTw] = useState(11.4);
    const [fy, setFy] = useState(345);
    const [E,  setE]  = useState(200000);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenSectionClassWorkbench  = () => setOpen(true);
        window.__forgeCloseSectionClassWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenSectionClassWorkbench;
            delete window.__forgeCloseSectionClassWorkbench;
        };
    }, []);

    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.sectclass?.analyse({
                bf_mm:  Number(bf),
                tf_mm:  Number(tf),
                d_mm:   Number(d),
                tw_mm:  Number(tw),
                Fy_MPa: Number(fy),
                E_MPa:  Number(E),
            });
            setResult(res);
            setError(null);
        } catch (e) {
            setError(String(e.message || e));
            setResult(null);
        }
    };

    return createPortal(
        <div data-testid="forge-sc-panel" style={{
            position: 'fixed', top: 90, right: 24, width: 420,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Section classification · AISC B4.1b</strong>
                <button onClick={() => setOpen(false)}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <Row label="b_f (mm) flange width"   v={bf} set={setBf}/>
            <Row label="t_f (mm) flange thick"   v={tf} set={setTf}/>
            <Row label="d (mm) overall depth"    v={d}  set={setD}/>
            <Row label="t_w (mm) web thick"      v={tw} set={setTw}/>
            <Row label="F_y (MPa)"               v={fy} set={setFy}/>
            <Row label="E (MPa)"                 v={E}  set={setE}/>

            <button data-testid="forge-sc-run" onClick={run}
                    style={{ marginTop: 10, width: '100%', padding: 8,
                             background: '#238636', border: 'none', borderRadius: 4,
                             color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Classify</button>

            {error && <div data-testid="forge-sc-error"
                           style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}

            {result && (
                <div data-testid="forge-sc-result"
                     style={{ marginTop: 12, padding: 10, background: '#0d1117',
                              borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
                    <Section title="Flange (Case 10)"
                             lam={result.flangeSlenderness}
                             lp={result.flangeLambda_p}
                             lr={result.flangeLambda_r}
                             cls={result.flangeClass}
                             testid="forge-sc-flange"/>
                    <Section title="Web (Case 15)"
                             lam={result.webSlenderness}
                             lp={result.webLambda_p}
                             lr={result.webLambda_r}
                             cls={result.webClass}
                             testid="forge-sc-web"/>
                    <div data-testid="forge-sc-overall"
                         style={{ marginTop: 8, padding: '6px 8px', borderRadius: 4,
                                  background: '#0d1117',
                                  border: `2px solid ${CLASS_COLOUR[result.overallClass]}`,
                                  color: CLASS_COLOUR[result.overallClass],
                                  fontWeight: 700, textAlign: 'center', fontSize: 14 }}>
                        Section: {result.overallClass.toUpperCase()}
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
}

function Section({ title, lam, lp, lr, cls, testid }) {
    return (
        <div data-testid={testid} style={{ marginBottom: 8 }}>
            <div style={{ color: '#8b949e', fontSize: 11, marginBottom: 2 }}>{title}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>λ = {lam.toFixed(2)}</span>
                <span style={{ color: CLASS_COLOUR[cls], fontWeight: 700 }}>{cls}</span>
            </div>
            <div style={{ color: '#8b949e', fontSize: 11 }}>
                λ_p = {lp.toFixed(2)} | λ_r = {lr.toFixed(2)}
            </div>
        </div>
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
