// Forge-205 — frame / truss FEA workbench.
//
// Solves 3D axial-only truss FEA via the kernel `frame` namespace.
// The panel ships a "Warren truss" fixture (5 panels) the user can
// hit "Solve" on for a sanity check, plus the scriptable
// `window.__forgeFrameSolve(input)` surface for Archie / e2e.
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

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.frame)
      || (typeof window !== 'undefined' && window.electron && window.electron.frame);
}

export function frameSolve(input) {
  const fr = api();
  if (!fr) throw new Error('forge.frame not available');
  return fr.solve(input);
}

// Warren truss: 5 bottom-chord panels with diagonals in /\/\/ pattern,
// pinned at the two ends, point load at the centre top node.
function warrenTrussFixture() {
  const span = 5000, height = 1500, panel = span / 5;
  const E = 200e3, A = 250;   // mm² · MPa
  const nodes = [];
  // Bottom chord: 6 nodes at y=0, z=0
  for (let i = 0; i <= 5; ++i) {
    nodes.push({
      position: [i * panel, 0, 0],
      fixed: i === 0 ? [true, true, true]
           : i === 5 ? [false, true, true]   // roller at right end
           :          [false, false, true],
    });
  }
  // Top chord: 5 nodes between adjacent bottom-chord panels
  for (let i = 0; i < 5; ++i) {
    nodes.push({
      position: [(i + 0.5) * panel, height, 0],
      fixed: [false, false, true],
    });
  }
  const elements = [];
  // Bottom chord (5 members)
  for (let i = 0; i < 5; ++i) elements.push({ a: i, b: i + 1, E, A });
  // Top chord (4 members between top-chord nodes)
  for (let i = 0; i < 4; ++i) elements.push({ a: 6 + i, b: 7 + i, E, A });
  // Diagonals
  for (let i = 0; i < 5; ++i) {
    elements.push({ a: i,     b: 6 + i, E, A });   // / diagonal
    elements.push({ a: i + 1, b: 6 + i, E, A });   // \ diagonal
  }
  return {
    nodes, elements,
    loads: [{ node: 8, force: [0, -50000, 0] }],   // 50 kN down at centre
  };
}

function FrameTrussPanel({ open, onClose }) {
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');

  if (!open) return null;

  const onSolve = () => {
    setErr(''); setResult(null);
    try {
      const fixture = warrenTrussFixture();
      const r = frameSolve(fixture);
      setResult({ r, fixture });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  const maxDisp = result ? (() => {
    const u = result.r.displacements;
    let mx = 0, idx = -1;
    for (let i = 0; i < u.length / 3; ++i) {
      const d = Math.hypot(u[i*3+0], u[i*3+1], u[i*3+2]);
      if (d > mx) { mx = d; idx = i; }
    }
    return { mx, idx };
  })() : null;

  const maxAxial = result ? (() => {
    let mx = 0, idx = -1;
    const f = result.r.axialForce;
    for (let i = 0; i < f.length; ++i) {
      if (Math.abs(f[i]) > Math.abs(mx)) { mx = f[i]; idx = i; }
    }
    return { mx, idx };
  })() : null;

  return (
    <div style={panelStyle} data-testid="forge-frame-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Frame / truss FEA</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Axial-only 3D truss FEA: pin/roller supports, point loads, member
        forces + reactions + nodal displacements via Eigen LDLT.
      </div>
      <button data-testid="forge-frame-solve" style={buttonStyle} onClick={onSolve}>
        Solve Warren truss fixture
      </button>

      {err && (
        <div data-testid="forge-frame-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-frame-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>Singular&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.r.singular ? 'YES (under-constrained)' : 'no'}</div>
          <div>Nodes&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.fixture.nodes.length}</div>
          <div>Elements&nbsp;&nbsp;&nbsp;&nbsp;{result.fixture.elements.length}</div>
          {maxDisp && (
            <div>Max |u|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{maxDisp.mx.toExponential(3)} mm at node {maxDisp.idx}</div>
          )}
          {maxAxial && (
            <div>Max axial&nbsp;&nbsp;{maxAxial.mx.toFixed(0)} N at element {maxAxial.idx}</div>
          )}
        </section>
      )}
    </div>
  );
}

export function FrameTrussWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenFrameWorkbench  = () => setOpen(true);
    window.__forgeCloseFrameWorkbench = () => setOpen(false);
    window.__forgeFrameSolve          = frameSolve;
    window.__forgeFrameFixture        = warrenTrussFixture;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.frame' || id === 'workbench.frame') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'frame') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <FrameTrussPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default FrameTrussPanel;
