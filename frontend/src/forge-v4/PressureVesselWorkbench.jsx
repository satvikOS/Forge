// Forge-228 — Pressure vessel workbench (ASME VIII Div 1).
//
// Thin-wall σ_h / σ_l + required thickness for cylinder + sphere.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 600, zIndex: 1310,
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
  width: 120, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.pvessel)
      || (typeof window !== 'undefined' && window.electron && window.electron.pvessel);
}

function defaults() {
  return {
    geometry: 'cylinder',
    pressure: 2e6, diameter: 1.0, wallThickness: 0.010,
    allowableStress: 120e6, jointEfficiency: 0.85,
  };
}

function PVPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      const s = a.stress({
        pressure: inp.pressure, diameter: inp.diameter,
        wallThickness: inp.wallThickness, geometry: inp.geometry,
      });
      const tReq = a.requiredThickness({
        pressure: inp.pressure, insideRadius: inp.diameter / 2,
        allowableStress: inp.allowableStress,
        jointEfficiency: inp.jointEfficiency,
        geometry: inp.geometry,
      });
      setResult({ s, tReq });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-pvessel-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Pressure vessel · ASME VIII Div 1</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Thin-wall: σ_h = pD/2t (cyl), pD/4t (sphere). ASME UG-27 /
        UG-32: t = pR/(SE−0.6p) cyl, t = pR/(2SE−0.2p) sphere.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="Geometry">
          <select value={inp.geometry} data-testid="forge-pvessel-geometry"
                  onChange={(e) => update({ geometry: e.target.value })}
                  style={fieldStyle}>
            <option value="cylinder">cylinder</option>
            <option value="sphere">sphere</option>
          </select>
        </Field>
        <Field label="p (Pa)">
          <input type="number" step="1e5" value={inp.pressure}
                 data-testid="forge-pvessel-p"
                 onChange={(e) => update({ pressure: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="D inside (m)">
          <input type="number" step="0.1" value={inp.diameter}
                 data-testid="forge-pvessel-D"
                 onChange={(e) => update({ diameter: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="t wall (m)">
          <input type="number" step="0.001" value={inp.wallThickness}
                 data-testid="forge-pvessel-t"
                 onChange={(e) => update({ wallThickness: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="S allow (Pa)">
          <input type="number" step="10e6" value={inp.allowableStress}
                 data-testid="forge-pvessel-S"
                 onChange={(e) => update({ allowableStress: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="E joint eff">
          <input type="number" step="0.05" min="0.01" max="1" value={inp.jointEfficiency}
                 data-testid="forge-pvessel-E"
                 onChange={(e) => update({ jointEfficiency: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-pvessel-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-pvessel-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-pvessel-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>σ_h (hoop)&nbsp;&nbsp;&nbsp;{(result.s.hoopStress / 1e6).toFixed(2)} MPa</div>
          <div>σ_l (long.)&nbsp;&nbsp;{(result.s.longitudinalStress / 1e6).toFixed(2)} MPa</div>
          <div data-testid="forge-pvessel-tReq"
               style={{ marginTop: 4, fontWeight: 700 }}>
            Required t&nbsp;&nbsp;{(result.tReq * 1000).toFixed(3)} mm
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

export function PressureVesselWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPVesselWorkbench  = () => setOpen(true);
    window.__forgeClosePVesselWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.pvessel' || id === 'workbench.pvessel') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'pvessel') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <PVPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default PVPanel;
