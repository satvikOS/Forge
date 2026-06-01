// Forge-114 — persistent progress strip.
//
// Renders a vertical stack of in-flight job rows directly under the QAT
// (top of viewport, below the title bar + quick-access toolbar). The
// strip is pointer-events: none on the wrapper so the user can still
// drag-select / orbit through any gap between rows; each row itself
// receives pointer events so the Cancel button is clickable.
//
// The component self-mounts via a portal — drop a single
// <ProgressStripPortal /> ANYWHERE in the React tree (or import the
// auto-mount helper) and the strip lives directly on document.body.
// This avoids any change to ForgeShellV4.jsx, which is frozen by the
// slice brief.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { listJobs, cancelJob } from './progressBus.js';

const MAX_VISIBLE = 5;
const AUTO_DISMISS_MS = 2000;

// Format an ETA in human-readable seconds → "12 s" / "2 m 18 s".
function fmtEta(eta_s) {
  if (eta_s == null || !Number.isFinite(eta_s) || eta_s < 0) return '';
  if (eta_s < 1) return '< 1 s';
  if (eta_s < 60) return `${Math.round(eta_s)} s`;
  const m = Math.floor(eta_s / 60);
  const s = Math.round(eta_s - m * 60);
  return s > 0 ? `${m} m ${s} s` : `${m} m`;
}

function ProgressRow({ job, onCancel }) {
  const finished = job.status !== 'running';
  const cancelled = job.status === 'cancelled';
  const pctClamped = Math.max(0, Math.min(100, job.pct || 0));

  const barColor = cancelled
    ? 'linear-gradient(90deg,#7a7e88,#9a9ea8)'
    : finished
      ? 'linear-gradient(90deg,#4ec18b,#6cd0e8)'
      : 'linear-gradient(90deg,#6cd0e8,#7ea8ff)';

  return (
    <div
      data-testid={`forge-progress-row-${job.id}`}
      data-forge-progress-label={job.label}
      data-job-status={job.status}
      data-job-pct={Math.round(pctClamped)}
      style={{
        background: 'rgba(19,26,35,0.96)',
        border: '1px solid #1f2a37',
        borderRadius: 6,
        padding: '6px 10px',
        marginBottom: 4,
        fontFamily: '-apple-system, ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
        color: '#c4ccd6',
        boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        pointerEvents: 'auto',
        transition: 'opacity 240ms ease',
        opacity: finished ? 0.78 : 1,
        minWidth: 280,
        maxWidth: 420,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          data-testid="forge-progress-label"
          style={{
            flex: '1 1 auto',
            color: '#e6eaf0',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {job.label}
        </span>
        <span
          data-testid="forge-progress-pct"
          style={{ color: '#6cd0e8', fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}
        >
          {Math.round(pctClamped)}%
        </span>
        {job.eta_s != null && job.status === 'running' && (
          <span
            data-testid="forge-progress-eta"
            style={{ color: '#7a8696', fontVariantNumeric: 'tabular-nums', minWidth: 50 }}
          >
            {fmtEta(job.eta_s)}
          </span>
        )}
        <button
          type="button"
          data-testid={`forge-progress-cancel-${job.id}`}
          aria-label={`Cancel ${job.label}`}
          disabled={finished}
          onClick={(ev) => {
            ev.stopPropagation();
            // Manual click never writes to the Archie thread — onCancel
            // dispatches through the progress bus, which only touches
            // its own registry + window event channel.
            onCancel(job.id);
          }}
          style={{
            background: 'transparent',
            border: '1px solid #2a3645',
            color: finished ? '#5a6472' : '#c4ccd6',
            borderRadius: 4,
            padding: '1px 6px',
            cursor: finished ? 'default' : 'pointer',
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          marginTop: 5,
          height: 4,
          background: '#0a0e14',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          data-testid="forge-progress-bar"
          style={{
            width: `${pctClamped}%`,
            height: '100%',
            background: barColor,
            transition: 'width 180ms ease',
          }}
        />
      </div>
      {job.message && (
        <div
          data-testid="forge-progress-message"
          style={{ marginTop: 3, color: '#7a8696', fontSize: 11 }}
        >
          {cancelled ? 'Cancelled' : job.message}
        </div>
      )}
    </div>
  );
}

/**
 * The strip itself — subscribes to the progressBus event channel and
 * re-snapshots the registry whenever something fires. Schedules row
 * removal 2 s after status leaves `running`.
 */
export function ProgressStrip() {
  const [jobs, setJobs] = useState(() => listJobs());
  const dismissTimers = useRef(new Map());

  const refresh = useCallback(() => {
    setJobs(listJobs());
  }, []);

  // Re-snapshot on bus events.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onProgress(_ev) { refresh(); }
    window.addEventListener('forge:progress', onProgress);
    refresh();
    return () => window.removeEventListener('forge:progress', onProgress);
  }, [refresh]);

  // Auto-dismiss finished rows after AUTO_DISMISS_MS.
  useEffect(() => {
    const timers = dismissTimers.current;
    for (const job of jobs) {
      if (job.status === 'running') continue;
      if (timers.has(job.id)) continue;
      const t = setTimeout(() => {
        timers.delete(job.id);
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
      }, AUTO_DISMISS_MS);
      timers.set(job.id, t);
    }
    return undefined;
  }, [jobs]);

  // Clear timers on unmount.
  useEffect(() => {
    const timers = dismissTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // QAT height = 32 px (tokens.css --forge-qat-h), title bar varies;
  // we use the same CSS-var arithmetic as the side panels.
  const topOffset = 'calc(var(--forge-topbar-h, 36px) + var(--forge-qat-h, 32px) + 6px)';
  const visible = jobs.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, jobs.length - MAX_VISIBLE);

  // Mounted but no work? Render nothing so we don't paint a black bar.
  if (visible.length === 0) {
    return (
      <div
        data-testid="forge-progress-strip"
        data-forge-empty="true"
        style={{ display: 'none' }}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      data-testid="forge-progress-strip"
      data-forge-empty="false"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: topOffset,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 8500,
        pointerEvents: 'none', // wrapper transparent to clicks
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}
    >
      {visible.map((job) => (
        <ProgressRow key={job.id} job={job} onCancel={cancelJob} />
      ))}
      {overflow > 0 && (
        <div
          data-testid="forge-progress-overflow"
          style={{
            fontSize: 11,
            color: '#7a8696',
            textAlign: 'center',
            background: 'rgba(19,26,35,0.94)',
            border: '1px solid #1f2a37',
            borderRadius: 6,
            padding: '2px 6px',
            pointerEvents: 'auto',
          }}
        >
          +{overflow} more
        </div>
      )}
    </div>
  );
}

/**
 * Drop this anywhere in the React tree to portal the strip onto
 * document.body. Mounting through a portal means it doesn't inherit
 * any parent overflow / transform constraints.
 */
export function ProgressStripPortal() {
  const [host, setHost] = useState(null);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    let el = document.getElementById('forge-progress-strip-host');
    let created = false;
    if (!el) {
      el = document.createElement('div');
      el.id = 'forge-progress-strip-host';
      document.body.appendChild(el);
      created = true;
    }
    setHost(el);
    return () => {
      if (created && el && el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);
  if (!host) return null;
  return createPortal(<ProgressStrip />, host);
}

/**
 * Vanilla-JS auto-mount: import this in any module that wants the
 * strip live (the dispatchers call it lazily so the strip appears the
 * first time a long-running job is fired, even if ForgeShellV4 hasn't
 * been changed to include it).
 *
 * Idempotent — calling it many times only mounts one root.
 */
export function mountProgressStrip() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  if (window.__forgeProgressStripMounted) return window.__forgeProgressStripMounted;
  let el = document.getElementById('forge-progress-strip-host');
  if (!el) {
    el = document.createElement('div');
    el.id = 'forge-progress-strip-host';
    document.body.appendChild(el);
  }
  // Lazy-load react-dom/client so this module can be imported in
  // Node tests without dragging in the renderer.
  // eslint-disable-next-line global-require
  let createRoot;
  try {
    ({ createRoot } = require('react-dom/client'));
  } catch {
    return null;
  }
  const root = createRoot(el);
  root.render(<ProgressStrip />);
  window.__forgeProgressStripMounted = { el, root };
  return window.__forgeProgressStripMounted;
}

export default ProgressStrip;
