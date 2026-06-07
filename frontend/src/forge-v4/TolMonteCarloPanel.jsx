// PUSH-175 (Slice-131) — Monte Carlo Tolerance Analysis panel.
//
// PUSH-47 / Forge-185 shipped the worst-case + RSS combo (kernel-bundled
// `forge.tolerance.compute`). This panel is the dedicated REAL Monte-Carlo
// statistical-assembly tool a manufacturing engineer reaches for to size a
// process capability study:
//
//   * Dim-chain table — name, nominal, +tol, −tol, distribution
//     ({normal | uniform}). Add / remove rows; defaults to the PUSH-175
//     brief's 3-link chain (30±0.1, 40±0.2, 50±0.15) so the e2e + first-
//     time user both land on numbers that match the spec.
//   * Trial count — radio chips: 1k / 10k / 100k. 10k is the default;
//     100k is the textbook "production capability" sample size.
//   * Run button — invokes the pure runMonteCarlo from monteCarloMath.js.
//   * Output block — assembly mean μ, σ, Cp, Cpk, yield %, and an inline
//     SVG histogram with USL / LSL red rule-lines.
//
// REAL Box-Muller draw per trial. No stubs, no rounding to nominal, no
// fake outputs. Seeded PRNG when a seed is supplied (e2e pins seed=42 so
// the spec can assert deterministic numbers); seedless Math.random when
// it's not.
//
// Reachable via:
//   * `tools.tolMonteCarlo` menu action,
//   * window.__forgeOpenTolMonteCarlo(true|false),
//   * window.__forgeTolMonteCarloHelper.* for headless / Archie callers.

import React, {
    useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
    runMonteCarlo,
    runTrials,
    computeStats,
    makeSeededRng,
    sampleNormal,
} from './monteCarloMath.js';

const PANEL_W = 620;

const DEFAULT_CHAIN = [
    { name: 'L1', nominal: 30, tolPlus: 0.10, tolMinus: 0.10, distribution: 'normal' },
    { name: 'L2', nominal: 40, tolPlus: 0.20, tolMinus: 0.20, distribution: 'normal' },
    { name: 'L3', nominal: 50, tolPlus: 0.15, tolMinus: 0.15, distribution: 'normal' },
];

const TRIAL_CHOICES = [
    { id: 1000,   label: '1k' },
    { id: 10000,  label: '10k' },
    { id: 100000, label: '100k' },
];

// ─────────────────────────────────────────────────────────────────────
// Styles.

function panelStyle() {
    return {
        position: 'fixed',
        top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
        right: 0,
        width: PANEL_W,
        maxWidth: '96vw',
        height: 'calc(100vh - var(--forge-topbar-h, 40px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 24px))',
        background: 'var(--forge-canvas-2, #161b22)',
        borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
        boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
        display: 'flex', flexDirection: 'column',
        fontSize: 12,
        color: 'var(--forge-ink, #dadde2)',
        zIndex: 1295,
        overflow: 'hidden',
    };
}

const HEADER_BAR = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px',
    background: 'var(--forge-canvas, #0e1117)',
    borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
    flexShrink: 0,
};

const BODY_SCROLL = {
    flex: 1, overflowY: 'auto', padding: '12px',
    display: 'flex', flexDirection: 'column', gap: 12,
};

const SECTION_LABEL = {
    fontSize: 10,
    color: 'var(--forge-ink-mute, #9aa1ab)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
};

const INPUT = {
    width: '100%',
    background: 'var(--forge-canvas, #0e1117)',
    color: 'var(--forge-ink, #dadde2)',
    border: '1px solid var(--forge-rail-edge, #2a2d34)',
    borderRadius: 3,
    padding: '3px 6px',
    fontFamily: 'var(--forge-mono, ui-monospace, SF Mono, Menlo, monospace)',
    fontSize: 11,
};

const TH = {
    padding: '4px 6px',
    textAlign: 'left',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--forge-ink-mute, #9aa1ab)',
    fontWeight: 600,
};

const TD = {
    padding: '3px 4px',
    verticalAlign: 'middle',
};

// ─────────────────────────────────────────────────────────────────────
// Histogram SVG.

function HistogramSvg({ result, width = 580, height = 160 }) {
    if (!result) return null;
    const { histogram, LSL, USL, mean, min, max } = result;
    const peak = histogram.reduce((m, b) => (b.count > m ? b.count : m), 0) || 1;
    const range = max - min || 1;
    const X = (v) => ((v - min) / range) * width;
    const padTop = 8;
    const usableH = height - padTop - 18;
    return (
        <svg width={width} height={height}
             data-testid="forge-tol-mc-histogram"
             data-bin-count={histogram.length}
             style={{
                 background: 'var(--forge-canvas, #0e1117)',
                 border: '1px solid var(--forge-rail-edge, #2a2d34)',
                 borderRadius: 3,
             }}>
            {/* Bars. */}
            {histogram.map((b, i) => {
                const h = (b.count / peak) * usableH;
                const w = width / histogram.length;
                return (
                    <rect key={i}
                          x={i * w} y={padTop + (usableH - h)}
                          width={Math.max(0.5, w - 0.5)} height={Math.max(0.5, h)}
                          fill="var(--forge-accent, #3a7afe)"
                          opacity={0.85} />
                );
            })}
            {/* LSL / USL guide rules. */}
            {LSL >= min && LSL <= max && (
                <line x1={X(LSL)} y1={padTop} x2={X(LSL)} y2={padTop + usableH}
                      stroke="#ff5a5a" strokeWidth={1.5} strokeDasharray="4 3"
                      data-testid="forge-tol-mc-lsl-rule" />
            )}
            {USL >= min && USL <= max && (
                <line x1={X(USL)} y1={padTop} x2={X(USL)} y2={padTop + usableH}
                      stroke="#ff5a5a" strokeWidth={1.5} strokeDasharray="4 3"
                      data-testid="forge-tol-mc-usl-rule" />
            )}
            {/* Mean line. */}
            <line x1={X(mean)} y1={padTop - 2} x2={X(mean)} y2={padTop + usableH + 2}
                  stroke="#ffffff" strokeWidth={1.25}
                  data-testid="forge-tol-mc-mean-rule" />
            {/* Axis ticks. */}
            <text x={0} y={height - 4}
                  fontSize={9} fill="var(--forge-ink-mute, #9aa1ab)"
                  fontFamily="var(--forge-mono, monospace)">
                {min.toFixed(3)}
            </text>
            <text x={width - 48} y={height - 4}
                  fontSize={9} fill="var(--forge-ink-mute, #9aa1ab)"
                  fontFamily="var(--forge-mono, monospace)">
                {max.toFixed(3)}
            </text>
            <text x={X(mean)} y={padTop - 1}
                  fontSize={9} fill="#ffffff"
                  textAnchor="middle"
                  fontFamily="var(--forge-mono, monospace)">
                μ {mean.toFixed(3)}
            </text>
        </svg>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function TolMonteCarloPanel({ open, onClose }) {
    const [chain, setChain] = useState(() =>
        DEFAULT_CHAIN.map((d) => ({ ...d })));
    const [N, setN]         = useState(10000);
    const [seed, setSeed]   = useState('');         // empty = non-deterministic
    const [LSL, setLSL]     = useState('');         // empty = auto worst-case
    const [USL, setUSL]     = useState('');
    const [status, setStatus] = useState({ kind: 'idle', text: 'idle — press Run' });
    const [result, setResult] = useState(null);
    const [runMs,  setRunMs]  = useState(null);

    const updateLink = useCallback((idx, patch) => {
        setChain((arr) => arr.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
    }, []);
    const addLink = useCallback(() => {
        setChain((arr) => [...arr,
            { name: `L${arr.length + 1}`, nominal: 10, tolPlus: 0.10,
              tolMinus: 0.10, distribution: 'normal' }]);
    }, []);
    const removeLink = useCallback((idx) => {
        setChain((arr) => (arr.length <= 1 ? arr : arr.filter((_, i) => i !== idx)));
    }, []);

    const onRun = useCallback(() => {
        try {
            const tStart = (typeof performance !== 'undefined')
                ? performance.now() : Date.now();
            const args = {
                chain: chain.map((d) => ({
                    name: d.name,
                    nominal: Number(d.nominal) || 0,
                    tolPlus: Number(d.tolPlus) || 0,
                    tolMinus: Number(d.tolMinus) || 0,
                    distribution: d.distribution === 'uniform' ? 'uniform' : 'normal',
                })),
                N: Number(N) | 0,
            };
            if (LSL !== '' && Number.isFinite(parseFloat(LSL))) args.LSL = parseFloat(LSL);
            if (USL !== '' && Number.isFinite(parseFloat(USL))) args.USL = parseFloat(USL);
            if (seed !== '' && Number.isFinite(parseInt(seed, 10))) args.seed = parseInt(seed, 10);

            const r = runMonteCarlo(args);
            const tEnd = (typeof performance !== 'undefined')
                ? performance.now() : Date.now();
            setResult(r);
            setRunMs(tEnd - tStart);
            setStatus({
                kind: 'ok',
                text: `✓ ${r.N.toLocaleString()} trials · μ ${r.mean.toFixed(4)} · σ ${r.sigma.toFixed(4)} · yield ${r.yieldPct.toFixed(2)}%`,
            });
            // Publish for e2e + Archie + plugins.
            if (typeof window !== 'undefined') {
                window.__forgeLastTolMonteCarloResult = r;
                window.dispatchEvent(new CustomEvent('forge:tol-mc-complete', {
                    detail: {
                        N: r.N, mean: r.mean, sigma: r.sigma,
                        cp: r.cp, cpk: r.cpk, yieldPct: r.yieldPct,
                        LSL: r.LSL, USL: r.USL,
                    },
                }));
            }
        } catch (err) {
            setStatus({ kind: 'err', text: `✗ ${err.message || String(err)}` });
            setResult(null);
        }
    }, [chain, N, LSL, USL, seed]);

    // Publish state for headless / Archie callers.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.__forgeTolMonteCarloState = {
            chain, N, LSL, USL, seed, result,
        };
    }, [chain, N, LSL, USL, seed, result]);

    if (!open) return null;

    const sumNominal = chain.reduce((s, d) => s + (Number(d.nominal) || 0), 0);
    const sumTol = chain.reduce((s, d) =>
        s + Math.max(Number(d.tolPlus) || 0, Number(d.tolMinus) || 0), 0);

    return (
        <aside
            role="region"
            aria-label="Monte Carlo Tolerance Analysis"
            data-testid="forge-tol-mc-panel"
            data-trial-count={N}
            data-link-count={chain.length}
            style={panelStyle()}>

            <header style={HEADER_BAR}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                    Monte-Carlo Tolerance Analysis
                </span>
                <span data-testid="forge-tol-mc-summary"
                      style={{
                          fontFamily: 'var(--forge-mono, monospace)',
                          fontSize: 10,
                          color: 'var(--forge-ink-mute, #9aa1ab)',
                          padding: '1px 6px',
                          borderRadius: 999,
                          border: '1px solid var(--forge-rail-edge, #2a2d34)',
                      }}>
                    Σnom {sumNominal.toFixed(3)} · ΣmaxTol {sumTol.toFixed(3)}
                </span>
                <span style={{ flex: 1 }} />
                <button type="button"
                        onClick={onClose}
                        aria-label="Close Monte Carlo Tolerance panel"
                        data-testid="forge-tol-mc-close"
                        style={{
                            background: 'transparent', border: 'none',
                            color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                            fontSize: 16, padding: 2,
                        }}>
                    ×
                </button>
            </header>

            <div style={BODY_SCROLL}>

                {/* CHAIN TABLE */}
                <section>
                    <div style={SECTION_LABEL}>Dim chain</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={TH}>Name</th>
                                <th style={{ ...TH, textAlign: 'right' }}>Nominal</th>
                                <th style={{ ...TH, textAlign: 'right' }}>+ Tol</th>
                                <th style={{ ...TH, textAlign: 'right' }}>− Tol</th>
                                <th style={TH}>Dist</th>
                                <th style={TH}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {chain.map((d, i) => (
                                <tr key={i}
                                    data-testid="forge-tol-mc-row"
                                    data-row-idx={i}
                                    style={{
                                        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
                                    }}>
                                    <td style={TD}>
                                        <input value={d.name}
                                               onChange={(e) => updateLink(i, { name: e.target.value })}
                                               style={INPUT}
                                               data-testid={`forge-tol-mc-name-${i}`} />
                                    </td>
                                    <td style={TD}>
                                        <input type="number" step="0.01" value={d.nominal}
                                               onChange={(e) => updateLink(i,
                                                   { nominal: parseFloat(e.target.value) || 0 })}
                                               style={{ ...INPUT, textAlign: 'right' }}
                                               data-testid={`forge-tol-mc-nom-${i}`} />
                                    </td>
                                    <td style={TD}>
                                        <input type="number" step="0.001" value={d.tolPlus}
                                               onChange={(e) => updateLink(i,
                                                   { tolPlus: parseFloat(e.target.value) || 0 })}
                                               style={{ ...INPUT, textAlign: 'right' }}
                                               data-testid={`forge-tol-mc-plus-${i}`} />
                                    </td>
                                    <td style={TD}>
                                        <input type="number" step="0.001" value={d.tolMinus}
                                               onChange={(e) => updateLink(i,
                                                   { tolMinus: parseFloat(e.target.value) || 0 })}
                                               style={{ ...INPUT, textAlign: 'right' }}
                                               data-testid={`forge-tol-mc-minus-${i}`} />
                                    </td>
                                    <td style={TD}>
                                        <select value={d.distribution}
                                                onChange={(e) => updateLink(i,
                                                    { distribution: e.target.value })}
                                                style={INPUT}
                                                data-testid={`forge-tol-mc-dist-${i}`}>
                                            <option value="normal">Normal</option>
                                            <option value="uniform">Uniform</option>
                                        </select>
                                    </td>
                                    <td style={TD}>
                                        <button type="button"
                                                onClick={() => removeLink(i)}
                                                disabled={chain.length <= 1}
                                                aria-label={`Remove link ${i + 1}`}
                                                data-testid={`forge-tol-mc-remove-${i}`}
                                                style={{
                                                    ...INPUT, width: 28, cursor: 'pointer',
                                                    textAlign: 'center',
                                                    opacity: chain.length <= 1 ? 0.4 : 1,
                                                }}>
                                            −
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <button type="button"
                            onClick={addLink}
                            data-testid="forge-tol-mc-add"
                            style={{
                                ...INPUT, cursor: 'pointer', marginTop: 6,
                                background: 'var(--forge-canvas-2, #161b22)',
                            }}>
                        + add link
                    </button>
                </section>

                {/* TRIALS + SEED + SPEC */}
                <section>
                    <div style={SECTION_LABEL}>Trials</div>
                    <div style={{
                        display: 'flex', gap: 6, alignItems: 'center',
                        marginBottom: 6,
                    }}>
                        {TRIAL_CHOICES.map((tc) => (
                            <button key={tc.id}
                                    type="button"
                                    onClick={() => setN(tc.id)}
                                    data-testid={`forge-tol-mc-trials-${tc.label}`}
                                    aria-pressed={N === tc.id}
                                    style={{
                                        ...INPUT, width: 60, cursor: 'pointer',
                                        background: N === tc.id
                                            ? 'var(--forge-accent-mute, #1f3a72)'
                                            : 'var(--forge-canvas, #0e1117)',
                                        border: N === tc.id
                                            ? '1px solid var(--forge-accent-rim, #3a7afe)'
                                            : '1px solid var(--forge-rail-edge, #2a2d34)',
                                        textAlign: 'center', fontWeight: 600,
                                    }}>
                                {tc.label}
                            </button>
                        ))}
                    </div>
                </section>

                <section style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 6,
                }}>
                    <label>
                        <div style={SECTION_LABEL}>LSL (auto)</div>
                        <input type="number" step="0.01" value={LSL}
                               onChange={(e) => setLSL(e.target.value)}
                               placeholder="auto Σnom − Σtol"
                               style={INPUT}
                               data-testid="forge-tol-mc-lsl" />
                    </label>
                    <label>
                        <div style={SECTION_LABEL}>USL (auto)</div>
                        <input type="number" step="0.01" value={USL}
                               onChange={(e) => setUSL(e.target.value)}
                               placeholder="auto Σnom + Σtol"
                               style={INPUT}
                               data-testid="forge-tol-mc-usl" />
                    </label>
                    <label>
                        <div style={SECTION_LABEL}>Seed (opt)</div>
                        <input type="number" step="1" value={seed}
                               onChange={(e) => setSeed(e.target.value)}
                               placeholder="non-deterministic"
                               style={INPUT}
                               data-testid="forge-tol-mc-seed" />
                    </label>
                </section>

                <section>
                    <button type="button"
                            onClick={onRun}
                            data-testid="forge-tol-mc-run"
                            style={{
                                width: '100%',
                                background: 'var(--forge-accent, #3a7afe)',
                                color: '#0a0e14',
                                border: 'none', borderRadius: 3,
                                padding: '10px 14px',
                                fontWeight: 700,
                                fontFamily: 'var(--forge-mono, monospace)',
                                fontSize: 12,
                                cursor: 'pointer',
                            }}>
                        Run Monte-Carlo
                    </button>
                </section>

                {/* STATUS */}
                <section data-testid="forge-tol-mc-status"
                         data-status-kind={status.kind}
                         style={{
                             fontFamily: 'var(--forge-mono, monospace)',
                             fontSize: 11,
                             color: status.kind === 'err' ? '#ff5a5a'
                                  : status.kind === 'ok'  ? '#4ec18b'
                                  : 'var(--forge-ink-mute, #9aa1ab)',
                         }}>
                    {status.text}
                    {runMs !== null && status.kind === 'ok' && (
                        <span style={{
                            marginLeft: 8,
                            color: 'var(--forge-ink-mute, #9aa1ab)',
                        }}>
                            ({runMs.toFixed(1)} ms)
                        </span>
                    )}
                </section>

                {/* OUTPUT */}
                {result && (
                    <>
                        <section>
                            <div style={SECTION_LABEL}>Distribution histogram</div>
                            <HistogramSvg result={result} />
                        </section>

                        <section data-testid="forge-tol-mc-result"
                                 data-mean={result.mean}
                                 data-sigma={result.sigma}
                                 data-cp={result.cp}
                                 data-cpk={result.cpk}
                                 data-yield-pct={result.yieldPct}
                                 data-lsl={result.LSL}
                                 data-usl={result.USL}
                                 data-n={result.N}
                                 style={{
                                     fontFamily: 'var(--forge-mono, monospace)',
                                     fontSize: 11,
                                     background: 'var(--forge-canvas, #0e1117)',
                                     padding: 10,
                                     borderRadius: 3,
                                     border: '1px solid var(--forge-rail-edge, #2a2d34)',
                                     lineHeight: 1.7,
                                 }}>
                            <Row k="Trials"      v={result.N.toLocaleString()} />
                            <Row k="Target Σnom" v={result.nominalSum.toFixed(4)} />
                            <Row k="μ assembly"  v={result.mean.toFixed(4)}
                                 testid="forge-tol-mc-mean" />
                            <Row k="σ assembly"  v={result.sigma.toFixed(4)}
                                 testid="forge-tol-mc-sigma" />
                            <Row k="min / max"
                                 v={`${result.min.toFixed(4)} / ${result.max.toFixed(4)}`} />
                            <Row k="LSL / USL"
                                 v={`${result.LSL.toFixed(4)} / ${result.USL.toFixed(4)}`} />
                            <Row k="Cp"
                                 v={isFinite(result.cp) ? result.cp.toFixed(3) : '∞'}
                                 testid="forge-tol-mc-cp" />
                            <Row k="Cpk"
                                 v={isFinite(result.cpk) ? result.cpk.toFixed(3) : '∞'}
                                 testid="forge-tol-mc-cpk" />
                            <Row k="Yield"
                                 v={`${result.yieldPct.toFixed(3)} %`}
                                 testid="forge-tol-mc-yield" />
                            <Row k="DPPM (defects/M)"
                                 v={((1 - result.yieldFraction) * 1e6).toFixed(1)} />
                        </section>
                    </>
                )}
            </div>
        </aside>
    );
}

function Row({ k, v, testid }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>{k}</span>
            <span style={{ fontWeight: 600 }} data-testid={testid}>{v}</span>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host — listens for the `tools.tolMonteCarlo` menu action +
// exposes window.__forgeOpenTolMonteCarlo + window.__forgeTolMonteCarloHelper
// (the pure math) so the e2e + Archie can drive it headlessly.

export function TolMonteCarloPanelHost() {
    const [open, setOpen] = useState(false);
    const mounted = useRef(false);

    useEffect(() => {
        if (mounted.current) return undefined;
        mounted.current = true;
        if (typeof window === 'undefined') return undefined;

        window.__forgeOpenTolMonteCarlo  = (b) => setOpen(b === undefined ? true : !!b);
        window.__forgeCloseTolMonteCarlo = () => setOpen(false);
        window.__forgeTolMonteCarloHelper = Object.freeze({
            runMonteCarlo, runTrials, computeStats,
            makeSeededRng, sampleNormal,
        });

        const onMenu = (e) => {
            if (e?.detail?.id === 'tools.tolMonteCarlo') setOpen(true);
        };
        window.addEventListener('forge:menu-action', onMenu);
        return () => {
            try { delete window.__forgeOpenTolMonteCarlo; } catch {}
            try { delete window.__forgeCloseTolMonteCarlo; } catch {}
            try { delete window.__forgeTolMonteCarloHelper; } catch {}
            window.removeEventListener('forge:menu-action', onMenu);
        };
    }, []);

    if (typeof document === 'undefined') return null;
    return createPortal(
        <TolMonteCarloPanel open={open} onClose={() => setOpen(false)} />,
        document.body,
    );
}

export default TolMonteCarloPanel;
