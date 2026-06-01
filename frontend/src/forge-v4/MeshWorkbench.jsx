// Forge-151 — Mesh Workbench.
//
// Polygonal-mesh tools panel + Host. Pattern matches
// WeldmentsWorkbench / ManufacturingWorkbench:
//   * a `MeshWorkbenchHost` mounted from App.jsx self-shows on
//     `[data-wb="mesh"]` rail clicks, `forge:open-mesh-panel`
//     custom events, and the imperative `window.__forgeOpenMesh()`.
//   * Manual UI never writes to Archie's thread.
//
// Workflow:
//   1. Convert solid → mesh (window.forge.tessellate).
//   2. Decimate / Smooth / Fill / Repair / Boolean / Remesh /
//      Simplify / Subdivide.
//   3. Convert mesh → solid (forge.io.writeTmpStl + forge.io.importStl)
//      which then surfaces as a native body in the feature tree.
//
// React #185 hygiene:
//   * `useSyncExternalStore` snapshots are memoised against a numeric
//     version counter — same reference returned when nothing changed.
//   * The host's `useEffect` deps array is a constant `[]`; we attach
//     and detach listeners exactly once, like every other Forge host.

import React, { useCallback, useEffect, useMemo, useRef, useState,
                useSyncExternalStore } from 'react';
import { MeshDispatch } from './meshDispatch.js';

/* -------------------------------------------------------------- */
/*  small mesh store                                              */
/* -------------------------------------------------------------- */
//
// We need to drive a Three.js viewport-side preview from React state,
// and we also want a window-side handle so tests can read the current
// mesh. The lightest way to do both without churning React on every
// pixel-level mouse-event is a tiny external store with a cached
// snapshot.

let _state = {
  mesh:    null,         // { positions: Float32Array, indices: Uint32Array }
  source:  null,         // { kind: 'native', handle: number } | { kind: 'manual' }
  history: [],           // [{ tool, before: {v,t}, after: {v,t}, ts }]
  pending: null,         // last error / progress string
};
let _version = 0;
const _subs = new Set();
let _cachedSnap = null;
let _cachedSnapVer = -1;

function notify() {
  _version++;
  for (const fn of _subs) { try { fn(); } catch {} }
}

function meshStore() {
  return {
    subscribe(cb) { _subs.add(cb); return () => _subs.delete(cb); },
    getSnapshot() {
      if (_cachedSnap && _cachedSnapVer === _version) return _cachedSnap;
      _cachedSnap = {
        mesh:    _state.mesh,
        source:  _state.source,
        history: _state.history,
        pending: _state.pending,
        stats:   _state.mesh ? MeshDispatch.meshStats(_state.mesh) : null,
        version: _version,
      };
      _cachedSnapVer = _version;
      return _cachedSnap;
    },
  };
}
const STORE = meshStore();

function setMesh(mesh, source) {
  _state = {
    ..._state,
    mesh,
    source: source ?? _state.source,
  };
  notify();
}
function setPending(msg) {
  _state = { ..._state, pending: msg };
  notify();
}
function pushHistory(rec) {
  _state = { ..._state, history: [..._state.history, rec] };
  notify();
}

/* -------------------------------------------------------------- */
/*  body picker — finds the most recent native body                */
/* -------------------------------------------------------------- */

function pickActiveBody() {
  if (typeof window === 'undefined') return null;
  const bodies = window.__forgeBodies;
  if (!Array.isArray(bodies)) return null;
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (b && b.kind === 'native' && typeof b.handle === 'number') return b;
  }
  return null;
}

/* -------------------------------------------------------------- */
/*  toolbar                                                       */
/* -------------------------------------------------------------- */

function MeshToolbar({
  theme,
  onConvertFromSolid,
  onConvertToSolid,
  onDecimate, decimateTarget, setDecimateTarget,
  onSmoothLap, smoothIter, setSmoothIter, smoothLambda, setSmoothLambda,
  onSmoothTaubin,
  onFillHoles,
  onRepair,
  onBoolean, booleanOp, setBooleanOp,
  onRemesh, remeshEdgeLen, setRemeshEdgeLen,
  onSimplify, simplifyVoxel, setSimplifyVoxel,
  onSubdivLoop, onSubdivCC,
  manifoldReady,
}) {
  const sel = selBase(theme);
  const inp = { ...sel, width: 70 };
  return (
    <div className="forge-mesh-toolbar"
         data-testid="forge-mesh-toolbar"
         style={{ display: 'flex', flexWrap: 'wrap', gap: 6,
                  padding: '6px 10px', alignItems: 'center',
                  borderBottom: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}` }}>
      <button type="button" data-tool="mesh.fromSolid"
              data-testid="forge-mesh-tool-from-solid"
              onClick={onConvertFromSolid} style={btnBase(theme)}>
        Solid → Mesh
      </button>
      <button type="button" data-tool="mesh.toSolid"
              data-testid="forge-mesh-tool-to-solid"
              onClick={onConvertToSolid} style={btnBase(theme)}>
        Mesh → Solid
      </button>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" data-tool="mesh.decimate"
              data-testid="forge-mesh-tool-decimate"
              onClick={onDecimate} style={btnBase(theme)}>
        Decimate
      </button>
      <label style={{ display: 'inline-flex', gap: 4, fontSize: 11, alignItems: 'center' }}>
        <span style={{ opacity: 0.6 }}>target tris</span>
        <input type="number" min={10} step={50}
               value={decimateTarget}
               data-testid="forge-mesh-decimate-target"
               onChange={(e) => setDecimateTarget(Math.max(10, parseInt(e.target.value, 10) || 200))}
               style={inp} />
      </label>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" data-tool="mesh.smooth.laplacian"
              data-testid="forge-mesh-tool-smooth-lap"
              onClick={onSmoothLap} style={btnBase(theme)}>
        Smooth Laplacian
      </button>
      <button type="button" data-tool="mesh.smooth.taubin"
              data-testid="forge-mesh-tool-smooth-taubin"
              onClick={onSmoothTaubin} style={btnBase(theme)}>
        Smooth Taubin
      </button>
      <label style={{ display: 'inline-flex', gap: 4, fontSize: 11, alignItems: 'center' }}>
        <span style={{ opacity: 0.6 }}>iters</span>
        <input type="number" min={1} max={50} value={smoothIter}
               data-testid="forge-mesh-smooth-iter"
               onChange={(e) => setSmoothIter(Math.max(1, parseInt(e.target.value, 10) || 5))}
               style={{ ...inp, width: 50 }} />
      </label>
      <label style={{ display: 'inline-flex', gap: 4, fontSize: 11, alignItems: 'center' }}>
        <span style={{ opacity: 0.6 }}>λ</span>
        <input type="number" min={0} max={1} step={0.05} value={smoothLambda}
               data-testid="forge-mesh-smooth-lambda"
               onChange={(e) => setSmoothLambda(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0.5)))}
               style={{ ...inp, width: 60 }} />
      </label>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" data-tool="mesh.fill"
              data-testid="forge-mesh-tool-fill"
              onClick={onFillHoles} style={btnBase(theme)}>
        Fill Holes
      </button>
      <button type="button" data-tool="mesh.repair"
              data-testid="forge-mesh-tool-repair"
              onClick={onRepair} style={btnBase(theme)}>
        Repair
      </button>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" data-tool="mesh.boolean"
              data-testid="forge-mesh-tool-boolean"
              onClick={onBoolean} style={btnBase(theme)}>
        Boolean
      </button>
      <select value={booleanOp}
              data-testid="forge-mesh-boolean-op"
              onChange={(e) => setBooleanOp(e.target.value)} style={sel}>
        <option value="union">Union</option>
        <option value="cut">Cut</option>
        <option value="intersect">Intersect</option>
      </select>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" data-tool="mesh.remesh"
              data-testid="forge-mesh-tool-remesh"
              onClick={onRemesh} style={btnBase(theme)}>
        Remesh
      </button>
      <label style={{ display: 'inline-flex', gap: 4, fontSize: 11, alignItems: 'center' }}>
        <span style={{ opacity: 0.6 }}>edge len</span>
        <input type="number" min={0.1} step={0.5} value={remeshEdgeLen}
               data-testid="forge-mesh-remesh-edge"
               onChange={(e) => setRemeshEdgeLen(Math.max(0.1, parseFloat(e.target.value) || 5))}
               style={{ ...inp, width: 60 }} />
      </label>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" data-tool="mesh.simplify"
              data-testid="forge-mesh-tool-simplify"
              onClick={onSimplify} style={btnBase(theme)}>
        Simplify (cluster)
      </button>
      <label style={{ display: 'inline-flex', gap: 4, fontSize: 11, alignItems: 'center' }}>
        <span style={{ opacity: 0.6 }}>voxel</span>
        <input type="number" min={0.1} step={0.5} value={simplifyVoxel}
               data-testid="forge-mesh-simplify-voxel"
               onChange={(e) => setSimplifyVoxel(Math.max(0.1, parseFloat(e.target.value) || 5))}
               style={{ ...inp, width: 60 }} />
      </label>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" data-tool="mesh.subdiv.loop"
              data-testid="forge-mesh-tool-subdiv-loop"
              onClick={onSubdivLoop} style={btnBase(theme)}>
        Subdivide · Loop
      </button>
      <button type="button" data-tool="mesh.subdiv.cc"
              data-testid="forge-mesh-tool-subdiv-cc"
              onClick={onSubdivCC} style={btnBase(theme)}>
        Subdivide · Catmull-Clark
      </button>
      <span style={{ flex: 1 }} />
      <span data-testid="forge-mesh-manifold-state"
            style={{ fontSize: 11, opacity: 0.6 }}>
        manifold-3d: {manifoldReady ? 'ready' : 'loading…'}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------- */
/*  SVG preview — orthographic XY projection                       */
/* -------------------------------------------------------------- */

function MeshPreview({ mesh, theme }) {
  const dark = theme === 'dark';
  const stroke = dark ? '#e9d9a8' : '#1a1612';
  const fill   = dark ? 'rgba(150,108,42,0.20)' : 'rgba(180,130,48,0.30)';
  if (!mesh || mesh.indices.length === 0) {
    return (
      <div data-testid="forge-mesh-preview-empty"
           style={{ padding: 24, opacity: 0.5, fontSize: 12,
                    background: dark ? '#0d0a06' : '#f0e6c0', height: 240 }}>
        No mesh loaded — click <b>Solid → Mesh</b> to start.
      </div>
    );
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i], y = mesh.positions[i+1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) { minX = -1; maxX = 1; minY = -1; maxY = 1; }
  const pad = (maxX - minX) * 0.1 + 4;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const w = maxX - minX, h = maxY - minY;
  // Throttle drawing for big meshes — sample every nth triangle.
  const triCount = mesh.indices.length / 3;
  const stride = triCount > 800 ? Math.ceil(triCount / 800) : 1;
  const polys = [];
  for (let t = 0; t < mesh.indices.length; t += 3 * stride) {
    const a = mesh.indices[t], b = mesh.indices[t+1], c = mesh.indices[t+2];
    polys.push(`${mesh.positions[3*a]},${-mesh.positions[3*a+1]} ` +
               `${mesh.positions[3*b]},${-mesh.positions[3*b+1]} ` +
               `${mesh.positions[3*c]},${-mesh.positions[3*c+1]}`);
  }
  return (
    <svg className="forge-mesh-preview"
         data-testid="forge-mesh-preview"
         viewBox={`${minX} ${-maxY} ${w} ${h}`}
         preserveAspectRatio="xMidYMid meet"
         style={{ width: '100%', height: 280, display: 'block',
                  background: dark ? '#0d0a06' : '#f0e6c0' }}>
      {polys.map((pts, i) => (
        <polygon key={i} points={pts} fill={fill} stroke={stroke}
                 strokeWidth={Math.max(0.05, (w + h) / 1500)}
                 vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/* -------------------------------------------------------------- */
/*  history list                                                  */
/* -------------------------------------------------------------- */

function HistoryList({ history, theme }) {
  if (history.length === 0) {
    return (
      <div style={{ padding: '6px 12px', fontSize: 11, opacity: 0.6 }}
           data-testid="forge-mesh-history-empty">
        no history
      </div>
    );
  }
  return (
    <ol data-testid="forge-mesh-history"
        style={{ margin: 0, padding: '4px 24px', maxHeight: 140,
                 overflow: 'auto', fontSize: 11, opacity: 0.85 }}>
      {history.map((h, i) => (
        <li key={i} data-history-row data-tool={h.tool}>
          <code>{h.tool}</code>
          <span style={{ opacity: 0.6 }}>
            {' '}· {h.before.t}→{h.after.t} tris
            {' '}· {h.before.v}→{h.after.v} verts
            {h.note ? ` · ${h.note}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------- */
/*  workbench                                                     */
/* -------------------------------------------------------------- */

export function MeshWorkbench({ open = true, theme = 'dark', onClose }) {
  // External-store snapshot — reference-stable.
  const snap = useSyncExternalStore(STORE.subscribe, STORE.getSnapshot,
                                    STORE.getSnapshot);

  const [decimateTarget, setDecimateTarget] = useState(200);
  const [smoothIter,     setSmoothIter]     = useState(5);
  const [smoothLambda,   setSmoothLambda]   = useState(0.5);
  const [booleanOp,      setBooleanOp]      = useState('union');
  const [remeshEdgeLen,  setRemeshEdgeLen]  = useState(5);
  const [simplifyVoxel,  setSimplifyVoxel]  = useState(5);
  const [manifoldReady, setManifoldReady]   = useState(MeshDispatch.manifoldReady());

  // Kick off manifold-3d init exactly once. Re-render via state when
  // it lands so the toolbar label flips to "ready".
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    MeshDispatch.ensureManifold().then(() => setManifoldReady(true))
      .catch((err) => setPending(`manifold-3d init failed: ${err.message}`));
  }, []);

  // Publish current mesh + dispatch hooks on window so e2e tests can
  // poke without going through React.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeMesh = snap.mesh;
    window.__forgeMeshStats = snap.stats;
    window.__forgeMeshHistory = snap.history;
  }, [snap]);

  // --- ops ----------------------------------------------------------

  const runWithBefore = useCallback((toolId, fn, note) => {
    if (!_state.mesh) {
      setPending('Convert a solid first (Solid → Mesh).');
      return null;
    }
    const before = MeshDispatch.meshStats(_state.mesh);
    try {
      const result = fn(_state.mesh);
      if (result && typeof result.then === 'function') {
        return result.then((out) => {
          if (!out) return null;
          const after = MeshDispatch.meshStats(out);
          setMesh(out);
          pushHistory({ tool: toolId, before, after, ts: Date.now(), note });
          setPending(`${toolId} · ${after.triangles} tris`);
          return out;
        }).catch((err) => {
          setPending(`${toolId} failed: ${err.message}`);
          return null;
        });
      }
      const after = MeshDispatch.meshStats(result);
      setMesh(result);
      pushHistory({ tool: toolId, before, after, ts: Date.now(), note });
      setPending(`${toolId} · ${after.triangles} tris`);
      return result;
    } catch (err) {
      setPending(`${toolId} failed: ${err.message}`);
      return null;
    }
  }, []);

  const convertFromSolid = useCallback(() => {
    const body = pickActiveBody();
    if (!body) {
      setPending('No native body to tessellate — create one first.');
      return;
    }
    try {
      const mesh = MeshDispatch.tessellateNativeBody(body.handle, 0.1, 0.5);
      const before = { vertices: 0, triangles: 0 };
      const after  = MeshDispatch.meshStats(mesh);
      setMesh(mesh, { kind: 'native', handle: body.handle });
      pushHistory({ tool: 'mesh.fromSolid', before, after, ts: Date.now(),
                    note: `body ${body.handle}` });
      setPending(`Solid → Mesh · ${after.triangles} tris`);
    } catch (err) {
      setPending(`Solid → Mesh failed: ${err.message}`);
    }
  }, []);

  const convertToSolid = useCallback(async () => {
    if (!_state.mesh) {
      setPending('No mesh to convert.');
      return;
    }
    try {
      const handle = await MeshDispatch.meshToSolidViaStl(_state.mesh, 'forge-mesh-out');
      // Surface as a new native body in the shell.
      if (typeof window !== 'undefined' && typeof window.__forgeAppendBody === 'function') {
        window.__forgeAppendBody({
          id: `mesh-solid-${Date.now()}`,
          handle,
          kind: 'native',
          label: `Mesh → Solid (${MeshDispatch.meshStats(_state.mesh).triangles} tris)`,
        });
      }
      setPending(`Mesh → Solid · handle ${handle}`);
      pushHistory({ tool: 'mesh.toSolid',
        before: MeshDispatch.meshStats(_state.mesh),
        after:  MeshDispatch.meshStats(_state.mesh),
        ts: Date.now(), note: `handle ${handle}` });
    } catch (err) {
      setPending(`Mesh → Solid failed: ${err.message}`);
    }
  }, []);

  const decimate    = useCallback(() => runWithBefore(
    'mesh.decimate',
    (m) => MeshDispatch.decimateQEM(m, decimateTarget),
    `target ${decimateTarget}`,
  ), [decimateTarget, runWithBefore]);
  const smoothLap   = useCallback(() => runWithBefore(
    'mesh.smooth.laplacian',
    (m) => MeshDispatch.smoothLaplacian(m, smoothIter, smoothLambda),
    `iters ${smoothIter} λ ${smoothLambda}`,
  ), [smoothIter, smoothLambda, runWithBefore]);
  const smoothTaubin = useCallback(() => runWithBefore(
    'mesh.smooth.taubin',
    (m) => MeshDispatch.smoothTaubin(m, smoothIter),
    `iters ${smoothIter}`,
  ), [smoothIter, runWithBefore]);
  const fillHoles   = useCallback(() => runWithBefore(
    'mesh.fill',
    (m) => MeshDispatch.fillHoles(m),
  ), [runWithBefore]);
  const repair      = useCallback(() => runWithBefore(
    'mesh.repair',
    (m) => MeshDispatch.repairSelfIntersect(m),
  ), [runWithBefore]);
  const boolean     = useCallback(() => {
    // Use the *current mesh* as A and a unit cube as B; that lets the
    // operator be exercised even from a single body. Real users
    // assemble B from a second mesh in the feature tree.
    const cube = {
      positions: new Float32Array([
        -10,-10,-10,  10,-10,-10,  10,10,-10, -10,10,-10,
        -10,-10, 10,  10,-10, 10,  10,10, 10, -10,10, 10,
      ]),
      indices: new Uint32Array([
        0,2,1, 0,3,2,  4,5,6, 4,6,7,
        0,1,5, 0,5,4,  1,2,6, 1,6,5,
        2,3,7, 2,7,6,  3,0,4, 3,4,7,
      ]),
    };
    return runWithBefore(
      `mesh.boolean.${booleanOp}`,
      (m) => MeshDispatch.meshBoolean(m, cube, booleanOp),
      `op ${booleanOp}`,
    );
  }, [booleanOp, runWithBefore]);
  const remesh      = useCallback(() => runWithBefore(
    'mesh.remesh',
    (m) => MeshDispatch.remeshUniform(m, remeshEdgeLen),
    `edge ${remeshEdgeLen}`,
  ), [remeshEdgeLen, runWithBefore]);
  const simplify    = useCallback(() => runWithBefore(
    'mesh.simplify',
    (m) => MeshDispatch.simplifyClustering(m, simplifyVoxel),
    `voxel ${simplifyVoxel}`,
  ), [simplifyVoxel, runWithBefore]);
  const subdivLoop  = useCallback(() => runWithBefore(
    'mesh.subdiv.loop', (m) => MeshDispatch.subdivideLoop(m),
  ), [runWithBefore]);
  const subdivCC    = useCallback(() => runWithBefore(
    'mesh.subdiv.cc', (m) => MeshDispatch.subdivideCatmullClark(m),
  ), [runWithBefore]);

  if (!open) return null;

  return (
    <div className="forge-mesh-workbench"
         data-testid="forge-mesh"
         data-theme={theme}
         style={panelOuter(theme)}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12,
                       padding: '8px 12px',
                       borderBottom: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}` }}>
        <span data-testid="forge-mesh-title"
              style={{ fontWeight: 600, letterSpacing: 0.6 }}>Mesh</span>
        <span data-testid="forge-mesh-stats"
              style={{ opacity: 0.7, fontSize: 11 }}>
          {snap.stats
            ? `${snap.stats.triangles} tris · ${snap.stats.vertices} verts`
            : 'no mesh'}
        </span>
        <span style={{ flex: 1 }} />
        {onClose ? (
          <button type="button"
                  data-tool="mesh.close"
                  data-testid="forge-mesh-close"
                  onClick={onClose} style={btnBase(theme)}>Close</button>
        ) : null}
      </header>

      <MeshToolbar
        theme={theme}
        onConvertFromSolid={convertFromSolid}
        onConvertToSolid={convertToSolid}
        onDecimate={decimate}
        decimateTarget={decimateTarget} setDecimateTarget={setDecimateTarget}
        onSmoothLap={smoothLap}
        onSmoothTaubin={smoothTaubin}
        smoothIter={smoothIter} setSmoothIter={setSmoothIter}
        smoothLambda={smoothLambda} setSmoothLambda={setSmoothLambda}
        onFillHoles={fillHoles}
        onRepair={repair}
        onBoolean={boolean}
        booleanOp={booleanOp} setBooleanOp={setBooleanOp}
        onRemesh={remesh}
        remeshEdgeLen={remeshEdgeLen} setRemeshEdgeLen={setRemeshEdgeLen}
        onSimplify={simplify}
        simplifyVoxel={simplifyVoxel} setSimplifyVoxel={setSimplifyVoxel}
        onSubdivLoop={subdivLoop}
        onSubdivCC={subdivCC}
        manifoldReady={manifoldReady}
      />

      <MeshPreview mesh={snap.mesh} theme={theme} />

      <HistoryList history={snap.history} theme={theme} />

      <footer style={{ padding: '6px 12px',
                       borderTop: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
                       fontSize: 11, opacity: 0.8,
                       display: 'flex', gap: 16, alignItems: 'center' }}>
        <span data-testid="forge-mesh-status">{snap.pending || 'idle'}</span>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------- */
/*  host — auto-opens on mesh tab + window event                   */
/* -------------------------------------------------------------- */

const MESH_PANEL_EVENT = 'forge:open-mesh-panel';

export function MeshWorkbenchHost() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (typeof window === 'undefined') return;
    window.__forgeOpenMesh = (opts = {}) => {
      if (opts && opts.theme) setTheme(opts.theme);
      setOpen(true);
    };
    window.__forgeCloseMesh = () => setOpen(false);
    // Expose the public dispatch + store hooks for tests / Archie.
    window.__forgeMeshDispatch = MeshDispatch;
    window.__forgeMeshStore = STORE;
    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.theme) setTheme(d.theme);
      setOpen(true);
    };
    window.addEventListener(MESH_PANEL_EVENT, onEvt);
    const onClick = (e) => {
      const tab = e.target?.closest?.('[data-wb="mesh"]');
      if (tab) {
        const t = window.__forgeTheme;
        if (t === 'dark' || t === 'light') setTheme(t);
        setOpen(true);
      }
    };
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener(MESH_PANEL_EVENT, onEvt);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  return (
    <MeshWorkbench open={open}
                   theme={theme}
                   onClose={() => setOpen(false)} />
  );
}

/* -------------------------------------------------------------- */
/*  styling                                                       */
/* -------------------------------------------------------------- */

function panelOuter(theme) {
  const dark = theme === 'dark';
  return {
    position: 'absolute',
    top:      72,
    left:     76,
    right:    16,
    bottom:   48,
    background:  dark ? 'rgba(16,14,11,0.97)' : 'rgba(252,247,232,0.97)',
    color:       dark ? '#e9d9a8' : '#1a1612',
    border:      `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    borderRadius: 6,
    boxShadow:   '0 14px 38px rgba(0,0,0,0.5)',
    fontFamily:  'ui-sans-serif, system-ui',
    zIndex:      8500,
    display:     'flex',
    flexDirection: 'column',
    overflow:    'hidden',
  };
}

function btnBase(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#2a241b' : '#e7dcb8',
    color:      dark ? '#e9d9a8' : '#1a1612',
    border:     `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4,
    padding:    '5px 12px',
    fontSize:   12,
    cursor:     'pointer',
    letterSpacing: 0.3,
  };
}
function selBase(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#1c1812' : '#f0e6c0',
    color:      dark ? '#e9d9a8' : '#1a1612',
    border:     `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4,
    padding:    '3px 6px',
    fontSize:   11,
  };
}

export default MeshWorkbench;
