// Forge-106 — performance stats overlay.
//
// Shows live FPS, frame time, draw calls, triangles, geometries, textures
// in a small top-right HUD chip. Pulled from r3f's renderer.info each
// useFrame tick. Toggle via window.__forgePerfHUD(true|false) or by
// keyboard Cmd+Shift+P.
//
// Forge-125 — extended to display LOD distribution (High/Med/Low/Hidden
// counts) + tessellation pool occupancy from the lodScheduler. These
// reveal whether the 100k-body streaming pipeline is actually keeping
// up: if Hidden + Low dominate the budget, the LOD heuristic is doing
// its job; if poolBusy is pinned at poolCap and queueDepth is growing,
// the kernel can't tessellate as fast as the camera is moving.

import React from 'react';

const chipStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h) + var(--forge-toolbar-h) + var(--forge-space-2))',
  right: 'calc(var(--forge-right-w) + var(--forge-space-2))',
  zIndex: 1500,
  background: 'rgba(0, 0, 0, 0.65)',
  color: '#ebecef',
  fontFamily: 'var(--forge-mono)',
  fontSize: 10,
  padding: 'var(--forge-space-2) var(--forge-space-3)',
  borderRadius: 'var(--forge-radius)',
  border: '1px solid var(--forge-rail-edge)',
  pointerEvents: 'none',
  lineHeight: 1.35,
};

export function PerfStatsHUD() {
  const [open, setOpen] = React.useState(false);
  const [stats, setStats] = React.useState({
    fps: 0, ms: 0, calls: 0, tris: 0, geos: 0, tex: 0,
    lod: { high: 0, med: 0, low: 0, hidden: 0, total: 0,
           poolBusy: 0, poolCap: 0, queueDepth: 0, fallback: false },
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgePerfHUD = (v) => setOpen(!!v);
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let accum = 0;
    function tick(t) {
      frames++;
      const dt = t - last; last = t; accum += dt;
      if (accum >= 500) {
        const fps = Math.round((frames * 1000) / accum);
        const ms  = Math.round(accum / frames);
        let calls = 0, tris = 0, geos = 0, tex = 0;
        if (window.__forgeRenderer) {
          const r = window.__forgeRenderer.info;
          calls = r.render.calls;
          tris  = r.render.triangles;
          geos  = r.memory.geometries;
          tex   = r.memory.textures;
        }
        // Forge-125 — LOD distribution + pool occupancy.
        let lod = stats.lod;
        try {
          const m = window.__forgeLodMetrics?.();
          if (m) lod = m;
        } catch { /* keep last */ }
        setStats({ fps, ms, calls, tris, geos, tex, lod });
        frames = 0; accum = 0;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;
  const lod = stats.lod || {};
  const showLod = (lod.total ?? 0) > 0;
  return (
    <div style={chipStyle} data-testid="forge-perf-hud">
      <div><strong>{stats.fps}</strong> fps · {stats.ms} ms</div>
      <div>{stats.calls.toLocaleString()} calls</div>
      <div>{stats.tris.toLocaleString()} tris</div>
      <div>{stats.geos} geos · {stats.tex} tex</div>
      {showLod && (
        <div data-testid="forge-perf-hud-lod"
             style={{ marginTop: 4, paddingTop: 4,
                      borderTop: '1px solid rgba(255,255,255,0.18)' }}>
          <div>
            <span style={{ color:'#7ec97e' }}>H {lod.high.toLocaleString()}</span>
            {' '}·{' '}
            <span style={{ color:'#e8c66c' }}>M {lod.med.toLocaleString()}</span>
            {' '}·{' '}
            <span style={{ color:'#9aa3ad' }}>L {lod.low.toLocaleString()}</span>
          </div>
          <div>
            <span style={{ color:'#6b7380' }}>hid {lod.hidden.toLocaleString()}</span>
            {' / '}{lod.total.toLocaleString()}
          </div>
          <div data-testid="forge-perf-hud-pool">
            pool {lod.poolBusy}/{lod.poolCap}
            {lod.queueDepth > 0 ? ` · q${lod.queueDepth}` : ''}
            {lod.fallback ? ' · synth' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
