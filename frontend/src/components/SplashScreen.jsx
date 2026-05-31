import { useEffect, useState } from 'react';
import './SplashScreen.css';

/**
 * SplashScreen — covers the first 1–3 seconds of cold-start while
 * OCCT WASM, manifold-3d WASM, and the Three.js viewport boot. Without
 * it, the user sees an empty grey rectangle, then a sudden flash to
 * the dark workbench, which feels unprofessional.
 *
 * Sequence:
 *   1. mount → show splash with branded panel + progress bar
 *   2. animate progress 0% → 95% over ~2.5 s (canned curve — the
 *      actual WASM load timing varies; we re-sync to "ready" once
 *      window.__archdiscKernel + __archdiscBodies appear)
 *   3. when both kernels are exposed → snap to 100%, fade out over
 *      300 ms, unmount
 *
 * Dismiss-only-once per session-day: localStorage records the last
 * shown time; if the user reloads within 30 s the splash is skipped
 * (avoids splash spam during e2e + dev hot-reload).
 */

const SHOWN_KEY = 'archdisc:splash:lastShownAt';
const SUPPRESS_WINDOW_MS = 30_000;

export default function SplashScreen() {
  const [shown, setShown] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = window.localStorage.getItem(SHOWN_KEY);
      if (raw) {
        const last = parseInt(raw, 10);
        if (Number.isFinite(last) && Date.now() - last < SUPPRESS_WINDOW_MS) return false;
      }
    } catch { /* fall through */ }
    return true;
  });
  const [progress, setProgress] = useState(0);
  const [fadingOut, setFadingOut] = useState(false);

  // Canned progress animation while kernels are warming up.
  useEffect(() => {
    if (!shown) return undefined;
    let raf;
    const start = performance.now();
    const TARGET_MS = 2500;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / TARGET_MS);
      // ease-out — accelerate to 95% then slow down
      const eased = 1 - Math.pow(1 - t, 2.5);
      setProgress(p => Math.max(p, Math.min(0.95, eased)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [shown]);

  // When the kernel + scene are ready → snap to 100% then fade out.
  useEffect(() => {
    if (!shown) return undefined;
    let dismissed = false;
    const check = setInterval(() => {
      if (dismissed) return;
      if (typeof window === 'undefined') return;
      const ready = !!window.__archdiscKernel && !!window.__archdiscBodies && !!window.__archdiscScene;
      if (ready) {
        dismissed = true;
        setProgress(1);
        setFadingOut(true);
        try { window.localStorage.setItem(SHOWN_KEY, String(Date.now())); } catch { /* ignore */ }
        setTimeout(() => setShown(false), 360);
        clearInterval(check);
      }
    }, 120);
    return () => clearInterval(check);
  }, [shown]);

  if (!shown) return null;

  return (
    <div className={`splash${fadingOut ? ' splash-fading' : ''}`} data-archdisc-splash={fadingOut ? 'fading' : 'visible'}>
      <div className="splash-panel">
        <div className="splash-mark" aria-hidden>
          {/* Two-stroke isometric cube mark — matches the toolIcons stroke style */}
          <svg viewBox="0 0 80 80" width="80" height="80">
            <path d="M16 28 L40 16 L64 28 L64 56 L40 68 L16 56 Z" fill="none" stroke="#5a8bd9" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M16 28 L40 40 L64 28 M40 40 L40 68" fill="none" stroke="#7ed957" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="splash-title">ArchDisc</h1>
        <div className="splash-sub">Mechanical CAD · Exact B-rep kernel</div>
        <div className="splash-progress" data-archdisc-splash-progress>
          <div className="splash-progress-bar" style={{ width: `${(progress * 100).toFixed(1)}%` }} />
        </div>
        <div className="splash-status">
          {progress < 0.95 ? 'Loading kernel…' : (fadingOut ? 'Ready' : 'Finalising…')}
        </div>
      </div>
    </div>
  );
}
