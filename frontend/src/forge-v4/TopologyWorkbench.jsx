// PUSH-15 — Topology optimisation workbench (SIMP method).
//
// Wraps frontend/src/foundation/TopoCantilever.runCantileverSIMP, which
// implements the canonical Bendsoe-Sigmund SIMP algorithm:
//   ρ_e ∈ [ρ_min, 1], penalty p=3, E_e = ρ_e^p E_0,
//   minimise compliance c = u^T K u  s.t.  Σ ρ_e v_e ≤ V_target,
//   OC update rule, optional density filter (mesh-independent).
//
// Manual UI only — does NOT post to Archie's thread; does NOT auto-open
// the Archie dock.

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { runCantileverSIMP, makeCubeDensitySDF } from '../foundation/TopoCantilever.js';

function bucket(counts, edges, val) {
    for (let i = edges.length - 1; i >= 0; i -= 1) {
        if (val >= edges[i]) { counts[i] += 1; return; }
    }
    counts[0] += 1;
}

export function TopologyWorkbench({ onClose }) {
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [params, setParams] = useState({
        W: 60, H: 40, T: 30, nx: 8, ny: 6, nz: 4,
        volumeFraction: 0.4, loadN: 1000, maxIter: 12,
    });

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const api = {
            runCantilever: (opts = {}) => runCantileverSIMP({ ...params, ...opts }),
            makeCubeDensitySDF,
            lastResult: () => result,
        };
        try { window.forge = window.forge || {}; window.forge.topology = api; } catch {}
        try { window.forgeUI = window.forgeUI || {}; window.forgeUI.topology = api; } catch {}
        return () => {
            try { if (window.forge && window.forge.topology) delete window.forge.topology; } catch {}
            try { if (window.forgeUI && window.forgeUI.topology) delete window.forgeUI.topology; } catch {}
        };
    }, [params, result]);

    const onRun = useCallback(() => {
        setRunning(true);
        setError(null);
        // Run in a microtask so the spinner can paint before SIMP blocks.
        setTimeout(() => {
            try {
                const r = runCantileverSIMP(params);
                setResult(r);
                setRunning(false);
            } catch (ex) {
                setError(String(ex && ex.message || ex));
                setRunning(false);
            }
        }, 30);
    }, [params]);

    let histogram = null;
    if (result) {
        const edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
        const counts = new Array(edges.length).fill(0);
        for (let i = 0; i < result.densitiesCube.length; i += 1) {
            bucket(counts, edges, result.densitiesCube[i]);
        }
        const max = Math.max(...counts);
        histogram = counts.map((c, i) => ({
            bin: `${edges[i].toFixed(1)}-${(edges[i] + 0.1).toFixed(1)}`,
            count: c,
            pct: max ? (c / max) * 100 : 0,
        }));
    }

    return createPortal(
        <div data-testid="forge-topology-panel" style={{
            position: 'fixed', right: 24, top: 96, width: 500, maxHeight: '82vh',
            background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
            borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 950,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>Topology optimisation <span style={{ opacity: 0.55 }}>· PUSH-15 · SIMP</span></div>
                <button onClick={onClose} aria-label="Close topology"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    Bendsoe-Sigmund SIMP, penalty p=3, OC update, density filter,
                    PCG linear solve. Steel 210 GPa, ν=0.3.
                </div>

                <details open>
                    <summary style={{ cursor: 'pointer' }}>Design box (W × H × T)</summary>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginTop: 4 }}>
                        {['W', 'H', 'T'].map((k) => (
                            <input key={k} data-testid={`forge-topo-${k}`}
                                type="number" value={params[k]}
                                onChange={(e) => setParams({ ...params, [k]: parseFloat(e.target.value) })}
                                style={{ background: '#0e1014', color: '#dadde2',
                                         border: '1px solid #2a2d34', borderRadius: 4, padding: 4 }}
                            />
                        ))}
                    </div>
                </details>

                <details open style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer' }}>Grid (nx × ny × nz)</summary>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginTop: 4 }}>
                        {['nx', 'ny', 'nz'].map((k) => (
                            <input key={k} data-testid={`forge-topo-${k}`}
                                type="number" value={params[k]}
                                onChange={(e) => setParams({ ...params, [k]: parseInt(e.target.value, 10) })}
                                style={{ background: '#0e1014', color: '#dadde2',
                                         border: '1px solid #2a2d34', borderRadius: 4, padding: 4 }}
                            />
                        ))}
                    </div>
                </details>

                <details open style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer' }}>SIMP knobs</summary>
                    <div style={{ marginTop: 4 }}>
                        <label>Volume fraction:&nbsp;</label>
                        <input data-testid="forge-topo-vf" type="number" step="0.05" min="0.1" max="0.9"
                            value={params.volumeFraction}
                            onChange={(e) => setParams({ ...params, volumeFraction: parseFloat(e.target.value) })}
                            style={{ width: 70, background: '#0e1014', color: '#dadde2',
                                     border: '1px solid #2a2d34', borderRadius: 4, padding: 4 }}
                        />
                    </div>
                    <div style={{ marginTop: 4 }}>
                        <label>Load (N):&nbsp;</label>
                        <input data-testid="forge-topo-load" type="number" min="0"
                            value={params.loadN}
                            onChange={(e) => setParams({ ...params, loadN: parseFloat(e.target.value) })}
                            style={{ width: 80, background: '#0e1014', color: '#dadde2',
                                     border: '1px solid #2a2d34', borderRadius: 4, padding: 4 }}
                        />
                    </div>
                    <div style={{ marginTop: 4 }}>
                        <label>Max iter:&nbsp;</label>
                        <input data-testid="forge-topo-maxiter" type="number" min="1" max="200"
                            value={params.maxIter}
                            onChange={(e) => setParams({ ...params, maxIter: parseInt(e.target.value, 10) })}
                            style={{ width: 60, background: '#0e1014', color: '#dadde2',
                                     border: '1px solid #2a2d34', borderRadius: 4, padding: 4 }}
                        />
                    </div>
                </details>

                <button data-testid="forge-topo-run" onClick={onRun} disabled={running}
                    style={{ marginTop: 8, padding: '6px 10px', background: running ? '#1a1c20' : '#2c4d2a',
                             color: '#dfeedd', border: '1px solid #3a6738',
                             borderRadius: 4, cursor: running ? 'wait' : 'pointer' }}>
                    {running ? 'Running SIMP…' : 'Run SIMP'}
                </button>

                {error && (
                    <div data-testid="forge-topo-error" style={{
                        marginTop: 8, padding: 8, background: '#3a1f1f', color: '#f1c4c4',
                        border: '1px solid #6d3434', borderRadius: 4,
                    }}>{error}</div>
                )}

                {result && (
                    <div data-testid="forge-topo-report" style={{
                        marginTop: 10, padding: 8, background: '#0e1014',
                        border: '1px solid #2a2d34', borderRadius: 4,
                    }}>
                        <div>Iterations: <span data-testid="forge-topo-iter">{result.iterations}</span></div>
                        <div>Compliance: <span data-testid="forge-topo-compliance">{result.compliance.toExponential(3)}</span></div>
                        <div>Cells: <span data-testid="forge-topo-cells">{result.densitiesCube.length}</span></div>
                        <div>Elapsed: <span data-testid="forge-topo-elapsed">{result.elapsedMs}</span> ms</div>
                        <div>Fixed nodes: {result.fixedNodes.length} · Load nodes: {result.loadNodes.length}</div>

                        <div style={{ marginTop: 8, opacity: 0.85 }}>Density histogram (cube):</div>
                        <table data-testid="forge-topo-histogram"
                            style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 4 }}>
                            <tbody>
                                {histogram.map((row) => (
                                    <tr key={row.bin}>
                                        <td style={{ padding: 2, width: 60 }}>{row.bin}</td>
                                        <td style={{ padding: 2, width: 40, textAlign: 'right' }}>{row.count}</td>
                                        <td>
                                            <div style={{
                                                background: '#3a6738', height: 10, width: `${row.pct}%`,
                                            }} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

export function TopologyWorkbenchHost() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenTopologyWorkbench = () => setOpen(true);
        window.__forgeCloseTopologyWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenTopologyWorkbench;
            delete window.__forgeCloseTopologyWorkbench;
        };
    }, []);

    if (!open) return null;
    return <TopologyWorkbench onClose={() => setOpen(false)} />;
}

export default TopologyWorkbenchHost;
