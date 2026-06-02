// Forge-214 — bolt joint preload + check workbench.
//
// Drives `forge::boltjoint` from the renderer with the standard
// Shigley/VDI 2230 calculation chain:
//   preload from torque → joint stiffness ratio → working bolt
//   force → margin of safety vs ISO 898 proof load.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.boltjoint)
      || (typeof window !== 'undefined' && window.electron && window.electron.boltjoint);
}

const M_CODES = ['M3','M4','M5','M6','M8','M10','M12','M16','M20','M24'];
const GRADES  = ['8.8', '10.9', '12.9'];

function defaultInputs() {
  return {
    code: 'M10', grade: '8.8',
    torque: 50, nutFactor: 0.2,
    gripLength: 0.025,
    memberE: 200e9, memberArea: 200e-6,
    externalLoad: 5000,
  };
}

function BoltJointPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaultInputs);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const bj = api();
      const bolt = bj.metricBolt(inp.code);
      const preload = bj.computePreload({
        torque: inp.torque, nutFactor: inp.nutFactor, diameter: bolt.diameter,
      });
      const stiff = bj.jointStiffness({
        boltE: 200e9, boltAt: bolt.tensileArea, gripLength: inp.gripLength,
        memberE: inp.memberE, memberArea: inp.memberArea,
      });
      const proof = inp.grade === '12.9' ? bolt.proofStrengthClass129
                  : inp.grade === '10.9' ? bolt.proofStrengthClass109
                                          : bolt.proofStrengthClass88;
      const check = bj.check({
        preload, externalLoad: inp.externalLoad,
        loadFactor: stiff.loadFactor,
        tensileArea: bolt.tensileArea,
        proofStrength: proof,
      });
      setResult({ bolt, preload, stiff, proof, check });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-boltjoint-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Bolt joint — preload + MoS</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        F_i = T/(K·d); C = k_b/(k_b+k_m); F_b = F_i + C·F_ext;
        MS = F_proof/F_b - 1. Margins via ISO 898 class proof strengths.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="M code">
          <select value={inp.code} data-testid="forge-boltjoint-code"
                  onChange={(e) => update({ code: e.target.value })}
                  style={fieldStyle}>
            {M_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Grade">
          <select value={inp.grade} data-testid="forge-boltjoint-grade"
                  onChange={(e) => update({ grade: e.target.value })}
                  style={fieldStyle}>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Torque (N·m)">
          <input type="number" step="1" value={inp.torque}
                 data-testid="forge-boltjoint-torque"
                 onChange={(e) => update({ torque: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="K (nut factor)">
          <input type="number" step="0.01" value={inp.nutFactor}
                 data-testid="forge-boltjoint-K"
                 onChange={(e) => update({ nutFactor: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Grip L (m)">
          <input type="number" step="0.005" value={inp.gripLength}
                 data-testid="forge-boltjoint-Lg"
                 onChange={(e) => update({ gripLength: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Member E (Pa)">
          <input type="number" step="1e9" value={inp.memberE}
                 data-testid="forge-boltjoint-memE"
                 onChange={(e) => update({ memberE: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Member A (m²)">
          <input type="number" step="1e-5" value={inp.memberArea}
                 data-testid="forge-boltjoint-memA"
                 onChange={(e) => update({ memberArea: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="F_ext (N)">
          <input type="number" step="100" value={inp.externalLoad}
                 data-testid="forge-boltjoint-Fext"
                 onChange={(e) => update({ externalLoad: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-boltjoint-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-boltjoint-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-boltjoint-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-boltjoint-status"
               style={{ color: result.check.adequate ? '#4ade80' : '#ff6363',
                        fontWeight: 700, fontSize: 13 }}>
            {result.check.adequate ? 'ADEQUATE (MS > 0)' : 'INADEQUATE (MS ≤ 0)'}
          </div>
          <div>preload F_i&nbsp;&nbsp;&nbsp;{(result.preload/1000).toFixed(2)} kN</div>
          <div>load factor C&nbsp;{result.stiff.loadFactor.toFixed(3)}</div>
          <div>working F_b&nbsp;&nbsp;{(result.check.workingBoltForce/1000).toFixed(2)} kN</div>
          <div>stress σ&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{(result.check.workingStress/1e6).toFixed(1)} MPa</div>
          <div>proof load&nbsp;&nbsp;&nbsp;{(result.check.proofLoad/1000).toFixed(2)} kN</div>
          <div>margin of safety&nbsp;{result.check.marginOfSafety.toFixed(3)}</div>
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

export function BoltJointWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBoltJointWorkbench  = () => setOpen(true);
    window.__forgeCloseBoltJointWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.boltjoint' || id === 'workbench.boltjoint') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'boltjoint') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <BoltJointPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BoltJointPanel;
