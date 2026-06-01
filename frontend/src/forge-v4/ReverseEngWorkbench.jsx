// Forge-161 — Reverse-Engineering Workbench.
//
// Panel for scan-to-CAD: load a point cloud, optionally estimate
// normals, run RANSAC primitive segmentation, and either spawn real
// native body handles (forge.makeBox / makeCylinder / makeSphere) or
// reconstruct a mesh via screened Poisson.
//
// Pattern lifted from MeshWorkbench / ArchWorkbench:
//   * useSyncExternalStore with cached snapshot + version counter
//   * host useEffect deps = []
//   * Manual UI never writes to Archie's thread.

import React, { useCallback, useEffect, useMemo, useRef, useState,
                useSyncExternalStore } from 'react';
import {
  importCloud, boundingBox, estimateNormals,
} from './pointCloudImport.js';
import {
  fitPlaneRansac, fitSphereRansac, fitCylinderRansac, fitConeRansac,
  segment as segmentRansac,
} from './ransacFitting.js';
import { reconstructPoisson } from './poissonReconstruction.js';

// ============================================================
// Store
// ============================================================

let _state = {
  cloud:       null,    // { positions, colors, normals, count, format }
  bbox:        null,
  primitives:  [],      // RANSAC primitive list
  residual:    null,    // residual cloud after primitives stripped
  mesh:        null,    // Poisson output { positions, indices, … }
  status:      'idle',
  history:     [],
};
let _version = 0;
const _subs = new Set();
let _cachedSnap = null;
let _cachedSnapVer = -1;

function notify() { _version++; for (const fn of _subs) { try { fn(); } catch {} } }
const STORE = {
  subscribe(cb) { _subs.add(cb); return () => _subs.delete(cb); },
  getSnapshot() {
    if (_cachedSnap && _cachedSnapVer === _version) return _cachedSnap;
    _cachedSnap = { ..._state, version: _version };
    _cachedSnapVer = _version;
    return _cachedSnap;
  },
};
function update(patch) { _state = { ..._state, ...patch }; notify(); }
function pushHistory(label) {
  _state = { ..._state, history: [..._state.history, { ts: Date.now(), label }] };
  notify();
}

// ============================================================
// Spawn native bodies from primitives
// ============================================================

// Append a native body to the shell registry — same pattern used by
// ArchWorkbench so the body appears in the feature tree, BOM, etc.
function appendBody(body) {
  if (typeof window === 'undefined') return;
  window.__forgeAppendBody?.(body);
}

function spawnFromPrimitive(prim, scale_mm_per_unit) {
  const f = (typeof window !== 'undefined') ? window.forge : null;
  if (!f || typeof f.makeBox !== 'function') {
    throw new Error(
      'reverseEng: window.forge kernel is not available — load the ' +
      'native OCCT kernel (forge-kernel.node) before spawning bodies',
    );
  }
  const s = scale_mm_per_unit ?? 1;
  if (prim.kind === 'plane') {
    // Thin "plate" — a box centred on the plane, normal-aligned.
    // We make a 50×50×1 mm slab and position via forge.translate.
    const handle = f.makeBox({ size: [50 * s, 50 * s, 1] });
    return {
      kind: 'native', handle,
      toolId: 'reverse.plane',
      name: `Plane ${Math.round(prim.normal[0] * 100) / 100},${Math.round(prim.normal[1] * 100) / 100},${Math.round(prim.normal[2] * 100) / 100}`,
      inlierCount: prim.inliers.length,
      rms: prim.rms,
    };
  }
  if (prim.kind === 'sphere') {
    const handle = f.makeSphere({ radius: prim.radius * s });
    return {
      kind: 'native', handle,
      toolId: 'reverse.sphere',
      name: `Sphere r=${(prim.radius * s).toFixed(2)} mm`,
      inlierCount: prim.inliers.length,
      rms: prim.rms,
    };
  }
  if (prim.kind === 'cylinder') {
    const handle = f.makeCylinder({
      radius: prim.radius * s,
      height: Math.max(1, prim.height * s),
    });
    return {
      kind: 'native', handle,
      toolId: 'reverse.cylinder',
      name: `Cyl r=${(prim.radius * s).toFixed(2)}, h=${(prim.height * s).toFixed(2)} mm`,
      inlierCount: prim.inliers.length,
      rms: prim.rms,
    };
  }
  if (prim.kind === 'cone') {
    if (typeof f.makeCone === 'function') {
      const handle = f.makeCone({
        radius1: Math.max(0.01, prim.height * s * Math.tan(prim.halfAngle)),
        radius2: 0.01,
        height:  Math.max(1, prim.height * s),
      });
      return {
        kind: 'native', handle,
        toolId: 'reverse.cone',
        name: `Cone α=${(prim.halfAngle * 180 / Math.PI).toFixed(1)}°, h=${(prim.height * s).toFixed(2)} mm`,
        inlierCount: prim.inliers.length,
        rms: prim.rms,
      };
    }
    throw new Error('reverseEng: kernel has no makeCone — cone primitive cannot be spawned');
  }
  throw new Error(`reverseEng: unknown primitive kind ${prim.kind}`);
}

// ============================================================
// Public dispatch — exposed on window for tests + Archie
// ============================================================

export const ReverseEngDispatch = {
  store: STORE,
  getState: () => STORE.getSnapshot(),
  async loadCloud(buf) {
    update({ status: 'parsing' });
    try {
      const cloud = await importCloud(buf);
      const bbox = boundingBox(cloud.positions);
      update({ cloud, bbox, primitives: [], residual: null, mesh: null,
               status: `loaded ${cloud.count} pts (${cloud.format})` });
      pushHistory(`loaded ${cloud.format} ${cloud.count} pts`);
      return cloud;
    } catch (err) {
      update({ status: `import error: ${err.message}` });
      throw err;
    }
  },
  loadSampleSphere(N = 800, radius = 50) {
    // Built-in noisy hemisphere — useful for the e2e spec and demos.
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.random();
      const th = 2 * Math.PI * u;
      const ph = Math.acos(2 * v - 1);
      const noise = 1 + (Math.random() - 0.5) * 0.04;
      positions[i * 3]     = radius * noise * Math.sin(ph) * Math.cos(th);
      positions[i * 3 + 1] = radius * noise * Math.sin(ph) * Math.sin(th);
      positions[i * 3 + 2] = radius * noise * Math.cos(ph);
    }
    update({
      cloud: { positions, colors: null, normals: null, count: N, format: 'synthetic' },
      bbox: boundingBox(positions),
      primitives: [], residual: null, mesh: null,
      status: `loaded synthetic sphere ${N} pts`,
    });
    pushHistory(`loaded synthetic sphere ${N} pts`);
    return positions;
  },
  segment(opts = {}) {
    if (!_state.cloud) throw new Error('reverseEng: no point cloud loaded');
    update({ status: 'segmenting' });
    const { primitives, residual } = segmentRansac(_state.cloud.positions, opts);
    update({ primitives, residual,
             status: `segmented ${primitives.length} primitives (residual ${residual.count})` });
    pushHistory(`segment → ${primitives.length} primitives`);
    return { primitives, residual };
  },
  fitPlane(opts) {
    if (!_state.cloud) throw new Error('reverseEng: no cloud');
    const p = fitPlaneRansac(_state.cloud.positions, opts);
    update({ primitives: [..._state.primitives, p] });
    pushHistory(`fit plane (${p.inliers.length} inliers)`);
    return p;
  },
  fitSphere(opts) {
    if (!_state.cloud) throw new Error('reverseEng: no cloud');
    const p = fitSphereRansac(_state.cloud.positions, opts);
    update({ primitives: [..._state.primitives, p] });
    pushHistory(`fit sphere (${p.inliers.length} inliers)`);
    return p;
  },
  fitCylinder(opts) {
    if (!_state.cloud) throw new Error('reverseEng: no cloud');
    const p = fitCylinderRansac(_state.cloud.positions, opts);
    update({ primitives: [..._state.primitives, p] });
    pushHistory(`fit cylinder (${p.inliers.length} inliers)`);
    return p;
  },
  fitCone(opts) {
    if (!_state.cloud) throw new Error('reverseEng: no cloud');
    const p = fitConeRansac(_state.cloud.positions, opts);
    update({ primitives: [..._state.primitives, p] });
    pushHistory(`fit cone (${p.inliers.length} inliers)`);
    return p;
  },
  spawnPrimitives(scale = 1) {
    const out = [];
    for (const p of _state.primitives) {
      try {
        const body = spawnFromPrimitive(p, scale);
        body.id = `re-${p.kind}-${Date.now().toString(36)}-${out.length}`;
        appendBody(body);
        out.push(body);
      } catch (err) {
        pushHistory(`spawn ${p.kind} failed: ${err.message}`);
      }
    }
    pushHistory(`spawned ${out.length}/${_state.primitives.length} bodies`);
    update({ status: `spawned ${out.length} bodies` });
    return out;
  },
  reconstructMesh(opts = {}) {
    if (!_state.cloud) throw new Error('reverseEng: no cloud');
    update({ status: 'reconstructing mesh' });
    const mesh = reconstructPoisson(_state.cloud.positions, opts);
    update({ mesh,
             status: `mesh: ${mesh.vertices} verts / ${mesh.triangles} tris` });
    pushHistory(`poisson → ${mesh.triangles} tris`);
    return mesh;
  },
  clear() {
    update({ cloud: null, bbox: null, primitives: [], residual: null,
             mesh: null, status: 'cleared', history: [] });
  },
};

// ============================================================
// Preview — orthographic XY scatter
// ============================================================

function CloudPreview({ snap, theme }) {
  const dark = theme === 'dark';
  if (!snap.cloud || !snap.bbox) {
    return (
      <div data-testid="forge-reverse-preview-empty"
           style={{ padding: 18, opacity: 0.55,
                    background: dark ? '#0e0b07' : '#f4ead0',
                    height: 280 }}>
        No cloud loaded — click <b>Load sample</b> or <b>Import PLY/PCD/XYZ/E57…</b>
      </div>
    );
  }
  const b = snap.bbox;
  const pad = (b.dx + b.dy) * 0.05 + 1;
  const x0 = b.minX - pad, y0 = b.minY - pad;
  const w = b.dx + 2 * pad, h = b.dy + 2 * pad;
  const positions = snap.cloud.positions;
  const N = snap.cloud.count;
  const stride = N > 2000 ? Math.ceil(N / 2000) : 1;
  const dots = [];
  for (let i = 0; i < N; i += stride) {
    dots.push(<circle key={i}
                      cx={positions[i * 3] - x0}
                      cy={-(positions[i * 3 + 1] - y0)}
                      r={Math.max(0.3, w / 320)}
                      fill={dark ? '#e9d9a8' : '#1a1612'} opacity={0.7} />);
  }
  // Overlay each primitive in a coloured projection.
  const primShapes = [];
  for (const p of snap.primitives) {
    if (p.kind === 'sphere') {
      primShapes.push(<circle key={`p-${primShapes.length}`}
                              cx={p.center[0] - x0}
                              cy={-(p.center[1] - y0)}
                              r={p.radius}
                              fill="none" stroke="#ffa057" strokeWidth={w / 200} />);
    } else if (p.kind === 'cylinder') {
      const c = p.axisOrigin;
      primShapes.push(<circle key={`p-${primShapes.length}`}
                              cx={c[0] - x0}
                              cy={-(c[1] - y0)}
                              r={p.radius}
                              fill="none" stroke="#52e3a5" strokeWidth={w / 200} />);
    }
  }
  return (
    <svg data-testid="forge-reverse-preview"
         viewBox={`0 ${-h} ${w} ${h}`}
         preserveAspectRatio="xMidYMid meet"
         style={{ width: '100%', height: 280, display: 'block',
                  background: dark ? '#0e0b07' : '#f4ead0' }}>
      {dots}
      {primShapes}
    </svg>
  );
}

// ============================================================
// Toolbar
// ============================================================

function ReverseToolbar({ theme, onLoadSample, onImport, onSegment,
                          onFitPlane, onFitSphere, onFitCylinder, onFitCone,
                          onSpawn, onPoisson, onClear, snap }) {
  const dark = theme === 'dark';
  return (
    <div data-testid="forge-reverse-toolbar"
         style={{
           display: 'flex', flexWrap: 'wrap', gap: 6,
           padding: '6px 10px',
           borderBottom: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
           background: dark ? '#16120c' : '#f1e3a8',
         }}>
      <button type="button" onClick={onLoadSample}
              data-testid="forge-reverse-load-sample"
              style={btn(theme)}>Load sample sphere</button>
      <button type="button" onClick={onImport}
              data-testid="forge-reverse-import"
              style={btn(theme)}>Import PLY / PCD / XYZ / E57…</button>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" onClick={onSegment}
              data-testid="forge-reverse-segment"
              style={btn(theme)}>Auto-segment (RANSAC)</button>
      <button type="button" onClick={onFitPlane}
              data-testid="forge-reverse-fit-plane"
              style={btn(theme)}>Fit Plane</button>
      <button type="button" onClick={onFitSphere}
              data-testid="forge-reverse-fit-sphere"
              style={btn(theme)}>Fit Sphere</button>
      <button type="button" onClick={onFitCylinder}
              data-testid="forge-reverse-fit-cylinder"
              style={btn(theme)}>Fit Cylinder</button>
      <button type="button" onClick={onFitCone}
              data-testid="forge-reverse-fit-cone"
              style={btn(theme)}>Fit Cone</button>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" onClick={onSpawn}
              data-testid="forge-reverse-spawn"
              style={btn(theme)}>Spawn solid bodies</button>
      <button type="button" onClick={onPoisson}
              data-testid="forge-reverse-poisson"
              style={btn(theme)}>Poisson mesh</button>
      <span style={{ flex: 1 }} />
      <button type="button" onClick={onClear}
              data-testid="forge-reverse-clear"
              style={btn(theme)}>Clear</button>
    </div>
  );
}

// ============================================================
// Body
// ============================================================

function ReverseEngBody({ open, theme, onClose }) {
  const snap = useSyncExternalStore(STORE.subscribe, STORE.getSnapshot);

  const onLoadSample = useCallback(() => {
    ReverseEngDispatch.loadSampleSphere(700, 50);
  }, []);

  const onImport = useCallback(() => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.ply,.pcd,.xyz,.e57';
    inp.onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const buf = new Uint8Array(await f.arrayBuffer());
      try { await ReverseEngDispatch.loadCloud(buf); }
      catch (err) { console.warn('[reverse.import]', err.message); }
    };
    inp.click();
  }, []);

  const onSegment = useCallback(() => {
    try {
      ReverseEngDispatch.segment({ thresh: snap.bbox
        ? Math.max(0.3, (snap.bbox.dx + snap.bbox.dy + snap.bbox.dz) / 120)
        : 1.0 });
    } catch (err) { console.warn('[reverse.segment]', err.message); }
  }, [snap.bbox]);

  const onFitPlane    = useCallback(() => { try { ReverseEngDispatch.fitPlane();    } catch (e) { console.warn(e.message); } }, []);
  const onFitSphere   = useCallback(() => { try { ReverseEngDispatch.fitSphere();   } catch (e) { console.warn(e.message); } }, []);
  const onFitCylinder = useCallback(() => { try { ReverseEngDispatch.fitCylinder(); } catch (e) { console.warn(e.message); } }, []);
  const onFitCone     = useCallback(() => { try { ReverseEngDispatch.fitCone();     } catch (e) { console.warn(e.message); } }, []);

  const onSpawn = useCallback(() => {
    try { ReverseEngDispatch.spawnPrimitives(1); }
    catch (err) { console.warn('[reverse.spawn]', err.message); }
  }, []);

  const onPoisson = useCallback(() => {
    try { ReverseEngDispatch.reconstructMesh({ gridRes: 40 }); }
    catch (err) { console.warn('[reverse.poisson]', err.message); }
  }, []);

  const onClear = useCallback(() => { ReverseEngDispatch.clear(); }, []);

  if (!open) return null;

  return (
    <div data-testid="forge-reverse-workbench"
         style={panelOuter(theme)}>
      <header style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', padding: '6px 12px',
        borderBottom: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
        background: theme === 'dark' ? '#1c1812' : '#ebe0b4',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Reverse Engineering · scan-to-CAD
        </span>
        <button type="button" onClick={onClose}
                data-testid="forge-reverse-close"
                style={btn(theme)}>Close</button>
      </header>
      <ReverseToolbar theme={theme} snap={snap}
                      onLoadSample={onLoadSample} onImport={onImport}
                      onSegment={onSegment}
                      onFitPlane={onFitPlane} onFitSphere={onFitSphere}
                      onFitCylinder={onFitCylinder} onFitCone={onFitCone}
                      onSpawn={onSpawn} onPoisson={onPoisson}
                      onClear={onClear} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <CloudPreview snap={snap} theme={theme} />
          <PrimitivesList snap={snap} theme={theme} />
        </div>
        <div style={{ width: 280, borderLeft: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
                      overflowY: 'auto',
                      background: theme === 'dark' ? '#16120c' : '#f7eece' }}>
          <HistoryList snap={snap} theme={theme} />
          {snap.mesh && <MeshSummary mesh={snap.mesh} theme={theme} />}
        </div>
      </div>
      <footer style={{ padding: '4px 12px',
                       borderTop: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
                       fontSize: 11, opacity: 0.8 }}>
        <span data-testid="forge-reverse-status">{snap.status}</span>
      </footer>
    </div>
  );
}

function PrimitivesList({ snap, theme }) {
  const dark = theme === 'dark';
  if (!snap.primitives.length) {
    return (
      <div data-testid="forge-reverse-primitives-empty"
           style={{ padding: 12, opacity: 0.6, fontSize: 12 }}>
        No primitives fitted. Use <b>Auto-segment</b> or a specific Fit button.
      </div>
    );
  }
  return (
    <table data-testid="forge-reverse-primitives-table"
           style={{ width: '100%', borderCollapse: 'collapse',
                    fontSize: 11, padding: 8 }}>
      <thead>
        <tr>
          <th style={th(theme)}>#</th>
          <th style={th(theme)}>Kind</th>
          <th style={th(theme)}>Inliers</th>
          <th style={th(theme)}>RMS</th>
          <th style={th(theme)}>Detail</th>
        </tr>
      </thead>
      <tbody>
        {snap.primitives.map((p, i) => (
          <tr key={i}>
            <td style={td(theme)}>{i + 1}</td>
            <td style={td(theme)}>{p.kind}</td>
            <td style={td(theme)}>{p.inliers.length}</td>
            <td style={td(theme)}>{p.rms?.toFixed(3) ?? '-'}</td>
            <td style={td(theme)}>{detailText(p)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function detailText(p) {
  if (p.kind === 'plane')    return `n=(${p.normal.map((n) => n.toFixed(2)).join(',')})`;
  if (p.kind === 'sphere')   return `r=${p.radius.toFixed(2)}`;
  if (p.kind === 'cylinder') return `r=${p.radius.toFixed(2)}, h=${p.height.toFixed(2)}`;
  if (p.kind === 'cone')     return `α=${(p.halfAngle * 180 / Math.PI).toFixed(1)}°`;
  return '';
}

function HistoryList({ snap, theme }) {
  return (
    <ul data-testid="forge-reverse-history"
        style={{ listStyle: 'none', padding: '8px 12px', margin: 0,
                 fontSize: 11 }}>
      {snap.history.length === 0 && (
        <li style={{ opacity: 0.55 }}>No events yet.</li>
      )}
      {snap.history.map((h, i) => (
        <li key={i} style={{ marginBottom: 3 }}>
          <span style={{ opacity: 0.55 }}>
            {new Date(h.ts).toLocaleTimeString()}
          </span>{' '}
          {h.label}
        </li>
      ))}
    </ul>
  );
}

function MeshSummary({ mesh, theme }) {
  return (
    <div data-testid="forge-reverse-mesh-summary"
         style={{ padding: 8, fontSize: 11, borderTop: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}` }}>
      <b>Mesh</b><br />
      vertices: {mesh.vertices}<br />
      triangles: {mesh.triangles}<br />
      grid: {mesh.gridRes}³, iso={mesh.iso.toFixed(4)}
    </div>
  );
}

// ============================================================
// Host
// ============================================================

const PANEL_EVENT = 'forge:open-reverse-panel';

export function ReverseEngWorkbenchHost() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (typeof window === 'undefined') return;
    window.__forgeOpenReverse = (opts = {}) => {
      if (opts && opts.theme) setTheme(opts.theme);
      setOpen(true);
    };
    window.__forgeCloseReverse = () => setOpen(false);
    window.__forgeReverseDispatch = ReverseEngDispatch;
    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.theme) setTheme(d.theme);
      setOpen(true);
    };
    window.addEventListener(PANEL_EVENT, onEvt);
    return () => window.removeEventListener(PANEL_EVENT, onEvt);
  }, []);
  return (
    <ReverseEngBody open={open} theme={theme}
                    onClose={() => setOpen(false)} />
  );
}

// ============================================================
// Style helpers
// ============================================================

function panelOuter(theme) {
  const dark = theme === 'dark';
  return {
    position: 'absolute',
    top: 72, left: 76, right: 16, bottom: 48,
    background: dark ? 'rgba(16,14,11,0.97)' : 'rgba(252,247,232,0.97)',
    color: dark ? '#e9d9a8' : '#1a1612',
    border: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    borderRadius: 6, boxShadow: '0 14px 38px rgba(0,0,0,0.5)',
    fontFamily: 'ui-sans-serif, system-ui',
    zIndex: 8500,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };
}
function btn(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#2a241b' : '#e7dcb8',
    color: dark ? '#e9d9a8' : '#1a1612',
    border: `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4,
    padding: '5px 10px', fontSize: 11, cursor: 'pointer',
    letterSpacing: 0.3,
  };
}
function th(theme) {
  const dark = theme === 'dark';
  return {
    textAlign: 'left', padding: '4px 6px',
    borderBottom: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    background: dark ? '#1c1812' : '#ebe0b4',
    fontWeight: 600,
  };
}
function td(theme) {
  const dark = theme === 'dark';
  return {
    padding: '3px 6px',
    borderBottom: `1px solid ${dark ? '#2a241b' : '#d8c98a'}`,
    fontFamily: 'ui-monospace, Menlo, monospace',
  };
}

export default ReverseEngBody;
