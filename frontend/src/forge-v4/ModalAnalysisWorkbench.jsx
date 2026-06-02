// Forge-210 — modal / vibration analysis workbench.
//
// Generalised eigenvalue solve on the Forge-205 truss K-M system.
// Reports first kModes natural frequencies + mode shapes. The Warren-
// truss fixture from Forge-205 doubles as the modal demo here.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 580, zIndex: 1310,
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

export function frameModal(input) {
  const fr = api();
  if (!fr || typeof fr.modal !== 'function') {
    throw new Error('forge.frame.modal not available');
  }
  return fr.modal(input);
}

// SI-units fixture: 5-panel Warren truss in metres, steel members.
function warrenModalFixture(kModes = 6) {
  const span = 5.0, height = 1.5, panel = span / 5;
  const E = 2.0e11;  // Pa
  const A = 2.5e-4;  // m² (250 mm²)
  const density = 7800;  // kg/m³
  const nodes = [];
  for (let i = 0; i <= 5; ++i) {
    nodes.push({
      position: [i * panel, 0, 0],
      fixed: i === 0 ? [true, true, true]
           : i === 5 ? [false, true, true]
           :          [false, false, true],
    });
  }
  for (let i = 0; i < 5; ++i) {
    nodes.push({
      position: [(i + 0.5) * panel, height, 0],
      fixed: [false, false, true],
    });
  }
  const elements = [];
  for (let i = 0; i < 5; ++i) elements.push({ a: i, b: i + 1, E, A, density });
  for (let i = 0; i < 4; ++i) elements.push({ a: 6 + i, b: 7 + i, E, A, density });
  for (let i = 0; i < 5; ++i) {
    elements.push({ a: i,     b: 6 + i, E, A, density });
    elements.push({ a: i + 1, b: 6 + i, E, A, density });
  }
  return { nodes, elements, kModes };
}

function ModalAnalysisPanel({ open, onClose }) {
  const [kModes, setKModes] = React.useState(6);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onRun = () => {
    setErr(''); setResult(null);
    try {
      const r = frameModal(warrenModalFixture(kModes));
      setResult(r);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-modal-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Modal analysis</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Generalised eigenvalue solve Kφ = ω²Mφ. Lumped mass matrix.
        First k modes returned with normalised mode shapes.
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>k modes</span>
        <input type="number" step="1" min="1" max="20" value={kModes}
               data-testid="forge-modal-k"
               onChange={(e) => setKModes(Math.max(1, Number(e.target.value) | 0))}
               style={{ width: 80,
                        background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
                        border: '1px solid var(--forge-rail-edge)',
                        padding: '2px 4px',
                        fontFamily: 'var(--forge-mono)', fontSize: 11 }} />
      </label>

      <button data-testid="forge-modal-run" style={buttonStyle} onClick={onRun}>
        Run modal analysis (Warren fixture)
      </button>

      {err && (
        <div data-testid="forge-modal-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-modal-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div style={{ color: 'var(--forge-ink-mute)' }}>
            Mode # &nbsp; Frequency (Hz)
          </div>
          {Array.from(result.frequenciesHz).map((f, i) => (
            <div key={i}>
              {String(i + 1).padStart(2, ' ')}&nbsp;&nbsp;&nbsp;&nbsp;{f.toFixed(2)}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

export function ModalAnalysisWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenModalWorkbench  = () => setOpen(true);
    window.__forgeCloseModalWorkbench = () => setOpen(false);
    window.__forgeFrameModal          = frameModal;
    window.__forgeModalFixture        = warrenModalFixture;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.modal' || id === 'workbench.modal') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'modal') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <ModalAnalysisPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default ModalAnalysisPanel;
