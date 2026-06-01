// Forge-126 — SurfaceAnalysisOverlay.
//
// Three.js overlay that draws class-A diagnostics on top of the
// existing forge viewport. Listens to the
// `forge:surface-analysis` window event (fired by surfacingDispatch
// when any Analysis op succeeds) and renders the matching primitive:
//
//   • porcupine          — needles, length ∝ local curvature
//   • reflection-lines   — polylines where ⟨n,light⟩ crosses a band
//   • isoclines          — polylines where ⟨n,axis⟩ = target
//   • draft              — coloured point cloud, undercut / safe / positive
//
// The overlay is its own absolutely-positioned <canvas>, sized to match
// the viewport and mounted in the corner of the forge-app grid (no
// changes to Viewport.jsx required). It renders only when a payload
// exists and only re-renders on resize / payload swap / camera tick.
//
// Cleared by dispatching forge:surface-analysis with detail.kind ===
// 'clear' or by clicking the overlay's close chip.
//
// Lazy-loads three; the file is a no-op in SSR.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SURFACE_ANALYSIS_EVENT } from './surfacingDispatch.js';

// ────────── projection helper ──────────
// Project a 3-D world point into the overlay canvas given the active
// renderer's camera. We piggy-back on window.__forgeRenderer (exposed
// by Viewport.jsx → RendererPublisher). If that's missing we draw
// nothing.
function project(point3, camera, w, h) {
  const v = camera.__work.copy({ x: point3[0], y: point3[1], z: point3[2] });
  v.project(camera);
  return {
    x: (v.x + 1) * 0.5 * w,
    y: (1 - v.y) * 0.5 * h,
    z: v.z,
  };
}

// Convert a draft-band id to a stroke colour. Uses the brand greys +
// warn/err signals (we are allowed warn/err as signals per tokens.css).
function draftColor(band) {
  if (band === 'undercut') return 'rgba(226,106,106,0.85)';   // forge-err
  if (band === 'positive') return 'rgba(92,200,143,0.85)';    // forge-ok
  return 'rgba(225,178,80,0.85)';                              // forge-warn (safe ≈ neutral)
}

// Lighten / darken by a small ramp for reflection lines.
function reflectionColor(idx, total) {
  const t = total <= 1 ? 0.5 : idx / (total - 1);
  const v = Math.round(140 + 100 * t);
  return `rgba(${v},${v},${v},0.9)`;
}

// ────────── overlay component ──────────
export function SurfaceAnalysisOverlay() {
  const [payload, setPayload] = useState(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const cameraRef = useRef(null);

  // Hook into the dispatch event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onEvt = (e) => {
      if (!e?.detail) return;
      if (e.detail.kind === 'clear' || e.detail.clear === true) {
        setPayload(null);
        return;
      }
      setPayload(e.detail);
    };
    window.addEventListener(SURFACE_ANALYSIS_EVENT, onEvt);
    // Imperative entry point — convenient for tests / Archie.
    window.__forgeSurfaceAnalysis = (detail) => {
      window.dispatchEvent(new CustomEvent(SURFACE_ANALYSIS_EVENT, { detail }));
    };
    window.__forgeClearSurfaceAnalysis = () => {
      window.dispatchEvent(new CustomEvent(SURFACE_ANALYSIS_EVENT,
                                           { detail: { kind: 'clear' } }));
    };
    return () => {
      window.removeEventListener(SURFACE_ANALYSIS_EVENT, onEvt);
      delete window.__forgeSurfaceAnalysis;
      delete window.__forgeClearSurfaceAnalysis;
    };
  }, []);

  // Track the active camera via window.__forgeRenderer (exposed by
  // Viewport.jsx). We poll once per frame — three.js doesn't fire a
  // global "camera changed" event.
  useEffect(() => {
    if (typeof window === 'undefined' || !payload) return;
    let cancelled = false;
    (async () => {
      try {
        const three = await import('three');
        if (cancelled) return;
        const Vector3 = three.Vector3;
        const tick = () => {
          if (cancelled) return;
          const gl = window.__forgeRenderer;
          if (gl && gl.xr && gl.xr.getCamera) {
            // R3F sets a camera through useThree(); we keep a soft
            // reference via the renderer's auto-bound scene's owner.
          }
          // The renderer doesn't directly expose the camera — but R3F
          // stores it on gl.userData.camera if we patched, else we
          // sniff via gl.__r3f? Fall back to scanning the DOM.
          const cam = window.__forgeCamera || null;
          if (cam) {
            cameraRef.current = cam;
            if (!cam.__work) cam.__work = new Vector3();
          }
          render();
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        console.warn('[forge.v4.surface-analysis] three load failed:', err.message);
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [payload]);

  // Resize handler — keep the canvas pixel-perfect with the viewport.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      const c = canvasRef.current;
      if (!c) return;
      c.width = c.clientWidth * window.devicePixelRatio;
      c.height = c.clientHeight * window.devicePixelRatio;
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [payload]);

  function render() {
    const c = canvasRef.current;
    if (!c || !payload) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const cam = cameraRef.current;
    if (!cam) {
      // Camera unavailable — paint a legible HUD chip in the corner so
      // the user knows the overlay is alive but waiting.
      ctx.font = `${11 * window.devicePixelRatio}px var(--forge-mono, monospace)`;
      ctx.fillStyle = 'rgba(235,236,239,0.55)';
      ctx.fillText(`analysis · ${payload.kind || payload.op} · awaiting camera`,
                   12 * window.devicePixelRatio, 18 * window.devicePixelRatio);
      return;
    }
    const w = c.width, h = c.height;
    const r = payload.result || {};
    if (payload.kind === 'porcupine' && Array.isArray(r.needles)) {
      ctx.strokeStyle = 'rgba(235,236,239,0.85)';
      ctx.lineWidth = 1.0 * window.devicePixelRatio;
      for (const n of r.needles) {
        const a = project(n.base, cam, w, h);
        const b = project(n.tip,  cam, w, h);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // Tip dot.
        ctx.fillStyle = 'rgba(225,178,80,0.95)';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 1.5 * window.devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (payload.kind === 'reflection-lines' && Array.isArray(r.lines)) {
      ctx.lineWidth = 1.5 * window.devicePixelRatio;
      r.lines.forEach((segments, i) => {
        ctx.strokeStyle = reflectionColor(i, r.lines.length);
        ctx.beginPath();
        segments.forEach((p, k) => {
          const q = project(p, cam, w, h);
          if (k === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();
      });
    } else if (payload.kind === 'isoclines' && Array.isArray(r.levels)) {
      ctx.lineWidth = 1.0 * window.devicePixelRatio;
      r.levels.forEach((level, i) => {
        const v = 120 + (i * 13) % 100;
        ctx.strokeStyle = `rgba(${v},${v + 30},${v},0.9)`;
        ctx.beginPath();
        level.points.forEach((p, k) => {
          const q = project(p, cam, w, h);
          if (k === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();
      });
    } else if (payload.kind === 'draft' && Array.isArray(r.bands)) {
      for (const b of r.bands) {
        const p = project(b.point, cam, w, h);
        ctx.fillStyle = draftColor(b.band);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5 * window.devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (payload.kind === 'envmap' && Array.isArray(r.vertices)) {
      for (const v of r.vertices) {
        const p = project(v.point, cam, w, h);
        const [cr, cg, cb] = v.color;
        ctx.fillStyle = `rgba(${cr * 255 | 0},${cg * 255 | 0},${cb * 255 | 0},0.7)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5 * window.devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (payload.kind === 'distance' && Array.isArray(r.points)) {
      const span = (r.max - r.min) || 1;
      for (const pt of r.points) {
        const p = project(pt.point, cam, w, h);
        const t = (pt.distance - r.min) / span;
        const grey = 120 + Math.round(120 * t);
        ctx.fillStyle = `rgba(${grey},${grey},${grey},0.7)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.0 * window.devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (payload.kind === 'comparison' && Array.isArray(r.points)) {
      const span = (r.max - r.min) || 1;
      ctx.lineWidth = 1 * window.devicePixelRatio;
      for (const pt of r.points) {
        const a = project(pt.point, cam, w, h);
        const b = project(pt.projected, cam, w, h);
        const t = (pt.distance - r.min) / span;
        const tinted = t > 0.66 ? 'rgba(226,106,106,0.8)'
                     : t > 0.33 ? 'rgba(225,178,80,0.8)'
                                : 'rgba(92,200,143,0.8)';
        ctx.strokeStyle = tinted;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else {
      // Unknown kind — paint a corner chip so test screenshots show
      // that the overlay received the event.
      ctx.font = `${11 * window.devicePixelRatio}px var(--forge-mono, monospace)`;
      ctx.fillStyle = 'rgba(235,236,239,0.55)';
      ctx.fillText(`analysis · ${payload.kind || payload.op}`,
                   12 * window.devicePixelRatio, 18 * window.devicePixelRatio);
    }
    // Legend chip — always visible while a payload exists.
    ctx.font = `${10 * window.devicePixelRatio}px var(--forge-mono, monospace)`;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(8 * window.devicePixelRatio, 8 * window.devicePixelRatio,
                 220 * window.devicePixelRatio, 22 * window.devicePixelRatio);
    ctx.fillStyle = 'rgba(235,236,239,0.95)';
    ctx.fillText(`${payload.kind || payload.op} · face ${payload.face ?? '—'}`,
                 14 * window.devicePixelRatio, 22 * window.devicePixelRatio);
  }

  if (!payload) return null;
  return (
    <div data-testid="forge-surface-analysis-overlay"
         data-kind={payload.kind || payload.op}
         style={{ position: 'fixed',
                  pointerEvents: 'none',
                  left: 'var(--forge-wb-rail-w)',
                  right: 'var(--forge-right-w)',
                  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h) + var(--forge-toolbar-h))',
                  bottom: 'calc(var(--forge-statusbar-h) + var(--forge-cmdbar-h))',
                  zIndex: 1100 }}>
      <canvas ref={canvasRef}
              style={{ width: '100%', height: '100%' }} />
      <button type="button"
              data-testid="forge-surface-analysis-clear"
              aria-label="Clear surface analysis overlay"
              onClick={() => setPayload(null)}
              style={{ position: 'absolute',
                       top: 8, right: 8,
                       background: 'rgba(0,0,0,0.55)',
                       border: '1px solid var(--forge-rail-edge)',
                       borderRadius: 'var(--forge-radius)',
                       color: 'var(--forge-ink)',
                       fontFamily: 'var(--forge-mono)',
                       fontSize: 10,
                       padding: '4px 8px',
                       cursor: 'pointer',
                       pointerEvents: 'auto' }}>
        clear analysis
      </button>
    </div>
  );
}

// Self-mounting host so App.jsx only adds one line.
export function SurfaceAnalysisOverlayHost() {
  return <SurfaceAnalysisOverlay />;
}
