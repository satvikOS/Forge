// Forge-224 — polygon centroid + area moments workbench.
//
// Editable vertex list + scatter-on-canvas; computes signed area,
// centroid, I_xx, I_yy, I_xy about the centroid, and radii of gyration.
// Hole support via signed loops.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.polysec)
      || (typeof window !== 'undefined' && window.electron && window.electron.polysec);
}

const FIXTURES = {
  square:   { name: 'Unit square (1×1)',     outer: [[0,0],[1,0],[1,1],[0,1]] },
  triangle: { name: 'Right triangle (3,2)',  outer: [[0,0],[3,0],[0,2]] },
  iBeam:    { name: 'I-beam (200 mm)',
    outer: [
      [-100,-100],[100,-100],[100,-80],[20,-80],
      [20,80],[100,80],[100,100],[-100,100],
      [-100,80],[-20,80],[-20,-80],[-100,-80],
    ]},
};

function PreviewSvg({ outer, holes, result }) {
  const W = 260, H = 200;
  if (!outer || outer.length < 3) return null;
  const xs = outer.map((p) => p[0]);
  const ys = outer.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const margin = 20;
  const sx = (x) => margin + ((x - minX) / Math.max(maxX - minX, 1)) * (W - 2*margin);
  const sy = (y) => H - margin - ((y - minY) / Math.max(maxY - minY, 1)) * (H - 2*margin);
  const poly = outer.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ');
  return (
    <svg width={W} height={H}
         style={{ background: 'var(--forge-canvas)',
                  border: '1px solid var(--forge-rail-edge)' }}>
      <polygon points={poly} fill="rgba(217,122,59,0.2)"
               stroke="var(--forge-accent)" strokeWidth="1.5" />
      {(holes || []).map((h, i) => (
        <polygon key={i}
                 points={h.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ')}
                 fill="var(--forge-canvas-2)" stroke="var(--forge-ink-mute)" strokeWidth="1" />
      ))}
      {result && (
        <>
          <circle cx={sx(result.centroid.x)} cy={sy(result.centroid.y)}
                  r="4" fill="#4ade80" />
          <line x1={sx(result.centroid.x)-6} y1={sy(result.centroid.y)}
                x2={sx(result.centroid.x)+6} y2={sy(result.centroid.y)}
                stroke="#4ade80" strokeWidth="1" />
          <line x1={sx(result.centroid.x)} y1={sy(result.centroid.y)-6}
                x2={sx(result.centroid.x)} y2={sy(result.centroid.y)+6}
                stroke="#4ade80" strokeWidth="1" />
        </>
      )}
    </svg>
  );
}

function PolySecPanel({ open, onClose }) {
  const [fixtureId, setFixtureId] = React.useState('square');
  const [outer, setOuter] = React.useState(FIXTURES.square.outer);
  const [holes] = React.useState([]);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');

  React.useEffect(() => {
    setOuter(FIXTURES[fixtureId].outer);
    setResult(null);
  }, [fixtureId]);

  if (!open) return null;

  const onAnalyse = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().analyse({ outer, holes }));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-polysec-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Polygon section · centroid + I</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Shoelace area + centroid + parallel-axis-shifted I_xx, I_yy, I_xy
        about the centroid for any 2D polygon. Holes supported via CW
        signed loops.
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>Fixture</span>
        <select value={fixtureId} data-testid="forge-polysec-fixture"
                onChange={(e) => setFixtureId(e.target.value)}
                style={{ background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
                         border: '1px solid var(--forge-rail-edge)',
                         padding: '2px 6px', fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          {Object.entries(FIXTURES).map(([id, f]) => (
            <option key={id} value={id}>{f.name}</option>
          ))}
        </select>
      </label>

      <button data-testid="forge-polysec-run" style={buttonStyle} onClick={onAnalyse}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-polysec-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-polysec-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>Area&nbsp;&nbsp;&nbsp;{result.area.toFixed(4)}</div>
          <div>Centroid&nbsp;({result.centroid.x.toFixed(4)}, {result.centroid.y.toFixed(4)})</div>
          <div>I_xx&nbsp;&nbsp;&nbsp;{result.IxxCentroid.toExponential(4)}</div>
          <div>I_yy&nbsp;&nbsp;&nbsp;{result.IyyCentroid.toExponential(4)}</div>
          <div>I_xy&nbsp;&nbsp;&nbsp;{result.IxyCentroid.toExponential(4)}</div>
          <div>r_gx&nbsp;&nbsp;&nbsp;{result.radiusOfGyrationX.toFixed(4)}</div>
          <div>r_gy&nbsp;&nbsp;&nbsp;{result.radiusOfGyrationY.toFixed(4)}</div>
        </section>
      )}

      <PreviewSvg outer={outer} holes={holes} result={result} />
    </div>
  );
}

export function PolygonSectionWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPolySecWorkbench  = () => setOpen(true);
    window.__forgeClosePolySecWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.polysec' || id === 'workbench.polysec') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'polysec') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <PolySecPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default PolySecPanel;
