import { useState, useEffect } from 'react';
import './StatusBarPro.css';

/**
 * Professional Status Bar — bottom of viewport.
 * Shows: cursor coords, selection info, triangle count, FPS, units, mode.
 */
export default function StatusBarPro({ selection, sketchActive, sketchStatus }) {
  const [fps, setFps] = useState(60);
  const [triCount, setTriCount] = useState(0);

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

  const mode = sketchActive ? 'SKETCH' : (selection?.type || 'READY');
  const modeColor = sketchActive ? '#00bbff' : selection ? '#ff6b35' : '#4caf50';

  return (
    <div className="status-bar-pro">
      <div className="status-left">
        <span className="status-mode" style={{ color: modeColor }}>{mode.toUpperCase()}</span>
        {selection?.name && <span className="status-sel">{selection.name}</span>}
        {selection?.faceId && <span className="status-sel">Face #{selection.faceId}</span>}
        {sketchStatus && <span className="status-sketch">{sketchStatus}</span>}
      </div>
      <div className="status-center">
        {selection?.position && (
          <span className="status-coords">
            X:{selection.position.x} Y:{selection.position.y} Z:{selection.position.z}
          </span>
        )}
      </div>
      <div className="status-right">
        <span className="status-unit">mm</span>
        <span className="status-divider">|</span>
        <span className="status-fps">{fps} FPS</span>
      </div>
    </div>
  );
}
