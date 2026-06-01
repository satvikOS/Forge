// Forge-104 — Floating record button HUD.
//
// Bottom-right of the viewport. One button that toggles between
//
//   ● Record   (idle)        →  ■ Stop   (recording)
//
// Hitting Stop downloads the resulting .webm via the browser. The HUD
// auto-mounts itself into document.body when the module is imported,
// listens for `forge:capture-start` / `forge:capture-stop` window events,
// and exposes an imperative `window.__forgeRecord(true|false)` shim for
// the e2e tests + ScenarioRunner to drive.
//
// Per the slice brief, ForgeShellV4.jsx is frozen — we self-mount via
// createPortal exactly the way StandardPartsLibraryHost does. Manual UI
// clicks do NOT write to Archie's thread; we deliberately go straight to
// the canvas + the download anchor.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { showToast } from './Toast.jsx';
import { startCanvasCapture, downloadBlob } from './videoCapture.js';

// Selector used to find the forge viewport canvas. Falls back to any
// canvas tag if the v4 testid is missing (e.g. during the kernel-offline
// black-canvas placeholder).
const CANVAS_SELECTORS = [
  '[data-testid="forge-fea-canvas"] canvas',
  '[data-testid="forge-v4-canvas"]',
  '[data-testid="forge-v4-canvas"] canvas',
  'canvas',
];

function findCanvas() {
  if (typeof document === 'undefined') return null;
  for (const sel of CANVAS_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && (el.tagName === 'CANVAS' || el.querySelector?.('canvas'))) {
      return el.tagName === 'CANVAS' ? el : el.querySelector('canvas');
    }
  }
  return null;
}

export function VideoCaptureHUD() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const handleRef = useRef(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);

  const stopAndDownload = useCallback(async (filenameHint) => {
    const h = handleRef.current;
    handleRef.current = null;
    setRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setElapsed(0);
    if (!h || h.unsupported) return null;
    try {
      const blob = await h.stop();
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const name = (filenameHint || `forge-capture-${ts}`) + '.webm';
      downloadBlob(blob, name);
      showToast({ kind: 'ok',
        text: `Recording saved (${(blob.size / 1024).toFixed(0)} KB · ${name})`,
        ttl: 3000 });
      try {
        window.dispatchEvent(new CustomEvent('forge:capture-saved',
          { detail: { blob, filename: name, bytes: blob.size, mime: h.mime } }));
      } catch { /* noop */ }
      return blob;
    } catch (err) {
      showToast({ kind: 'err',
        text: `Recording failed: ${err.message || err}`,
        ttl: 4000 });
      return null;
    }
  }, []);

  const startRecording = useCallback((opts = {}) => {
    if (handleRef.current) return; // already running
    const canvas = opts.canvas || findCanvas();
    if (!canvas) {
      showToast({ kind: 'warn',
        text: 'No viewport canvas found — open a workbench first.',
        ttl: 3000 });
      return;
    }
    const h = startCanvasCapture(canvas, {
      fps: opts.fps || 60,
      codec: opts.codec || 'vp9',
    });
    if (h.unsupported) {
      showToast({ kind: 'err',
        text: `Video capture unsupported: ${h.reason}`,
        ttl: 4500 });
      return;
    }
    if (h.startError) {
      showToast({ kind: 'err',
        text: `MediaRecorder failed to start: ${h.startError.message || h.startError}`,
        ttl: 4500 });
      return;
    }
    handleRef.current = h;
    startedAtRef.current = performance.now();
    setRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed((performance.now() - startedAtRef.current) / 1000);
    }, 100);
    showToast({ kind: 'info',
      text: `Recording ${h.mime.replace(/^video\//, '')} @ ${h.fps} fps`,
      ttl: 1500 });
    try {
      window.dispatchEvent(new CustomEvent('forge:capture-running',
        { detail: { mime: h.mime, fps: h.fps } }));
    } catch { /* noop */ }
  }, []);

  // ---- imperative + event hooks ----
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    window.__forgeRecord = (on, opts) => {
      if (on === undefined) return !!handleRef.current;
      if (on) startRecording(opts || {});
      else stopAndDownload(opts && opts.filename);
      return !!handleRef.current;
    };
    const onStart = (e) => startRecording(e?.detail || {});
    const onStop  = (e) => stopAndDownload(e?.detail?.filename);
    window.addEventListener('forge:capture-start', onStart);
    window.addEventListener('forge:capture-stop',  onStop);

    return () => {
      try { delete window.__forgeRecord; } catch { /* noop */ }
      window.removeEventListener('forge:capture-start', onStart);
      window.removeEventListener('forge:capture-stop',  onStop);
      if (handleRef.current) {
        try { handleRef.current.stop(); } catch { /* noop */ }
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startRecording, stopAndDownload]);

  if (typeof document === 'undefined') return null;

  const dotPulse = recording ? 'forge-rec-pulse 1.1s ease-in-out infinite' : 'none';

  return createPortal(
    <>
      <style>{HUD_CSS}</style>
      <button type="button"
              data-testid="forge-video-capture-toggle"
              data-recording={String(recording)}
              onClick={() => recording ? stopAndDownload() : startRecording()}
              className="forge-video-capture-hud"
              title={recording ? 'Stop recording and download .webm'
                               : 'Start recording the viewport'}
              style={{
                position: 'fixed',
                right: 16, bottom: 'calc(var(--forge-statusbar-h, 26px) + 16px)',
                zIndex: 2400,
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 14px',
                background: recording ? 'rgba(226,106,106,0.18)' : 'rgba(20,22,27,0.75)',
                color: 'var(--forge-ink, #ebecef)',
                border: `1px solid ${recording ? 'var(--forge-err, #e26a6a)'
                                              : 'var(--forge-rail-edge, #1d2027)'}`,
                borderRadius: 999,
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 11,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                boxShadow: recording ? '0 4px 14px rgba(226,106,106,0.35)'
                                     : '0 4px 14px rgba(0,0,0,0.45)',
                cursor: 'pointer',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
              }}>
        <span data-testid="forge-video-capture-glyph"
              style={{
                display: 'inline-block',
                width: 10, height: 10,
                borderRadius: recording ? 2 : '50%',
                background: recording ? 'var(--forge-err, #e26a6a)' : '#e26a6a',
                animation: dotPulse,
              }} />
        <span data-testid="forge-video-capture-label">
          {recording ? 'Stop' : 'Record'}
        </span>
        {recording && (
          <span data-testid="forge-video-capture-elapsed"
                style={{ color: 'var(--forge-ink-2, #b0b4bd)',
                         fontVariantNumeric: 'tabular-nums' }}>
            {formatHMS(elapsed)}
          </span>
        )}
      </button>
    </>,
    document.body);
}

function formatHMS(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s - m * 60);
  const cs = Math.floor((s - Math.floor(s)) * 10);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}.${cs}`;
}

const HUD_CSS = `
@keyframes forge-rec-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.55; transform: scale(0.82); }
}
.forge-video-capture-hud:hover { filter: brightness(1.1); }
.forge-video-capture-hud:active { transform: translateY(1px); }
`;

export default VideoCaptureHUD;
