// Forge-111 — stress-test launcher panel.
//
// A small floating panel mounted next to the viewport that lets the
// user drop a 20k-bolt scene (or 25k mixed, or clear) directly into
// the live SceneMeshes pipeline. Built to validate Forge-106's
// InstancedMesh batching at scale.
//
// Architecture
// ------------
// ForgeShellV4.jsx is frozen for this slice, so the panel cannot poke
// into the shell's bodies state directly. Instead the host mounts a
// FULL-VIEWPORT OVERLAY containing its own copy of the exported
// `Viewport` component (which carries the same SceneMeshes / Forge-106
// InstancedGroup) into a portal layered on top of the shell. When the
// stress overlay is active:
//
//   - `window.__forgeRenderer` is republished by the overlay's own
//     RendererPublisher (Viewport.jsx:251), so PerfStatsHUD and the e2e
//     spec read the stress canvas's renderer.info — exactly what we
//     want to measure.
//   - `window.__forgeSetBodies(bodiesArray)` replaces the overlay's
//     body list in one shot.
//   - `window.__forgeStressEstimateDrawCalls(bodies)` returns the
//     count of distinct instance groups the overlay would mount; the
//     buttons use it for the estimated-draw-calls label.
//
// When the stress overlay is closed the shell viewport is unaffected
// and the original RendererPublisher reclaims `__forgeRenderer`.
//
// Manual button clicks NEVER post to Archie's thread — these are
// performance tooling, not feature operations.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Viewport } from './Viewport.jsx';
import {
  generateBolts20k,
  generateBrackets5k,
  generateMixedScene,
  generate100k,
} from './stressScenes.js';

/* =====================================================================
 * Draw-call estimator. Mirrors Viewport.SceneMeshes.instanceKeyFor()
 * so the panel's "est draw calls" label matches what the renderer will
 * actually do.
 * ===================================================================== */

function instanceKeyFor(body) {
  if (!body) return 'uniq:nil';
  if (body.instanceTag) return body.instanceTag;
  if (body.kind === 'synthetic' && body.spec) {
    const s = body.spec;
    return `syn:${s.kind}:${s.dx ?? ''}:${s.dy ?? ''}:${s.dz ?? ''}:` +
           `${s.r ?? ''}:${s.h ?? ''}:${s.R ?? ''}`;
  }
  return `uniq:${body.id}`;
}

export function estimateDrawCalls(bodies) {
  if (!Array.isArray(bodies) || bodies.length === 0) return 0;
  const groups = new Set();
  for (const b of bodies) groups.add(instanceKeyFor(b));
  return groups.size;
}

if (typeof window !== 'undefined') {
  window.__forgeStressEstimateDrawCalls = estimateDrawCalls;
}

/* =====================================================================
 * Visual styling — matches the existing forge panel tokens (see
 * StandardPartsLibrary + ProjectBundlePanel) so the overlay reads as
 * native UI, not a debug afterthought.
 * ===================================================================== */

const overlayCanvasStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 1400,             // below modals (1500+) but above shell chrome
  background: 'transparent',
  pointerEvents: 'auto',
};

const panelStyle = {
  position: 'fixed',
  top: 100,
  right: 24,
  zIndex: 1600,
  width: 280,
  background: 'rgba(13, 18, 26, 0.94)',
  color: '#ebecef',
  fontFamily: 'var(--forge-sans, -apple-system, ui-sans-serif, system-ui)',
  fontSize: 12,
  padding: 14,
  borderRadius: 8,
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
  pointerEvents: 'auto',
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 10,
};

const titleStyle = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.02em',
};

const closeBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: '#9aa3ad',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: 4,
};

const buttonStyle = {
  display: 'block',
  width: '100%',
  marginTop: 8,
  padding: '10px 12px',
  background: '#1f2a37',
  color: '#ebecef',
  border: '1px solid #2a3a4d',
  borderRadius: 5,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  textAlign: 'left',
  fontWeight: 500,
};

const callsBadgeStyle = {
  marginTop: 4,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: '#6cd0e8',
};

const statsRowStyle = {
  marginTop: 14,
  paddingTop: 10,
  borderTop: '1px solid #1f2a37',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: '#9aa3ad',
  lineHeight: 1.5,
};

/* =====================================================================
 * The panel UI itself. Three load buttons + a clear button + live
 * counters. Estimated draw calls are computed up-front for each
 * scene shape so the user knows what to expect before pressing.
 * ===================================================================== */

// Each scene declares its expected instance-group count analytically.
// Validated by the e2e spec (which calls estimateDrawCalls on the real
// generator output), so the label here is never out of sync with
// SceneMeshes' instanceKeyFor() without a test failure.
const SCENES = [
  {
    id: 'bolts20k',
    label: 'Load 20k bolts',
    sub:   '200 × 100 grid · instanceTag=bolt20k',
    expectedCalls: 1,
    make: generateBolts20k,
  },
  {
    id: 'mixed25k',
    label: 'Load 25k mixed',
    sub:   '6 part families · ~6 InstancedGroups',
    expectedCalls: 6,
    make: () => generateMixedScene(25000),
  },
  {
    id: 'brackets5k',
    label: 'Load 5k brackets',
    sub:   '100 × 50 grid · instanceTag=bracket5k',
    expectedCalls: 1,
    make: generateBrackets5k,
  },
  // Forge-125 — 100k spherical cloud + LOD streaming smoke test.
  {
    id: 'cloud100k',
    label: 'Load 100k cloud',
    sub:   'Fibonacci sphere · LOD streaming · radius 800mm',
    expectedCalls: 1,
    make: generate100k,
  },
];

export function StressTestPanel({ open, onClose, bodies, onLoadScene, onClear }) {
  // Live group count from the currently loaded scene. Cheap because
  // estimateDrawCalls just hashes by instanceTag — no per-body iteration
  // beyond a single Set add.
  const liveCalls = useMemo(() => estimateDrawCalls(bodies), [bodies]);
  // Forge-125 — live LOD streaming readout. Polls the scheduler's
  // metrics() at 4Hz so the panel reflects what the perf HUD shows.
  // Tagged with a stable test id so the e2e spec can assert "LOD
  // streaming kicked in" by waiting for high+med+low > 0.
  const [lod, setLod] = React.useState(null);
  React.useEffect(() => {
    if (!open) return undefined;
    let raf = 0;
    let last = 0;
    function tick(t) {
      if (t - last >= 250) {
        try { setLod(window.__forgeLodMetrics?.() || null); }
        catch { /* noop */ }
        last = t;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);
  if (!open) return null;
  return (
    <aside
      style={panelStyle}
      data-testid="forge-stress-test-panel"
      role="dialog"
      aria-label="Forge stress test"
    >
      <div style={headerStyle}>
        <div style={titleStyle}>Stress test · v4</div>
        <button
          type="button"
          style={closeBtnStyle}
          onClick={onClose}
          aria-label="Close stress test panel"
          data-testid="forge-stress-test-close"
        >
          ×
        </button>
      </div>
      {SCENES.map((s) => (
        <div key={s.id}>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => onLoadScene(s)}
            data-testid={`forge-stress-load-${s.id}`}
          >
            <div>{s.label}</div>
            <div style={{ fontSize: 10, color: '#9aa3ad', marginTop: 2 }}>
              {s.sub}
            </div>
          </button>
          <div style={callsBadgeStyle}>
            est draw calls: <strong>{s.expectedCalls}</strong>
            {' '}(1 per InstancedMesh group)
          </div>
        </div>
      ))}
      <button
        type="button"
        style={{ ...buttonStyle, background: '#3a2326', borderColor: '#572d2d' }}
        onClick={onClear}
        data-testid="forge-stress-clear"
      >
        Clear scene
      </button>
      <div style={statsRowStyle}>
        bodies in overlay: <strong style={{ color: '#ebecef' }}>
          {bodies.length.toLocaleString()}
        </strong><br />
        live draw groups: <strong style={{ color: '#ebecef' }}>
          {liveCalls}
        </strong><br />
        view: <span data-testid="forge-stress-view">{
          (typeof window !== 'undefined' && window.__forgeStressView) || 'iso'
        }</span>
      </div>
      {lod && lod.total > 0 && (
        <div style={statsRowStyle} data-testid="forge-stress-lod">
          LOD streaming:
          <br />
          <span style={{ color:'#7ec97e' }}>High {lod.high.toLocaleString()}</span>
          {' · '}
          <span style={{ color:'#e8c66c' }}>Med {lod.med.toLocaleString()}</span>
          {' · '}
          <span style={{ color:'#9aa3ad' }}>Low {lod.low.toLocaleString()}</span>
          <br />
          <span style={{ color:'#6b7380' }}>
            hidden {lod.hidden.toLocaleString()} ·
            pool {lod.poolBusy}/{lod.poolCap}
            {lod.queueDepth > 0 ? ` · q${lod.queueDepth}` : ''}
            {lod.fallback ? ' · synth' : ''}
          </span>
          {(lod.high > 0 || lod.med > 0 || lod.low > 0) && (
            <div data-testid="forge-stress-lod-active"
                 style={{ color:'#6cd0e8', marginTop: 4 }}>
              streaming active
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

/* =====================================================================
 * Self-mounting host. Mirrors the StandardPartsLibraryHost pattern so
 * ForgeShellV4 doesn't need to import or wire anything.
 *
 *   window.__forgeOpenStressTest(true|false)   → show / hide
 *   window.__forgeSetBodies(bodyArray)         → load a scene
 *   window.__forgeClearBodies()                → empty the overlay
 *   window.__forgeStressView = 'iso'|'top'|... → re-aim the overlay camera
 *   window.__forgeStressCenter()               → bump centerToken
 *
 * The overlay's Canvas is the same `Viewport` component the shell
 * mounts, so SceneMeshes + InstancedGroup are exercised identically.
 * ===================================================================== */

export function StressTestPanelHost() {
  const [open, setOpen] = useState(false);
  const [bodies, setBodiesState] = useState([]);
  const [view, setView] = useState('iso');
  const [centerToken, setCenterToken] = useState(0);
  const [displayState] = useState('shaded');

  // Wire the global setters. We expose readers too so the e2e spec
  // and DevTools can drive the overlay end-to-end.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const setBodies = (arr) => {
      if (!Array.isArray(arr)) {
        console.warn('[forge.v4.stress] __forgeSetBodies expects an array');
        return 0;
      }
      setBodiesState(arr);
      window.__forgeStressBodyCount = arr.length;
      return arr.length;
    };
    const clearBodies = () => {
      setBodiesState([]);
      window.__forgeStressBodyCount = 0;
    };
    const setStressView = (name) => {
      if (typeof name !== 'string') return;
      setView(name);
      window.__forgeStressView = name;
    };
    const center = () => setCenterToken((t) => t + 1);
    window.__forgeOpenStressTest = (v) =>
      setOpen(v === undefined ? true : !!v);
    window.__forgeSetBodies = setBodies;
    window.__forgeClearBodies = clearBodies;
    window.__forgeStressSetView = setStressView;
    window.__forgeStressCenter = center;
    return () => {
      try {
        delete window.__forgeOpenStressTest;
        delete window.__forgeSetBodies;
        delete window.__forgeClearBodies;
        delete window.__forgeStressSetView;
        delete window.__forgeStressCenter;
      } catch { /* noop */ }
    };
  }, []);

  // Keep the body count published live so the e2e spec can poll for
  // it without holding a React reference.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__forgeStressBodyCount = bodies.length;
    }
  }, [bodies.length]);

  // Sync the live view name to a global the panel can read.
  useEffect(() => {
    if (typeof window !== 'undefined') window.__forgeStressView = view;
  }, [view]);

  const onLoadScene = useCallback((scene) => {
    const arr = scene.make();
    setBodiesState(arr);
    if (typeof window !== 'undefined') {
      window.__forgeStressBodyCount = arr.length;
    }
  }, []);

  const onClear = useCallback(() => {
    setBodiesState([]);
    if (typeof window !== 'undefined') window.__forgeStressBodyCount = 0;
  }, []);

  // Render: the panel + (when open) a full-viewport overlay Canvas via
  // the exported Viewport component. Portal both to <body> so neither
  // is clipped by shell containers.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {open && (
        <div style={overlayCanvasStyle} data-testid="forge-stress-overlay">
          <Viewport
            steps={bodies}
            viewName={view}
            displayState={displayState}
            theme="dark"
            centerToken={centerToken}
            activeWb="stress"
          />
        </div>
      )}
      <StressTestPanel
        open={open}
        onClose={() => setOpen(false)}
        bodies={bodies}
        onLoadScene={onLoadScene}
        onClear={onClear}
      />
    </>,
    document.body,
  );
}

export default StressTestPanel;
