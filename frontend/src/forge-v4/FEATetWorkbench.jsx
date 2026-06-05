// PUSH-11 — Tet4 FEA workbench (forge::fea::tet).
//
// Wraps the new Tet4 native solver behind window.forge.fea.tet:
// meshShape, solveLinearStatic, solveModal.
//
// Manual UI only — never posts to Archie, never opens dock.

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

const STEEL = { E: 200e9, nu: 0.3, rho: 7850 };

export function FEATetWorkbench({ onClose }) {
    const surface = typeof window !== 'undefined' &&
        window.forge && window.forge.fea && window.forge.fea.tet;

    const [mesh, setMesh]       = useState(null);
    const [running, setRunning] = useState(false);
    const [staticR, setStatic]  = useState(null);
    const [modal, setModal]     = useState(null);
    const [error, setError]     = useState(null);

    const onMesh = useCallback(() => {
        if (!surface) { setError('forge.fea.tet unavailable'); return; }
        try {
            // 100 × 10 × 10 mm beam in metres → 0.1 × 0.01 × 0.01.
            const handle = window.forge.box(0.1, 0.01, 0.01);
            const m = surface.meshShape(handle, 0.0025);
            setMesh({ handle, nodes: m.nodes ? m.nodes.length : 0,
                      tets: m.tets ? m.tets.length : 0, raw: m });
            setError(null);
        } catch (ex) { setError(String(ex.message || ex)); }
    }, [surface]);

    const onSolveStatic = useCallback(() => {
        if (!surface || !mesh) return;
        setRunning(true);
        setError(null);
        setTimeout(() => {
            try {
                const fixedNodes = [];
                const loadNodes  = [];
                for (let i = 0; i < mesh.raw.nodes.length; i += 1) {
                    const n = mesh.raw.nodes[i];
                    if (n.x <= 1e-5) fixedNodes.push(n.id);
                    else if (n.x >= 0.1 - 1e-5) loadNodes.push(n.id);
                }
                const perNode = loadNodes.length ? -100 / loadNodes.length : 0;
                const bc = {
                    fixedNodes,
                    nodalForces: loadNodes.map((id) => [id, [0, 0, perNode]]),
                };
                const r = surface.solveLinearStatic(mesh.raw, STEEL, bc);
                setStatic(r);
            } catch (ex) { setError(String(ex.message || ex)); }
            setRunning(false);
        }, 30);
    }, [surface, mesh]);

    const onSolveModal = useCallback(() => {
        if (!surface || !mesh) return;
        setRunning(true);
        setError(null);
        setTimeout(() => {
            try {
                const fixedNodes = [];
                for (let i = 0; i < mesh.raw.nodes.length; i += 1) {
                    const n = mesh.raw.nodes[i];
                    if (n.x <= 1e-5) fixedNodes.push(n.id);
                }
                const r = surface.solveModal(mesh.raw, STEEL, fixedNodes, 3);
                setModal(r);
            } catch (ex) { setError(String(ex.message || ex)); }
            setRunning(false);
        }, 30);
    }, [surface, mesh]);

    return createPortal(
        <div data-testid="forge-feat-panel" style={{
            position: 'fixed', right: 24, top: 96, width: 500, maxHeight: '80vh',
            background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
            borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 950,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>FEA Tet4 <span style={{ opacity: 0.55 }}>· PUSH-11 · forge::fea::tet</span></div>
                <button onClick={onClose} aria-label="Close FEA Tet4"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    Canonical cantilever beam (100×10×10 mm), steel E=200 GPa,
                    ν=0.3, ρ=7850. Bowyer-Watson Delaunay tet mesh; Jacobi-CG.
                </div>

                <button data-testid="forge-feat-mesh" onClick={onMesh}
                    style={{ marginTop: 6, padding: '6px 10px', background: '#2c4d2a',
                             color: '#dfeedd', border: '1px solid #3a6738',
                             borderRadius: 4, cursor: 'pointer' }}>
                    1. Mesh shape
                </button>

                {mesh && (
                    <div data-testid="forge-feat-mesh-report" style={{
                        marginTop: 6, padding: 6, background: '#0e1014',
                        border: '1px solid #2a2d34', borderRadius: 4,
                    }}>
                        <div>Nodes: <span data-testid="forge-feat-node-count">{mesh.nodes}</span></div>
                        <div>Tets: <span data-testid="forge-feat-tet-count">{mesh.tets}</span></div>
                    </div>
                )}

                <button data-testid="forge-feat-solve-static" onClick={onSolveStatic}
                    disabled={!mesh || running}
                    style={{ marginTop: 8, padding: '6px 10px',
                             background: mesh ? '#2c3a4d' : '#1a1c20',
                             color: '#dadde2', border: '1px solid #3a3d44',
                             borderRadius: 4,
                             cursor: mesh && !running ? 'pointer' : 'not-allowed' }}>
                    2. Solve linear-static (100 N tip)
                </button>

                {staticR && (
                    <div data-testid="forge-feat-static-report" style={{
                        marginTop: 6, padding: 6, background: '#0e1014',
                        border: '1px solid #2a2d34', borderRadius: 4,
                    }}>
                        <div>Converged: <span data-testid="forge-feat-converged">{String(staticR.converged)}</span></div>
                        <div>CG iter: <span data-testid="forge-feat-cgiter">{staticR.cgIters}</span></div>
                        <div>Max disp: <span data-testid="forge-feat-maxdisp">{(staticR.maxDisp * 1e6).toFixed(2)}</span> µm</div>
                        <div>Max vonMises: <span data-testid="forge-feat-maxvm">{(staticR.maxVonMises / 1e6).toFixed(2)}</span> MPa</div>
                    </div>
                )}

                <button data-testid="forge-feat-solve-modal" onClick={onSolveModal}
                    disabled={!mesh || running}
                    style={{ marginTop: 8, padding: '6px 10px',
                             background: mesh ? '#2c3a4d' : '#1a1c20',
                             color: '#dadde2', border: '1px solid #3a3d44',
                             borderRadius: 4,
                             cursor: mesh && !running ? 'pointer' : 'not-allowed' }}>
                    3. Solve modal (3 lowest)
                </button>

                {modal && modal.eigenfrequencies && (
                    <div data-testid="forge-feat-modal-report" style={{
                        marginTop: 6, padding: 6, background: '#0e1014',
                        border: '1px solid #2a2d34', borderRadius: 4,
                    }}>
                        <div>Mode freqs (Hz):</div>
                        <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                            {modal.eigenfrequencies.map((f, i) => (
                                <li key={i} data-testid={`forge-feat-freq-${i}`}>{f.toFixed(1)}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {running && <div style={{ marginTop: 8, opacity: 0.7 }}>Running…</div>}

                {error && (
                    <div data-testid="forge-feat-error" style={{
                        marginTop: 8, padding: 8, background: '#3a1f1f', color: '#f1c4c4',
                        border: '1px solid #6d3434', borderRadius: 4,
                    }}>{error}</div>
                )}
            </div>
        </div>,
        document.body,
    );
}

export function FEATetWorkbenchHost() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenFEATetWorkbench = () => setOpen(true);
        window.__forgeCloseFEATetWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenFEATetWorkbench;
            delete window.__forgeCloseFEATetWorkbench;
        };
    }, []);

    if (!open) return null;
    return <FEATetWorkbench onClose={() => setOpen(false)} />;
}

export default FEATetWorkbenchHost;
