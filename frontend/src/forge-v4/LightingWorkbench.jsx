// Forge-253 — IES lumen method lighting design.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Lighting → Lighting design.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.lighting)
      || (typeof window !== 'undefined' && window.electron && window.electron.lighting);
}

function defaults() {
  return {
    mode: 'solveN',
    lengthM: 10, widthM: 8, mountingHeightM: 1.83,
    lumensPerLuminaire: 3500,
    luminaireCount: 19,
    targetIlluminanceLux: 500,
    cuOverride: 0,
    lightLossFactor: 0.80,
  };
}

function LightPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().lumenMethod({
        room: {
          lengthM: inp.lengthM, widthM: inp.widthM,
          mountingHeightM: inp.mountingHeightM,
        },
        lumensPerLuminaire: inp.lumensPerLuminaire,
        luminaireCount: inp.mode === 'solveN' ? 0 : inp.luminaireCount,
        targetIlluminanceLux: inp.targetIlluminanceLux,
        cuOverride: inp.cuOverride,
        lightLossFactor: inp.lightLossFactor,
      }));
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-lighting-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Lighting design · IES lumen method</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        RCR = 5·h_rc·(L+W)/(L·W); CU(RCR) ≈ 0.85 − 0.045·RCR + 0.0015·RCR²
        for typical recessed troffer at 80/50/20 reflectance.
        E = N·Φ·CU·LLF / (L·W).
      </div>

      <div style={{ display: 'flex', gap: 6 }} role="tablist">
        {[
          ['solveN', 'Solve for N'], ['solveE', 'Solve for E'],
        ].map(([mode, label]) => (
          <button key={mode} role="tab" data-testid={`forge-lighting-tab-${mode}`}
                  onClick={() => update({ mode })}
                  style={{ flex: 1, padding: '4px 8px', cursor: 'pointer',
                           fontWeight: 700,
                           background: inp.mode === mode ? 'var(--forge-accent)' : 'var(--forge-canvas)',
                           color: inp.mode === mode ? '#0a0e14' : 'var(--forge-ink)',
                           border: '1px solid var(--forge-rail-edge)' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="L (m)">
          <input type="number" step="0.5" value={inp.lengthM}
                 data-testid="forge-lighting-L"
                 onChange={(e) => update({ lengthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="W (m)">
          <input type="number" step="0.5" value={inp.widthM}
                 data-testid="forge-lighting-W"
                 onChange={(e) => update({ widthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="h_rc (m)">
          <input type="number" step="0.1" value={inp.mountingHeightM}
                 data-testid="forge-lighting-h"
                 onChange={(e) => update({ mountingHeightM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Φ /luminaire (lm)">
          <input type="number" step="100" value={inp.lumensPerLuminaire}
                 data-testid="forge-lighting-phi"
                 onChange={(e) => update({ lumensPerLuminaire: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="LLF">
          <input type="number" step="0.05" min="0.1" max="1" value={inp.lightLossFactor}
                 data-testid="forge-lighting-LLF"
                 onChange={(e) => update({ lightLossFactor: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="CU (0 = auto)">
          <input type="number" step="0.05" min="0" max="1" value={inp.cuOverride}
                 data-testid="forge-lighting-CU"
                 onChange={(e) => update({ cuOverride: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        {inp.mode === 'solveN' && (
          <Field label="E_target (lux)">
            <input type="number" step="25" value={inp.targetIlluminanceLux}
                   data-testid="forge-lighting-Etgt"
                   onChange={(e) => update({ targetIlluminanceLux: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        )}
        {inp.mode === 'solveE' && (
          <Field label="N">
            <input type="number" step="1" min="1" value={inp.luminaireCount}
                   data-testid="forge-lighting-N"
                   onChange={(e) => update({ luminaireCount: Number(e.target.value) || 1 })}
                   style={fieldStyle} />
          </Field>
        )}
      </div>

      <button data-testid="forge-lighting-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-lighting-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-lighting-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>RCR&nbsp;&nbsp;{result.rcr.toFixed(3)}&nbsp;&nbsp;
               CU&nbsp;&nbsp;{result.cu.toFixed(3)}</div>
          <div data-testid="forge-lighting-N-out"
               style={{ marginTop: 4, fontWeight: 700 }}>
            N luminaires&nbsp;{result.requiredLuminaires}&nbsp;&nbsp;
            Σ lm&nbsp;{result.computedTotalLumens.toFixed(0)}
          </div>
          <div data-testid="forge-lighting-E"
               style={{ fontWeight: 700, color: '#4ade80' }}>
            E&nbsp;{result.illuminanceLux.toFixed(1)} lux
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

export function LightingWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenLightingWorkbench  = () => setOpen(true);
    window.__forgeCloseLightingWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.lighting' || id === 'workbench.lighting') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'lighting') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <LightPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default LightPanel;
