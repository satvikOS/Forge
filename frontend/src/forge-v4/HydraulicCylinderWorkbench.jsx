// Forge-222 — hydraulic cylinder sizing workbench.
//
// Areas, forces, speeds, volume/cycle, Euler buckling check on rod.
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
  width: 110, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.hydcyl)
      || (typeof window !== 'undefined' && window.electron && window.electron.hydcyl);
}

function defaults() {
  return {
    bore: 0.050, rodDiameter: 0.022,
    pressure: 21e6, flowRate: 1.667e-4,
    strokeLength: 0.200,
    rodE: 200e9, bucklingK: 1.0,
  };
}

function HydCylPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onAnalyse = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().analyse(inp));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-hydcyl-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Hydraulic cylinder · sizing</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Areas, push/pull forces, extend/retract speeds, volume/cycle,
        Euler buckling SF on the rod.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="Bore (m)">
          <input type="number" step="0.005" value={inp.bore}
                 data-testid="forge-hydcyl-bore"
                 onChange={(e) => update({ bore: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Rod d (m)">
          <input type="number" step="0.002" value={inp.rodDiameter}
                 data-testid="forge-hydcyl-rod"
                 onChange={(e) => update({ rodDiameter: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Pressure (Pa)">
          <input type="number" step="1e6" value={inp.pressure}
                 data-testid="forge-hydcyl-p"
                 onChange={(e) => update({ pressure: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Flow (m³/s)">
          <input type="number" step="1e-5" value={inp.flowRate}
                 data-testid="forge-hydcyl-Q"
                 onChange={(e) => update({ flowRate: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Stroke (m)">
          <input type="number" step="0.05" value={inp.strokeLength}
                 data-testid="forge-hydcyl-L"
                 onChange={(e) => update({ strokeLength: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Rod E (Pa)">
          <input type="number" step="1e9" value={inp.rodE}
                 data-testid="forge-hydcyl-E"
                 onChange={(e) => update({ rodE: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="K (end cond.)">
          <input type="number" step="0.1" value={inp.bucklingK}
                 data-testid="forge-hydcyl-K"
                 onChange={(e) => update({ bucklingK: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-hydcyl-run" style={buttonStyle} onClick={onAnalyse}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-hydcyl-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-hydcyl-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>Piston A&nbsp;&nbsp;&nbsp;{(result.pistonArea * 1e4).toFixed(3)} cm²</div>
          <div>Annulus A&nbsp;&nbsp;{(result.annulusArea * 1e4).toFixed(3)} cm²</div>
          <div>F extend&nbsp;&nbsp;&nbsp;{(result.extendForce / 1000).toFixed(2)} kN</div>
          <div>F retract&nbsp;&nbsp;{(result.retractForce / 1000).toFixed(2)} kN</div>
          <div>v extend&nbsp;&nbsp;&nbsp;{(result.extendSpeed * 1000).toFixed(1)} mm/s</div>
          <div>v retract&nbsp;&nbsp;{(result.retractSpeed * 1000).toFixed(1)} mm/s</div>
          <div>V / cycle&nbsp;&nbsp;{(result.volumePerCycle * 1e6).toFixed(2)} cm³</div>
          <div style={{ marginTop: 4,
                        color: result.bucklingSafetyFactor > 2 ? '#4ade80' : '#ff6363',
                        fontWeight: 700 }}
               data-testid="forge-hydcyl-sf">
            Buckling SF&nbsp;&nbsp;{result.bucklingSafetyFactor.toFixed(2)}
            {result.bucklingSafetyFactor > 2 ? ' (OK)' : ' (LOW)'}
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

export function HydraulicCylinderWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenHydCylWorkbench  = () => setOpen(true);
    window.__forgeCloseHydCylWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.hydcyl' || id === 'workbench.hydcyl') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'hydcyl') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <HydCylPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default HydCylPanel;
