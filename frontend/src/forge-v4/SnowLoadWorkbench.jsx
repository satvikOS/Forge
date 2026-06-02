// Forge-225 — Snow load (ASCE 7) workbench.
//
// p_f = 0.7·C_e·C_t·I_s·p_g; p_s = C_s·p_f.
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
  width: 150, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.snowload)
      || (typeof window !== 'undefined' && window.electron && window.electron.snowload);
}

function defaults() {
  return {
    groundSnowPa: 1500, exposure: 'partially', thermal: 'heated',
    risk: 'II', slopeDeg: 20,
  };
}

function SnowLoadPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().analyse(inp));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-snowload-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Snow load · ASCE 7</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        p_f = 0.7·C_e·C_t·I_s·p_g; sloped p_s = C_s·p_f. C_s ramps to 0
        as slope rises (warm: 30°→70°, cold: 45°→70°).
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="p_g (Pa)">
          <input type="number" step="100" value={inp.groundSnowPa}
                 data-testid="forge-snowload-pg"
                 onChange={(e) => update({ groundSnowPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Exposure">
          <select value={inp.exposure} data-testid="forge-snowload-exposure"
                  onChange={(e) => update({ exposure: e.target.value })}
                  style={fieldStyle}>
            <option value="fully">fully (C_e=0.8)</option>
            <option value="partially">partially (1.0)</option>
            <option value="sheltered">sheltered (1.2)</option>
          </select>
        </Field>
        <Field label="Thermal">
          <select value={inp.thermal} data-testid="forge-snowload-thermal"
                  onChange={(e) => update({ thermal: e.target.value })}
                  style={fieldStyle}>
            <option value="heated">heated (C_t=1.0)</option>
            <option value="just-above-freezing">just above freezing (1.1)</option>
            <option value="unheated">unheated (1.2)</option>
            <option value="cold-vent">cold-vent (1.1)</option>
          </select>
        </Field>
        <Field label="Risk">
          <select value={inp.risk} data-testid="forge-snowload-risk"
                  onChange={(e) => update({ risk: e.target.value })}
                  style={fieldStyle}>
            <option value="I">I (0.80)</option>
            <option value="II">II (1.00)</option>
            <option value="III">III (1.10)</option>
            <option value="IV">IV (1.20)</option>
          </select>
        </Field>
        <Field label="Slope θ (°)">
          <input type="number" step="1" min="0" max="90" value={inp.slopeDeg}
                 data-testid="forge-snowload-slope"
                 onChange={(e) => update({ slopeDeg: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-snowload-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-snowload-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-snowload-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>p_f (flat)&nbsp;&nbsp;&nbsp;{result.flatRoofPa.toFixed(1)} Pa</div>
          <div>C_s (slope)&nbsp;{result.slopeFactor.toFixed(3)}</div>
          <div>p_s (sloped)&nbsp;{result.slopedRoofPa.toFixed(1)} Pa ({(result.slopedRoofPa / 1000).toFixed(3)} kPa)</div>
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

export function SnowLoadWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSnowLoadWorkbench  = () => setOpen(true);
    window.__forgeCloseSnowLoadWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.snowload' || id === 'workbench.snowload') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'snowload') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SnowLoadPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SnowLoadPanel;
