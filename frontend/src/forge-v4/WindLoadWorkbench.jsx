// Forge-223 — Wind load (ASCE 7) workbench.
//
// K_z exposure coefficient + q_z velocity pressure + design pressure
// for main wind-force-resisting systems.
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
  width: 100, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.windload)
      || (typeof window !== 'undefined' && window.electron && window.electron.windload);
}

function defaults() {
  return {
    V: 50, z: 10, exposure: 'C',
    Kzt: 1.0, Kd: 0.85, Ke: 1.0,
    G: 0.85, Cp: 0.8,
  };
}

function WindLoadPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      const Kz = a.kzCoefficient(inp.z, inp.exposure);
      const qz = a.velocityPressure({
        V: inp.V, z: inp.z, exposure: inp.exposure,
        Kzt: inp.Kzt, Kd: inp.Kd, Ke: inp.Ke,
      });
      const p = a.designPressure({ qz, G: inp.G, Cp: inp.Cp });
      setResult({ Kz, qz, p });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-windload-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Wind load · ASCE 7</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        K_z = 2.01·(z/z_g)^(2/α); q_z = 0.613·K_z·K_zt·K_d·K_e·V²;
        p = q_z·G·C_p. z_g + α from Exposure Category (B/C/D).
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="V (m/s)">
          <input type="number" step="1" value={inp.V}
                 data-testid="forge-windload-V"
                 onChange={(e) => update({ V: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="z height (m)">
          <input type="number" step="1" value={inp.z}
                 data-testid="forge-windload-z"
                 onChange={(e) => update({ z: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Exposure">
          <select value={inp.exposure} data-testid="forge-windload-exposure"
                  onChange={(e) => update({ exposure: e.target.value })}
                  style={fieldStyle}>
            <option value="B">B (suburban)</option>
            <option value="C">C (open)</option>
            <option value="D">D (water)</option>
          </select>
        </Field>
        <Field label="K_zt">
          <input type="number" step="0.05" value={inp.Kzt}
                 data-testid="forge-windload-Kzt"
                 onChange={(e) => update({ Kzt: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="K_d">
          <input type="number" step="0.05" value={inp.Kd}
                 data-testid="forge-windload-Kd"
                 onChange={(e) => update({ Kd: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="G">
          <input type="number" step="0.05" value={inp.G}
                 data-testid="forge-windload-G"
                 onChange={(e) => update({ G: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="C_p">
          <input type="number" step="0.1" value={inp.Cp}
                 data-testid="forge-windload-Cp"
                 onChange={(e) => update({ Cp: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-windload-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-windload-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-windload-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>K_z&nbsp;&nbsp;&nbsp;{result.Kz.toFixed(4)}</div>
          <div>q_z&nbsp;&nbsp;&nbsp;{result.qz.toFixed(1)} Pa ({(result.qz / 1000).toFixed(3)} kPa)</div>
          <div>p (design)&nbsp;&nbsp;{result.p.toFixed(1)} Pa</div>
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

export function WindLoadWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenWindLoadWorkbench  = () => setOpen(true);
    window.__forgeCloseWindLoadWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.windload' || id === 'workbench.windload') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'windload') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <WindLoadPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default WindLoadPanel;
