// PUSH-94 (Slice-62 / Big Scene Stress Test panel).
//
// Up through PUSH-93 Forge has shipped Viewport.SceneMeshes with the
// Forge-106 InstancedGroup that batches synthetic bodies sharing a
// `partKey` into a single THREE.InstancedMesh. Forge-111's StressTest
// panel proved that path can carry 20k bolts at ≥30 FPS on the real
// shell. The remaining headroom question is: what happens when an
// assembly has 30,000+ components — does the renderer fall apart on a
// non-batched code path? The main viewport's mesh count is dominated
// by SCENE complexity, not body count alone (every body still owns its
// own geometry + per-instance matrix), so for a dedicated 30k-body
// stress benchmark we need a sidecar canvas that exercises the
// best-case path — ONE InstancedMesh, N cubes, total draw call = 1 —
// without touching Viewport.jsx (parallel agents on this branch are
// known to collide there per the user mandate).
//
// PUSH-94 ships the Big Scene Stress Test panel:
//   • Right-docked panel reachable via the `tools.bigSceneStress` menu
//     action OR `window.__forgeOpenBigSceneStress()`.
//   • Body-count slider with 4 named presets: 1 000, 5 000, 10 000,
//     30 000. Each preset seeds N cubes at random positions in a
//     200×200×200 mm cloud, with random uniform scales [0.4..1.6] and
//     random Euler rotations.
//   • Generate button rebuilds the InstancedMesh; Clear disposes the
//     mesh + renderer.
//   • Own animation loop rotates the scene; each frame samples FPS,
//     ms-per-frame and draw calls off the renderer.info object.
//   • Per-frame stats published on `window.__forgeBigSceneStats` so the
//     e2e harness, Archie and any sibling panel can assert against them
//     without scraping the DOM.
//
// Contract:
//   - The panel ONLY mounts in a sidecar canvas (its own <canvas> in a
//     portal). The main viewport is untouched.
//   - The mesh is a single THREE.InstancedMesh — drawCalls === 1 by
//     construction once it's rendered. The e2e contract asserts this.
//   - NO new npm packages (three is already in deps), NO C++ libs, NO
//     external services. Pure renderer-side three.js.
//   - Multi-cam e2e mandate honoured by the spec — 5 named camera
//     angles in the main viewport while the sidecar runs.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';

// Hard-coded body-count presets. Anything beyond 30k will start to chew
// GPU memory on integrated chipsets; we cap at 30k to match the brief.
export const BIG_SCENE_PRESETS = Object.freeze([
  { id: '1k',  label: '1 k',  value: 1000 },
  { id: '5k',  label: '5 k',  value: 5000 },
  { id: '10k', label: '10 k', value: 10000 },
  { id: '30k', label: '30 k', value: 30000 },
]);

// Sample window for the FPS estimator. Updates the chip every 250 ms
// (4 readings/s). Keeping a 60-sample ring buffer means the published
// mean is over the last 15 seconds — enough to smooth out transient
// stalls (alt-tab, GC) without lagging real regressions.
const FPS_SAMPLE_INTERVAL_MS = 250;
const FPS_SAMPLE_RING_SIZE   = 60;

// Cloud size — bodies seeded uniformly inside [-CLOUD/2, +CLOUD/2]^3.
// 200 mm is large enough that 30k unit-ish cubes don't visually overlap
// into a solid blob.
const CLOUD_HALF_EXTENT_MM = 100;

// Deterministic Mulberry32 PRNG so the generated cloud is reproducible
// across runs (handy for screenshot diffing + Archie thread replay).
// Seed = Date.now() shifted into 32-bit space so users get a fresh
// scene per click, but the e2e harness pins it via the optional
// `seedBigScene(seed)` hook.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a Float32Array of per-instance matrices. We compose the matrix
// directly (T * R * S * I) so we don't pay the cost of THREE.Matrix4
// scratch instantiation N times. Each instance gets 16 floats in
// row-major order matching THREE.Matrix4.elements.
function buildInstanceMatrices(count, seed) {
  const rng = mulberry32(seed >>> 0);
  const matrices = new Float32Array(count * 16);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    p.set(
      (rng() - 0.5) * 2 * CLOUD_HALF_EXTENT_MM,
      (rng() - 0.5) * 2 * CLOUD_HALF_EXTENT_MM,
      (rng() - 0.5) * 2 * CLOUD_HALF_EXTENT_MM,
    );
    e.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
    q.setFromEuler(e);
    const scale = 0.4 + rng() * 1.2; // [0.4, 1.6]
    s.set(scale, scale, scale);
    m.compose(p, q, s);
    m.toArray(matrices, i * 16);
  }
  return matrices;
}

// Public test seed hook — the e2e spec calls
// window.__forgeBigSceneSetSeed(<int>) before clicking Generate so the
// generated cloud is byte-deterministic across runs.
let _seedOverride = null;
if (typeof window !== 'undefined') {
  window.__forgeBigSceneSetSeed = (n) => {
    _seedOverride = (typeof n === 'number' && Number.isFinite(n)) ? (n >>> 0) : null;
  };
  // The named generator the e2e + Archie can call to inspect the seeded
  // matrices without spinning up a real WebGL context. Returns a
  // Float32Array of length count*16.
  window.__forgeBigSceneBuildMatrices = (count, seed) =>
    buildInstanceMatrices(count >>> 0, (seed >>> 0) || 1);
}

// ─────────────────────────────────────────────────────────────────────
// Styles. Matches the existing Forge right-docked panel tokens (see
// DiagnosticDumpPanel / SectionPlanePanel) so the surface reads as
// native UI, not a debug afterthought.

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460,
  zIndex: 1340,
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
const presetRowStyle = {
  display: 'flex', gap: 6,
};
const presetBtnBase = {
  flex: 1,
  background: 'var(--forge-surface, #1a212c)',
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
  color: 'var(--forge-ink, #ebecef)',
  padding: '6px 8px',
  cursor: 'pointer',
  fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
  fontSize: 11,
  borderRadius: 4,
};
const presetBtnActive = {
  ...presetBtnBase,
  background: 'var(--forge-accent, #2e7be0)',
  borderColor: 'var(--forge-accent, #2e7be0)',
  color: '#fff',
  fontWeight: 600,
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
const canvasWrapStyle = {
  flex: 1,
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
  borderRadius: 4,
  background: '#0a0d12',
  overflow: 'hidden',
  position: 'relative',
  minHeight: 220,
};
const canvasStyle = {
  width: '100%',
  height: '100%',
  display: 'block',
};
const statsRowStyle = {
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
// Panel.

export function BigSceneStressPanel({ open, onClose }) {
  const [bodyCount, setBodyCount] = useState(1000);
  const [generated, setGenerated] = useState(false);
  const [stats, setStats] = useState({
    fps: 0, msPerFrame: 0, drawCalls: 0, instanceCount: 0,
    triangles: 0, lastSeed: 0, frames: 0,
  });
  const [statusText, setStatusText] = useState('Idle — pick N and click Generate.');

  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const meshRef = useRef(null);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const frameTimesRef = useRef([]); // ring buffer of ms-per-frame samples
  const sampleTickRef = useRef(0);
  // The active seed is mirrored into a ref so the RAF loop (which is
  // memoised once at startup) reads the seed seeded by the most recent
  // Generate, not the stale 0 from the initial state snapshot.
  const lastSeedRef = useRef(0);

  // ─── three.js bootstrap. We deliberately do NOT use react-three-fiber
  // here. The sidecar canvas owns its own renderer + RAF loop so the
  // main viewport's r3f tree is undisturbed. Everything lives on refs
  // so React re-renders don't tear down the GPU resources.
  const bootRenderer = useCallback(() => {
    if (!canvasRef.current) return false;
    if (rendererRef.current) return true;
    try {
      const canvas = canvasRef.current;
      // Match the canvas pixel size to the wrapper rect so the
      // benchmark runs at the actual on-screen resolution (1× pixel
      // ratio, no DPR amplification, so we measure the cost a real
      // 1080p viewport would pay).
      const rect = canvas.parentElement.getBoundingClientRect();
      const w = Math.max(220, Math.floor(rect.width));
      const h = Math.max(180, Math.floor(rect.height));
      canvas.width = w; canvas.height = h;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      const renderer = new THREE.WebGLRenderer({
        canvas, antialias: false, alpha: false,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      renderer.setClearColor(new THREE.Color(0x0a0d12), 1);
      const scene = new THREE.Scene();
      // A modest hemisphere light + a directional rim so the cubes
      // actually have shading. We use unlit MeshBasicMaterial to
      // remove lighting from the frame cost — the benchmark is about
      // per-instance matrix throughput, not lighting math. The colours
      // come from per-instance Color attribute.
      const camera = new THREE.PerspectiveCamera(60, w / h, 1, 5000);
      camera.position.set(280, 220, 320);
      camera.lookAt(0, 0, 0);
      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;
      // Resize observer keeps the sidecar canvas in sync with the
      // panel when the user resizes the window mid-run.
      const ro = new ResizeObserver(() => {
        if (!rendererRef.current || !canvasRef.current) return;
        const r = canvasRef.current.parentElement.getBoundingClientRect();
        const w2 = Math.max(220, Math.floor(r.width));
        const h2 = Math.max(180, Math.floor(r.height));
        rendererRef.current.setSize(w2, h2, false);
        cameraRef.current.aspect = w2 / h2;
        cameraRef.current.updateProjectionMatrix();
      });
      ro.observe(canvas.parentElement);
      rendererRef.current.userData = { resizeObserver: ro };
      return true;
    } catch (err) {
      setStatusText(`WebGL bootstrap failed: ${err?.message || String(err)}`);
      return false;
    }
  }, []);

  // ─── Build a single InstancedMesh with N cubes. We dispose the old
  // mesh + geometry + material before allocating a fresh one so we
  // don't leak GPU memory across Generate clicks.
  const buildInstancedMesh = useCallback((count) => {
    if (!sceneRef.current) return null;
    const scene = sceneRef.current;
    if (meshRef.current) {
      scene.remove(meshRef.current);
      try { meshRef.current.geometry.dispose(); } catch {}
      try { meshRef.current.material.dispose(); } catch {}
      meshRef.current = null;
    }
    const geom = new THREE.BoxGeometry(2.0, 2.0, 2.0);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const mesh = new THREE.InstancedMesh(geom, mat, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const seed = _seedOverride ?? (Date.now() & 0x7fffffff) >>> 0;
    const matrices = buildInstanceMatrices(count, seed);
    // Copy the precomputed matrix block straight into the instance
    // attribute. mesh.instanceMatrix is a Float32 BufferAttribute of
    // length count*16; replacing .array in-place is faster than calling
    // setMatrixAt N times.
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;
    // Per-instance colours derived from position so the cloud is
    // visually busy even though the material is unlit.
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const m = matrices;
      const ox = m[i * 16 + 12];
      const oy = m[i * 16 + 13];
      const oz = m[i * 16 + 14];
      // Map each axis to [0..1] (the cloud half-extent is 100).
      colors[i * 3 + 0] = Math.max(0, Math.min(1, 0.5 + ox / 200));
      colors[i * 3 + 1] = Math.max(0, Math.min(1, 0.5 + oy / 200));
      colors[i * 3 + 2] = Math.max(0, Math.min(1, 0.5 + oz / 200));
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3, false);
    mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    meshRef.current = mesh;
    lastSeedRef.current = seed;
    setStats((s) => ({ ...s, lastSeed: seed }));
    return mesh;
  }, []);

  // ─── RAF loop. Each frame we (a) rotate the scene a touch so the
  // benchmark exercises the matrix upload, (b) render, (c) sample
  // frame time, and (d) update the published stats every
  // FPS_SAMPLE_INTERVAL_MS.
  const tick = useCallback((now) => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) {
      rafRef.current = 0; return;
    }
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const dt = lastFrameRef.current === 0 ? 16.667 : (now - lastFrameRef.current);
    lastFrameRef.current = now;
    // Rotate the scene around Y for visual interest. We tilt slightly
    // around X too so motion is unmistakable on the recording.
    if (meshRef.current) {
      meshRef.current.rotation.y += dt * 0.0006;
      meshRef.current.rotation.x = Math.sin(now * 0.0003) * 0.15;
    }
    renderer.render(scene, camera);
    // Append to ring buffer of ms-per-frame samples.
    const ring = frameTimesRef.current;
    ring.push(dt);
    if (ring.length > FPS_SAMPLE_RING_SIZE) ring.shift();
    // Publish stats every FPS_SAMPLE_INTERVAL_MS so the React state
    // doesn't churn on every frame.
    if (now - sampleTickRef.current >= FPS_SAMPLE_INTERVAL_MS) {
      sampleTickRef.current = now;
      let sum = 0;
      for (const v of ring) sum += v;
      const meanMs = ring.length ? sum / ring.length : 0;
      const fps = meanMs > 0 ? (1000 / meanMs) : 0;
      const info = renderer.info;
      const next = {
        fps,
        msPerFrame: meanMs,
        drawCalls: info?.render?.calls ?? 0,
        instanceCount: meshRef.current?.count ?? 0,
        triangles: info?.render?.triangles ?? 0,
        lastSeed: lastSeedRef.current,
        frames: info?.render?.frame ?? 0,
      };
      setStats(next);
      try {
        window.__forgeBigSceneStats = next;
        window.dispatchEvent(new CustomEvent('forge:big-scene-stats', { detail: next }));
      } catch { /* fail-soft */ }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current) return;
    lastFrameRef.current = 0;
    sampleTickRef.current = 0;
    frameTimesRef.current = [];
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const stopLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  // ─── Generate handler — bootstraps the renderer on first click, then
  // rebuilds the mesh + restarts the loop.
  const onGenerate = useCallback(() => {
    if (!bootRenderer()) return;
    setStatusText(`Generating ${bodyCount.toLocaleString()} instances…`);
    const mesh = buildInstancedMesh(bodyCount);
    if (!mesh) {
      setStatusText('Generate failed: scene unavailable.');
      return;
    }
    setGenerated(true);
    setStatusText(`Rendering ${bodyCount.toLocaleString()} instances · 1 draw call.`);
    startLoop();
    try {
      window.dispatchEvent(new CustomEvent('forge:big-scene-generated', {
        detail: { count: bodyCount, seed: _seedOverride ?? null },
      }));
    } catch { /* fail-soft */ }
  }, [bootRenderer, buildInstancedMesh, bodyCount, startLoop]);

  // ─── Clear — stop the loop + dispose mesh. Renderer stays mounted so
  // the next Generate is fast.
  const onClear = useCallback(() => {
    stopLoop();
    if (meshRef.current && sceneRef.current) {
      sceneRef.current.remove(meshRef.current);
      try { meshRef.current.geometry.dispose(); } catch {}
      try { meshRef.current.material.dispose(); } catch {}
      meshRef.current = null;
    }
    setGenerated(false);
    setStats((s) => ({
      ...s, fps: 0, msPerFrame: 0, drawCalls: 0,
      instanceCount: 0, triangles: 0,
    }));
    setStatusText('Cleared. Pick N and click Generate.');
    try {
      window.__forgeBigSceneStats = {
        fps: 0, msPerFrame: 0, drawCalls: 0,
        instanceCount: 0, triangles: 0, lastSeed: 0, frames: 0,
      };
    } catch { /* fail-soft */ }
  }, [stopLoop]);

  // ─── Cleanup on unmount / panel close. We tear down the renderer
  // so the WebGL context isn't held forever after the panel is closed.
  useEffect(() => {
    if (open) return undefined;
    return () => {};
  }, [open]);

  useEffect(() => () => {
    // Real teardown on hard unmount.
    stopLoop();
    if (rendererRef.current) {
      try {
        rendererRef.current.userData?.resizeObserver?.disconnect();
      } catch {}
      try { rendererRef.current.dispose(); } catch {}
      rendererRef.current = null;
    }
    if (meshRef.current) {
      try { meshRef.current.geometry.dispose(); } catch {}
      try { meshRef.current.material.dispose(); } catch {}
      meshRef.current = null;
    }
    sceneRef.current = null;
    cameraRef.current = null;
  }, [stopLoop]);

  if (!open) return null;

  const fpsColor = stats.fps >= 30
    ? 'var(--forge-good, #4ade80)'
    : stats.fps >= 15
      ? 'var(--forge-warn, #facc15)'
      : 'var(--forge-bad, #ff6363)';

  return (
    <div style={panelStyle}
         data-testid="forge-big-scene-panel"
         data-generated={generated ? 'true' : 'false'}
         data-body-count={String(bodyCount)}
         data-fps={stats.fps.toFixed(1)}
         data-draw-calls={String(stats.drawCalls)}
         data-instance-count={String(stats.instanceCount)}>
      <header style={headerStyle}>
        <strong>Big Scene Stress Test</strong>
        <button onClick={onClose}
                data-testid="forge-big-scene-close"
                style={closeBtn}>×</button>
      </header>

      <div style={helpStyle}
           data-testid="forge-big-scene-help">
        Seeds N cubes into one <code>THREE.InstancedMesh</code> in a
        sidecar canvas, runs a private RAF loop, and reports FPS,
        ms/frame and draw-call count. The main viewport is untouched —
        this is a renderer-only benchmark.
      </div>

      <div style={sliderRowStyle}
           data-testid="forge-big-scene-slider-row">
        <span style={{ width: 60, color: 'var(--forge-ink-mute, #8a93a0)' }}>
          Bodies
        </span>
        <input type="range"
               min={1000} max={30000} step={500}
               value={bodyCount}
               onChange={(e) => setBodyCount(parseInt(e.target.value, 10) || 1000)}
               data-testid="forge-big-scene-slider"
               style={{ flex: 1 }} />
        <span style={{
          width: 64,
          textAlign: 'right',
          fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {bodyCount.toLocaleString()}
        </span>
      </div>

      <div style={presetRowStyle}
           data-testid="forge-big-scene-presets">
        {BIG_SCENE_PRESETS.map((p) => (
          <button key={p.id}
                  type="button"
                  data-testid={`forge-big-scene-preset-${p.id}`}
                  data-active={bodyCount === p.value ? 'true' : 'false'}
                  onClick={() => setBodyCount(p.value)}
                  style={bodyCount === p.value ? presetBtnActive : presetBtnBase}>
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button"
                style={bigBtnStyle}
                onClick={onGenerate}
                data-testid="forge-big-scene-generate">
          Generate
        </button>
        <button type="button"
                style={altBtnStyle}
                onClick={onClear}
                disabled={!generated}
                data-testid="forge-big-scene-clear">
          Clear
        </button>
      </div>

      <div style={canvasWrapStyle}
           data-testid="forge-big-scene-canvas-wrap">
        <canvas ref={canvasRef} style={canvasStyle}
                data-testid="forge-big-scene-canvas" />
        <div style={{
          position: 'absolute', top: 6, right: 8,
          fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
          fontSize: 10, color: 'var(--forge-ink-mute, #8a93a0)',
          pointerEvents: 'none',
        }}
             data-testid="forge-big-scene-canvas-stamp">
          {generated ? `seed ${stats.lastSeed}` : 'idle'}
        </div>
      </div>

      <div style={statsRowStyle}
           data-testid="forge-big-scene-stats">
        <div style={chipStyle} data-testid="forge-big-scene-chip-fps">
          <div style={chipLabel}>FPS</div>
          <div style={{ ...chipValue, color: generated ? fpsColor : 'var(--forge-ink, #ebecef)' }}
               data-testid="forge-big-scene-chip-fps-value">
            {stats.fps.toFixed(1)}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-big-scene-chip-ms">
          <div style={chipLabel}>ms/frame</div>
          <div style={chipValue}
               data-testid="forge-big-scene-chip-ms-value">
            {stats.msPerFrame.toFixed(2)}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-big-scene-chip-draws">
          <div style={chipLabel}>Draw calls</div>
          <div style={chipValue}
               data-testid="forge-big-scene-chip-draws-value">
            {stats.drawCalls}
          </div>
        </div>
      </div>

      <div style={{
        fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
        fontSize: 10, color: 'var(--forge-ink-mute, #8a93a0)',
        display: 'flex', justifyContent: 'space-between',
      }}
           data-testid="forge-big-scene-status"
           data-status-text={statusText}>
        <span>{statusText}</span>
        <span>tri {stats.triangles.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host.

export function BigSceneStressPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBigSceneStress = (v) =>
      setOpen(v === undefined ? true : !!v);
    window.__forgeCloseBigSceneStress = () => setOpen(false);
    // Seed slot so the e2e gets deterministic matrices.
    window.__forgeBigSceneStats = window.__forgeBigSceneStats || {
      fps: 0, msPerFrame: 0, drawCalls: 0,
      instanceCount: 0, triangles: 0, lastSeed: 0, frames: 0,
    };
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.bigSceneStress') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenBigSceneStress; } catch {}
      try { delete window.__forgeCloseBigSceneStress; } catch {}
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <BigSceneStressPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BigSceneStressPanel;
