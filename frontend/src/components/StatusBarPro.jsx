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
