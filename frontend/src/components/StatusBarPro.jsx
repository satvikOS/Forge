import { useState, useEffect } from 'react';
import './StatusBarPro.css';

/**
 * Professional Status Bar — bottom of viewport.
 * Shows: mode, selection info, body count, equation count,
 * cursor position, units, FPS.
 *
 * Reads from window slots so callers don't have to thread state
 * through React props — that mirrors the rest of ArchDisc's UI
 * (the slots are the single-source-of-truth for cross-component
 * state).
 */
export default function StatusBarPro({ selection, sketchActive, sketchStatus }) {
  const [fps, setFps] = useState(60);
  // Side-channels — refreshed via a single 'archdisc:status-tick'
  // poll @ 4 Hz to avoid hot-rendering on every body / selection
  // change. The slots themselves are mutated synchronously by their
  // owners; we sample.
  const [bodyCount, setBodyCount] = useState(0);
  const [equationCount, setEquationCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [cursor, setCursor] = useState(null);  // {x, y, z} in mm (sketch) or null
  // WF-06 — saving/calculating/dirty triad. `busyTool` is the tool name
  // currently executing (or null); `dirty` is true when history has
  // grown since the last Save Snapshot (or never saved + non-empty);
  // `savedFlash` flashes for a couple of seconds after a successful save
  // so the user gets clear "Saved" feedback.
  const [busyTool, setBusyTool] = useState(null);
  const [busyElapsedMs, setBusyElapsedMs] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(null);  // {filename, ts}

  // FPS counter
  useEffect(() => {
    let frames = 0;
    let lastTime = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTime;
      setFps(Math.round(frames * 1000 / elapsed));
      frames = 0;
      lastTime = now;
    }, 1000);

    const countFrame = () => {
      frames++;
      requestAnimationFrame(countFrame);
    };
    const raf = requestAnimationFrame(countFrame);

    return () => {
      clearInterval(interval);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Sample window slots at 4 Hz so the status bar reflects current
  // scene state without re-rendering on every body event.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const tick = () => {
      try {
        // Bodies — registry may not be initialised yet.
        const reg = window.__archdiscBodies;
        if (reg) {
          const list = typeof reg.list === 'function' ? reg.list()
            : (Array.isArray(reg.bodies) ? reg.bodies : []);
          setBodyCount(list.length);
        }
        // Equations — Tier 10 EquationStore.
        const eq = window.__archdiscEquationStore;
        if (eq && typeof eq.list === 'function') {
          setEquationCount(eq.list().length);
        }
        // Design History — entries (suppressed flag respected).
        const hist = window.__archdiscHistory;
        if (hist && hist.entries) {
          setHistoryCount(hist.entries.filter((e) => !e.suppressed).length);
        }
        // Cursor position published by InteractiveSketch (UX Tier-1 backlog).
        const c = window.__archdiscSketchCursor;
        if (c && typeof c.x === 'number' && typeof c.y === 'number') {
          setCursor({ x: c.x.toFixed(2), y: c.y.toFixed(2), z: (c.z ?? 0).toFixed(2) });
        } else {
          setCursor(null);
        }
        // WF-06 — calculating indicator.
        const busy = window.__archdiscBusyTool;
        const busySince = window.__archdiscBusyStartedAt;
        setBusyTool(busy || null);
        setBusyElapsedMs(busy && busySince ? Math.max(0, Date.now() - busySince) : 0);
        // WF-06 — dirty indicator (reuse `hist` from the entry count
        // block above; no re-declaration). DesignHistory exposes
        // `.entries.length` as its monotonic counter (no separate
        // cursor field).
        if (hist) {
          const histCursor = hist.entries ? hist.entries.length : 0;
          const savedCursor = window.__archdiscLastSavedHistoryCursor ?? null;
          // Dirty when history has entries AND either we've never saved,
          // OR the cursor has moved past the last-saved point.
          if (histCursor > 0 && (savedCursor === null || histCursor !== savedCursor)) {
            setDirty(true);
          } else {
            setDirty(false);
          }
        } else {
          setDirty(false);
        }
        // WF-06 — saved flash (2 s after the save event).
        const lastSavedAt = window.__archdiscLastSavedAt;
        if (lastSavedAt && Date.now() - lastSavedAt < 2500) {
          setSavedFlash({
            filename: window.__archdiscLastSavedFilename || 'project',
            ts: lastSavedAt,
          });
        } else {
          setSavedFlash(null);
        }
      } catch {
        // Silently swallow — never break the UI on a status-bar poll.
      }
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, []);

  const mode = sketchActive ? 'SKETCH' : (selection?.type || 'READY');
  const modeColor = sketchActive ? '#00bbff' : selection ? '#ff6b35' : '#4caf50';

  return (
    <div className="status-bar-pro">
      <div className="status-left">
        <span className="status-mode" style={{ color: modeColor }}>{mode.toUpperCase()}</span>
        {selection?.name && <span className="status-sel">{selection.name}</span>}
        {selection?.faceId !== undefined && <span className="status-sel">Face #{selection.faceId}</span>}
        {sketchStatus && <span className="status-sketch">{sketchStatus}</span>}
      </div>
      <div className="status-center">
        {cursor ? (
          <span className="status-coords">
            X:{cursor.x} Y:{cursor.y} Z:{cursor.z} mm
          </span>
        ) : selection?.position ? (
          <span className="status-coords">
            X:{selection.position.x} Y:{selection.position.y} Z:{selection.position.z}
          </span>
        ) : null}
      </div>
      <div className="status-right">
        {busyTool && (
          <>
            <span className="status-busy" data-archdisc-status="busy" title={`${busyTool} running…`}>
              <span className="status-busy-dot" />
              Calculating · {busyTool}
              {busyElapsedMs > 700 && <span className="status-busy-elapsed"> · {(busyElapsedMs / 1000).toFixed(1)}s</span>}
            </span>
            <span className="status-divider">|</span>
          </>
        )}
        {!busyTool && savedFlash && (
          <>
            <span className="status-saved-flash" data-archdisc-status="saved" title={`Saved as ${savedFlash.filename}`}>
              ✓ Saved
            </span>
            <span className="status-divider">|</span>
          </>
        )}
        {!busyTool && !savedFlash && dirty && (
          <>
            <span className="status-dirty" data-archdisc-status="dirty" title="Unsaved changes since last snapshot">
              ● Unsaved
            </span>
            <span className="status-divider">|</span>
          </>
        )}
        {bodyCount > 0 && (
          <>
            <span className="status-stat" title="Bodies in scene">▦ {bodyCount}</span>
            <span className="status-divider">|</span>
          </>
        )}
        {historyCount > 0 && (
          <>
            <span className="status-stat" title="Active design history entries">↺ {historyCount}</span>
            <span className="status-divider">|</span>
          </>
        )}
        {equationCount > 0 && (
          <>
            <span className="status-stat" title="Equation Manager variables">Σ {equationCount}</span>
            <span className="status-divider">|</span>
          </>
        )}
        <span className="status-unit">mm</span>
        <span className="status-divider">|</span>
        <span className="status-fps">{fps} FPS</span>
      </div>
    </div>
  );
}
