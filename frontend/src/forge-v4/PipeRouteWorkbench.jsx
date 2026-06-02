// Forge-206 — pipe routing workbench.
//
// Picks A* shortest axis-aligned route between two ports, with
// obstacle avoidance + per-elbow cost. Shows result on a small 3-view
// SVG canvas (XZ + XY) so the user can sanity-check before committing.
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
const fieldStyle = {
  width: 80, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.piperoute)
      || (typeof window !== 'undefined' && window.electron && window.electron.piperoute);
}

export function pipeRoute(input) {
  const pr = api();
  if (!pr) throw new Error('forge.piperoute not available');
  return pr.route(input);
}

function defaultInputs() {
  return {
    start: { position: [0, 0, 0],  direction: [1, 0, 0] },
    end:   { position: [20, 8, 0], direction: [1, 0, 0] },
    obstacles: [{ min: [6, -3, -3], max: [12, 3, 3] }],
    gridSpacing: 1.0,
    elbowPenalty: 0.5,
    bbMargin: 6.0,
    maxIterations: 200000,
  };
}

function MiniView({ result, inputs, view }) {
  const W = 200, H = 140;
  const minX = -2, maxX = 22, minY = -10, maxY = 10;
  const sx = (x) => ((x - minX) / (maxX - minX)) * W;
  const sy = (y) => H - ((y - minY) / (maxY - minY)) * H;
  // For XZ view, swap y for z
  const pickY = (i) => view === 'XZ' ? inputs?.polyAxisIsZ?.[i] : inputs?.polyAxisIsY?.[i];
  return (
    <svg width={W} height={H}
         style={{ background: 'var(--forge-canvas)',
                  border: '1px solid var(--forge-rail-edge)' }}>
      {inputs?.obstacles?.map((b, i) => {
        const ax = view === 'XZ' ? 2 : 1;
        return (
          <rect key={i}
                x={sx(b.min[0])} y={sy(b.max[ax])}
                width={sx(b.max[0]) - sx(b.min[0])}
                height={sy(b.min[ax]) - sy(b.max[ax])}
                fill="rgba(217,122,59,0.3)" stroke="rgba(217,122,59,0.6)" />
        );
      })}
      {result?.polyline?.length >= 6 && (() => {
        const pts = [];
        for (let i = 0; i < result.polyline.length; i += 3) {
          const x = result.polyline[i + 0];
          const y = view === 'XZ' ? result.polyline[i + 2] : result.polyline[i + 1];
          pts.push(`${sx(x)},${sy(y)}`);
        }
        return <polyline points={pts.join(' ')} fill="none"
                         stroke="var(--forge-accent)" strokeWidth="2" />;
      })()}
      {inputs?.start && (
        <circle cx={sx(inputs.start.position[0])}
                cy={sy(view === 'XZ' ? inputs.start.position[2] : inputs.start.position[1])}
                r="4" fill="#4ade80" />
      )}
      {inputs?.end && (
        <circle cx={sx(inputs.end.position[0])}
                cy={sy(view === 'XZ' ? inputs.end.position[2] : inputs.end.position[1])}
                r="4" fill="#f97316" />
      )}
      <text x="4" y="14" fill="var(--forge-ink-mute)"
            style={{ font: '10px var(--forge-mono)' }}>{view}</text>
    </svg>
  );
}

function PipeRoutePanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaultInputs());
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onRun = () => {
    setErr(''); setResult(null);
    try {
      const r = pipeRoute(inp);
      setResult(r);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const setStart = (axis, val) => {
    const s = { ...inp.start, position: inp.start.position.slice() };
    s.position[axis] = Number(val) || 0;
    setInp({ ...inp, start: s });
  };
  const setEnd = (axis, val) => {
    const e = { ...inp.end, position: inp.end.position.slice() };
    e.position[axis] = Number(val) || 0;
    setInp({ ...inp, end: e });
  };

  return (
    <div style={panelStyle} data-testid="forge-piperoute-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Pipe routing</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        A* shortest axis-aligned route between two ports with AABB
        obstacles and per-elbow cost.
      </div>

      <section style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--forge-ink-mute)' }}>Start (X, Y, Z)</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[0,1,2].map((a) => (
              <input key={a} type="number" step="1" value={inp.start.position[a]}
                     data-testid={`forge-piperoute-start-${'xyz'[a]}`}
                     onChange={(e) => setStart(a, e.target.value)}
                     style={fieldStyle} />
            ))}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--forge-ink-mute)' }}>End (X, Y, Z)</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[0,1,2].map((a) => (
              <input key={a} type="number" step="1" value={inp.end.position[a]}
                     data-testid={`forge-piperoute-end-${'xyz'[a]}`}
                     onChange={(e) => setEnd(a, e.target.value)}
                     style={fieldStyle} />
            ))}
          </div>
        </div>
      </section>

      <button data-testid="forge-piperoute-run" style={buttonStyle} onClick={onRun}>
        Route
      </button>

      {err && (
        <div data-testid="forge-piperoute-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <div data-testid="forge-piperoute-result"
             style={{ background: 'var(--forge-canvas)',
                      padding: 'var(--forge-space-2)',
                      borderRadius: 'var(--forge-radius)',
                      fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>Found&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.found ? 'yes' : 'NO'}</div>
          <div>Length&nbsp;&nbsp;&nbsp;&nbsp;{result.totalLength.toFixed(3)}</div>
          <div>Elbows&nbsp;&nbsp;&nbsp;&nbsp;{result.elbowCount}</div>
          <div>Iter used&nbsp;{result.iterationsUsed}</div>
        </div>
      )}

      {result?.polyline && (
        <div style={{ display: 'flex', gap: 8 }}>
          <MiniView result={result} inputs={inp} view="XY" />
          <MiniView result={result} inputs={inp} view="XZ" />
        </div>
      )}
    </div>
  );
}

export function PipeRouteWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPipeRouteWorkbench  = () => setOpen(true);
    window.__forgeClosePipeRouteWorkbench = () => setOpen(false);
    window.__forgePipeRoute               = pipeRoute;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.piperoute' || id === 'workbench.piperoute') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'piperoute') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <PipeRoutePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default PipeRoutePanel;
