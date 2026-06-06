// Forge-209 — animation timeline workbench.
//
// Play / pause / scrub a keyframe animation. Built-in fixture is a
// 3-track demo: a box that translates while rotating. Renderer-side
// consumers can subscribe via `window.__forgeAnimationCurrent` (set
// every animation frame while playing).
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 620, zIndex: 1310,
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

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.animation)
      || (typeof window !== 'undefined' && window.electron && window.electron.animation);
}

export function animationDuration(tracks) {
  const a = api();
  if (!a) throw new Error('forge.animation not available');
  return a.duration(tracks);
}
export function animationEvaluate(tracks, t) {
  const a = api();
  if (!a) throw new Error('forge.animation not available');
  return a.evaluateAll(tracks, t);
}

function fixtureTracks() {
  return [
    {
      name: 'box.translation', interpolation: 'cubic',
      keys: [
        { time: 0,   value: [0, 0, 0] },
        { time: 1,   value: [5, 0, 0] },
        { time: 2,   value: [5, 5, 0] },
        { time: 3,   value: [0, 5, 0] },
        { time: 4,   value: [0, 0, 0] },
      ],
    },
    {
      name: 'box.rotation', interpolation: 'linear',
      keys: [
        { time: 0, value: [0, 0, 0] },
        { time: 4, value: [0, 0, 6.283185307] },   // 1 full revolution
      ],
    },
    {
      name: 'box.scale', interpolation: 'linear',
      keys: [
        { time: 0, value: [1, 1, 1] },
        { time: 2, value: [1.5, 1.5, 1.5] },
        { time: 4, value: [1, 1, 1] },
      ],
    },
  ];
}

// PUSH-57 — build a per-body translation track for every native body in
// the live scene. Each body's track orbits 20 mm around its base via a
// 4-second loop with one cubic-Hermite ease so the animation reads as
// purposeful motion (not a stutter), and the track name encodes the
// real OCCT handle (`body:<handle>.translation`) so the viewport ticker
// can resolve mesh ↔ track without an extra registry.
export function buildTracksFromBodies(bodies) {
  const nativeBodies = (Array.isArray(bodies) ? bodies : [])
      .filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
  return nativeBodies.map((b, i) => {
    // Phase each body by 1 second so a 2-body assembly doesn't look like
    // a single rigid translation — the e2e relies on the two bodies
    // having distinguishable poses at t≈1 s.
    const phase = i;
    const radius = 12 + i * 4;     // pull bodies apart by index so the
                                   // assertion can distinguish them
    return {
      name: `body:${b.handle}.translation`,
      interpolation: 'cubic',
      keys: [
        { time: 0,   value: [0, 0, 0] },
        { time: 1,   value: [radius, 0, 0] },
        { time: 2,   value: [radius, radius, 0] },
        { time: 3,   value: [0, radius, 0] },
        { time: 4,   value: [0, 0, 0] },
      ].map((k) => ({ ...k, time: (k.time + phase) % 4 }))
       .sort((a, b) => a.time - b.time),
    };
  });
}

function AnimationPanel({ open, onClose }) {
  const [tracks, setTracks] = React.useState(fixtureTracks());
  // PUSH-57 — "live" === bound to real OCCT bodies via track names of
  // shape `body:<handle>.translation`. The viewport pose-ticker only
  // reads those tracks.
  const [live, setLive] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [current, setCurrent] = React.useState(null);
  const [err, setErr] = React.useState('');
  const rafRef = React.useRef(null);
  const lastRef = React.useRef(0);

  const duration = React.useMemo(() => {
    try { return animationDuration(tracks); }
    catch (e) { setErr(String(e?.message || e)); return 0; }
  }, [tracks]);

  const buildFromBodies = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
    const next = buildTracksFromBodies(bodies);
    if (next.length === 0) {
      setErr('No native bodies in the scene — add one before binding tracks.');
      return;
    }
    setErr('');
    setTracks(next);
    setLive(true);
    setTime(0);
    setPlaying(false);
  }, []);

  React.useEffect(() => {
    try {
      const s = animationEvaluate(tracks, time);
      setCurrent(s);
      if (typeof window !== 'undefined') {
        window.__forgeAnimationCurrent = s;
        // PUSH-57 — publish per-body pose for the viewport ticker. Only
        // emit when the active track set is the live (body-bound) one
        // so the legacy box.* fixture doesn't grab a random handle.
        if (live) {
          const pose = new Map();
          for (const sample of s) {
            const m = /^body:(\d+)\.translation$/.exec(sample.name || '');
            if (!m) continue;
            pose.set(Number(m[1]), { pos: sample.value });
          }
          window.__forgeAnimationPose = pose;
        } else {
          window.__forgeAnimationPose = new Map();
        }
      }
    } catch (e) { setErr(String(e?.message || e)); }
  }, [tracks, time, live]);

  React.useEffect(() => {
    if (!playing) return;
    lastRef.current = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      setTime((t) => {
        const nt = t + dt;
        return nt > duration ? 0 : nt;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, duration]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-animation-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Animation timeline</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Linear + Catmull-Rom Hermite keyframe evaluator.
        {' '}
        {live
          ? <span><strong>Live</strong> — bound to {tracks.length} body{tracks.length === 1 ? '' : 'ies'} in the scene; scrub or play to move them.</span>
          : 'Built-in fixture is a 3-track box demo (translation / rotation / scale).'}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button data-testid="forge-animation-build-from-bodies"
                style={{ ...buttonStyle, background: live ? '#3a6738' : 'var(--forge-canvas-2)',
                         color: live ? '#dfeedd' : 'var(--forge-ink)',
                         border: live ? 'none' : '1px solid var(--forge-rail-edge)',
                         fontWeight: 600 }}
                onClick={buildFromBodies}>
          {live ? '✓ Live tracks' : 'Build from bodies'}
        </button>
        <button data-testid="forge-animation-play"
                style={buttonStyle}
                onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button data-testid="forge-animation-rewind"
                style={{ ...buttonStyle, background: 'var(--forge-canvas-2)',
                         color: 'var(--forge-ink)', fontWeight: 400 }}
                onClick={() => { setTime(0); setPlaying(false); }}>
          ⏮
        </button>
        <div data-testid="forge-animation-time"
             style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                      color: 'var(--forge-ink-mute)' }}>
          t = {time.toFixed(3)} / {duration.toFixed(3)} s
        </div>
      </div>

      <input type="range" min={0} max={duration} step={0.01}
             data-testid="forge-animation-scrub"
             value={time}
             onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} />

      {err && (
        <div data-testid="forge-animation-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}

      {current && (
        <section data-testid="forge-animation-state"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          {current.map((s, i) => (
            <div key={i}>
              {s.name.padEnd(24, ' ')} ({s.value[0].toFixed(3)}, {s.value[1].toFixed(3)}, {s.value[2].toFixed(3)})
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

export function AnimationTimelineWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenAnimationWorkbench  = () => setOpen(true);
    window.__forgeCloseAnimationWorkbench = () => setOpen(false);
    window.__forgeAnimationEvaluate       = animationEvaluate;
    window.__forgeAnimationDuration       = animationDuration;
    window.__forgeAnimationFixture        = fixtureTracks;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.animation' || id === 'workbench.animation') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'animation') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimationPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default AnimationPanel;
