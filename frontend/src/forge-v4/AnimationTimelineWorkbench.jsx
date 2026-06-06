// Forge-209 — animation timeline workbench.
//
// Play / pause / scrub a keyframe animation. Built-in fixture is a
// 3-track demo: a box that translates while rotating. Renderer-side
// consumers can subscribe via `window.__forgeAnimationCurrent` (set
// every animation frame while playing).
//
// PUSH-64 — Export MP4. With the animation bound to real OCCT bodies
// (Build from bodies), an "Export MP4" button records the viewport
// canvas via MediaRecorder while the timeline plays through one full
// loop, ships the resulting WebM blob to disk via the writeBlob bridge,
// and hands it off to ffmpeg-static through the existing
// forge.video.transcodeWebmToMp4 IPC for an H.264 .mp4. Surfaces the
// final path on window.__forgeLastAnimMp4Path so e2e + automation can
// pick it up deterministically.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';
import { startCanvasCapture } from './videoCapture.js';

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

// PUSH-64 — Resolve the viewport <canvas> the MediaRecorder will tap.
// Same selector cascade as the Forge-104 VideoCaptureHUD: prefer the
// FEA workbench canvas if it's the active one (it covers the screen),
// otherwise fall back to the main v4 r3f canvas, and only as a last
// resort grab any <canvas> in the DOM (avoids picking up a thumbnail
// or sparkline). We keep this local instead of importing from
// VideoCaptureHUD.jsx so the timeline workbench has no UI dependency
// on the HUD existing.
const ANIM_CANVAS_SELECTORS = [
  '[data-testid="forge-fea-canvas"] canvas',
  '[data-testid="forge-fea-canvas"]',
  '[data-testid="forge-v4-canvas"] canvas',
  '[data-testid="forge-v4-canvas"]',
  '[data-testid="forge-viewport"] canvas',
  '[data-testid="forge-viewport-canvas"]',
  'canvas',
];

function findAnimCanvas() {
  if (typeof document === 'undefined') return null;
  for (const sel of ANIM_CANVAS_SELECTORS) {
    const el = document.querySelector(sel);
    if (!el) continue;
    if (el.tagName === 'CANVAS') return el;
    const inner = el.querySelector?.('canvas');
    if (inner) return inner;
  }
  return null;
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
  // PUSH-64 — Export MP4 status surface. The button toggles through
  // 'idle' → 'recording' → 'transcoding' → 'done' | 'error:<msg>' so
  // the e2e can poll a single element and Archie's automation can read
  // an authoritative state string.
  const [exportState, setExportState] = React.useState('idle');
  const [exportInfo, setExportInfo]   = React.useState('');
  const exportCancelRef = React.useRef(false);
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

  // PUSH-64 — Export MP4 of the live animation.
  //
  // Sequence:
  //   1. Sanity-check we're in Live mode (Build from bodies) — recording
  //      the abstract fixture box that doesn't render anywhere produces
  //      a black mp4, which is useless. Hard-fail with a clear error.
  //   2. Sanity-check the preload bridges (forge.dialog.saveFile +
  //      forge.dialog.writeBlob + forge.video.transcodeWebmToMp4). Each
  //      missing bridge gets surfaced verbatim so the user can see why.
  //   3. Ask the user where to save the .mp4 via forge.dialog.saveFile.
  //      Derive the intermediate .webm path next to it so the renderer
  //      and main process are unambiguous about both files.
  //   4. Pin the active time to 0 and resolve the canvas. Start
  //      MediaRecorder via the existing startCanvasCapture(...) helper
  //      from videoCapture.js — VP9/WebM, 60 fps.
  //   5. Drive a timeline progression deterministically: walk `time`
  //      from 0 → duration in small steps via setTime(), spending a
  //      fixed wall-clock per second of animation time so the resulting
  //      mp4 actually shows motion. This is independent of `playing`,
  //      so a paused timeline at the moment the button is clicked is
  //      fine — we drive the scrub directly.
  //   6. Stop the recorder → Blob → writeBlob → transcodeWebmToMp4.
  //   7. Publish window.__forgeLastAnimMp4Path and final status.
  const exportMp4 = React.useCallback(async () => {
    if (exportState === 'recording' || exportState === 'transcoding') return;
    if (typeof window === 'undefined') return;

    setErr('');
    setExportInfo('');
    exportCancelRef.current = false;

    if (!live) {
      setExportState('error:not-live');
      setExportInfo('Build from bodies first — Export MP4 only records the live (body-bound) animation.');
      return;
    }

    const forge = window.forge || window.electron;
    const dialog = forge && forge.dialog;
    const video  = forge && forge.video;
    if (!dialog || typeof dialog.saveFile !== 'function' || typeof dialog.writeBlob !== 'function') {
      setExportState('error:no-dialog');
      setExportInfo('forge.dialog.saveFile / writeBlob bridge missing — preload.js not loaded?');
      return;
    }
    if (!video || typeof video.transcodeWebmToMp4 !== 'function') {
      setExportState('error:no-ffmpeg');
      setExportInfo('forge.video.transcodeWebmToMp4 bridge missing — ffmpeg-static not bundled?');
      return;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultName = `forge-animation-${ts}.mp4`;
    let mp4Path = null;
    try {
      mp4Path = await dialog.saveFile({
        title: 'Export animation MP4',
        defaultPath: defaultName,
        filters: [{ name: 'H.264 MP4', extensions: ['mp4'] }],
      });
    } catch (e) {
      setExportState('error:dialog-threw');
      setExportInfo(`saveFile threw: ${e?.message || e}`);
      return;
    }
    if (!mp4Path || typeof mp4Path !== 'string') {
      setExportState('cancelled');
      setExportInfo('Save dialog cancelled.');
      return;
    }
    // Derive a sibling .webm intermediate path. The main-process
    // transcoder rewrites foo.webm → foo.mp4, so we want our intermediate
    // to share the exact basename so the path it writes lines up with
    // the user's chosen target.
    const webmPath = mp4Path.replace(/\.mp4$/i, '') + '.webm';

    const srcCanvas = findAnimCanvas();
    if (!srcCanvas) {
      setExportState('error:no-canvas');
      setExportInfo('Could not find the viewport canvas.');
      return;
    }

    // libx264 (the ffmpeg encoder we transcode through) requires even
    // width AND even height. The r3f canvas size is whatever the layout
    // engine handed it — frequently odd (e.g. 1508×733). Rather than
    // teach the main-process transcoder a scale filter, mirror the
    // viewport into an even-dimensioned offscreen <canvas> and capture
    // that. drawImage() into the mirror runs once per animation frame
    // (~60 Hz) and is cheap enough that it doesn't measurably affect
    // the live ticker — the GPU has already drawn the source pixels.
    const rawW = srcCanvas.width  || srcCanvas.clientWidth  || 1280;
    const rawH = srcCanvas.height || srcCanvas.clientHeight || 720;
    const mirrorW = Math.max(2, rawW - (rawW % 2));
    const mirrorH = Math.max(2, rawH - (rawH % 2));
    const mirror = document.createElement('canvas');
    mirror.width  = mirrorW;
    mirror.height = mirrorH;
    const mirrorCtx = mirror.getContext('2d');
    if (!mirrorCtx) {
      setExportState('error:no-2d-context');
      setExportInfo('Could not obtain 2D context on mirror canvas.');
      return;
    }
    // Prime the mirror with the current frame so the first recorder
    // tick is non-black on slow machines.
    try { mirrorCtx.drawImage(srcCanvas, 0, 0, mirrorW, mirrorH); } catch { /* may throw if src is tainted */ }

    // Pin the timeline to t=0 and pause anything that's running.
    setPlaying(false);
    setTime(0);
    // Wait one rAF for the pose ticker to apply the t=0 pose before we
    // start capturing — otherwise frame 0 may still hold the last
    // scrubbed pose from before the export click.
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    // Pump the source canvas into the mirror on every rAF for the
    // duration of the recording. We park the rAF id in a local so we
    // can cancel cleanly when stop() resolves.
    let mirrorRaf = 0;
    let mirroring = true;
    const pump = () => {
      if (!mirroring) return;
      try { mirrorCtx.drawImage(srcCanvas, 0, 0, mirrorW, mirrorH); }
      catch { /* one-off draw failure shouldn't kill the recording */ }
      mirrorRaf = requestAnimationFrame(pump);
    };
    mirrorRaf = requestAnimationFrame(pump);

    const handle = startCanvasCapture(mirror, { fps: 60, codec: 'vp9' });
    if (handle.unsupported) {
      setExportState('error:no-mediarecorder');
      setExportInfo(`Canvas capture unsupported: ${handle.reason}`);
      return;
    }
    if (handle.startError) {
      setExportState('error:recorder-start');
      setExportInfo(`MediaRecorder start failed: ${handle.startError.message || handle.startError}`);
      return;
    }
    setExportState('recording');
    setExportInfo(`Recording ${duration.toFixed(2)} s at ${handle.fps} fps`);

    // Drive the timeline deterministically. We need each "animation
    // second" to take ~1 wall-clock second so the resulting mp4 actually
    // animates at real speed; we step `time` in 1/60-second increments
    // sleeping ~16.7 ms between steps. Total: roughly duration × 1000 ms.
    const STEP_DT  = 1 / 60;
    const STEP_SLEEP_MS = 16.7;
    const totalSteps = Math.max(1, Math.ceil(duration / STEP_DT));
    let t = 0;
    for (let i = 0; i <= totalSteps; i++) {
      if (exportCancelRef.current) break;
      setTime(t);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, STEP_SLEEP_MS));
      t += STEP_DT;
      if (t > duration) t = duration;
    }
    // Hold the final frame for ~250 ms so the user can see the loop close.
    await new Promise((r) => setTimeout(r, 250));

    let blob;
    try {
      blob = await handle.stop();
    } catch (e) {
      mirroring = false;
      if (mirrorRaf) cancelAnimationFrame(mirrorRaf);
      setExportState('error:recorder-stop');
      setExportInfo(`MediaRecorder stop failed: ${e?.message || e}`);
      return;
    }
    // Stop pumping pixels into the mirror once the recorder is closed.
    mirroring = false;
    if (mirrorRaf) cancelAnimationFrame(mirrorRaf);
    if (!blob || blob.size === 0) {
      setExportState('error:empty-recording');
      setExportInfo('Recorder produced 0 bytes — viewport may have been hidden.');
      return;
    }
    setExportState('transcoding');
    setExportInfo(`Captured ${(blob.size / 1024).toFixed(0)} KB WebM — invoking ffmpeg`);

    // Ship the WebM bytes to disk for ffmpeg to consume.
    let bytes;
    try {
      bytes = new Uint8Array(await blob.arrayBuffer());
    } catch (e) {
      setExportState('error:blob-read');
      setExportInfo(`Could not read recording blob: ${e?.message || e}`);
      return;
    }
    let writeResult;
    try {
      writeResult = await dialog.writeBlob(webmPath, bytes);
    } catch (e) {
      setExportState('error:writeblob-threw');
      setExportInfo(`writeBlob threw: ${e?.message || e}`);
      return;
    }
    if (!writeResult || writeResult.ok === false) {
      setExportState('error:writeblob-failed');
      setExportInfo(`writeBlob failed: ${writeResult && writeResult.error}`);
      return;
    }

    let trans;
    try {
      trans = await video.transcodeWebmToMp4(webmPath);
    } catch (e) {
      setExportState('error:transcode-threw');
      setExportInfo(`transcodeWebmToMp4 threw: ${e?.message || e}`);
      return;
    }
    if (!trans || trans.ok === false) {
      setExportState('error:transcode-failed');
      setExportInfo(`ffmpeg: ${trans && trans.error}`);
      return;
    }

    // Publish the final mp4 path for automation + e2e.
    try { window.__forgeLastAnimMp4Path = trans.mp4Path; } catch { /* noop */ }
    setExportState('done');
    setExportInfo(`MP4 saved: ${trans.mp4Path} (${(trans.bytes / 1024).toFixed(0)} KB · ffmpeg ${trans.durationMs} ms)`);
  }, [duration, exportState, live]);

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

      {/* PUSH-64 — Export MP4 button + live status pill. The button
          requires Live mode; the pill exposes a single authoritative
          state string for e2e + Archie automation to poll. */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button data-testid="forge-animation-export-mp4"
                data-export-state={exportState}
                disabled={exportState === 'recording' || exportState === 'transcoding'}
                style={{ ...buttonStyle,
                         background: exportState === 'recording'
                              ? 'rgba(226,106,106,0.85)'
                              : exportState === 'transcoding'
                                ? '#608cdc'
                                : exportState === 'done'
                                  ? '#3a6738'
                                  : 'var(--forge-accent)',
                         color: exportState === 'recording' || exportState === 'transcoding'
                              ? '#ffffff'
                              : exportState === 'done'
                                ? '#dfeedd'
                                : '#0a0e14',
                         cursor: (exportState === 'recording' || exportState === 'transcoding')
                              ? 'progress' : 'pointer',
                         opacity: (exportState === 'recording' || exportState === 'transcoding') ? 0.85 : 1 }}
                onClick={exportMp4}
                title={live
                  ? 'Record the live animation playback to .webm and transcode to H.264 .mp4'
                  : 'Build from bodies first — Export MP4 only works on the live animation'}>
          {exportState === 'recording'   ? 'Recording…'
            : exportState === 'transcoding' ? 'Transcoding…'
            : exportState === 'done'        ? 'MP4 exported ✓'
            : 'Export MP4'}
        </button>
        {exportState !== 'idle' && (
          <span data-testid="forge-animation-export-status"
                data-state={exportState}
                style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                         color: /^error:/.test(exportState)
                           ? 'var(--forge-bad, #ff6363)'
                           : 'var(--forge-ink-mute)',
                         flex: 1, overflow: 'hidden',
                         textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {exportState}{exportInfo ? ` · ${exportInfo}` : ''}
          </span>
        )}
      </div>

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
