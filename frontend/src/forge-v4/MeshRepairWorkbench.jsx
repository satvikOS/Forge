// Forge-200 — mesh repair workbench.
//
// Operates on the active mesh (or a built-in fixture when no scene
// mesh is loaded — useful for e2e + quick demos). Each pass renders a
// before/after stats card so the user can see what changed.
//
// The kernel-side surface (`window.forge.meshrepair`) exposes:
//   analyse, dedupeVertices, removeDegenerate, fillHoles,
//   laplacianSmooth, decimate.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 560, zIndex: 1310,
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
  width: 80,
  background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

// Built-in fixture: small open quad with a duplicate vertex + a
// degenerate strip + one missing triangle. Exercises every pass.
function buildFixture() {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0.0001, 0, 0,
      0, 1, 0,
      2, 0, 0,    // for the degenerate strip
      2, 0.5, 0,
    ]),
    indices: new Uint32Array([
      0, 1, 2,
      3, 2, 4,
      1, 5, 6,   // a third triangle that connects but has unclosed boundary
    ]),
  };
}

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.meshrepair)
      || (typeof window !== 'undefined' && window.electron && window.electron.meshrepair);
}

export function meshrepairPipeline(mesh, options) {
  const mr = api();
  if (!mr) throw new Error('forge.meshrepair not available');
  let m = mesh;
  const stats = [];
  stats.push({ name: 'initial', ...mr.analyse(m) });
  if (options?.dedupe) {
    m = mr.dedupeVertices(m, options.dedupeEps ?? 1e-4);
    stats.push({ name: 'dedupe', ...mr.analyse(m) });
  }
  if (options?.removeDegenerate) {
    m = mr.removeDegenerate(m);
    stats.push({ name: 'removeDegenerate', ...mr.analyse(m) });
  }
  if (options?.fillHoles) {
    m = mr.fillHoles(m, options.maxLoopLen ?? 512);
    stats.push({ name: 'fillHoles', ...mr.analyse(m) });
  }
  if (options?.smooth) {
    m = mr.laplacianSmooth(m, options.smoothIter ?? 2, options.smoothLambda ?? 0.5);
    stats.push({ name: 'smooth', ...mr.analyse(m) });
  }
  if (options?.decimate) {
    m = mr.decimate(m, options.decimateTarget ?? 100);
    stats.push({ name: 'decimate', ...mr.analyse(m) });
  }
  return { mesh: m, stats };
}

function StatsTable({ stats }) {
  if (!stats || stats.length === 0) return null;
  return (
    <table data-testid="forge-meshrepair-stats"
           style={{ width: '100%', borderCollapse: 'collapse',
                    fontFamily: 'var(--forge-mono)', fontSize: 11,
                    background: 'var(--forge-canvas)',
                    borderRadius: 'var(--forge-radius)' }}>
      <thead>
        <tr style={{ color: 'var(--forge-ink-mute)' }}>
          <th style={{ textAlign: 'left',  padding: 4 }}>stage</th>
          <th style={{ textAlign: 'right', padding: 4 }}>verts</th>
          <th style={{ textAlign: 'right', padding: 4 }}>tris</th>
          <th style={{ textAlign: 'right', padding: 4 }}>boundary</th>
          <th style={{ textAlign: 'right', padding: 4 }}>non-mani</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s, i) => (
          <tr key={i} style={{ borderTop: '1px solid var(--forge-rail-edge)' }}>
            <td style={{ padding: 4 }}>{s.name}</td>
            <td style={{ padding: 4, textAlign: 'right' }}>{s.vertexCount}</td>
            <td style={{ padding: 4, textAlign: 'right' }}>{s.triangleCount}</td>
            <td style={{ padding: 4, textAlign: 'right' }}>{s.boundaryEdgeCount}</td>
            <td style={{ padding: 4, textAlign: 'right' }}>{s.nonManifoldEdgeCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MeshRepairPanel({ open, onClose }) {
  const [opts, setOpts] = React.useState({
    dedupe: true, dedupeEps: 1e-4,
    removeDegenerate: true,
    fillHoles: true, maxLoopLen: 512,
    smooth: false, smoothIter: 2, smoothLambda: 0.5,
    decimate: false, decimateTarget: 100,
  });
  const [stats, setStats] = React.useState(null);
  const [err, setErr] = React.useState('');

  if (!open) return null;

  const setOpt = (k, v) => setOpts({ ...opts, [k]: v });

  const onRun = () => {
    setErr(''); setStats(null);
    try {
      const mesh = (typeof window !== 'undefined' && window.__forgeActiveMesh)
        ? window.__forgeActiveMesh()
        : buildFixture();
      const r = meshrepairPipeline(mesh, opts);
      setStats(r.stats);
      if (typeof window !== 'undefined') window.__forgeLastRepairedMesh = r.mesh;
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-meshrepair-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Mesh repair</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Each pass is a separate kernel call. Runs against the active mesh
        (or a built-in fixture if none is loaded).
      </div>

      <Pass label="Dedupe vertices" checked={opts.dedupe}
            onCheck={(v) => setOpt('dedupe', v)}>
        <span>ε</span>
        <input type="number" step="0.0001" value={opts.dedupeEps}
               onChange={(e) => setOpt('dedupeEps', Number(e.target.value))}
               data-testid="forge-meshrepair-dedupe-eps" style={fieldStyle} />
      </Pass>
      <Pass label="Remove degenerate" checked={opts.removeDegenerate}
            onCheck={(v) => setOpt('removeDegenerate', v)} />
      <Pass label="Fill holes" checked={opts.fillHoles}
            onCheck={(v) => setOpt('fillHoles', v)}>
        <span>max loop</span>
        <input type="number" value={opts.maxLoopLen}
               onChange={(e) => setOpt('maxLoopLen', Number(e.target.value))}
               data-testid="forge-meshrepair-fillholes-max" style={fieldStyle} />
      </Pass>
      <Pass label="Laplacian smooth" checked={opts.smooth}
            onCheck={(v) => setOpt('smooth', v)}>
        <span>iter</span>
        <input type="number" value={opts.smoothIter}
               onChange={(e) => setOpt('smoothIter', Number(e.target.value))}
               data-testid="forge-meshrepair-smooth-iter" style={fieldStyle} />
        <span>λ</span>
        <input type="number" step="0.05" min="0" max="1" value={opts.smoothLambda}
               onChange={(e) => setOpt('smoothLambda', Number(e.target.value))}
               data-testid="forge-meshrepair-smooth-lambda" style={fieldStyle} />
      </Pass>
      <Pass label="Decimate" checked={opts.decimate}
            onCheck={(v) => setOpt('decimate', v)}>
        <span>target</span>
        <input type="number" value={opts.decimateTarget}
               onChange={(e) => setOpt('decimateTarget', Number(e.target.value))}
               data-testid="forge-meshrepair-decimate-target" style={fieldStyle} />
      </Pass>

      <button data-testid="forge-meshrepair-run" style={buttonStyle} onClick={onRun}>
        Run pipeline
      </button>

      {err && (
        <div data-testid="forge-meshrepair-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {stats && <StatsTable stats={stats} />}
    </div>
  );
}

function Pass({ label, checked, onCheck, children }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6,
                    background: 'var(--forge-canvas)',
                    padding: '4px 6px', borderRadius: 'var(--forge-radius)' }}>
      <input type="checkbox" checked={checked}
             onChange={(e) => onCheck(e.target.checked)}
             data-testid={`forge-meshrepair-cb-${label.toLowerCase().replace(/\s+/g, '-')}`} />
      <span style={{ flex: 1 }}>{label}</span>
      {children}
    </label>
  );
}

export function MeshRepairWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenMeshRepairWorkbench  = () => setOpen(true);
    window.__forgeCloseMeshRepairWorkbench = () => setOpen(false);
    window.__forgeMeshRepairPipeline       = meshrepairPipeline;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.meshrepair' || id === 'workbench.meshrepair') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'meshrepair') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <MeshRepairPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default MeshRepairPanel;
