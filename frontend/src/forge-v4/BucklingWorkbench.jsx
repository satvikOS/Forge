// Forge-215 — column buckling workbench.
//
// Euler critical load with Johnson short-column transition. Section
// helpers for rectangle / solid circle / hollow circle.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 580, zIndex: 1310,
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
const fieldStyle = {
  width: 110, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.buckling)
      || (typeof window !== 'undefined' && window.electron && window.electron.buckling);
}

const SECTIONS = [
  { id: 'solidCircle', label: 'solid circle (d)' },
  { id: 'hollowCircle', label: 'hollow circle (d_o, d_i)' },
  { id: 'rectangle', label: 'rectangle (b × h)' },
];

const ENDS = ['pinned-pinned', 'fixed-fixed', 'fixed-free', 'fixed-pinned'];

function defaultInputs() {
  return {
    section: 'solidCircle', d: 0.020, dInner: 0.012, b: 0.020, h: 0.040,
    length: 2.0, E: 2e11, sigmaY: 250e6, ends: 'pinned-pinned',
    safetyFactor: 2.0,
  };
}

function BucklingPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaultInputs);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const update = (patch) => setInp({ ...inp, ...patch });

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const b = api();
      const sec = inp.section === 'solidCircle' ? b.sectionSolidCircle(inp.d)
                : inp.section === 'hollowCircle' ? b.sectionHollowCircle(inp.d, inp.dInner)
                                                  : b.sectionRectangle(inp.b, inp.h);
      const r = b.analyse({
        area: sec.area, secondMomentI: sec.secondMomentI,
        length: inp.length, youngsModulus: inp.E, yieldStrength: inp.sigmaY,
        ends: inp.ends,
      });
      const allowable = r.criticalLoad / inp.safetyFactor;
      setResult({ sec, r, allowable });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-buckling-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Column buckling (Euler + Johnson)</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Long column → P_cr = π²EI/(KL)². Short column → Johnson
        P_J = σ_y·A·(1 − σ_y·λ²/(4π²E)). λ_c is the transition
        slenderness.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="Section">
          <select value={inp.section} data-testid="forge-buckling-section"
                  onChange={(e) => update({ section: e.target.value })}
                  style={fieldStyle}>
            {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        {inp.section === 'solidCircle' && (
          <Field label="d (m)">
            <input type="number" step="0.001" value={inp.d}
                   data-testid="forge-buckling-d"
                   onChange={(e) => update({ d: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        )}
        {inp.section === 'hollowCircle' && (
          <>
            <Field label="d_o (m)">
              <input type="number" step="0.001" value={inp.d}
                     data-testid="forge-buckling-do"
                     onChange={(e) => update({ d: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
            <Field label="d_i (m)">
              <input type="number" step="0.001" value={inp.dInner}
                     data-testid="forge-buckling-di"
                     onChange={(e) => update({ dInner: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
          </>
        )}
        {inp.section === 'rectangle' && (
          <>
            <Field label="b (m)">
              <input type="number" step="0.001" value={inp.b}
                     data-testid="forge-buckling-b"
                     onChange={(e) => update({ b: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
            <Field label="h (m)">
              <input type="number" step="0.001" value={inp.h}
                     data-testid="forge-buckling-h"
                     onChange={(e) => update({ h: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </Field>
          </>
        )}
        <Field label="L (m)">
          <input type="number" step="0.1" value={inp.length}
                 data-testid="forge-buckling-L"
                 onChange={(e) => update({ length: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="E (Pa)">
          <input type="number" step="1e9" value={inp.E}
                 data-testid="forge-buckling-E"
                 onChange={(e) => update({ E: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="σy (Pa)">
          <input type="number" step="10e6" value={inp.sigmaY}
                 data-testid="forge-buckling-sigmaY"
                 onChange={(e) => update({ sigmaY: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Ends">
          <select value={inp.ends} data-testid="forge-buckling-ends"
                  onChange={(e) => update({ ends: e.target.value })}
                  style={fieldStyle}>
            {ENDS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Safety factor">
          <input type="number" step="0.5" value={inp.safetyFactor}
                 data-testid="forge-buckling-sf"
                 onChange={(e) => update({ safetyFactor: Number(e.target.value) || 1 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-buckling-run" style={buttonStyle} onClick={onCompute}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-buckling-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-buckling-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-buckling-mode"
               style={{ color: result.r.mode === 'euler' ? '#4ade80' : '#fbbf24',
                        fontWeight: 700, fontSize: 13 }}>
            {result.r.mode.toUpperCase()} regime
          </div>
          <div>A&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{(result.sec.area * 1e6).toFixed(1)} mm²</div>
          <div>I&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{(result.sec.secondMomentI * 1e12).toFixed(2)} mm⁴</div>
          <div>r (gyr.)&nbsp;&nbsp;&nbsp;{(result.r.radiusOfGyration * 1000).toFixed(2)} mm</div>
          <div>λ&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.r.slenderness.toFixed(1)}</div>
          <div>λ_c&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.r.slendernessTransition.toFixed(1)}</div>
          <div>P_cr&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{(result.r.criticalLoad / 1000).toFixed(2)} kN</div>
          <div>P_allow&nbsp;&nbsp;{(result.allowable / 1000).toFixed(2)} kN (SF = {inp.safetyFactor})</div>
        </section>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ color: 'var(--forge-ink-mute)' }}>{label}</span>
      {children}
    </label>
  );
}

export function BucklingWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBucklingWorkbench  = () => setOpen(true);
    window.__forgeCloseBucklingWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.buckling' || id === 'workbench.buckling') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'buckling') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <BucklingPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BucklingPanel;
