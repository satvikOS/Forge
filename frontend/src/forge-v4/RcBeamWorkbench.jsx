// Forge-238 — RC beam flexure (ACI 318-19 §22.2).
//
// Singly reinforced rectangular section, Whitney stress block.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Structural → Concrete → RC beam.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 660, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.rcbeam)
      || (typeof window !== 'undefined' && window.electron && window.electron.rcbeam);
}

function defaults() {
  return {
    widthM: 0.300, effectiveDepthM: 0.500, steelAreaM2: 1.161e-3,
    concreteFcPa: 28e6, steelFyPa: 414e6, steelEPa: 200e9,
  };
}

function RcBeamPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try { setResult(api().analyse(inp)); }
    catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-rcbeam-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>RC beam · ACI 318-19 §22.2 flexure</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Whitney block: a = A_s·f_y / (0.85·f'_c·b); c = a/β_1;
        ε_t = 0.003·(d−c)/c → φ (0.65→0.90); M_n = A_s·f_y·(d−a/2);
        φM_n = φ·M_n.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="b (m)">
          <input type="number" step="0.025" value={inp.widthM}
                 data-testid="forge-rcbeam-b"
                 onChange={(e) => update({ widthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="d (m)">
          <input type="number" step="0.025" value={inp.effectiveDepthM}
                 data-testid="forge-rcbeam-d"
                 onChange={(e) => update({ effectiveDepthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="A_s (m²)">
          <input type="number" step="1e-4" value={inp.steelAreaM2}
                 data-testid="forge-rcbeam-As"
                 onChange={(e) => update({ steelAreaM2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="f'_c (Pa)">
          <input type="number" step="5e6" value={inp.concreteFcPa}
                 data-testid="forge-rcbeam-fc"
                 onChange={(e) => update({ concreteFcPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="f_y (Pa)">
          <input type="number" step="10e6" value={inp.steelFyPa}
                 data-testid="forge-rcbeam-fy"
                 onChange={(e) => update({ steelFyPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="E_s (Pa)">
          <input type="number" step="1e9" value={inp.steelEPa}
                 data-testid="forge-rcbeam-Es"
                 onChange={(e) => update({ steelEPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-rcbeam-run" style={buttonStyle} onClick={onCompute}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-rcbeam-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-rcbeam-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-rcbeam-regime"
               style={{ color: result.tensionControlled ? '#4ade80' : '#fbbf24',
                        fontWeight: 700, fontSize: 13 }}>
            {result.tensionControlled ? 'TENSION-CONTROLLED' : 'TRANSITION / COMPRESSION-CONTROLLED'}
          </div>
          <div>β_1&nbsp;&nbsp;&nbsp;&nbsp;{result.beta1.toFixed(3)}</div>
          <div>a (block)&nbsp;{(result.stressBlockDepthM * 1000).toFixed(1)} mm</div>
          <div>c (NA)&nbsp;&nbsp;&nbsp;{(result.neutralAxisDepthM * 1000).toFixed(1)} mm</div>
          <div>ε_t&nbsp;&nbsp;&nbsp;&nbsp;{(result.steelStrain * 1000).toFixed(2)} ‰</div>
          <div>φ&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.phi.toFixed(3)}</div>
          <div>M_n&nbsp;&nbsp;&nbsp;&nbsp;{(result.nominalMomentNm / 1000).toFixed(1)} kN·m</div>
          <div data-testid="forge-rcbeam-phiMn"
               style={{ marginTop: 4, fontWeight: 700 }}>
            φM_n&nbsp;&nbsp;{(result.designMomentNm / 1000).toFixed(1)} kN·m
          </div>
          <div style={{ marginTop: 6, color: result.belowRhoMin ? '#ff6363' : '#4ade80' }}
               data-testid="forge-rcbeam-rhomin">
            ρ {result.rho.toExponential(2)} &nbsp;vs&nbsp; ρ_min {result.rhoMin.toExponential(2)}
            {result.belowRhoMin ? ' — BELOW MIN' : ' — OK'}
          </div>
          <div style={{ color: result.aboveRhoMax ? '#fbbf24' : '#4ade80' }}
               data-testid="forge-rcbeam-rhomax">
            ρ {result.rho.toExponential(2)} &nbsp;vs&nbsp; ρ_max {result.rhoMax.toExponential(2)}
            {result.aboveRhoMax ? ' — ABOVE 0.75·ρ_b (compression-heavy)' : ' — OK'}
          </div>
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

export function RcBeamWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenRcBeamWorkbench  = () => setOpen(true);
    window.__forgeCloseRcBeamWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.rcbeam' || id === 'workbench.rcbeam') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'rcbeam') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <RcBeamPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default RcBeamPanel;
