// Forge-220 — Mohr's circle workbench.
//
// 2D σ_x, σ_y, τ_xy → σ_1, σ_2, τ_max, θ_p with SVG Mohr's circle
// rendering. 3D principal stresses via Eigen self-adjoint solver.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.mohr)
      || (typeof window !== 'undefined' && window.electron && window.electron.mohr);
}

function MohrCircleSvg({ s, r }) {
  if (!s || !r) return null;
  const W = 300, H = 200;
  const margin = 20;
  const span = Math.max(Math.abs(r.sigma1), Math.abs(r.sigma2), r.tauMax) * 1.3 || 1;
  const sx = (v) => margin + ((v + span) / (2 * span)) * (W - 2 * margin);
  const sy = (v) => H / 2 - ((v + span) / (2 * span) - 0.5) * (H - 2 * margin) * 2;
  const cx = (r.sigma1 + r.sigma2) / 2;
  const R  = (r.sigma1 - r.sigma2) / 2;
  const screenR = ((R + span) / (2 * span) - 0.5) * (W - 2 * margin) * 2;
  return (
    <svg width={W} height={H}
         style={{ background: 'var(--forge-canvas)',
                  border: '1px solid var(--forge-rail-edge)' }}>
      <line x1={margin} y1={H/2} x2={W - margin} y2={H/2}
            stroke="var(--forge-ink-mute)" strokeWidth="0.5" />
      <line x1={sx(0)} y1={margin} x2={sx(0)} y2={H - margin}
            stroke="var(--forge-ink-mute)" strokeWidth="0.5" />
      <circle cx={sx(cx)} cy={H/2} r={Math.abs(screenR)}
              fill="none" stroke="var(--forge-accent)" strokeWidth="1.5" />
      <circle cx={sx(s.sx)} cy={sy(-s.txy)} r="3" fill="#4ade80" />
      <circle cx={sx(s.sy)} cy={sy( s.txy)} r="3" fill="#fbbf24" />
      <circle cx={sx(r.sigma1)} cy={H/2} r="3" fill="#ff6363" />
      <circle cx={sx(r.sigma2)} cy={H/2} r="3" fill="#ff6363" />
      <text x="4" y="14" fill="var(--forge-ink-mute)"
            style={{ font: '10px var(--forge-mono)' }}>Mohr's circle σ–τ</text>
    </svg>
  );
}

function MohrPanel({ open, onClose }) {
  const [s, setS] = React.useState({ sx: 80, sy: 20, txy: 30 });
  const [s3, setS3] = React.useState({ sx: 100, sy: 0, sz: 0, txy: 0, tyz: 0, tzx: 0 });
  const [r, setR] = React.useState(null);
  const [r3, setR3] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setR(null); setR3(null);
    try {
      const a = api();
      setR(a.principal2D(s));
      setR3(a.principal3D(s3));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-mohr-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Mohr's circle · principal stress</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        2D: σ_x, σ_y, τ_xy → σ_1, σ_2, τ_max, θ_p.
        3D: Eigen self-adjoint of the symmetric stress tensor.
      </div>

      <section style={{ background: 'var(--forge-canvas)', padding: 6, borderRadius: 4 }}>
        <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 4 }}>2D state (MPa)</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['sx','sy','txy'].map((k) => (
            <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: 'var(--forge-ink-mute)' }}>{k}</span>
              <input type="number" step="1" value={s[k]}
                     data-testid={`forge-mohr-2d-${k}`}
                     onChange={(e) => setS({ ...s, [k]: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </label>
          ))}
        </div>
      </section>

      <section style={{ background: 'var(--forge-canvas)', padding: 6, borderRadius: 4 }}>
        <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 4 }}>3D state (MPa)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['sx','sy','sz','txy','tyz','tzx'].map((k) => (
            <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: 'var(--forge-ink-mute)' }}>{k}</span>
              <input type="number" step="1" value={s3[k]}
                     data-testid={`forge-mohr-3d-${k}`}
                     onChange={(e) => setS3({ ...s3, [k]: Number(e.target.value) || 0 })}
                     style={fieldStyle} />
            </label>
          ))}
        </div>
      </section>

      <button data-testid="forge-mohr-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-mohr-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {r && (
        <section data-testid="forge-mohr-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div style={{ color: 'var(--forge-ink-mute)' }}>2D principal:</div>
          <div>σ_1&nbsp;&nbsp;{r.sigma1.toFixed(3)} MPa</div>
          <div>σ_2&nbsp;&nbsp;{r.sigma2.toFixed(3)} MPa</div>
          <div>τ_max&nbsp;{r.tauMax.toFixed(3)} MPa</div>
          <div>θ_p&nbsp;&nbsp;{(r.thetaPRad * 180 / Math.PI).toFixed(2)}°</div>
          {r3 && (
            <>
              <div style={{ color: 'var(--forge-ink-mute)', marginTop: 4 }}>3D principal:</div>
              <div>σ_1&nbsp;&nbsp;{r3.sigma1.toFixed(3)} MPa</div>
              <div>σ_2&nbsp;&nbsp;{r3.sigma2.toFixed(3)} MPa</div>
              <div>σ_3&nbsp;&nbsp;{r3.sigma3.toFixed(3)} MPa</div>
            </>
          )}
        </section>
      )}

      {r && <MohrCircleSvg s={s} r={r} />}
    </div>
  );
}

export function MohrsCircleWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenMohrWorkbench  = () => setOpen(true);
    window.__forgeCloseMohrWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.mohr' || id === 'workbench.mohr') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'mohr') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <MohrPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default MohrPanel;
