// Forge-116 — live hover tooltip.
//
// As the user hovers a body in the viewport, the tooltip shows: name,
// dimensions (bbox), material, mass via forge.massProps, surface area,
// volume. Cached per body handle so re-hover is instant. Toggle with the
// 'i' key (info) or window.__forgeHoverTooltip(true|false).

import React from 'react';

const cache = new Map();   // handle → { mass_g, volume_mm3, surface_mm2, centroid, ts }

export function computeBodyStats(body) {
  if (!body) return null;
  const key = body.handle ?? body.id;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < 5000) return hit;
  let stats = null;
  if (body.kind === 'native' && typeof body.handle === 'number'
      && window.forge?.massProps) {
    try {
      const m = window.forge.massProps(body.handle);
      stats = {
        mass_g: (m.volume || 0) * 7.85e-3,
        volume_mm3: m.volume || 0,
        surface_mm2: m.surface || 0,
        centroid: m.centroid || [0,0,0],
        kind: 'native',
        ts: Date.now(),
      };
    } catch (err) {
      console.warn('[forge.v4.hover] massProps:', err.message);
    }
  } else if (body.kind === 'synthetic' && body.spec) {
    const s = body.spec;
    let v = 0, a = 0;
    if (s.kind === 'box') {
      v = (s.dx || 0) * (s.dy || 0) * (s.dz || 0);
      a = 2 * ((s.dx*s.dy) + (s.dy*s.dz) + (s.dz*s.dx));
    } else if (s.kind === 'cylinder') {
      v = Math.PI * s.r * s.r * s.h;
      a = 2 * Math.PI * s.r * (s.r + s.h);
    } else if (s.kind === 'sphere') {
      v = (4/3) * Math.PI * Math.pow(s.r, 3);
      a = 4 * Math.PI * s.r * s.r;
    } else if (s.kind === 'torus') {
      v = 2 * Math.PI * Math.PI * s.R * s.r * s.r;
      a = 4 * Math.PI * Math.PI * s.R * s.r;
    }
    stats = {
      mass_g: v * 7.85e-3, volume_mm3: v, surface_mm2: a,
      centroid: [0,0,0], kind: 'synthetic', ts: Date.now(),
    };
  }
  if (stats) cache.set(key, stats);
  return stats;
}

const tipStyle = {
  position: 'fixed',
  zIndex: 1450,
  background: 'rgba(0, 0, 0, 0.85)',
  color: '#ebecef',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  lineHeight: 1.45,
  padding: 'var(--forge-space-2) var(--forge-space-3)',
  borderRadius: 'var(--forge-radius)',
  border: '1px solid var(--forge-rail-edge)',
  pointerEvents: 'none',
  maxWidth: 280,
  whiteSpace: 'pre',
};

export function HoverTooltip() {
  const [open, setOpen] = React.useState(true);
  const [info, setInfo] = React.useState(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeHoverTooltip = (v) => setOpen(!!v);
    const onMove = (e) => {
      // Look for the body the mouse currently hovers via window.__forgeHovered
      const body = window.__forgeHovered;
      if (!body) { setInfo(null); return; }
      const stats = computeBodyStats(body);
      setInfo({ x: e.clientX + 14, y: e.clientY + 14, body, stats });
    };
    const onKey = (e) => {
      if (!e.metaKey && !e.ctrlKey && e.key === 'i' &&
          document.activeElement?.tagName !== 'INPUT' &&
          document.activeElement?.tagName !== 'TEXTAREA') {
        setOpen((o) => !o);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open || !info?.body || !info?.stats) return null;
  const { body, stats } = info;
  return (
    <div style={{ ...tipStyle, left: info.x, top: info.y }}
         data-testid="forge-hover-tooltip">
      <strong style={{ color: '#fff' }}>{body.name || body.toolId || body.id}</strong>
      {'\n'}
      handle: {body.handle ?? '(synthetic)'}{'\n'}
      mass:   {stats.mass_g.toFixed(2)} g{'\n'}
      V:      {stats.volume_mm3.toFixed(0)} mm³{'\n'}
      A:      {stats.surface_mm2.toFixed(0)} mm²{'\n'}
      CG:     ({stats.centroid.map((v) => v.toFixed(1)).join(', ')})
    </div>
  );
}
