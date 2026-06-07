// PUSH-179 (Slice-135 / Bend Deduction Calculator panel).
//
// Sheet-metal flat-pattern offset calculator. Inputs: material, sheet
// thickness, inner bend radius, bend angle. Outputs: bend allowance
// (BA), bend deduction (BD), outside set-back (OSSB), neutral-axis
// offset (K·t), and the K-factor in use. A common-defaults table at
// the bottom lets the press-brake operator load any of eight memorised
// recipes with one click — the first row is the canonical Steel 2 mm
// × R 2 mm × 90° case that ships with every CAD bend-calculator preset.
//
// Reachable via:
//   * `tools.bendDeduction` menu action (forge:menu-action),
//   * `window.__forgeOpenBendDeduction(true|false)`,
//   * `window.__forgeBendDeductionHelper.solveBend(args)` for headless
//     callers (Archie / plugin API / e2e smoke).
//
// Hard constraints (PUSH-179 brief): no new npm / C++ / external deps,
// real formulas, no MVP / stub / placeholder. The math lives in
// `bendDeductionMath.js` as a pure module so the e2e + plugins can
// drive the formulas without mounting React.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD — this is a calculator, not
// a kernel op; the user can copy the BD into the unfold workbench
// (PUSH-43) or sheet catalogue panel (PUSH-95) by hand.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  K_FACTORS, MATERIAL_LIBRARY, COMMON_DEFAULTS,
  kFactor, bendAllowance, bendDeduction, outsideSetBack,
  neutralAxisOffset, solveBend, flatLengthTwoLeg,
} from './bendDeductionMath.js';

const PANEL_W = 560;

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: PANEL_W, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};
const buttonStyle = {
  background: 'var(--forge-accent)', border: 'none',
  color: '#0a0e14', padding: '6px 10px', cursor: 'pointer',
  fontWeight: 600, fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const ghostBtn = {
  background: 'transparent', border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', padding: '4px 8px', cursor: 'pointer',
  fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const fieldStyle = {
  width: 110, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const selectStyle = {
  width: 200, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const sectionStyle = {
  background: 'var(--forge-canvas)', padding: 8, borderRadius: 4,
  display: 'flex', flexDirection: 'column', gap: 6,
};

function defaults() {
  return {
    material: 'steel',
    thicknessMm: 2,
    bendRadiusMm: 2,
    angleDeg: 90,
    leg1Mm: 50,
    leg2Mm: 50,
  };
}

function BendDeductionPanelImpl({ open, onClose }) {
  const [inp, setInp] = useState(defaults);
  if (!open) return null;

  const result = useMemo(() => solveBend(inp), [inp]);
  const flatLen = useMemo(
    () => flatLengthTwoLeg({ ...inp }),
    [inp],
  );

  const update = (patch) => setInp((prev) => ({ ...prev, ...patch }));

  const loadPreset = useCallback((preset) => {
    setInp((prev) => ({ ...prev, ...preset }));
  }, []);

  // Publish the latest computed result so the e2e + plugins can read
  // without scraping the DOM. Fires every solve.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeLastBendDeduction = Object.freeze({
      input: { ...inp },
      result: { ...result },
      flatLengthMm: Number(flatLen.toFixed(4)),
      ts: Date.now(),
    });
    try {
      window.dispatchEvent(new CustomEvent('forge:bend-deduction-solved',
        { detail: window.__forgeLastBendDeduction }));
    } catch { /* JSDOM / SSR */ }
  }, [inp, result, flatLen]);

  return (
    <div
      style={panelStyle}
      data-testid="forge-bend-deduction-panel"
      data-material={result.material}
      data-k={String(result.k)}
      data-ba={String(result.bendAllowanceMm)}
      data-bd={String(result.bendDeductionMm)}
      data-ossb={String(result.outsideSetBackMm)}
      data-neutral={String(result.neutralAxisOffsetMm)}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Bend deduction · sheet-metal flat pattern</strong>
        <button
          data-testid="forge-bend-deduction-close"
          onClick={onClose}
          style={{ ...ghostBtn, padding: '2px 6px' }}
        >×</button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        BA = (π/180)·θ·(R + K·t) — arc at neutral fibre. <br />
        BD = 2·(R+t)·tan(θ/2) − BA — subtract from leg sum for flat. <br />
        Neutral offset = K·t (distance from inner fibre).
      </div>

      {/* ─── inputs ─────────────────────────────────────────────── */}
      <section style={sectionStyle}>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Inputs</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 110, color: 'var(--forge-ink-mute)' }}>Material</span>
          <select
            data-testid="forge-bend-deduction-material"
            value={inp.material}
            onChange={(e) => update({ material: e.target.value })}
            style={selectStyle}
          >
            {MATERIAL_LIBRARY.map((m) => (
              <option key={m.id} value={m.id}>{m.label} — K = {m.k.toFixed(2)}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 110, color: 'var(--forge-ink-mute)' }}>Thickness t (mm)</span>
          <input
            data-testid="forge-bend-deduction-thickness"
            type="number" step="0.1" min="0.05"
            value={inp.thicknessMm}
            onChange={(e) => update({ thicknessMm: Number(e.target.value) })}
            style={fieldStyle}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 110, color: 'var(--forge-ink-mute)' }}>Inner radius R (mm)</span>
          <input
            data-testid="forge-bend-deduction-radius"
            type="number" step="0.1" min="0.01"
            value={inp.bendRadiusMm}
            onChange={(e) => update({ bendRadiusMm: Number(e.target.value) })}
            style={fieldStyle}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 110, color: 'var(--forge-ink-mute)' }}>Bend angle θ (°)</span>
          <input
            data-testid="forge-bend-deduction-angle"
            type="number" step="1" min="0" max="180"
            value={inp.angleDeg}
            onChange={(e) => update({ angleDeg: Number(e.target.value) })}
            style={fieldStyle}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 110, color: 'var(--forge-ink-mute)' }}>Leg 1 (mm)</span>
          <input
            data-testid="forge-bend-deduction-leg1"
            type="number" step="1" min="0"
            value={inp.leg1Mm}
            onChange={(e) => update({ leg1Mm: Number(e.target.value) })}
            style={fieldStyle}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 110, color: 'var(--forge-ink-mute)' }}>Leg 2 (mm)</span>
          <input
            data-testid="forge-bend-deduction-leg2"
            type="number" step="1" min="0"
            value={inp.leg2Mm}
            onChange={(e) => update({ leg2Mm: Number(e.target.value) })}
            style={fieldStyle}
          />
        </label>
      </section>

      {/* ─── results ────────────────────────────────────────────── */}
      <section style={{ ...sectionStyle, fontFamily: 'var(--forge-mono)' }}>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Results</div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>K-factor</span>
          <span data-testid="forge-bend-deduction-result-k">{result.k.toFixed(3)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Bend Allowance (BA)</span>
          <span data-testid="forge-bend-deduction-result-ba">{result.bendAllowanceMm.toFixed(4)} mm</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Bend Deduction (BD)</span>
          <span data-testid="forge-bend-deduction-result-bd">{result.bendDeductionMm.toFixed(4)} mm</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Outside Set-Back (OSSB)</span>
          <span data-testid="forge-bend-deduction-result-ossb">{result.outsideSetBackMm.toFixed(4)} mm</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Neutral-axis offset (K·t)</span>
          <span data-testid="forge-bend-deduction-result-neutral">{result.neutralAxisOffsetMm.toFixed(4)} mm</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between',
                      borderTop: '1px dashed var(--forge-rail-edge)', paddingTop: 6, marginTop: 4 }}>
          <span>Developed flat length (L1 + L2 − BD)</span>
          <span data-testid="forge-bend-deduction-result-flat">{flatLen.toFixed(4)} mm</span>
        </div>
      </section>

      {/* ─── common defaults table ──────────────────────────────── */}
      <section style={sectionStyle}>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Common defaults — click to load</div>
        <table
          data-testid="forge-bend-deduction-defaults-table"
          style={{ borderCollapse: 'collapse', width: '100%',
                   fontFamily: 'var(--forge-mono)', fontSize: 11 }}
        >
          <thead>
            <tr style={{ color: 'var(--forge-ink-mute)' }}>
              <th style={{ textAlign: 'left',  padding: '2px 4px' }}>Material</th>
              <th style={{ textAlign: 'right', padding: '2px 4px' }}>t</th>
              <th style={{ textAlign: 'right', padding: '2px 4px' }}>R</th>
              <th style={{ textAlign: 'right', padding: '2px 4px' }}>θ</th>
              <th style={{ textAlign: 'right', padding: '2px 4px' }}>BA</th>
              <th style={{ textAlign: 'right', padding: '2px 4px' }}>BD</th>
              <th style={{ padding: '2px 4px' }} />
            </tr>
          </thead>
          <tbody>
            {COMMON_DEFAULTS.map((p, idx) => {
              const r = solveBend(p);
              return (
                <tr
                  key={idx}
                  data-testid="forge-bend-deduction-default-row"
                  data-material={p.material}
                  data-thickness={String(p.thicknessMm)}
                  data-radius={String(p.bendRadiusMm)}
                  data-angle={String(p.angleDeg)}
                  data-ba={String(r.bendAllowanceMm)}
                  data-bd={String(r.bendDeductionMm)}
                  style={{ borderTop: '1px solid var(--forge-rail-edge)' }}
                >
                  <td style={{ padding: '2px 4px' }}>{p.material}</td>
                  <td style={{ textAlign: 'right', padding: '2px 4px' }}>{p.thicknessMm}</td>
                  <td style={{ textAlign: 'right', padding: '2px 4px' }}>{p.bendRadiusMm}</td>
                  <td style={{ textAlign: 'right', padding: '2px 4px' }}>{p.angleDeg}°</td>
                  <td style={{ textAlign: 'right', padding: '2px 4px' }}>{r.bendAllowanceMm.toFixed(3)}</td>
                  <td style={{ textAlign: 'right', padding: '2px 4px' }}>{r.bendDeductionMm.toFixed(3)}</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right' }}>
                    <button
                      data-testid="forge-bend-deduction-load-preset"
                      onClick={() => loadPreset(p)}
                      style={{ ...ghostBtn, padding: '1px 6px' }}
                    >Load</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ─── K-factor reference ─────────────────────────────────── */}
      <section style={sectionStyle}>
        <div style={{ color: 'var(--forge-ink-mute)' }}>K-factor library (air bend, R/t ≈ 1)</div>
        <table
          data-testid="forge-bend-deduction-k-table"
          style={{ borderCollapse: 'collapse', width: '100%',
                   fontFamily: 'var(--forge-mono)', fontSize: 11 }}
        >
          <tbody>
            {MATERIAL_LIBRARY.map((m) => (
              <tr
                key={m.id}
                data-testid="forge-bend-deduction-k-row"
                data-material={m.id}
                data-k={String(m.k)}
                style={{ borderTop: '1px solid var(--forge-rail-edge)' }}
              >
                <td style={{ padding: '2px 4px' }}>{m.label}</td>
                <td style={{ textAlign: 'right', padding: '2px 4px' }}>K = {m.k.toFixed(2)}</td>
                <td style={{ padding: '2px 4px', color: 'var(--forge-ink-mute)' }}>{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Subscribes to the `tools.bendDeduction` menu
// action + installs the imperative open/close + helper hooks on
// window. Idempotent on remount.

export function BendDeductionPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenBendDeduction  = (v) =>
      setOpen(v === undefined ? true : !!v);
    window.__forgeCloseBendDeduction = () => setOpen(false);

    // Default the last-solve slot so an early probe sees the surface
    // even before the panel mounts open.
    if (!window.__forgeLastBendDeduction) {
      window.__forgeLastBendDeduction = Object.freeze({
        input: null, result: null, flatLengthMm: null, ts: 0,
      });
    }

    // Headless helper surface — pure math + the canonical tables. The
    // e2e + plugin authors can solve a bend without mounting React.
    window.__forgeBendDeductionHelper = Object.freeze({
      K_FACTORS, MATERIAL_LIBRARY, COMMON_DEFAULTS,
      kFactor, bendAllowance, bendDeduction, outsideSetBack,
      neutralAxisOffset, solveBend, flatLengthTwoLeg,
    });

    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.bendDeduction') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenBendDeduction;  } catch { /* noop */ }
      try { delete window.__forgeCloseBendDeduction; } catch { /* noop */ }
      try { delete window.__forgeBendDeductionHelper; } catch { /* noop */ }
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <BendDeductionPanelImpl open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BendDeductionPanelImpl;
