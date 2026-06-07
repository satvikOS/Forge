// PUSH-86 (Slice-54) — Zebra Stripes Class-A surface analysis overlay.
//
// What it does
// ────────────
// Toggles a Class-A "zebra stripes" reflection shader on every body in
// the live three.js scene. Stripe count + axis are user-adjustable from
// a small floating control panel anchored to the viewport's bottom-left.
// When toggled off, the original material on every body is restored.
//
// Wire-up
// ───────
//   • The toggle is reachable through the Tools menu (`tools.zebraStripes`).
//   • A self-mounting Host listens for the menu action and exposes
//     window.__forgeOpenZebraStripes(true|false) / __forgeToggleZebraStripes()
//     so plugins / Archie tool calls / the e2e spec can drive it.
//   • When enabled, the overlay traverses window.__forgeScene (published
//     by Viewport.jsx's RendererPublisher) once per frame: for every Mesh
//     whose userData.body is set (the tag Viewport.jsx applies to scene
//     bodies — see Viewport.jsx around L625), it saves the existing
//     `mesh.material` to `mesh.userData._origMaterial` and swaps in the
//     shared zebra ShaderMaterial. New bodies that appear while zebra is
//     on are absorbed automatically on the next tick.
//   • cameraPosWorld is updated every frame from window.__forgeCamera so
//     the reflection vector stays correct as the user orbits.
//   • Disable: traverse the scene, restore _origMaterial, delete the key,
//     dispose the shared ShaderMaterial.
//
// We do NOT modify Viewport.jsx — userData.body is already set by it on
// every body mesh, so swapping `mesh.material` from this overlay is
// non-invasive.
//
// Hard constraints
// ────────────────
//   • NO new npm packages — three.js is already in frontend/package.json.
//   • Real impl, no MVP / stub / placeholder.
//   • Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).
//   • Multi-cam e2e: 5 named camera angles per Forge-171 mandate.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ZEBRA_VERTEX_SHADER,
  ZEBRA_FRAGMENT_SHADER,
  ZEBRA_DEFAULTS,
  ZEBRA_AXIS_PRESETS,
  ZEBRA_MATERIAL_NAME,
  buildZebraUniforms,
} from './zebraShader.js';

export const FORGE_ZEBRA_EVENT = 'forge:zebra-stripes-changed';
// userData key under which the original mesh.material is parked so we
// can restore it when zebra is toggled off. Exported for the e2e spec.
export const ZEBRA_USERDATA_KEY = '_origMaterial';

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — exported for tests / Archie tool calls.

/** Count meshes in the scene whose userData.body is set (i.e. the body
 *  meshes Viewport.jsx tags). Defensive against a missing scene. */
export function countBodyMeshes(scene) {
  if (!scene || typeof scene.traverse !== 'function') return 0;
  let n = 0;
  scene.traverse((obj) => {
    if (obj && obj.isMesh && obj.userData && obj.userData.body) n += 1;
  });
  return n;
}

/** Count meshes whose material has been swapped to the zebra shader.
 *  We identify them by their material.name === ZEBRA_MATERIAL_NAME so
 *  even if multiple shader-material instances are in play (shouldn't
 *  happen — we use a single shared material — but defensive) we still
 *  catch them. */
export function countZebraSwappedMeshes(scene) {
  if (!scene || typeof scene.traverse !== 'function') return 0;
  let n = 0;
  scene.traverse((obj) => {
    if (obj && obj.isMesh && obj.material &&
        obj.material.name === ZEBRA_MATERIAL_NAME) n += 1;
  });
  return n;
}

// ─────────────────────────────────────────────────────────────────────
// Floating control panel — rendered through createPortal so it lives on
// top of the viewport without inheriting viewport CSS.

const PANEL_STYLE = {
  position: 'fixed',
  left: 'calc(var(--forge-wb-rail-w, 56px) + var(--forge-space-3, 12px))',
  bottom: 'calc(var(--forge-statusbar-h, 24px) + var(--forge-cmdbar-h, 36px) + 16px)',
  width: 280,
  zIndex: 1330,
  background: 'var(--forge-canvas-2, #161b22)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 'var(--forge-radius, 6px)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 8,
  color: 'var(--forge-ink, #dadde2)',
  fontSize: 12,
  fontFamily: 'var(--forge-sans, ui-sans-serif, system-ui)',
  boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 3,
};
const LABELED_BLOCK = {
  display: 'flex', flexDirection: 'column', gap: 4,
};
const FIELD_LABEL = {
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
const SLIDER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const SLIDER_INPUT = {
  flex: 1,
  accentColor: 'var(--forge-accent, #4f87ff)',
};
const READOUT = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  color: 'var(--forge-ink, #dadde2)',
  minWidth: 36,
  textAlign: 'right',
};
const AXIS_ROW = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 4,
};
const AXIS_BTN = (active) => ({
  background: active ? 'var(--forge-accent, #4f87ff)' : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: active ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
});

// ─────────────────────────────────────────────────────────────────────
// Control panel UI.

function ZebraControlPanel({
  active, stripeCount, stripeWidth, axisPresetId,
  onStripeCount, onStripeWidth, onAxisPreset, onClose,
}) {
  if (!active) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div role="dialog"
         aria-label="Zebra stripes surface analysis"
         data-testid="forge-zebra-stripes-panel"
         data-stripe-count={stripeCount}
         data-axis={axisPresetId}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>Zebra Stripes</span>
        <span data-testid="forge-zebra-stripes-status"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-accent, #4f87ff)',
                padding: '1px 6px',
                borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          ACTIVE
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Disable zebra stripes overlay"
                data-testid="forge-zebra-stripes-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={LABELED_BLOCK}>
        <span style={FIELD_LABEL}>Stripe count</span>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={2}
                 max={96}
                 step={1}
                 value={stripeCount}
                 onChange={(e) => onStripeCount(Number(e.target.value))}
                 data-testid="forge-zebra-stripes-count-slider"
                 style={SLIDER_INPUT} />
          <span data-testid="forge-zebra-stripes-count-readout"
                style={READOUT}>{stripeCount}</span>
        </div>
      </div>

      <div style={LABELED_BLOCK}>
        <span style={FIELD_LABEL}>Stripe width</span>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={0.1}
                 max={0.9}
                 step={0.05}
                 value={stripeWidth}
                 onChange={(e) => onStripeWidth(Number(e.target.value))}
                 data-testid="forge-zebra-stripes-width-slider"
                 style={SLIDER_INPUT} />
          <span data-testid="forge-zebra-stripes-width-readout"
                style={READOUT}>{stripeWidth.toFixed(2)}</span>
        </div>
      </div>

      <div style={LABELED_BLOCK}>
        <span style={FIELD_LABEL}>Axis</span>
        <div style={AXIS_ROW}>
          {ZEBRA_AXIS_PRESETS.map((p) => (
            <button key={p.id}
                    type="button"
                    onClick={() => onAxisPreset(p.id)}
                    data-testid={`forge-zebra-stripes-axis-${p.id}`}
                    data-axis-id={p.id}
                    aria-pressed={axisPresetId === p.id}
                    style={AXIS_BTN(axisPresetId === p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        fontSize: 10,
        color: 'var(--forge-ink-mute, #9aa1ab)',
        marginTop: 4,
        lineHeight: 1.4,
      }}>
        Class-A surface continuity test. Look for kinks, breaks, or wobbles
        in the stripes — they indicate G0 / G1 / G2 defects.
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — owns the active state, the shared ShaderMaterial, and the
// per-frame scene traversal. Self-mounting under <App/>.

export function ZebraStripesOverlayHost() {
  const [active, setActive] = useState(false);
  const [stripeCount, setStripeCount] = useState(ZEBRA_DEFAULTS.stripeCount);
  const [stripeWidth, setStripeWidth] = useState(ZEBRA_DEFAULTS.stripeWidth);
  const [axisPresetId, setAxisPresetId] = useState('horizontal');

  // Shared material — created lazily on first activation, disposed when
  // the host unmounts. Holding a single instance means every swapped
  // mesh shares the same uniforms (uniform updates show on every body
  // simultaneously).
  const matRef = useRef(null);
  const threeRef = useRef(null);   // resolved THREE module
  const rafRef = useRef(0);
  const mountedRef = useRef(false);

  // ─── Activation source: window event + menu action.
  useEffect(() => {
    if (mountedRef.current) return undefined;
    mountedRef.current = true;
    if (typeof window === 'undefined') return undefined;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.zebraStripes') {
        setActive((prev) => !prev);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    window.__forgeOpenZebraStripes = (v) => setActive(!!v);
    window.__forgeToggleZebraStripes = () => setActive((prev) => !prev);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenZebraStripes; } catch {}
      try { delete window.__forgeToggleZebraStripes; } catch {}
    };
  }, []);

  // ─── Build / dispose the shared ShaderMaterial.
  // Lazy-loads three so the host doesn't pull the whole 800 kB three
  // bundle into the bootstrap path if zebra is never used.
  useEffect(() => {
    let cancelled = false;
    if (!active) return undefined;
    (async () => {
      if (!threeRef.current) {
        try {
          threeRef.current = await import('three');
        } catch (err) {
          console.warn('[forge.v4.zebra-stripes] three load failed:', err.message);
          return;
        }
      }
      if (cancelled) return;
      const THREE = threeRef.current;
      if (!matRef.current) {
        const preset = ZEBRA_AXIS_PRESETS.find((p) => p.id === axisPresetId)
                       || ZEBRA_AXIS_PRESETS[0];
        const uniforms = buildZebraUniforms({
          stripeCount,
          stripeWidth,
          axisX: preset.axis[0],
          axisY: preset.axis[1],
          axisZ: preset.axis[2],
        });
        // Three's uniform vec3 wants a THREE.Vector3 instance — rebuild
        // the plain-object {x,y,z} pairs as Vector3 so WebGL gets the
        // right glUniform3fv driver. We do this after the buildZebra
        // helper returns to keep the helper pure (it's exported for the
        // e2e to verify default values without importing three).
        uniforms.axis.value         = new THREE.Vector3(uniforms.axis.value.x,
                                                       uniforms.axis.value.y,
                                                       uniforms.axis.value.z);
        uniforms.stripeColorA.value = new THREE.Vector3(uniforms.stripeColorA.value.x,
                                                       uniforms.stripeColorA.value.y,
                                                       uniforms.stripeColorA.value.z);
        uniforms.stripeColorB.value = new THREE.Vector3(uniforms.stripeColorB.value.x,
                                                       uniforms.stripeColorB.value.y,
                                                       uniforms.stripeColorB.value.z);
        uniforms.cameraPosWorld.value = new THREE.Vector3(0, 0, 0);
        const mat = new THREE.ShaderMaterial({
          uniforms,
          vertexShader: ZEBRA_VERTEX_SHADER,
          fragmentShader: ZEBRA_FRAGMENT_SHADER,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        mat.name = ZEBRA_MATERIAL_NAME;
        matRef.current = mat;
      }
    })();
    return () => { cancelled = true; };
  }, [active, axisPresetId, stripeCount, stripeWidth]);

  // ─── Per-frame loop. Two responsibilities:
  //
  //   1. Update the shared material's `cameraPosWorld` uniform from the
  //      live camera. The reflection vector depends on view direction,
  //      so this MUST run every frame, not just on slider drag.
  //
  //   2. Swap every body mesh's material to the zebra material, stashing
  //      the original on userData[_origMaterial]. New bodies that appear
  //      between frames are caught automatically because we re-traverse
  //      every tick.
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const scene = (typeof window !== 'undefined') ? window.__forgeScene : null;
      const cam   = (typeof window !== 'undefined') ? window.__forgeCamera : null;
      const mat   = matRef.current;
      if (scene && mat) {
        if (cam && mat.uniforms?.cameraPosWorld) {
          mat.uniforms.cameraPosWorld.value.set(cam.position.x,
                                                cam.position.y,
                                                cam.position.z);
        }
        scene.traverse((obj) => {
          if (!obj || !obj.isMesh) return;
          // Only swap on body meshes (tagged by Viewport.jsx).
          if (!obj.userData || !obj.userData.body) return;
          // Skip our own zebra material (re-entry-safe).
          if (obj.material && obj.material.name === ZEBRA_MATERIAL_NAME) return;
          // Stash the original. We use a property name with a leading
          // underscore so feature-tree serialisers ignore it.
          if (!obj.userData[ZEBRA_USERDATA_KEY]) {
            obj.userData[ZEBRA_USERDATA_KEY] = obj.material;
          }
          obj.material = mat;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  // ─── Uniform updates from sliders.
  // Three doesn't auto-trigger a re-render on uniform mutation — but the
  // RAF tick above runs every frame, so dragging a slider hits the
  // material on the very next frame.
  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;
    if (mat.uniforms?.stripeCount) mat.uniforms.stripeCount.value = stripeCount;
    if (mat.uniforms?.stripeWidth) mat.uniforms.stripeWidth.value = stripeWidth;
  }, [stripeCount, stripeWidth]);
  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;
    const preset = ZEBRA_AXIS_PRESETS.find((p) => p.id === axisPresetId)
                   || ZEBRA_AXIS_PRESETS[0];
    if (mat.uniforms?.axis?.value?.set) {
      mat.uniforms.axis.value.set(preset.axis[0], preset.axis[1], preset.axis[2]);
    }
  }, [axisPresetId]);

  // ─── Deactivation path: restore every swapped mesh's original
  // material and dispose the shared material so the GPU program is
  // released. We run this as a transition into !active — the cleanup
  // path covers component unmount too.
  useEffect(() => {
    if (active) return undefined;
    return undefined;
  }, [active]);

  useEffect(() => {
    // Restore-on-deactivate. We do this in a separate effect keyed off
    // active so React runs the cleanup BEFORE the next active=true run.
    if (active) return undefined;
    if (typeof window === 'undefined') return undefined;
    const scene = window.__forgeScene;
    if (scene && typeof scene.traverse === 'function') {
      scene.traverse((obj) => {
        if (!obj || !obj.isMesh || !obj.userData) return;
        const orig = obj.userData[ZEBRA_USERDATA_KEY];
        if (orig) {
          obj.material = orig;
          delete obj.userData[ZEBRA_USERDATA_KEY];
        }
      });
    }
    // Dispose the shader so the GPU program is released. Three caches
    // by program key — a clean rebuild on the next activation picks up
    // any GLSL string changes (none today, but defensive).
    if (matRef.current) {
      try { matRef.current.dispose(); } catch {}
      matRef.current = null;
    }
    return undefined;
  }, [active]);

  // ─── Publish the active state on a stable global + bus event so
  // plugins / the e2e spec / Archie can observe transitions without
  // mounting React.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeZebraStripes = Object.freeze({
      active,
      stripeCount,
      stripeWidth,
      axisPresetId,
    });
    try {
      window.dispatchEvent(new CustomEvent(FORGE_ZEBRA_EVENT, {
        detail: { active, stripeCount, stripeWidth, axisPresetId },
      }));
    } catch {}
  }, [active, stripeCount, stripeWidth, axisPresetId]);

  // ─── Headless helper API mirror for plugins / Archie / e2e.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeZebraStripesHelper = Object.freeze({
      countBodyMeshes,
      countZebraSwappedMeshes,
      ZEBRA_MATERIAL_NAME,
      ZEBRA_USERDATA_KEY,
      AXIS_PRESETS: ZEBRA_AXIS_PRESETS,
      DEFAULTS: ZEBRA_DEFAULTS,
      EVENT_NAME: FORGE_ZEBRA_EVENT,
    });
    return () => {
      try { delete window.__forgeZebraStripesHelper; } catch {}
    };
  }, []);

  // ─── Bridge slider state through callbacks.
  const onStripeCountChange = useCallback((v) => setStripeCount(v), []);
  const onStripeWidthChange = useCallback((v) => setStripeWidth(v), []);
  const onAxisPresetChange  = useCallback((id) => setAxisPresetId(id), []);
  const onClose             = useCallback(() => setActive(false), []);

  return (
    <ZebraControlPanel active={active}
                       stripeCount={stripeCount}
                       stripeWidth={stripeWidth}
                       axisPresetId={axisPresetId}
                       onStripeCount={onStripeCountChange}
                       onStripeWidth={onStripeWidthChange}
                       onAxisPreset={onAxisPresetChange}
                       onClose={onClose} />
  );
}

export default ZebraStripesOverlayHost;
