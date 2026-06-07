// PUSH-207 (Slice-161) — 100k real-geometry assembly stress harness panel.
//
// Self-mounting right-docked panel that drives stress100kMath's
// generate100kAssembly through the live OCCT kernel + commits the
// resulting 100k body records into window.__forgeBodies via the
// existing __forgeSetBodies channel (the same path PUSH-94's
// BigSceneStressPanel + Forge-111's StressTestPanel use to swap
// scenes).
//
// What makes this panel different from BigSceneStressPanel:
//   • Real kernel handles. ~20 OCCT template B-reps produced by
//     window.forge.makeBox / makeCylinder / makeSphere, with 100k
//     bodies pointing at them via `handle` + `templateId`. The Big
//     Scene panel uses a sidecar THREE.InstancedMesh — no kernel.
//   • Generates into the MAIN viewport. The PUSH-204 octree culling
//     ticker reads __forgeBodies, builds an OctreeIndex, and publishes
//     `window.__forgeVisibleBodies` — the panel reads this to compute
//     the culling ratio for the headline stat.
//   • Tracks live FPS via requestAnimationFrame after generation,
//     averaged over 60 frames.
//
// Reachable via:
//   • Tools › "100k Assembly Stress…" menu entry (PUSH-207 patch to
//     Menus.jsx adds `tools.stress100k`).
//   • window.__forgeOpenStress100k() — imperative open hook.
//
// The panel writes its current run summary to
// window.__forgeStress100kLast so the e2e + Archie can read it
// without scraping the DOM.

import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  generate100kAssembly, snapshotJsHeap, formatBytes,
  sampleFps, readVisibleBodyCount,
  STRESS_100K_CHUNK_SIZE,
} from './stress100kMath.js';

// ─────────────────────────────────────────────────────────────────────
// Styles — match the right-docked Forge panel tokens (see
// DiagnosticDumpPanel + BigSceneStressPanel).

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 480,
  zIndex: 1340,
  background: 'var(--forge-canvas-2, #131820)',
  borderLeft: '1px solid var(--forge-rail-edge, #1f2a37)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #ebecef)', fontSize: 12,
  overflow: 'auto',
};
const headerStyle = {
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 8,
};
const closeBtn = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
  color: 'var(--forge-ink, #ebecef)', cursor: 'pointer',
  padding: '2px 8px', borderRadius: 3, fontSize: 14, lineHeight: '16px',
};
const helpStyle = {
  color: 'var(--forge-ink-mute, #8a93a0)', lineHeight: 1.45, fontSize: 11,
};
const sliderRowStyle = { display: 'flex', alignItems: 'center', gap: 8 };
const bigBtnStyle = {
  background: 'var(--forge-accent, #2e7be0)', color: '#fff',
  border: '1px solid var(--forge-accent, #2e7be0)',
  padding: '8px 12px', cursor: 'pointer',
  fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
  fontWeight: 600, fontSize: 12, borderRadius: 4,
  textAlign: 'center', flex: 1,
};
const altBtnStyle = {
  ...bigBtnStyle, background: 'transparent',
  color: 'var(--forge-ink, #ebecef)',
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
};
const progressTrackStyle = {
  height: 8, background: 'var(--forge-canvas-1, #0a0d12)',
  borderRadius: 4, overflow: 'hidden',
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
};
const progressFillStyle = (frac) => ({
  height: '100%', width: `${Math.max(0, Math.min(1, frac)) * 100}%`,
  background: 'var(--forge-accent, #2e7be0)',
  transition: 'width 120ms linear',
});
const statsGridStyle = {
  display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 6, fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
  fontSize: 11,
};
const chipStyle = {
  background: 'var(--forge-surface, #1a212c)',
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
  borderRadius: 4, padding: '8px 10px',
  display: 'flex', flexDirection: 'column', gap: 4,
};
const chipLabel = {
  color: 'var(--forge-ink-mute, #8a93a0)', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const chipValue = {
  color: 'var(--forge-ink, #ebecef)',
  fontSize: 14, fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

// ─────────────────────────────────────────────────────────────────────
// Initial / empty stat shape. Used by setState + the e2e read.
const EMPTY_STATS = Object.freeze({
  wallClockMs:      0,
  templateBuildMs:  0,
  bodyLoopMs:       0,
  bodyCount:        0,
  templateCount:    0,
  templateFailures: 0,
  memoryBefore:     null,
  memoryAfter:      null,
  memoryDeltaBytes: null,
  fps:              0,
  msPerFrame:       0,
  fpsFrames:        0,
  visibleCount:     0,
  cullingRatio:     0,
  seed:             0,
});

// Panel target ranges (matches the brief — 1k..200k, default 100k).
const TARGET_MIN  = 1000;
const TARGET_MAX  = 200000;
const TARGET_STEP = 1000;

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function Stress100kPanel({ open, onClose }) {
  const [target, setTarget] = useState(100000);
  const [phase, setPhase] = useState('idle');
  // 'idle' | 'templates' | 'bodies' | 'committing' | 'sampling-fps' | 'done' | 'error'
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [error, setError] = useState(null);
  const cancelRef = useRef(false);

  // Mirror phase into a data attribute on the panel root so the e2e can
  // wait for stable transitions without polling React state.

  const onGenerate = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const kernel = window.forge;
    if (!kernel
        || typeof kernel.makeBox !== 'function'
        || typeof kernel.makeCylinder !== 'function'
        || typeof kernel.makeSphere !== 'function') {
      setError('window.forge kernel missing makeBox/makeCylinder/makeSphere — '
             + 'open the Electron app, not the vite preview.');
      setPhase('error');
      return;
    }
    cancelRef.current = false;
    setError(null);
    setProgress(0);
    setStats(EMPTY_STATS);
    setPhase('templates');
    // Tiny await so React paints the templates state before the
    // synchronous kernel calls fire.
    await new Promise((r) => setTimeout(r, 0));

    const memBefore = snapshotJsHeap();

    let result = null;
    try {
      setPhase('bodies');
      result = await generate100kAssembly({
        targetBodyCount: target,
        kernel,
        chunkSize: STRESS_100K_CHUNK_SIZE,
        onProgress: (frac) => {
          if (cancelRef.current) return;
          setProgress(frac);
        },
      });
    } catch (err) {
      setError(String(err?.message || err));
      setPhase('error');
      return;
    }
    if (cancelRef.current) {
      setPhase('idle');
      return;
    }
    // Commit the bodies through __forgeSetBodies so the v4 shell
    // rebuilds the feature tree + SceneMeshes batches the InstancedGroup.
    setPhase('committing');
    setProgress(1);
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (typeof window.__forgeSetBodies === 'function') {
        window.__forgeSetBodies(result.bodies);
      } else {
        window.__forgeBodies = result.bodies;
        try {
          window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
            detail: { count: result.bodies.length, source: 'stress100k' },
          }));
        } catch { /* fail-soft */ }
      }
    } catch (err) {
      setError(`Body commit failed: ${err?.message || err}`);
      setPhase('error');
      return;
    }
    // Wait a few rAF ticks so the SceneMeshes batcher mounts the new
    // InstancedGroups AND the OctreeCullingTicker has a chance to
    // rebuild + publish window.__forgeVisibleBodies.
    await new Promise((r) => requestAnimationFrame(() => r()));
    await new Promise((r) => requestAnimationFrame(() => r()));
    await new Promise((r) => setTimeout(r, 80));

    // FPS sample.
    setPhase('sampling-fps');
    const memAfter = snapshotJsHeap();
    const fpsSample = await sampleFps({ frameCount: 60 });
    const visibleCount = readVisibleBodyCount();
    const bodyCount = result.bodies.length;
    const cullingRatio = bodyCount > 0
      ? (visibleCount / bodyCount) : 0;
    const memoryDeltaBytes = (memBefore && memAfter)
      ? (memAfter.usedJSHeapSize - memBefore.usedJSHeapSize) : null;
    const finalStats = {
      wallClockMs:      result.stats.wallClockMs,
      templateBuildMs:  result.stats.templateBuildMs,
      bodyLoopMs:       result.stats.bodyLoopMs,
      bodyCount:        bodyCount,
      templateCount:    result.stats.templateCount,
      templateFailures: result.stats.templateFailures,
      memoryBefore:     memBefore?.usedJSHeapSize ?? null,
      memoryAfter:      memAfter?.usedJSHeapSize ?? null,
      memoryDeltaBytes,
      fps:              fpsSample.fps,
      msPerFrame:       fpsSample.msPerFrame,
      fpsFrames:        fpsSample.frames,
      visibleCount,
      cullingRatio,
      seed:             result.stats.seed,
    };
    setStats(finalStats);
    setPhase('done');
    try {
      window.__forgeStress100kLast = finalStats;
      window.dispatchEvent(new CustomEvent('forge:stress100k-done', {
        detail: finalStats,
      }));
    } catch { /* fail-soft */ }
  }, [target]);

  const onCancel = useCallback(() => {
    cancelRef.current = true;
    setPhase('idle');
    setProgress(0);
  }, []);

  if (!open) return null;

  const inProgress = (phase === 'templates'
                  || phase === 'bodies'
                  || phase === 'committing'
                  || phase === 'sampling-fps');
  const done = phase === 'done';

  const fpsColor = stats.fps >= 30
    ? 'var(--forge-good, #4ade80)'
    : stats.fps >= 10
      ? 'var(--forge-warn, #facc15)'
      : 'var(--forge-bad, #ff6363)';

  return (
    <div style={panelStyle}
         data-testid="forge-stress100k-panel"
         data-phase={phase}
         data-body-count={String(stats.bodyCount)}
         data-fps={stats.fps.toFixed(1)}
         data-visible-count={String(stats.visibleCount)}
         data-culling-ratio={stats.cullingRatio.toFixed(3)}>
      <header style={headerStyle}>
        <strong>100k Assembly Stress Harness</strong>
        <button onClick={onClose}
                data-testid="forge-stress100k-close"
                style={closeBtn}>×</button>
      </header>

      <div style={helpStyle}
           data-testid="forge-stress100k-help">
        Builds ~20 OCCT template B-reps via
        <code> kernel.makeBox / makeCylinder / makeSphere</code>, then
        seeds N instance bodies that all share the same handles by template.
        Commits into <code>window.__forgeBodies</code> so PUSH-204&apos;s
        octree culling + Forge-106 InstancedGroup render the assembly.
        Reports wall-clock, JS heap delta, FPS over 60 frames, and the
        visible-body count read from <code>__forgeVisibleBodies</code>.
      </div>

      <div style={sliderRowStyle}
           data-testid="forge-stress100k-target-row">
        <span style={{ width: 56, color: 'var(--forge-ink-mute, #8a93a0)' }}>
          Target
        </span>
        <input type="range"
               min={TARGET_MIN} max={TARGET_MAX} step={TARGET_STEP}
               value={target}
               disabled={inProgress}
               onChange={(e) => setTarget(
                 Math.max(TARGET_MIN, Math.min(TARGET_MAX,
                   parseInt(e.target.value, 10) || 100000)))}
               data-testid="forge-stress100k-target-slider"
               style={{ flex: 1 }} />
        <input type="number"
               min={TARGET_MIN} max={TARGET_MAX} step={TARGET_STEP}
               value={target}
               disabled={inProgress}
               onChange={(e) => setTarget(
                 Math.max(TARGET_MIN, Math.min(TARGET_MAX,
                   parseInt(e.target.value, 10) || 100000)))}
               data-testid="forge-stress100k-target-input"
               style={{
                 width: 90, textAlign: 'right',
                 background: 'var(--forge-surface, #1a212c)',
                 color: 'var(--forge-ink, #ebecef)',
                 border: '1px solid var(--forge-rail-edge, #1f2a37)',
                 padding: '4px 6px', borderRadius: 3,
                 fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
                 fontVariantNumeric: 'tabular-nums',
               }} />
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button"
                style={bigBtnStyle}
                onClick={onGenerate}
                disabled={inProgress}
                data-testid="forge-stress100k-generate">
          {inProgress ? 'Generating…' : `Generate ${target.toLocaleString()}`}
        </button>
        <button type="button"
                style={altBtnStyle}
                onClick={onCancel}
                disabled={!inProgress}
                data-testid="forge-stress100k-cancel">
          Cancel
        </button>
      </div>

      <div data-testid="forge-stress100k-progress-row">
        <div style={progressTrackStyle}
             data-testid="forge-stress100k-progress-track">
          <div style={progressFillStyle(progress)}
               data-testid="forge-stress100k-progress-fill" />
        </div>
        <div style={{
          marginTop: 4,
          fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
          fontSize: 10, color: 'var(--forge-ink-mute, #8a93a0)',
          display: 'flex', justifyContent: 'space-between',
        }}
             data-testid="forge-stress100k-progress-text">
          <span>phase: <strong>{phase}</strong></span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
      </div>

      {error ? (
        <div style={{
          padding: '6px 10px',
          background: 'rgba(255, 99, 99, 0.10)',
          border: '1px solid var(--forge-bad, #ff6363)',
          borderRadius: 4, fontSize: 11,
          color: 'var(--forge-bad, #ff6363)',
        }}
             data-testid="forge-stress100k-error">
          {error}
        </div>
      ) : null}

      <div style={statsGridStyle}
           data-testid="forge-stress100k-stats">
        <div style={chipStyle} data-testid="forge-stress100k-chip-wallclock">
          <div style={chipLabel}>Wall-clock</div>
          <div style={chipValue}>
            {done || stats.wallClockMs > 0
              ? `${(stats.wallClockMs).toFixed(0)} ms`
              : '—'}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-stress100k-chip-bodycount">
          <div style={chipLabel}>Bodies</div>
          <div style={chipValue}>
            {stats.bodyCount.toLocaleString()}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-stress100k-chip-templates">
          <div style={chipLabel}>Templates</div>
          <div style={chipValue}>
            {stats.templateCount > 0
              ? `${stats.templateCount}${stats.templateFailures
                ? ` (${stats.templateFailures} failed)` : ''}`
              : '—'}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-stress100k-chip-memory">
          <div style={chipLabel}>JS heap Δ</div>
          <div style={chipValue}>
            {stats.memoryDeltaBytes != null
              ? (stats.memoryDeltaBytes >= 0
                ? `+${formatBytes(stats.memoryDeltaBytes)}`
                : `−${formatBytes(-stats.memoryDeltaBytes)}`)
              : '—'}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-stress100k-chip-fps">
          <div style={chipLabel}>FPS (60 fr avg)</div>
          <div style={{ ...chipValue,
            color: stats.fps > 0 ? fpsColor : 'var(--forge-ink, #ebecef)' }}
               data-testid="forge-stress100k-chip-fps-value">
            {stats.fpsFrames > 0 ? stats.fps.toFixed(1) : '—'}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-stress100k-chip-visible">
          <div style={chipLabel}>Visible (octree)</div>
          <div style={chipValue}
               data-testid="forge-stress100k-chip-visible-value">
            {stats.bodyCount > 0
              ? stats.visibleCount.toLocaleString()
              : '—'}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-stress100k-chip-culling">
          <div style={chipLabel}>Culling ratio</div>
          <div style={chipValue}
               data-testid="forge-stress100k-chip-culling-value">
            {stats.bodyCount > 0
              ? `${(stats.cullingRatio * 100).toFixed(1)}%`
              : '—'}
          </div>
        </div>
        <div style={chipStyle} data-testid="forge-stress100k-chip-msframe">
          <div style={chipLabel}>ms/frame</div>
          <div style={chipValue}>
            {stats.fpsFrames > 0 ? stats.msPerFrame.toFixed(2) : '—'}
          </div>
        </div>
      </div>

      <div style={{
        fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
        fontSize: 10, color: 'var(--forge-ink-mute, #8a93a0)',
        display: 'flex', justifyContent: 'space-between',
      }}
           data-testid="forge-stress100k-footer">
        <span>
          seed {stats.seed || '—'}
        </span>
        <span>
          template B-rep {stats.templateBuildMs.toFixed(1)} ms · body
          loop {stats.bodyLoopMs.toFixed(0)} ms
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Installs window.__forgeOpenStress100k +
// __forgeCloseStress100k + listens for the `forge:menu-action` event
// (id === 'tools.stress100k') so the Menus.jsx Tools entry opens us.

export function Stress100kPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenStress100k  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseStress100k = ()  => setOpen(false);
    // Seed the result slot so the e2e gets a stable key to wait on.
    window.__forgeStress100kLast = window.__forgeStress100kLast || null;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.stress100k') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenStress100k;  } catch {}
      try { delete window.__forgeCloseStress100k; } catch {}
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <Stress100kPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default Stress100kPanel;
