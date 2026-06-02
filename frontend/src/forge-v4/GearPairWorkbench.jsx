// Forge-221 — spur gear pair design workbench.
//
// Lewis bending + Hertz contact stress + AGMA correction factors.
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
  width: 100, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.gearpair)
      || (typeof window !== 'undefined' && window.electron && window.electron.gearpair);
}

function defaults() {
  return {
    module: 2, teeth1: 20, teeth2: 60,
    faceWidth: 25, torque1: 200000,
    pressureAngleDeg: 20,
    materialE1: 200e9, materialE2: 200e9,
    materialNu1: 0.3, materialNu2: 0.3,
    KO: 1.0, KV: 1.0, KS: 1.0, KH: 1.0, KB: 1.0,
  };
}

function GearPairPanel({ open, onClose }) {
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
    <div style={panelStyle} data-testid="forge-gearpair-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Spur gear pair · Lewis + Hertz</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Lewis σ_b = W_t/(b·m·Y); Y ≈ 0.484 − 0.2745/√N for 20°
        involute. Hertz pitch-line contact via Z_E + geometry factor.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="Module m (mm)">
          <input type="number" step="0.5" value={inp.module}
                 data-testid="forge-gearpair-m"
                 onChange={(e) => update({ module: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="N₁ (pinion)">
          <input type="number" step="1" value={inp.teeth1}
                 data-testid="forge-gearpair-N1"
                 onChange={(e) => update({ teeth1: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="N₂ (gear)">
          <input type="number" step="1" value={inp.teeth2}
                 data-testid="forge-gearpair-N2"
                 onChange={(e) => update({ teeth2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="b face (mm)">
          <input type="number" step="1" value={inp.faceWidth}
                 data-testid="forge-gearpair-b"
                 onChange={(e) => update({ faceWidth: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="T₁ (N·mm)">
          <input type="number" step="1000" value={inp.torque1}
                 data-testid="forge-gearpair-T"
                 onChange={(e) => update({ torque1: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="φ (°)">
          <input type="number" step="0.5" value={inp.pressureAngleDeg}
                 data-testid="forge-gearpair-phi"
                 onChange={(e) => update({ pressureAngleDeg: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="KO">
          <input type="number" step="0.1" value={inp.KO}
                 data-testid="forge-gearpair-KO"
                 onChange={(e) => update({ KO: Number(e.target.value) || 1 })}
                 style={fieldStyle} />
        </Field>
        <Field label="KV">
          <input type="number" step="0.05" value={inp.KV}
                 data-testid="forge-gearpair-KV"
                 onChange={(e) => update({ KV: Number(e.target.value) || 1 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-gearpair-run" style={buttonStyle} onClick={onAnalyse}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-gearpair-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-gearpair-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>d₁/d₂&nbsp;&nbsp;&nbsp;&nbsp;{result.pitchDiameter1.toFixed(2)} / {result.pitchDiameter2.toFixed(2)} mm</div>
          <div>C (centre)&nbsp;{result.centreDistance.toFixed(2)} mm</div>
          <div>Ratio mG&nbsp;{result.gearRatio.toFixed(3)}</div>
          <div>W_t&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.tangentialLoadN.toFixed(1)} N</div>
          <div>Y₁ / Y₂&nbsp;&nbsp;{result.lewisFormFactor1.toFixed(4)} / {result.lewisFormFactor2.toFixed(4)}</div>
          <hr style={{ borderColor: 'var(--forge-rail-edge)' }} />
          <div>σ_b,Lewis 1&nbsp;{(result.bendingStressLewis1 / 1e6).toFixed(1)} MPa</div>
          <div>σ_b,Lewis 2&nbsp;{(result.bendingStressLewis2 / 1e6).toFixed(1)} MPa</div>
          <div>σ_b,AGMA 1&nbsp;&nbsp;{(result.bendingStressAGMA1 / 1e6).toFixed(1)} MPa</div>
          <div>σ_b,AGMA 2&nbsp;&nbsp;{(result.bendingStressAGMA2 / 1e6).toFixed(1)} MPa</div>
          <div>σ_H Hertz&nbsp;&nbsp;&nbsp;{(result.contactStressHertz / 1e6).toFixed(1)} MPa</div>
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

export function GearPairWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenGearPairWorkbench  = () => setOpen(true);
    window.__forgeCloseGearPairWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.gearpair' || id === 'workbench.gearpair') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'gearpair') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <GearPairPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default GearPairPanel;
