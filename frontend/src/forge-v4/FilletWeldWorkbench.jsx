// Forge-237 — Fillet weld design (AISC J2 / AWS D1.1).
//
// Equal-leg fillet weld: t_e = 0.707·w; φR_n = 0.75·0.60·F_EXX·t_e·L.
// AWS D1.1 minimum leg + AISC J2.2b maximum leg checks.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Structural → Connections → Fillet weld.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 620, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.filletweld)
      || (typeof window !== 'undefined' && window.electron && window.electron.filletweld);
}

function defaults() {
  return {
    legSizeM: 0.006, weldLengthM: 0.200, electrodeFexxPa: 480e6,
    thickerPlateM: 0.012, edgePlateM: 0.010,
  };
}

function FilletWeldPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().analyse({ ...inp, phi: 0.75 }));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-filletweld-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Fillet weld · AISC 360 §J2 + AWS D1.1</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        t_e = 0.707·w; φR_n = 0.75·0.60·F_EXX·t_e·L. AWS min-leg by
        thicker plate; AISC max-leg = t_edge − 1.6 mm along plate edge.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="leg w (m)">
          <input type="number" step="0.001" value={inp.legSizeM}
                 data-testid="forge-filletweld-w"
                 onChange={(e) => update({ legSizeM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="L total (m)">
          <input type="number" step="0.025" value={inp.weldLengthM}
                 data-testid="forge-filletweld-L"
                 onChange={(e) => update({ weldLengthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="F_EXX (Pa)">
          <input type="number" step="50e6" value={inp.electrodeFexxPa}
                 data-testid="forge-filletweld-Fexx"
                 onChange={(e) => update({ electrodeFexxPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="t thick (m)">
          <input type="number" step="0.001" value={inp.thickerPlateM}
                 data-testid="forge-filletweld-tthick"
                 onChange={(e) => update({ thickerPlateM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="t edge (m)">
          <input type="number" step="0.001" value={inp.edgePlateM}
                 data-testid="forge-filletweld-tedge"
                 onChange={(e) => update({ edgePlateM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-filletweld-run" style={buttonStyle} onClick={onCompute}>
        Check
      </button>

      {err && (
        <div data-testid="forge-filletweld-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-filletweld-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>throat t_e&nbsp;&nbsp;{(result.effectiveThroatM * 1000).toFixed(2)} mm</div>
          <div>φr_n&nbsp;&nbsp;{(result.designPerUnitNPerM / 1000).toFixed(1)} N/mm</div>
          <div data-testid="forge-filletweld-total"
               style={{ marginTop: 4, fontWeight: 700 }}>
            φR_n&nbsp;&nbsp;{(result.totalDesignN / 1000).toFixed(1)} kN
          </div>
          <div style={{ marginTop: 6, color: result.legBelowAwsMin ? '#ff6363' : '#4ade80' }}
               data-testid="forge-filletweld-aws">
            AWS w_min&nbsp;{(result.awsMinLegM * 1000).toFixed(1)} mm —
            {result.legBelowAwsMin ? ' BELOW AWS MIN' : ' OK'}
          </div>
          <div style={{ color: result.legAboveAiscMax ? '#ff6363' : '#4ade80' }}
               data-testid="forge-filletweld-aisc">
            AISC w_max&nbsp;{(result.aiscMaxLegM * 1000).toFixed(1)} mm —
            {result.legAboveAiscMax ? ' ABOVE AISC MAX' : ' OK'}
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

export function FilletWeldWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenFilletWeldWorkbench  = () => setOpen(true);
    window.__forgeCloseFilletWeldWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.filletweld' || id === 'workbench.filletweld') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'filletweld') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <FilletWeldPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default FilletWeldPanel;
