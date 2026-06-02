// Forge-235 — Shaft design under combined bending + torsion.
//
// Static check (Distortion Energy / von Mises) and fatigue check
// (Shigley modified Goodman, S_e from k_total · 0.5·S_ut).
//
// Per the Forge-233 rule: not added to the workbench rail. Reached
// via Tools menu → Machine design → Shafts & axles → Shaft (combined).
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 640, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.shaft)
      || (typeof window !== 'undefined' && window.electron && window.electron.shaft);
}

function defaults() {
  return {
    diameterM: 0.025, bendingMomentNm: 200, torqueNm: 150,
    yieldMPa: 600, ultimateMPa: 800,
    marinFactor: 0.8, kfBending: 1.5, kfsTorsion: 1.3,
  };
}

function ShaftPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [stat, setStat] = React.useState(null);
  const [fat, setFat] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setStat(null); setFat(null);
    try {
      const a = api();
      setStat(a.analyseStatic({
        diameterM: inp.diameterM, bendingMomentNm: inp.bendingMomentNm,
        torqueNm: inp.torqueNm, yieldMPa: inp.yieldMPa,
      }));
      setFat(a.analyseFatigue({
        diameterM: inp.diameterM, bendingMomentNm: inp.bendingMomentNm,
        torqueNm: inp.torqueNm, ultimateMPa: inp.ultimateMPa,
        marinFactor: inp.marinFactor,
        kfBending: inp.kfBending, kfsTorsion: inp.kfsTorsion,
      }));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-shaft-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Shaft · combined bending + torsion</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Static: σ_vm = √(σ_x² + 3·τ²); SF = S_y/σ_vm.
        Fatigue (Shigley modified Goodman): S_e = k·0.5·S_ut, n via
        1/n = K_f·σ_a/S_e + √3·K_fs·τ_m/S_ut.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="d (m)">
          <input type="number" step="0.001" value={inp.diameterM}
                 data-testid="forge-shaft-d"
                 onChange={(e) => update({ diameterM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="M (N·m)">
          <input type="number" step="10" value={inp.bendingMomentNm}
                 data-testid="forge-shaft-M"
                 onChange={(e) => update({ bendingMomentNm: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="T (N·m)">
          <input type="number" step="10" value={inp.torqueNm}
                 data-testid="forge-shaft-T"
                 onChange={(e) => update({ torqueNm: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="S_y (MPa)">
          <input type="number" step="10" value={inp.yieldMPa}
                 data-testid="forge-shaft-Sy"
                 onChange={(e) => update({ yieldMPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="S_ut (MPa)">
          <input type="number" step="10" value={inp.ultimateMPa}
                 data-testid="forge-shaft-Sut"
                 onChange={(e) => update({ ultimateMPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="k_total">
          <input type="number" step="0.05" value={inp.marinFactor}
                 data-testid="forge-shaft-k"
                 onChange={(e) => update({ marinFactor: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="K_f">
          <input type="number" step="0.05" value={inp.kfBending}
                 data-testid="forge-shaft-Kf"
                 onChange={(e) => update({ kfBending: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="K_fs">
          <input type="number" step="0.05" value={inp.kfsTorsion}
                 data-testid="forge-shaft-Kfs"
                 onChange={(e) => update({ kfsTorsion: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-shaft-run" style={buttonStyle} onClick={onCompute}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-shaft-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}

      {stat && (
        <section data-testid="forge-shaft-static"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 2 }}>
            STATIC · Distortion Energy
          </div>
          <div>σ_x (bending)&nbsp;&nbsp;{stat.bendingStressMPa.toFixed(1)} MPa</div>
          <div>τ (shear)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{stat.shearStressMPa.toFixed(1)} MPa</div>
          <div>σ_vm&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{stat.vonMisesStressMPa.toFixed(1)} MPa</div>
          <div data-testid="forge-shaft-sf-static"
               style={{ marginTop: 4, fontWeight: 700,
                        color: stat.safetyFactor >= 2 ? '#4ade80' : '#ff6363' }}>
            SF static&nbsp;&nbsp;{stat.safetyFactor.toFixed(2)}
            {stat.safetyFactor >= 2 ? ' (OK)' : ' (LOW)'}
          </div>
        </section>
      )}

      {fat && (
        <section data-testid="forge-shaft-fatigue"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 2 }}>
            FATIGUE · modified Goodman (Shigley)
          </div>
          <div>S_e&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{fat.enduranceLimitMPa.toFixed(1)} MPa</div>
          <div>σ_a&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{fat.alternatingMPa.toFixed(1)} MPa</div>
          <div>σ_m&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{fat.meanMPa.toFixed(1)} MPa</div>
          <div data-testid="forge-shaft-sf-fatigue"
               style={{ marginTop: 4, fontWeight: 700,
                        color: fat.safetyFactor >= 1.5 ? '#4ade80' : '#ff6363' }}>
            n (Goodman)&nbsp;&nbsp;{fat.safetyFactor.toFixed(2)}
            {fat.safetyFactor >= 1.5 ? ' (OK)' : ' (LOW)'}
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

export function ShaftWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenShaftWorkbench  = () => setOpen(true);
    window.__forgeCloseShaftWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.shaft' || id === 'workbench.shaft') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'shaft') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <ShaftPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default ShaftPanel;
