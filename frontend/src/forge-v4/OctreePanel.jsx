// PUSH-164 (Slice-120 / OctreePanel — spatial index stats for frustum culling).
//
// The OctreeIndex (octreeIndex.js) builds a recursive bounding-volume
// hierarchy over `window.__forgeBodies` and lets the renderer ask
// "which bodies intersect the current camera frustum?" in O(log N + visible)
// instead of the O(N) THREE.Object3D.frustumCulled scan that the
// default viewport runs.
//
// OctreePanel is the operator-facing console for that index:
//
//   • Header — title + body count + Rebuild + Close.
//   • Build params — slider for maxDepth (1..10) and a slider for
//     maxLeafSize (1..64). Rebuild on release.
//   • Index stats chip grid — nodes built, leaf count, max realised
//     depth, total bodies indexed, last build ms, last query ms.
//   • Live cull chip — last visible vs last culled (each query frame).
//   • FPS chip — runs its own 500 ms RAF sampler so the user can see
//     whether the cull is keeping the frame budget happy.
//   • Per-frame "synthetic query" — the panel spins a virtual camera
//     around the scene at 0.6 rad/s and runs queryFrustum() each
//     frame against the live planes so the stats stay live even when
//     the user isn't actually moving the main viewport camera. This
//     also doubles as the deterministic surface the e2e drives.
//
// All counters mirror onto:
//   window.__forgeOctreeStats           — the latest stats snapshot.
//   forge:octree-rebuilt    custom event
//   forge:octree-queried    custom event
// so Archie / sibling panels / e2e can subscribe without scraping
// the DOM.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  OctreeIndex,
  getOctreeIndex,
  installOctreeWindowApi,
} from './octreeIndex.js';

// Sampling cadence for the FPS chip + the synthetic-camera tick.
const SAMPLE_INTERVAL_MS = 500;
const ORBIT_RAD_PER_SEC  = 0.6;

// ─────────────────────────────────────────────────────────────────────
// Styles. Matches the BigSceneStress + Diagnostic Dump tokens so the
// panel reads as a native right-docked Forge surface.

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460,
  zIndex: 1330,
  background: 'var(--forge-canvas-2, #131820)',
  borderLeft: '1px solid var(--forge-rail-edge, #1f2a37)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #ebecef)', fontSize: 12,
  overflow: 'hidden',
};
const headerStyle = {
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 8,
};
const closeBtn = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
  color: 'var(--forge-ink, #ebecef)', cursor: 'pointer',
  padding: '2px 8px', borderRadius: 3, fontSize: 14,
  lineHeight: '16px',
};
const helpStyle = {
  color: 'var(--forge-ink-mute, #8a93a0)', lineHeight: 1.45, fontSize: 11,
};
const sliderRowStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const bigBtnStyle = {
  background: 'var(--forge-accent, #2e7be0)',
  color: '#fff',
  border: '1px solid var(--forge-accent, #2e7be0)',
  padding: '8px 12px',
  cursor: 'pointer',
  fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
  fontWeight: 600,
  fontSize: 12,
  borderRadius: 4,
  textAlign: 'center',
  flex: 1,
};
const altBtnStyle = {
  ...bigBtnStyle,
  background: 'transparent',
  color: 'var(--forge-ink, #ebecef)',
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
};
const statsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 6,
  fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
  fontSize: 11,
};
const chipStyle = {
  background: 'var(--forge-surface, #1a212c)',
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
  borderRadius: 4,
  padding: '6px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
const chipLabel = {
  color: 'var(--forge-ink-mute, #8a93a0)',
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em',
};
const chipValue = {
  color: 'var(--forge-ink, #ebecef)',
  fontSize: 14, fontWeight: 600,
};

// ─────────────────────────────────────────────────────────────────────
// Synthetic camera for the live cull tick.
//
// We don't want to depend on the main viewport's r3f camera here —
// per the Forge feedback "window APIs no setState" rule, panels must
// not touch the React state of the viewport. Instead we maintain our
// own 4×4 projection + view matrix and orbit them around the scene
// at ORBIT_RAD_PER_SEC. queryFrustum is fed the planes derived from
// this camera each tick.

function makeProjectionMatrixElements(fovDeg, aspect, near, far) {
  const fovRad = fovDeg * Math.PI / 180;
  const f = 1 / Math.tan(fovRad / 2);
  const nf = 1 / (near - far);
  // Column-major (matches THREE.Matrix4.elements layout).
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0,
  ];
}

function makeViewMatrixElements(eye, target, up) {
  const fx = target[0] - eye[0];
  const fy = target[1] - eye[1];
  const fz = target[2] - eye[2];
  let flen = Math.hypot(fx, fy, fz) || 1;
  const fnx = fx / flen, fny = fy / flen, fnz = fz / flen;
  // s = f × up.
  const sx = fny * up[2] - fnz * up[1];
  const sy = fnz * up[0] - fnx * up[2];
  const sz = fnx * up[1] - fny * up[0];
  let slen = Math.hypot(sx, sy, sz) || 1;
  const snx = sx / slen, sny = sy / slen, snz = sz / slen;
  // u = s × f.
  const ux = sny * fnz - snz * fny;
  const uy = snz * fnx - snx * fnz;
  const uz = snx * fny - sny * fnx;
  // Column-major view matrix (look-at).
  return [
    snx,            ux,             -fnx,           0,
    sny,            uy,             -fny,           0,
    snz,            uz,             -fnz,           0,
    -(snx * eye[0] + sny * eye[1] + snz * eye[2]),
    -(ux  * eye[0] + uy  * eye[1] + uz  * eye[2]),
     (fnx * eye[0] + fny * eye[1] + fnz * eye[2]),
    1,
  ];
}

function syntheticCameraPlanes(t, orbit) {
  const r = orbit;
  const eye    = [Math.cos(t) * r, Math.sin(t) * r, r * 0.6];
  const target = [0, 0, 0];
  const up     = [0, 0, 1];
  const pm = makeProjectionMatrixElements(60, 16 / 9, 1, 5000);
  const vm = makeViewMatrixElements(eye, target, up);
  return OctreeIndex.planesFromCamera({
    projectionMatrix: { elements: pm },
    matrixWorldInverse: { elements: vm },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function OctreePanel({ open, onClose }) {
  const [maxDepth, setMaxDepth] = useState(6);
  const [maxLeafSize, setMaxLeafSize] = useState(16);
  const [statusText, setStatusText] = useState('Idle — click Rebuild to index __forgeBodies.');
  const [stats, setStats] = useState(() => ({
    bodyCount: 0, nodeCount: 0, leafCount: 0, maxDepth: 0,
    buildMs: 0, lastQueryMs: 0, lastVisible: 0, lastCulled: 0, fps: 0,
  }));
  const [live, setLive] = useState(true);
  const [orbitRadius, setOrbitRadius] = useState(300);

  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const sampleTickRef = useRef(0);
  const orbitTRef = useRef(0);
  const frameTimesRef = useRef([]);
  const idxRef = useRef(null);

  // Ensure the singleton + window surface are mounted (idempotent so
  // repeat opens are cheap).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    idxRef.current = installOctreeWindowApi({ maxDepth, maxLeafSize }) || getOctreeIndex();
    // Reflect the current stats snapshot so the chip grid isn't all
    // zeros when the user opens a panel after the index was already
    // built by a sibling caller.
    const s = idxRef.current?.stats || {};
    setStats((prev) => ({ ...prev, ...s }));
  }, [maxDepth, maxLeafSize]);

  // Rebuild handler — snapshot __forgeBodies, build, publish stats.
  const onRebuild = useCallback(() => {
    if (typeof window === 'undefined') return;
    const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
    const idx = idxRef.current || getOctreeIndex();
    idx.build(bodies, { maxDepth, maxLeafSize });
    const s = { ...idx.stats };
    setStats((prev) => ({ ...prev, ...s }));
    setStatusText(`Built ${s.nodeCount} nodes / ${s.leafCount} leaves over ${s.bodyCount} bodies in ${s.buildMs.toFixed(1)} ms.`);
    try {
      window.__forgeOctreeStats = { ...s };
      window.dispatchEvent(new CustomEvent('forge:octree-rebuilt', { detail: { ...s } }));
    } catch { /* fail-soft */ }
  }, [maxDepth, maxLeafSize]);

  // Per-frame loop: drive the synthetic camera, run queryFrustum,
  // sample FPS, publish stats every SAMPLE_INTERVAL_MS.
  const tick = useCallback((now) => {
    if (!live || !open) { rafRef.current = 0; return; }
    const dt = lastFrameRef.current === 0 ? 16.667 : (now - lastFrameRef.current);
    lastFrameRef.current = now;
    orbitTRef.current += (dt / 1000) * ORBIT_RAD_PER_SEC;
    const ring = frameTimesRef.current;
    ring.push(dt);
    if (ring.length > 60) ring.shift();

    const idx = idxRef.current || getOctreeIndex();
    let lastVisible = idx.stats.lastVisible || 0;
    let lastCulled  = idx.stats.lastCulled  || 0;
    let lastQueryMs = idx.stats.lastQueryMs || 0;
    if (idx.root && idx.stats.bodyCount > 0) {
      const planes = syntheticCameraPlanes(orbitTRef.current, orbitRadius);
      const ids = idx.queryFrustum(planes);
      lastVisible = ids.length;
      lastCulled  = Math.max(0, idx.stats.bodyCount - lastVisible);
      lastQueryMs = idx.stats.lastQueryMs;
      try {
        window.__forgeOctreeStats = { ...idx.stats };
        window.dispatchEvent(new CustomEvent('forge:octree-queried', {
          detail: { ...idx.stats, visibleCount: lastVisible },
        }));
      } catch { /* fail-soft */ }
    }

    if (now - sampleTickRef.current >= SAMPLE_INTERVAL_MS) {
      sampleTickRef.current = now;
      let sum = 0;
      for (const v of ring) sum += v;
      const meanMs = ring.length ? sum / ring.length : 0;
      const fps = meanMs > 0 ? (1000 / meanMs) : 0;
      setStats((prev) => ({
        ...prev,
        ...idx.stats,
        lastVisible,
        lastCulled,
        lastQueryMs,
        fps,
      }));
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [live, open, orbitRadius]);

  useEffect(() => {
    if (!open || !live) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      lastFrameRef.current = 0;
      sampleTickRef.current = 0;
      frameTimesRef.current = [];
      return undefined;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [open, live, tick]);

  // Listen for forge:bodies-changed (sibling panels that mutate
  // __forgeBodies fire this) so the chip grid stays fresh even when
  // the user hasn't clicked Rebuild.
  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const onChanged = () => {
      const idx = idxRef.current || getOctreeIndex();
      const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
      if (bodies.length === idx.stats.bodyCount) return; // unchanged
      idx.build(bodies, { maxDepth, maxLeafSize });
      setStats((prev) => ({ ...prev, ...idx.stats }));
    };
    window.addEventListener('forge:bodies-changed', onChanged);
    return () => window.removeEventListener('forge:bodies-changed', onChanged);
  }, [open, maxDepth, maxLeafSize]);

  // Reset on panel open so a fresh user-visible state shows up.
  useEffect(() => {
    if (!open) return;
    const idx = idxRef.current || getOctreeIndex();
    setStats((prev) => ({ ...prev, ...idx.stats }));
  }, [open]);

  if (!open) return null;

  const fpsColor = stats.fps >= 30
    ? 'var(--forge-good, #4ade80)'
    : stats.fps >= 15
      ? 'var(--forge-warn, #facc15)'
      : 'var(--forge-bad, #ff6363)';

  return (
    <div style={panelStyle}
         data-testid="forge-octree-panel"
         data-body-count={String(stats.bodyCount)}
         data-node-count={String(stats.nodeCount)}
         data-leaf-count={String(stats.leafCount)}
         data-max-depth={String(stats.maxDepth)}
         data-max-leaf-size={String(maxLeafSize)}
         data-build-ms={stats.buildMs.toFixed(2)}
         data-query-ms={stats.lastQueryMs.toFixed(3)}
         data-visible-count={String(stats.lastVisible)}
         data-culled-count={String(stats.lastCulled)}
         data-fps={stats.fps.toFixed(1)}
         data-live={live ? 'true' : 'false'}>
      <header style={headerStyle}>
        <strong>Octree Spatial Index</strong>
        <button onClick={onClose}
                data-testid="forge-octree-close"
                style={closeBtn}>×</button>
      </header>

      <div style={helpStyle}
           data-testid="forge-octree-help">
        Recursive octree over every body's world-space AABB. Each frame
        the panel runs <code>queryFrustum(planes6)</code> against a
        synthetic orbiting camera to keep the cull counters live.
        Used by the main Viewport for sub-linear culling at 100k+ bodies.
      </div>

      <div style={sliderRowStyle}
           data-testid="forge-octree-depth-row">
        <span style={{ width: 90, color: 'var(--forge-ink-mute, #8a93a0)' }}>
          Max depth
        </span>
        <input type="range"
               min={1} max={10} step={1}
               value={maxDepth}
               onChange={(e) => setMaxDepth(parseInt(e.target.value, 10) || 6)}
               data-testid="forge-octree-depth-slider"
               style={{ flex: 1 }} />
        <span style={{
          width: 36, textAlign: 'right',
          fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
          fontVariantNumeric: 'tabular-nums',
        }} data-testid="forge-octree-depth-value">
          {maxDepth}
        </span>
      </div>

      <div style={sliderRowStyle}
           data-testid="forge-octree-leaf-row">
        <span style={{ width: 90, color: 'var(--forge-ink-mute, #8a93a0)' }}>
          Leaf size
        </span>
        <input type="range"
               min={1} max={64} step={1}
               value={maxLeafSize}
               onChange={(e) => setMaxLeafSize(parseInt(e.target.value, 10) || 16)}
               data-testid="forge-octree-leaf-slider"
               style={{ flex: 1 }} />
        <span style={{
          width: 36, textAlign: 'right',
          fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
          fontVariantNumeric: 'tabular-nums',
        }} data-testid="forge-octree-leaf-value">
          {maxLeafSize}
        </span>
      </div>

      <div style={sliderRowStyle}
           data-testid="forge-octree-orbit-row">
        <span style={{ width: 90, color: 'var(--forge-ink-mute, #8a93a0)' }}>
          Orbit r
        </span>
        <input type="range"
               min={50} max={1500} step={10}
               value={orbitRadius}
               onChange={(e) => setOrbitRadius(parseInt(e.target.value, 10) || 300)}
               data-testid="forge-octree-orbit-slider"
               style={{ flex: 1 }} />
        <span style={{
          width: 60, textAlign: 'right',
          fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
          fontVariantNumeric: 'tabular-nums',
        }} data-testid="forge-octree-orbit-value">
          {orbitRadius} mm
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button"
                style={bigBtnStyle}
                onClick={onRebuild}
                data-testid="forge-octree-rebuild">
          Rebuild
        </button>
        <button type="button"
                style={altBtnStyle}
                onClick={() => setLive((v) => !v)}
                data-testid="forge-octree-toggle-live">
          {live ? 'Pause Live' : 'Resume Live'}
        </button>
      </div>

      <div style={statsGridStyle}
           data-testid="forge-octree-stats">
        <div style={chipStyle} data-testid="forge-octree-chip-bodies">
          <div style={chipLabel}>Bodies</div>
          <div style={chipValue}
               data-testid="forge-octree-chip-bodies-value">
            {stats.bodyCount.toLocaleString()}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-octree-chip-nodes">
          <div style={chipLabel}>Nodes</div>
          <div style={chipValue}
               data-testid="forge-octree-chip-nodes-value">
            {stats.nodeCount.toLocaleString()}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-octree-chip-leaves">
          <div style={chipLabel}>Leaves</div>
          <div style={chipValue}
               data-testid="forge-octree-chip-leaves-value">
            {stats.leafCount.toLocaleString()}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-octree-chip-depth">
          <div style={chipLabel}>Max depth</div>
          <div style={chipValue}
               data-testid="forge-octree-chip-depth-value">
            {stats.maxDepth}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-octree-chip-build">
          <div style={chipLabel}>Build ms</div>
          <div style={chipValue}
               data-testid="forge-octree-chip-build-value">
            {stats.buildMs.toFixed(1)}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-octree-chip-query">
          <div style={chipLabel}>Query µs</div>
          <div style={chipValue}
               data-testid="forge-octree-chip-query-value">
            {(stats.lastQueryMs * 1000).toFixed(0)}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-octree-chip-visible">
          <div style={chipLabel}>Visible</div>
          <div style={chipValue}
               data-testid="forge-octree-chip-visible-value">
            {stats.lastVisible.toLocaleString()}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-octree-chip-culled">
          <div style={chipLabel}>Culled</div>
          <div style={chipValue}
               data-testid="forge-octree-chip-culled-value">
            {stats.lastCulled.toLocaleString()}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-octree-chip-fps">
          <div style={chipLabel}>FPS</div>
          <div style={{ ...chipValue, color: live ? fpsColor : 'var(--forge-ink, #ebecef)' }}
               data-testid="forge-octree-chip-fps-value">
            {stats.fps.toFixed(1)}
          </div>
        </div>
      </div>

      <div style={{
        fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
        fontSize: 10, color: 'var(--forge-ink-mute, #8a93a0)',
      }}
           data-testid="forge-octree-status"
           data-status-text={statusText}>
        {statusText}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host. Mounts the panel as a portal sibling to ForgeShellV4. Wires
// window.__forgeOpenOctreeStats + the `tools.octreeStats` menu action,
// and installs the headless window API at boot so callers (BigScene
// e2e, Archie plans) can rebuild + query the index even when the
// panel is closed.

export function OctreePanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Boot the singleton + headless surface up front so e2e harnesses
    // can build + query the index BEFORE opening the panel.
    installOctreeWindowApi();
    window.__forgeOpenOctreeStats = (v) =>
      setOpen(v === undefined ? true : !!v);
    window.__forgeCloseOctreeStats = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.octreeStats') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenOctreeStats; } catch {}
      try { delete window.__forgeCloseOctreeStats; } catch {}
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <OctreePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default OctreePanel;
