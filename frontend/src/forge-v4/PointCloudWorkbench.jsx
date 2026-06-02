// Forge-202 — point cloud / reverse engineering workbench.
//
// Drives `forge::pointcloud` from the renderer: stats, voxel downsample,
// PCA normal estimation, voxel-shell mesh. The mesh output can be
// chained into Forge-200's mesh repair to clean up a scan.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 540, zIndex: 1310,
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
  width: 90,
  background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.pointcloud)
      || (typeof window !== 'undefined' && window.electron && window.electron.pointcloud);
}

function buildLattice(n) {
  const pts = [];
  for (let i = 0; i < n; ++i)
    for (let j = 0; j < n; ++j)
      for (let k = 0; k < n; ++k)
        pts.push(i, j, k);
  return new Float32Array(pts);
}

export function pointcloudPipeline(points, options) {
  const pc = api();
  if (!pc) throw new Error('forge.pointcloud not available');
  const stats0 = pc.stats(points);
  let working = points;
  if (options?.downsample) {
    working = pc.voxelDownsample(working, options.downsampleLeaf ?? 1.0);
  }
  const statsAfter = pc.stats(working);
  let normals = null, mesh = null;
  if (options?.normals) {
    normals = pc.estimateNormals(working, options.normalsK ?? 8,
                                 options.viewpoint ?? [0, 0, 1e6]);
  }
  if (options?.voxelMesh) {
    mesh = pc.voxelMesh(working, options.voxelMeshLeaf ?? 1.0);
  }
  return { stats0, statsAfter, points: working, normals, mesh };
}

function PointCloudPanel({ open, onClose }) {
  const [opts, setOpts] = React.useState({
    downsample: true,     downsampleLeaf: 1.0,
    normals: true,        normalsK: 8,
    voxelMesh: true,      voxelMeshLeaf: 1.0,
  });
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');

  if (!open) return null;

  const setOpt = (k, v) => setOpts({ ...opts, [k]: v });

  const onRun = () => {
    setErr(''); setResult(null);
    try {
      const pts = (typeof window !== 'undefined' && window.__forgeActivePointCloud)
        ? window.__forgeActivePointCloud()
        : buildLattice(5);
      const r = pointcloudPipeline(pts, opts);
      setResult(r);
      if (typeof window !== 'undefined') {
        window.__forgeLastPointcloud = r.points;
        window.__forgeLastPointcloudMesh = r.mesh;
      }
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-pointcloud-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Point cloud · reverse engineering</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Runs against the active point cloud (or a 5×5×5 lattice fixture
        if none is loaded). Output mesh chains into Mesh repair.
      </div>

      <Pass label="Voxel downsample" checked={opts.downsample}
            onCheck={(v) => setOpt('downsample', v)}>
        <span>leaf</span>
        <input type="number" step="0.1" value={opts.downsampleLeaf}
               data-testid="forge-pointcloud-ds-leaf"
               onChange={(e) => setOpt('downsampleLeaf', Number(e.target.value))}
               style={fieldStyle} />
      </Pass>
      <Pass label="Estimate normals (PCA)" checked={opts.normals}
            onCheck={(v) => setOpt('normals', v)}>
        <span>k</span>
        <input type="number" step="1" value={opts.normalsK}
               data-testid="forge-pointcloud-normals-k"
               onChange={(e) => setOpt('normalsK', Number(e.target.value))}
               style={fieldStyle} />
      </Pass>
      <Pass label="Voxel-shell mesh" checked={opts.voxelMesh}
            onCheck={(v) => setOpt('voxelMesh', v)}>
        <span>leaf</span>
        <input type="number" step="0.1" value={opts.voxelMeshLeaf}
               data-testid="forge-pointcloud-mesh-leaf"
               onChange={(e) => setOpt('voxelMeshLeaf', Number(e.target.value))}
               style={fieldStyle} />
      </Pass>

      <button data-testid="forge-pointcloud-run" style={buttonStyle} onClick={onRun}>
        Run pipeline
      </button>

      {err && (
        <div data-testid="forge-pointcloud-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-pointcloud-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>before&nbsp;&nbsp;{result.stats0.pointCount} pts, density {result.stats0.density.toFixed(2)}</div>
          <div>after&nbsp;&nbsp;&nbsp;{result.statsAfter.pointCount} pts, density {result.statsAfter.density.toFixed(2)}</div>
          {result.normals && <div>normals&nbsp;{result.normals.length / 3} vectors</div>}
          {result.mesh && (
            <div>mesh&nbsp;&nbsp;&nbsp;&nbsp;{result.mesh.positions.length / 3} verts, {result.mesh.indices.length / 3} tris</div>
          )}
        </section>
      )}
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
             data-testid={`forge-pointcloud-cb-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} />
      <span style={{ flex: 1 }}>{label}</span>
      {children}
    </label>
  );
}

export function PointCloudWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPointCloudWorkbench  = () => setOpen(true);
    window.__forgeClosePointCloudWorkbench = () => setOpen(false);
    window.__forgePointCloudPipeline       = pointcloudPipeline;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.pointcloud' || id === 'workbench.pointcloud') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'pointcloud') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <PointCloudPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default PointCloudPanel;
