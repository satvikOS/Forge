// Forge-207 — DXF (AutoCAD) round-trip workbench.
//
// Drives the kernel `dxf.parse` and `dxf.write` namespaces from the
// renderer. The panel can:
//   1. Load DXF text into a textarea
//   2. Parse it and show the entity list with counts by type
//   3. Write the current entity list back to text
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

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.dxf)
      || (typeof window !== 'undefined' && window.electron && window.electron.dxf);
}

export function dxfParse(text) {
  const d = api();
  if (!d) throw new Error('forge.dxf not available');
  return d.parse(text);
}
export function dxfWrite(doc) {
  const d = api();
  if (!d) throw new Error('forge.dxf not available');
  return d.write(doc);
}

const FIXTURE = {
  entities: [
    { type: 'line',   layer: '0',     x0: 0, y0: 0, x1: 30, y1: 0,
      radius: 0, startAngleDeg: 0, endAngleDeg: 0,
      closed: false, vertices: new Float64Array() },
    { type: 'line',   layer: '0',     x0: 30, y0: 0, x1: 30, y1: 20,
      radius: 0, startAngleDeg: 0, endAngleDeg: 0,
      closed: false, vertices: new Float64Array() },
    { type: 'circle', layer: 'HOLES', x0: 15, y0: 10, x1: 0, y1: 0, radius: 3,
      startAngleDeg: 0, endAngleDeg: 0,
      closed: false, vertices: new Float64Array() },
    { type: 'arc',    layer: '0',     x0: 30, y0: 20, x1: 0, y1: 0, radius: 5,
      startAngleDeg: 90, endAngleDeg: 180,
      closed: false, vertices: new Float64Array() },
    { type: 'lwpolyline', layer: 'OUT',
      vertices: new Float64Array([5, 5,  25, 5,  25, 15,  5, 15]),
      closed: true,
      x0: 0, y0: 0, x1: 0, y1: 0, radius: 0, startAngleDeg: 0, endAngleDeg: 0 },
  ],
};

function counts(doc) {
  const r = { line: 0, circle: 0, arc: 0, lwpolyline: 0 };
  if (!doc?.entities) return r;
  for (const e of doc.entities) {
    if (r[e.type] != null) r[e.type] += 1;
  }
  return r;
}

function DxfPanel({ open, onClose }) {
  const [text, setText] = React.useState(() => dxfWrite(FIXTURE));
  const [doc, setDoc]   = React.useState(null);
  const [err, setErr]   = React.useState('');

  if (!open) return null;

  const onParse = () => {
    setErr(''); setDoc(null);
    try {
      setDoc(dxfParse(text));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const onWrite = () => {
    setErr('');
    try {
      const t = dxfWrite(doc ?? FIXTURE);
      setText(t);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const onLoadFixture = () => {
    setText(dxfWrite(FIXTURE));
    setDoc(null);
  };

  const c = doc ? counts(doc) : null;

  return (
    <div style={panelStyle} data-testid="forge-dxf-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>DXF round-trip</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        ASCII DXF reader + writer for LINE / CIRCLE / ARC / LWPOLYLINE
        entities on arbitrary layers.
      </div>

      <textarea
        data-testid="forge-dxf-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        style={{ width: '100%',
                 background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
                 fontFamily: 'var(--forge-mono)', fontSize: 11,
                 border: '1px solid var(--forge-rail-edge)',
                 padding: 4 }}
      />

      <div style={{ display: 'flex', gap: 6 }}>
        <button data-testid="forge-dxf-parse" style={buttonStyle} onClick={onParse}>Parse</button>
        <button data-testid="forge-dxf-write" style={buttonStyle} onClick={onWrite}>Write</button>
        <button data-testid="forge-dxf-fixture" style={buttonStyle} onClick={onLoadFixture}>Reset fixture</button>
      </div>

      {err && (
        <div data-testid="forge-dxf-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {c && (
        <section data-testid="forge-dxf-counts"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>lines&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{c.line}</div>
          <div>circles&nbsp;&nbsp;&nbsp;{c.circle}</div>
          <div>arcs&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{c.arc}</div>
          <div>lwpolylines&nbsp;{c.lwpolyline}</div>
          <div>total&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{doc.entities.length}</div>
        </section>
      )}
    </div>
  );
}

export function DxfRoundtripWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenDxfWorkbench  = () => setOpen(true);
    window.__forgeCloseDxfWorkbench = () => setOpen(false);
    window.__forgeDxfParse          = dxfParse;
    window.__forgeDxfWrite          = dxfWrite;
    window.__forgeDxfFixture        = FIXTURE;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.dxf' || id === 'workbench.dxf') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'dxf') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <DxfPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default DxfPanel;
