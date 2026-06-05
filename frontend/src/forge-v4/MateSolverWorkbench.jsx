// PUSH-04 — Mate Solver workbench (kernel forge::matelib).
//
// Exposes the 12-kind assembly constraint solver behind window.forge.matelib
// as a Blender-style dock panel. Manual UI only — never posts to Archie's
// thread, never opens the Archie dock.

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

const MATE_KINDS = [
    { id: 0, label: 'Coincident',      hint: 'Two points lock to identical XYZ' },
    { id: 1, label: 'Concentric',      hint: 'Two axes share origin + direction' },
    { id: 2, label: 'Distance',        hint: 'Hold |AB| = value (m)' },
    { id: 3, label: 'Angle',           hint: 'Hold ∠(uA, uB) = value (rad)' },
    { id: 4, label: 'Parallel',        hint: 'Axes share direction' },
    { id: 5, label: 'Perpendicular',   hint: 'Axes orthogonal' },
    { id: 6, label: 'Tangent',         hint: 'Surface-normal contact' },
    { id: 7, label: 'Gear',            hint: 'ωA / ωB = ratio' },
    { id: 8, label: 'Rack-pinion',     hint: 'Linear / angular coupling' },
    { id: 9, label: 'Cam',             hint: 'tB = value + r·sin(angle_A)' },
    { id: 10, label: 'Slot',           hint: 'Point slides along slot axis' },
    { id: 11, label: 'Width',          hint: 'Symmetric pocket centering' },
];

function emptyPose() { return { id: 0, fixed: false, t: [0, 0, 0], q: [0, 0, 0, 1] }; }

function defaultDemo() {
    // Two parts: A fixed at origin, B free at +X. Concentric mate aligns B
    // back onto A's axis from a small offset.
    return {
        poses: [
            { ...emptyPose(), id: 1, fixed: true,  t: [0, 0, 0] },
            { ...emptyPose(), id: 2, fixed: false, t: [0.05, 0.03, 0.01] },
        ],
        mates: [
            {
                kind: 1,                     // concentric
                a: { inst: 1, origin: [0, 0, 0],   axis: [0, 0, 1] },
                b: { inst: 2, origin: [0, 0, 0],   axis: [0, 0, 1] },
                value: 0,
            },
        ],
    };
}

export function MateSolverWorkbench({ onClose }) {
    const [demo, setDemo] = useState(defaultDemo);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const surface = typeof window !== 'undefined' && window.forge && window.forge.matelib;

    const onSolve = useCallback(() => {
        if (!surface) { setError('window.forge.matelib unavailable (rebuild kernel)'); return; }
        try {
            const r = surface.solve(demo.poses, demo.mates);
            setResult(r);
            setError(null);
        } catch (ex) { setError(String(ex && ex.message || ex)); }
    }, [demo, surface]);

    return createPortal(
        <div data-testid="forge-mate-solver-panel" style={{
            position: 'fixed', right: 24, top: 96, width: 460, maxHeight: '78vh',
            background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
            borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 950,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>Assembly mate solver <span style={{ opacity: 0.55 }}>· PUSH-04 · forge::matelib</span></div>
                <button onClick={onClose} aria-label="Close mate solver"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    Damped Gauss-Seidel solver, max 256 iter, tol 1e-6. Native module:
                    {surface ? ' ready' : ' unavailable'}.
                </div>

                <details open>
                    <summary style={{ cursor: 'pointer' }}>Mate kinds ({MATE_KINDS.length})</summary>
                    <ul style={{ margin: '4px 0 8px 16px', padding: 0 }}>
                        {MATE_KINDS.map((m) => (
                            <li key={m.id} data-testid={`forge-mate-kind-${m.id}`}>
                                <strong>{m.label}</strong> <span style={{ opacity: 0.65 }}>— {m.hint}</span>
                            </li>
                        ))}
                    </ul>
                </details>

                <details open style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer' }}>Poses (n={demo.poses.length})</summary>
                    <textarea
                        data-testid="forge-mate-poses"
                        value={JSON.stringify(demo.poses, null, 2)}
                        onChange={(e) => {
                            try { setDemo({ ...demo, poses: JSON.parse(e.target.value) }); }
                            catch { /* keep partial input */ }
                        }}
                        style={{ width: '100%', height: 140, fontFamily: 'monospace', fontSize: 11,
                                 background: '#0e1014', color: '#dadde2',
                                 border: '1px solid #2a2d34', borderRadius: 4, padding: 6 }}
                    />
                </details>

                <details open style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer' }}>Mates (n={demo.mates.length})</summary>
                    <textarea
                        data-testid="forge-mate-mates"
                        value={JSON.stringify(demo.mates, null, 2)}
                        onChange={(e) => {
                            try { setDemo({ ...demo, mates: JSON.parse(e.target.value) }); }
                            catch { /* keep partial input */ }
                        }}
                        style={{ width: '100%', height: 140, fontFamily: 'monospace', fontSize: 11,
                                 background: '#0e1014', color: '#dadde2',
                                 border: '1px solid #2a2d34', borderRadius: 4, padding: 6 }}
                    />
                </details>

                <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                    <button data-testid="forge-mate-solve" onClick={onSolve}
                        style={{ flex: 1, padding: '6px 10px', background: '#2c4d2a',
                                 color: '#dfeedd', border: '1px solid #3a6738',
                                 borderRadius: 4, cursor: 'pointer' }}>
                        Solve
                    </button>
                    <button data-testid="forge-mate-reset" onClick={() => { setDemo(defaultDemo()); setResult(null); }}
                        style={{ flex: 1, padding: '6px 10px', background: '#2a2d34',
                                 color: '#dadde2', border: '1px solid #3a3d44',
                                 borderRadius: 4, cursor: 'pointer' }}>
                        Reset demo
                    </button>
                </div>

                {error && (
                    <div data-testid="forge-mate-error" style={{
                        marginTop: 8, padding: 8, background: '#3a1f1f', color: '#f1c4c4',
                        border: '1px solid #6d3434', borderRadius: 4,
                    }}>{error}</div>
                )}

                {result && (
                    <div data-testid="forge-mate-report" style={{
                        marginTop: 10, padding: 8, background: '#0e1014',
                        border: '1px solid #2a2d34', borderRadius: 4,
                    }}>
                        <div>Converged: <span data-testid="forge-mate-converged">{String(result.converged)}</span></div>
                        <div>Iterations: <span data-testid="forge-mate-iterations">{result.iterations}</span></div>
                        <div>Residual: <span data-testid="forge-mate-residual">{result.residual.toExponential(2)}</span></div>
                        <div style={{ marginTop: 6, opacity: 0.85 }}>Solved poses:</div>
                        <pre data-testid="forge-mate-poses-out" style={{ fontSize: 11, margin: '4px 0 0' }}>
                            {JSON.stringify(result.poses, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

export function MateSolverWorkbenchHost() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenMateSolverWorkbench = () => setOpen(true);
        window.__forgeCloseMateSolverWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenMateSolverWorkbench;
            delete window.__forgeCloseMateSolverWorkbench;
        };
    }, []);

    if (!open) return null;
    return <MateSolverWorkbench onClose={() => setOpen(false)} />;
}

export default MateSolverWorkbenchHost;
