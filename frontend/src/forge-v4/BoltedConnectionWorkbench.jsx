// Forge-236 — Bolted lap-joint connection check (AISC 360 J3).
//
// Two analyses: per-bolt shear+bearing (J3-1, J3-6a) and net-section
// tension (D2 yield + rupture).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Structural → Connections → Bolted connection.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 680, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.boltconn)
      || (typeof window !== 'undefined' && window.electron && window.electron.boltconn);
}

function defaults() {
  return {
    boltAreaM2: Math.PI / 4 * Math.pow(0.01905, 2), // 3/4" A325
    boltUltimatePa: 825e6,
    plateThicknessM: 0.010,
    boltNominalDiamM: 0.01905,
    edgeClearanceM: 0.035,
    plateUltimatePa: 400e6,
    plateYieldPa: 250e6,
    shearPlanes: 1,
    grossAreaM2: 0.100 * 0.010,
    plateWidthM: 0.100, boltsAcross: 2, holeDiameterM: 0.02065,
    shearLagU: 1.0,
  };
}

function BoltConnPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [shr, setShr] = React.useState(null);
  const [ten, setTen] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setShr(null); setTen(null);
    try {
      const a = api();
      setShr(a.analyseShear({
        boltAreaM2: inp.boltAreaM2, boltUltimatePa: inp.boltUltimatePa,
        plateThicknessM: inp.plateThicknessM, boltNominalDiamM: inp.boltNominalDiamM,
        edgeClearanceM: inp.edgeClearanceM, plateUltimatePa: inp.plateUltimatePa,
        shearPlanes: inp.shearPlanes, phiShear: 0.75, phiBearing: 0.75,
      }));
      setTen(a.analyseTension({
        grossAreaM2: inp.grossAreaM2,
        yieldPa: inp.plateYieldPa, ultimatePa: inp.plateUltimatePa,
        plateWidthM: inp.plateWidthM, plateThicknessM: inp.plateThicknessM,
        boltsAcross: inp.boltsAcross, holeDiameterM: inp.holeDiameterM,
        shearLagU: inp.shearLagU, phiYield: 0.9, phiRupture: 0.75,
      }));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-boltconn-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Bolted connection · AISC 360 J3 / EC3 §3.6</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Per-bolt: F_nv = 0.45·F_ub (threads in plane), R_p =
        min(1.2·L_c·t·F_u, 2.4·d_b·t·F_u). Net section: P_y = F_y·A_g
        (φ=0.9); P_r = F_u·U·A_n (φ=0.75).
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="A_b (m²)">
          <input type="number" step="1e-5" value={inp.boltAreaM2}
                 data-testid="forge-boltconn-Ab"
                 onChange={(e) => update({ boltAreaM2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="F_ub (Pa)">
          <input type="number" step="50e6" value={inp.boltUltimatePa}
                 data-testid="forge-boltconn-Fub"
                 onChange={(e) => update({ boltUltimatePa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="d_b (m)">
          <input type="number" step="0.001" value={inp.boltNominalDiamM}
                 data-testid="forge-boltconn-db"
                 onChange={(e) => update({ boltNominalDiamM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="t (m)">
          <input type="number" step="0.001" value={inp.plateThicknessM}
                 data-testid="forge-boltconn-t"
                 onChange={(e) => update({ plateThicknessM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="L_c (m)">
          <input type="number" step="0.005" value={inp.edgeClearanceM}
                 data-testid="forge-boltconn-Lc"
                 onChange={(e) => update({ edgeClearanceM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="F_u (Pa)">
          <input type="number" step="50e6" value={inp.plateUltimatePa}
                 data-testid="forge-boltconn-Fu"
                 onChange={(e) => update({ plateUltimatePa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="F_y (Pa)">
          <input type="number" step="25e6" value={inp.plateYieldPa}
                 data-testid="forge-boltconn-Fy"
                 onChange={(e) => update({ plateYieldPa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="shear planes">
          <select value={inp.shearPlanes} data-testid="forge-boltconn-planes"
                  onChange={(e) => update({ shearPlanes: Number(e.target.value) })}
                  style={fieldStyle}>
            <option value="1">1 (single)</option>
            <option value="2">2 (double)</option>
          </select>
        </Field>
        <Field label="W plate (m)">
          <input type="number" step="0.01" value={inp.plateWidthM}
                 data-testid="forge-boltconn-W"
                 onChange={(e) => update({ plateWidthM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="A_g (m²)">
          <input type="number" step="1e-4" value={inp.grossAreaM2}
                 data-testid="forge-boltconn-Ag"
                 onChange={(e) => update({ grossAreaM2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="n bolts ⊥">
          <input type="number" step="1" value={inp.boltsAcross}
                 data-testid="forge-boltconn-n"
                 onChange={(e) => update({ boltsAcross: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="d_h (m)">
          <input type="number" step="0.001" value={inp.holeDiameterM}
                 data-testid="forge-boltconn-dh"
                 onChange={(e) => update({ holeDiameterM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="U (shear lag)">
          <input type="number" step="0.05" value={inp.shearLagU}
                 data-testid="forge-boltconn-U"
                 onChange={(e) => update({ shearLagU: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-boltconn-run" style={buttonStyle} onClick={onCompute}>
        Check
      </button>

      {err && (
        <div data-testid="forge-boltconn-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}

      {shr && (
        <section data-testid="forge-boltconn-shear"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 2 }}>
            PER-BOLT · shear + bearing
          </div>
          <div>R_n,v (bolt shear)&nbsp;&nbsp;{(shr.boltShearN / 1000).toFixed(1)} kN</div>
          <div>1.2·L_c·t·F_u&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{(shr.bearingLcN / 1000).toFixed(1)} kN</div>
          <div>2.4·d_b·t·F_u&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{(shr.bearingDbN / 1000).toFixed(1)} kN</div>
          <div>R_n,p (bearing)&nbsp;&nbsp;&nbsp;&nbsp;{(shr.bearingN / 1000).toFixed(1)} kN</div>
          <div>φR_v&nbsp;&nbsp;&nbsp;&nbsp;{(shr.designShearN / 1000).toFixed(1)} kN</div>
          <div>φR_p&nbsp;&nbsp;&nbsp;&nbsp;{(shr.designBearingN / 1000).toFixed(1)} kN</div>
          <div data-testid="forge-boltconn-shear-gov"
               style={{ marginTop: 4, fontWeight: 700, color: '#4ade80' }}>
            Governs: {shr.governedByShear ? 'BOLT SHEAR' : 'PLATE BEARING'}
            &nbsp;@ {(shr.governingN / 1000).toFixed(1)} kN
          </div>
        </section>
      )}

      {ten && (
        <section data-testid="forge-boltconn-tension"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 2 }}>
            NET-SECTION TENSION · D2
          </div>
          <div>A_n&nbsp;&nbsp;&nbsp;&nbsp;{(ten.netAreaM2 * 1e4).toFixed(3)} cm²</div>
          <div>A_e&nbsp;&nbsp;&nbsp;&nbsp;{(ten.effectiveAreaM2 * 1e4).toFixed(3)} cm²</div>
          <div>φP_y&nbsp;&nbsp;&nbsp;{(ten.designYieldN / 1000).toFixed(1)} kN</div>
          <div>φP_r&nbsp;&nbsp;&nbsp;{(ten.designRuptureN / 1000).toFixed(1)} kN</div>
          <div data-testid="forge-boltconn-tension-gov"
               style={{ marginTop: 4, fontWeight: 700, color: '#4ade80' }}>
            Governs: {ten.governedByRupture ? 'NET-SECTION RUPTURE' : 'GROSS YIELDING'}
            &nbsp;@ {(ten.governingN / 1000).toFixed(1)} kN
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

export function BoltedConnectionWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBoltConnWorkbench  = () => setOpen(true);
    window.__forgeCloseBoltConnWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.boltconn' || id === 'workbench.boltconn') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'boltconn') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <BoltConnPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BoltConnPanel;
