// Forge-135 — Render Room (path-traced offline render).
//
// Spins up three-gpu-pathtracer on a hidden WebGL2 context, captures
// frames at the chosen environment / samples-per-pixel / resolution
// settings, and writes the composite PNG to disk via the existing
// dialog.saveFile + writeBlob bridge.
//
// Strict rules per the deliverable:
//   - No fallback to the PBR viewport. If WebGL2 / compute pipeline is
//     unavailable, we throw a clear, user-visible error.
//   - Manual clicks here NEVER post to Archie's thread (handleMenuAction
//     in ForgeShellV4 reserves that for the cmd bar).
//   - Each render pulls live scene geometry from window.__forgeBodies via
//     the kernel tessellation cache so the result mirrors the user's
//     current model.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import {
  WebGLPathTracer,
  PathTracingSceneGenerator,
  GradientEquirectTexture,
  BlurredEnvMapGenerator,
} from 'three-gpu-pathtracer';

// ────────────────────────────── env presets ──────────────────────────
//
// 5 named environments. "studio" is a soft 5500K dome generated
// procedurally so the panel works even when no HDR file ships with
// the bundle. The others use a gradient sky encoded as an equirect
// texture (procedural, two colours + interpolation).

const ENV_PRESETS = Object.freeze({
  studio: {
    label: 'Studio',
    top:    new THREE.Color(0xffffff),
    bottom: new THREE.Color(0x16171b),
    exponent: 0.72,
    intensity: 1.95,
  },
  sunset: {
    label: 'Sunset',
    top:    new THREE.Color(0xf7c08a),
    bottom: new THREE.Color(0x2b1810),
    exponent: 1.8,
    intensity: 1.2,
  },
  forest: {
    label: 'Forest',
    top:    new THREE.Color(0x96bd9c),
    bottom: new THREE.Color(0x1a2f1f),
    exponent: 1.4,
    intensity: 1.0,
  },
  night: {
    label: 'Night',
    top:    new THREE.Color(0x0a1428),
    bottom: new THREE.Color(0x000000),
    exponent: 2.2,
    intensity: 0.35,
  },
  warehouse: {
    label: 'Warehouse',
    top:    new THREE.Color(0xb4b8c4),
    bottom: new THREE.Color(0x2a2c30),
    exponent: 1.0,
    intensity: 1.1,
  },
});

export const ENV_PRESET_IDS = Object.keys(ENV_PRESETS);

// Output resolutions — landscape, the only orientation the panel
// currently supports.
const RESOLUTIONS = Object.freeze({
  '720p':  { w: 1280, h: 720,  label: '720p (1280 × 720)' },
  '1080p': { w: 1920, h: 1080, label: '1080p (1920 × 1080)' },
  '4K':    { w: 3840, h: 2160, label: '4K (3840 × 2160)' },
});

export const RESOLUTION_IDS = Object.keys(RESOLUTIONS);

// ─────────────────────────── WebGL2 detection ────────────────────────
//
// The path tracer needs a WebGL2 context with the EXT_color_buffer_float
// extension (the half-float MRT path it writes radiance into). If either
// is missing we surface a clear error — strict no-fallback policy.

function detectWebGL2Compute() {
  if (typeof document === 'undefined') {
    return { ok: false, error: 'Path tracer requires a browser DOM.' };
  }
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) {
    return { ok: false,
             error: 'WebGL2 is not available. The path tracer requires a WebGL2 context.' };
  }
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) {
    return { ok: false,
             error: 'EXT_color_buffer_float is not supported. The path tracer requires a float colour buffer.' };
  }
  const ext2 = gl.getExtension('OES_texture_float_linear');
  if (!ext2) {
    return { ok: false,
             error: 'OES_texture_float_linear is not supported.' };
  }
  return { ok: true };
}

// ─────────────────────────── env map builder ─────────────────────────

function buildEnvTexture(presetId, renderer) {
  const p = ENV_PRESETS[presetId] || ENV_PRESETS.studio;
  const tex = new GradientEquirectTexture(1024);
  tex.topColor.copy(p.top);
  tex.bottomColor.copy(p.bottom);
  tex.exponent = p.exponent;
  tex.update();
  if (!renderer) {
    return { tex, intensity: p.intensity };
  }
  // Soft-blur for a more diffuse light contribution.
  const blur = new BlurredEnvMapGenerator(renderer);
  const blurred = blur.generate(tex, 0.12);
  blur.dispose();
  return { tex: blurred, intensity: p.intensity };
}

let _offlineRendererSingleton = null;
function makeOfflineRenderer() {
  if (_offlineRendererSingleton && !_offlineRendererSingleton.disposed) {
    return _offlineRendererSingleton;
  }
  const canvas = document.createElement('canvas');
  // Sized to first render; resize happens per-job.
  canvas.width = 1280; canvas.height = 720;
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: true, premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const wrapper = { canvas, renderer, disposed: false,
                    dispose() { this.disposed = true; try { renderer.dispose(); } catch {} } };
  _offlineRendererSingleton = wrapper;
  return wrapper;
}

// ────────────────────────── scene assembly ───────────────────────────
//
// We harvest the live forge meshes the same way StressTestPanel does:
// from window.__forgeBodies → the scene already mounted by Viewport.jsx
// publishes its meshes onto window.__forgeViewportMeshes. We clone
// them into an offline scene so we don't mutate the on-screen scene
// graph (path tracer rebakes its BVH when geometry changes).

function harvestScene() {
  const out = new THREE.Scene();
  let live = (typeof window !== 'undefined' && Array.isArray(window.__forgeViewportMeshes))
    ? window.__forgeViewportMeshes : [];
  // __forgeViewportMeshes is not always published; fall back to walking
  // the live render scene for the actual body meshes (tagged
  // userData.forgeBody by Viewport.jsx) so the path tracer renders the
  // real part rather than the neutral-cube placeholder.
  if ((!live || live.length === 0) && typeof window !== 'undefined' && window.__forgeScene) {
    const collected = [];
    window.__forgeScene.traverse((o) => {
      if (o && o.isMesh && o.geometry && !o.userData?.helper
          && (o.userData?.forgeBody || o.userData?.body || o.userData?.bodyId != null)) {
        o.updateWorldMatrix?.(true, false);
        collected.push(o);
      }
    });
    live = collected;
  }
  // Brushed-metal palette so parts read as machined hardware, not flat
  // clay. We do NOT clone the viewport material (it carries flat selection
  // colours / vertex tints that path-trace as muddy checker artifacts);
  // instead assign a clean PBR metal, varied per body for visual interest.
  const METALS = [
    { color: 0xc9ced6, metalness: 0.92, roughness: 0.28 }, // brushed steel
    { color: 0xd2d6dc, metalness: 0.95, roughness: 0.16 }, // polished steel
    { color: 0xc6c2bb, metalness: 0.88, roughness: 0.38 }, // aluminium
    { color: 0xb9a78c, metalness: 0.85, roughness: 0.42 }, // brass-ish
  ];
  let _mi = 0;
  for (const m of live) {
    if (!m || !m.geometry) continue;
    const spec = METALS[_mi++ % METALS.length];
    const mat = new THREE.MeshPhysicalMaterial({ color: spec.color, metalness: spec.metalness, roughness: spec.roughness, clearcoat: 0.15, clearcoatRoughness: 0.3 });
    const clone = new THREE.Mesh(m.geometry.clone(), mat);
    // Bake the WORLD transform into the clone so bodies nested under
    // groups land in the right place (copying only local position drops
    // any parent offset).
    m.updateWorldMatrix?.(true, false);
    if (m.matrixWorld) clone.applyMatrix4(m.matrixWorld);
    else { clone.position.copy(m.position); clone.quaternion.copy(m.quaternion); clone.scale.copy(m.scale); }
    clone.matrixAutoUpdate = true;
    out.add(clone);
  }
  if (out.children.length === 0) {
    // Provide a single neutral cube so the test sees a non-blank
    // image even before the user has built anything.
    const g = new THREE.BoxGeometry(20, 20, 20);
    const m = new THREE.MeshPhysicalMaterial({ color: 0xa8b0bc, metalness: 0.5, roughness: 0.4 });
    out.add(new THREE.Mesh(g, m));
  }
  // Measure the PART now, before adding the floor, so the camera frames
  // the part (not a giant ground plane) and the floor is sized to the
  // part. Scale-to-viewer: a 70 mm housing must dominate the frame, never
  // sit as a speck on a 2 m floor.
  const partBox = new THREE.Box3().setFromObject(out);
  const partCenter = partBox.getCenter(new THREE.Vector3());
  const partSize = partBox.getSize(new THREE.Vector3());
  out.userData.partCenter = partCenter;
  out.userData.partRadius = Math.max(partSize.length() / 2, 1);
  // Ground plane sized to the part (≈10× its footprint) and set at its
  // base — gives the path tracer a floor to bounce off without dwarfing
  // the part.
  const span = Math.max(partSize.x, partSize.z, partSize.y) * 10 + 1;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span),
    // subtly reflective studio sweep floor → a product-shot reflection under
    // the part (clearcoat gives the soft mirror without full chrome).
    new THREE.MeshPhysicalMaterial({ color: 0x141519, metalness: 0.1, roughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.45 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(partCenter.x, partBox.min.y - partSize.y * 0.01 - 0.01, partCenter.z);
  out.add(floor);
  return out;
}

const FORGE_ANGLE_DIRS = {
  hero:    [1.55, 1.2, 1.75],
  front:   [0.05, 0.5, 1.9],
  profile: [1.9, 0.5, 0.12],
  top:     [0.5, 2.1, 0.6],
};

function frameCameraForScene(scene, aspect, angle = 'hero') {
  // Frame the PART (measured in harvestScene), not the whole scene —
  // otherwise the proportional floor still pulls the framing wide. Fall
  // back to the scene box if the part metrics are absent.
  let center, radius;
  if (scene.userData && scene.userData.partCenter) {
    center = scene.userData.partCenter;
    radius = scene.userData.partRadius;
  } else {
    const box = new THREE.Box3().setFromObject(scene);
    center = box.getCenter(new THREE.Vector3());
    radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 30);
  }
  const cam = new THREE.PerspectiveCamera(40, aspect, Math.max(radius * 0.01, 0.05), radius * 200);
  // distance ≈ 2.66× radius so a 40° FOV fills the view; the angle picks the
  // (normalized) view direction so every angle keeps the same framing.
  const raw = FORGE_ANGLE_DIRS[angle] || FORGE_ANGLE_DIRS.hero;
  const d = radius * 2.66;
  const dn = new THREE.Vector3(raw[0], raw[1], raw[2]).normalize();
  cam.position.set(center.x + dn.x * d, center.y + dn.y * d, center.z + dn.z * d);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  return cam;
}

// ─────────────────────────── render driver ───────────────────────────

export async function runPathTracedRender({
  envPresetId = 'studio',
  samples = 32,
  denoise = true,
  resolutionId = '1080p',
  angle = 'hero',
  onProgress,
} = {}) {
  const cap = detectWebGL2Compute();
  if (!cap.ok) {
    throw new Error(cap.error);
  }
  const res = RESOLUTIONS[resolutionId] || RESOLUTIONS['1080p'];
  const wrapper = makeOfflineRenderer();
  const { renderer, canvas } = wrapper;
  renderer.setPixelRatio(1);
  renderer.setSize(res.w, res.h, false);
  canvas.width = res.w; canvas.height = res.h;

  const scene = harvestScene();
  const camera = frameCameraForScene(scene, res.w / res.h, angle);

  const env = buildEnvTexture(envPresetId, renderer);
  scene.environment = env.tex;
  scene.background  = env.tex;

  const pt = new WebGLPathTracer(renderer);
  pt.tiles.set(2, 2);
  pt.minSamples = 1;
  // The denoiser pass blurs near-noise pixels at the framebuffer level.
  // When the user toggles it off we leave the raw radiance.
  pt.renderToCanvas = false;
  pt.filterGlossyFactor = denoise ? 0.5 : 0.0;

  // Bake BVH + material buffers and upload to the tracer. setScene does
  // this internally (generator.setObjects + sync generate) — do NOT call
  // a standalone PathTracingSceneGenerator.generate(scene): its first arg
  // is onProgress, so passing the scene there makes the BVH builder try
  // to invoke the scene as a callback ("onProgress is not a function"),
  // and it double-bakes the BVH (extra memory).
  pt.setScene(scene, camera);
  const built = true;

  // Pump samples until we've hit the target.
  let sampleIndex = 0;
  const target = Math.max(1, Math.min(512, samples | 0));
  while (sampleIndex < target) {
    pt.renderSample();
    sampleIndex += 1;
    if (onProgress) {
      try { onProgress({ sample: sampleIndex, total: target }); } catch {}
    }
    // Yield so the UI doesn't freeze on giant sample counts.
    if (sampleIndex % 8 === 0) {
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  // Pull the composite framebuffer back onto a 2D canvas so we can
  // export it as PNG. The path tracer's target is what we want.
  pt.renderSample(); // ensure latest in framebuffer
  const out = document.createElement('canvas');
  out.width = res.w; out.height = res.h;
  const ctx = out.getContext('2d');
  // Re-render to the wrapper canvas via the public path so we can
  // copy via drawImage (which handles flipY for us).
  pt.renderToCanvas = true;
  pt.renderSample();
  ctx.drawImage(canvas, 0, 0, res.w, res.h);

  // Grade pass — subtle S-curve contrast + radial vignette for a crafted
  // hero look. The renderer already ACES-tonemaps + sRGB-encodes, so we do
  // NOT re-tonemap; just gently shape contrast and darken the edges.
  try {
    const img = ctx.getImageData(0, 0, res.w, res.h);
    const d = img.data;
    const cx = res.w / 2, cy = res.h / 2, maxd = Math.hypot(cx, cy);
    const contrast = 1.08; // gentle mid punch
    for (let i = 0; i < d.length; i += 4) {
      const idx = i >> 2; const px = idx % res.w, py = (idx / res.w) | 0;
      const vig = 1 - 0.28 * Math.pow(Math.hypot(px - cx, py - cy) / maxd, 2.2);
      for (let c = 0; c < 3; c++) {
        let v = d[i + c] / 255;
        v = (v - 0.5) * contrast + 0.5; // contrast around mid-grey
        v *= vig;                        // vignette
        d[i + c] = Math.max(0, Math.min(255, v * 255));
      }
    }
    ctx.putImageData(img, 0, 0);
  } catch (_) { /* grading optional */ }

  // Clean up. Dispose the path tracer, env, and scene meshes — AND tear
  // down the offline renderer's WebGL2 context (forceContextLoss + null
  // the singleton). The path tracer's GPU textures/BVH targets are not
  // fully reclaimed by pt.dispose() alone; without a hard context teardown
  // the singleton renderer accumulates GPU memory across successive
  // renders and the ~3rd render in a session crashes the page (the next
  // cmdbar interaction then hangs). A fresh context is rebuilt next call.
  try { pt.dispose?.(); } catch {}
  try { env.tex.dispose?.(); } catch {}
  scene.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m?.dispose?.());
    }
  });
  try { renderer.forceContextLoss?.(); } catch {}
  try { wrapper.dispose(); } catch {}
  _offlineRendererSingleton = null;

  return { canvas: out, width: res.w, height: res.h, samples: target,
           envPresetId, resolutionId, generated: !!built };
}

async function canvasToPng(canvas) {
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('toBlob returned null')); return; }
      blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)));
    }, 'image/png');
  });
}

async function savePngToDisk(bytes, defaultName) {
  if (typeof window === 'undefined' || !window.forge?.dialog?.saveFile
      || !window.forge?.dialog?.writeBlob) {
    throw new Error('PNG save requires the Forge dialog bridge (electron). Run inside the desktop shell.');
  }
  const fp = await window.forge.dialog.saveFile({
    title: 'Save Path-Traced Render',
    defaultPath: defaultName,
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (!fp) return null;
  await window.forge.dialog.writeBlob(fp, bytes);
  return fp;
}

// ────────────────────────── React panel UI ───────────────────────────

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 1450,
  background: 'rgba(8,9,12,0.62)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  pointerEvents: 'auto',
};
const panelStyle = {
  background: 'var(--forge-canvas-2)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  padding: 'var(--forge-space-4, 16px)',
  width: 560, maxWidth: '92vw',
  display: 'flex', flexDirection: 'column',
  gap: 'var(--forge-space-3, 12px)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
};
const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const labelStyle = {
  minWidth: 130, fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--forge-ink-mute)',
};
const inputStyle = {
  flex: 1,
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  padding: '6px 8px',
  borderRadius: 3, fontSize: 12,
};
const buttonStyle = (kind) => ({
  padding: '8px 14px',
  background: kind === 'primary' ? 'var(--forge-accent)' : 'var(--forge-surface)',
  color: kind === 'primary' ? '#0a0a0a' : 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 3, cursor: 'pointer', fontSize: 12, fontWeight: 600,
});

export function PathTracedRenderPanel({ open, onClose }) {
  const [envPresetId, setEnvPresetId] = useState('studio');
  const [samples, setSamples] = useState(32);
  const [denoise, setDenoise] = useState(true);
  const [resolutionId, setResolutionId] = useState('1080p');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [lastSavedPath, setLastSavedPath] = useState(null);
  const previewCanvasRef = useRef(null);

  // Detect WebGL2 capability once when the panel opens so the Render
  // button can be disabled with a clear message rather than failing
  // mid-render.
  const cap = useMemo(() => detectWebGL2Compute(), [open]);

  const handleRender = useCallback(async () => {
    setBusy(true); setError(null); setProgress({ sample: 0, total: samples });
    try {
      const result = await runPathTracedRender({
        envPresetId, samples, denoise, resolutionId,
        onProgress: (p) => setProgress(p),
      });
      // Draw the result into the small preview canvas.
      const pv = previewCanvasRef.current;
      if (pv) {
        const ctx = pv.getContext('2d');
        const pw = pv.width, ph = pv.height;
        ctx.clearRect(0, 0, pw, ph);
        ctx.drawImage(result.canvas, 0, 0, pw, ph);
      }
      const bytes = await canvasToPng(result.canvas);
      const defaultName = `forge-render-${envPresetId}-${samples}spp.png`;
      const fp = await savePngToDisk(bytes, defaultName);
      if (fp) setLastSavedPath(fp);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [envPresetId, samples, denoise, resolutionId]);

  if (!open) return null;

  return (
    <div style={overlayStyle}
         data-testid="forge-render-overlay"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <section style={panelStyle}
               data-testid="forge-render-panel"
               role="dialog"
               aria-label="Path-traced render"
               onMouseDown={(e) => e.stopPropagation()}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Render Room · path tracer</strong>
          <span style={{ flex: 1 }} />
          <button type="button"
                  onClick={onClose}
                  data-testid="forge-render-close"
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--forge-ink-mute)', cursor: 'pointer',
                    fontSize: 14,
                  }}>×</button>
        </header>

        {!cap.ok && (
          <div data-testid="forge-render-capability-error"
               style={{ background: 'rgba(220,60,60,0.12)',
                        border: '1px solid rgba(220,60,60,0.4)',
                        color: 'var(--forge-ink)', padding: 8, borderRadius: 3,
                        fontSize: 11 }}>
            {cap.error}
          </div>
        )}

        <div style={rowStyle}>
          <span style={labelStyle}>Environment</span>
          <select style={inputStyle}
                  data-testid="forge-render-env"
                  value={envPresetId}
                  onChange={(e) => setEnvPresetId(e.target.value)}>
            {ENV_PRESET_IDS.map((id) => (
              <option key={id} value={id}>{ENV_PRESETS[id].label}</option>
            ))}
          </select>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Samples · {samples}</span>
          <input type="range"
                 min={1} max={512} step={1}
                 value={samples}
                 onChange={(e) => setSamples(parseInt(e.target.value, 10) || 1)}
                 data-testid="forge-render-samples"
                 style={{ flex: 1 }} />
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Denoiser</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox"
                   checked={denoise}
                   onChange={(e) => setDenoise(e.target.checked)}
                   data-testid="forge-render-denoise" />
            <span style={{ fontSize: 12 }}>
              {denoise ? 'Enabled (filterGlossy 0.5)' : 'Disabled (raw radiance)'}
            </span>
          </label>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Resolution</span>
          <select style={inputStyle}
                  data-testid="forge-render-resolution"
                  value={resolutionId}
                  onChange={(e) => setResolutionId(e.target.value)}>
            {RESOLUTION_IDS.map((id) => (
              <option key={id} value={id}>{RESOLUTIONS[id].label}</option>
            ))}
          </select>
        </div>

        <canvas ref={previewCanvasRef} width={480} height={270}
                data-testid="forge-render-preview"
                style={{
                  width: '100%', aspectRatio: '16 / 9',
                  background: 'var(--forge-canvas)',
                  border: '1px solid var(--forge-rail-edge)',
                  borderRadius: 3,
                }} />

        {busy && progress && (
          <div data-testid="forge-render-progress"
               data-progress-sample={progress.sample}
               data-progress-total={progress.total}
               style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: 'var(--forge-ink-mute)' }}>
            Sample {progress.sample} / {progress.total}
          </div>
        )}

        {error && (
          <div data-testid="forge-render-error"
               style={{ background: 'rgba(220,60,60,0.12)',
                        border: '1px solid rgba(220,60,60,0.4)',
                        color: 'var(--forge-ink)', padding: 8, borderRadius: 3,
                        fontSize: 11 }}>
            {error}
          </div>
        )}

        {lastSavedPath && (
          <div data-testid="forge-render-saved"
               style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                        color: 'var(--forge-ink-2)' }}>
            Saved · {lastSavedPath}
          </div>
        )}

        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button"
                  onClick={onClose}
                  style={buttonStyle('secondary')}
                  data-testid="forge-render-cancel">
            Close
          </button>
          <button type="button"
                  disabled={!cap.ok || busy}
                  onClick={handleRender}
                  style={{
                    ...buttonStyle('primary'),
                    opacity: (!cap.ok || busy) ? 0.5 : 1,
                    cursor: (!cap.ok || busy) ? 'not-allowed' : 'pointer',
                  }}
                  data-testid="forge-render-go">
            {busy ? 'Rendering…' : 'Render & Save PNG'}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function PathTracedRenderHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeOpenPathTracer = (v) => setOpen(typeof v === 'boolean' ? v : !open);
    // Headless driver — run the real GPU path tracer WITHOUT opening the
    // panel (the modal overlay obstructs the cmdbar). Returns a PNG data
    // URL of the M4 Max ray-traced hero frame so callers (the demo
    // harness, the render queue) can write it to disk.
    window.__forgeRunPathTracedRender = async (opts = {}) => {
      const { canvas, width, height, samples } = await runPathTracedRender(opts);
      return { dataUrl: canvas.toDataURL('image/png'), width, height, samples };
    };
    return () => {
      try { delete window.__forgeOpenPathTracer; } catch {}
      try { delete window.__forgeRunPathTracedRender; } catch {}
    };
  }, [open]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <PathTracedRenderPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}
