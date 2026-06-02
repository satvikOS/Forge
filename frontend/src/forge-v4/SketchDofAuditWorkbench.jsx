// Forge-208 — sketch DOF audit workbench.
//
// Counts geometric DOFs vs constraints in the active sketch (or a
// built-in fixture) and reports under / fully / over-constrained.
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 520, zIndex: 1310,
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

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.sketchdof)
      || (typeof window !== 'undefined' && window.electron && window.electron.sketchdof);
}

export function sketchDofAudit(input) {
  const s = api();
  if (!s) throw new Error('forge.sketchdof not available');
  return s.audit(input);
}

// Defaults to a 4-line square (Forge-208 smoke topology).
function fixture() {
  return {
    entities: Array(4).fill(0).map(() => ({ kind: 'line' })),
    constraints: [
      ...Array(4).fill(0).map(() => ({ kind: 'coincident' })),
      { kind: 'horizontal' }, { kind: 'horizontal' },
      { kind: 'vertical' }, { kind: 'vertical' },
      { kind: 'fix' },
      { kind: 'distance' },
    ],
  };
}

function statusColour(status) {
  if (status === 'fully') return '#4ade80';
  if (status === 'over')  return '#ff6363';
  return '#fbbf24';
}

function SketchDofPanel({ open, onClose }) {
  const [src, setSrc] = React.useState(fixture);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onAudit = () => {
    setErr(''); setResult(null);
    try {
      // Pull from the active sketch if the renderer has one wired.
      const active = (typeof window !== 'undefined' && window.__forgeActiveSketchEntities)
        ? { entities: window.__forgeActiveSketchEntities(),
            constraints: window.__forgeActiveSketchConstraints?.() ?? [] }
        : src;
      const r = sketchDofAudit(active);
      setResult({ r, src: active });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  const addConstraint = (kind) => {
    setSrc({ ...src, constraints: [...src.constraints, { kind }] });
  };
  const removeLastConstraint = () => {
    setSrc({ ...src, constraints: src.constraints.slice(0, -1) });
  };

  return (
    <div style={panelStyle} data-testid="forge-sketchdof-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Sketch DOF audit</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Per-entity DOFs (point 2, line 4, circle 3, arc 5) minus per-
        constraint DOFs removed. Over- / under-constrained sketches
        won't solve cleanly.
      </div>

      <div style={{ background: 'var(--forge-canvas)', padding: 6, borderRadius: 4,
                    fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
        <div data-testid="forge-sketchdof-current-count">
          entities: {src.entities.length} · constraints: {src.constraints.length}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {['coincident', 'horizontal', 'vertical', 'distance', 'radius',
          'parallel', 'perpendicular', 'fix'].map((k) => (
          <button key={k}
                  data-testid={`forge-sketchdof-add-${k}`}
                  onClick={() => addConstraint(k)}
                  style={{ ...buttonStyle, background: 'var(--forge-canvas-2)',
                           color: 'var(--forge-ink)', fontWeight: 400, fontSize: 10 }}>
            + {k}
          </button>
        ))}
        <button data-testid="forge-sketchdof-remove"
                onClick={removeLastConstraint}
                style={{ ...buttonStyle, background: 'var(--forge-canvas-2)',
                         color: 'var(--forge-ink)', fontWeight: 400, fontSize: 10 }}>
          − last
        </button>
      </div>

      <button data-testid="forge-sketchdof-run" style={buttonStyle} onClick={onAudit}>
        Run audit
      </button>

      {err && (
        <div data-testid="forge-sketchdof-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}

      {result && (
        <section data-testid="forge-sketchdof-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-sketchdof-status"
               style={{ color: statusColour(result.r.status),
                        fontWeight: 700, fontSize: 13 }}>
            {result.r.status.toUpperCase()}-CONSTRAINED
          </div>
          <div>entities&nbsp;&nbsp;&nbsp;&nbsp;{result.r.totalEntities}</div>
          <div>constraints&nbsp;{result.r.totalConstraints}</div>
          <div>total DOF&nbsp;&nbsp;&nbsp;{result.r.totalDof}</div>
          <div>removed&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.r.constrainedDof}</div>
          <div>free DOF&nbsp;&nbsp;&nbsp;&nbsp;{result.r.freeDof}</div>
        </section>
      )}
    </div>
  );
}

export function SketchDofAuditWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSketchDofWorkbench  = () => setOpen(true);
    window.__forgeCloseSketchDofWorkbench = () => setOpen(false);
    window.__forgeSketchDofAudit          = sketchDofAudit;
    window.__forgeSketchDofFixture        = fixture;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.sketchdof' || id === 'workbench.sketchdof') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'sketchdof') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SketchDofPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SketchDofPanel;
