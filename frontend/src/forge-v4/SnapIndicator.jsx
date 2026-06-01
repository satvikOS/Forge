// Forge-117 — visual snap indicator.
//
// Renders a 12 px glyph at the active snap point. Uses drei <Html> so
// the SVG sits in screen space and never rotates with the camera. The
// active snap is read from window.__forgeSnap (snapEngine.js) and the
// component re-renders on the 'forge-snap-change' window event.
//
// Drop this anywhere inside the r3f <Canvas>:
//   <SnapIndicator />
//
// If you need to drive the indicator outside r3f (e.g. for screenshots
// in tests) you can use <SnapIndicatorHtml /> — same glyph, plain DOM.

import React, { useEffect, useState, lazy, Suspense } from 'react';
import { getSnapState } from './snapEngine.js';

const GLYPH_SIZE = 12;

const GLYPHS = {
  vertex:        VertexGlyph,
  edgeMid:       EdgeMidGlyph,
  faceCenter:    FaceCenterGlyph,
  grid:          GridGlyph,
  origin:        OriginGlyph,
  perpendicular: PerpendicularGlyph,
  tangent:       TangentGlyph,
};

function useActiveSnap() {
  const [snap, setSnap] = useState(() => {
    const s = getSnapState();
    return s ? s.active : null;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      const s = getSnapState();
      setSnap(s ? s.active : null);
    };
    window.addEventListener('forge-snap-change', refresh);
    return () => window.removeEventListener('forge-snap-change', refresh);
  }, []);
  return snap;
}

function VertexGlyph({ color }) {
  // small square
  return (
    <rect x="2" y="2" width="8" height="8"
          fill="none" stroke={color} strokeWidth="1.5" />
  );
}
function EdgeMidGlyph({ color }) {
  // triangle pointing down
  return (
    <polygon points="1,2 11,2 6,11"
             fill="none" stroke={color} strokeWidth="1.5"
             strokeLinejoin="round" />
  );
}
function FaceCenterGlyph({ color }) {
  // circle outline
  return (
    <circle cx="6" cy="6" r="4.5"
            fill="none" stroke={color} strokeWidth="1.5" />
  );
}
function GridGlyph({ color }) {
  // cross
  return (
    <g stroke={color} strokeWidth="1.5" strokeLinecap="round">
      <line x1="1" y1="6" x2="11" y2="6" />
      <line x1="6" y1="1" x2="6" y2="11" />
    </g>
  );
}
function OriginGlyph({ color }) {
  // filled circle
  return <circle cx="6" cy="6" r="3.5" fill={color} />;
}
function PerpendicularGlyph({ color }) {
  // 90° angle glyph
  return (
    <g stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round">
      <polyline points="1,1 1,11 11,11" />
      <rect x="1" y="8" width="3" height="3" />
    </g>
  );
}
function TangentGlyph({ color }) {
  // tangent — line tangent to small arc
  return (
    <g stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round">
      <circle cx="6" cy="8" r="3" />
      <line x1="0" y1="3" x2="12" y2="3" />
    </g>
  );
}

function Glyph({ kind, color = '#ebecef' }) {
  const G = GLYPHS[kind] || GLYPHS.vertex;
  return (
    <svg width={GLYPH_SIZE} height={GLYPH_SIZE} viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`}
         data-testid="forge-snap-glyph"
         data-snap-kind={kind}
         style={{ display: 'block', overflow: 'visible',
                  filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.85))' }}>
      <G color={color} />
    </svg>
  );
}

/**
 * Plain-DOM variant — renders an absolutely positioned glyph at the
 * stored screen coordinates. Safe to mount outside r3f. This is what
 * the test spec asserts on (data-testid="forge-snap-indicator").
 */
export function SnapIndicatorHtml({ color = '#ebecef' }) {
  const snap = useActiveSnap();
  if (!snap || !snap.screen) return null;
  return (
    <div data-testid="forge-snap-indicator"
         data-snap-kind={snap.kind}
         style={{
           position: 'fixed',
           left: snap.screen.x - GLYPH_SIZE / 2,
           top:  snap.screen.y - GLYPH_SIZE / 2,
           width: GLYPH_SIZE,
           height: GLYPH_SIZE,
           pointerEvents: 'none',
           zIndex: 1450,
           color,
         }}>
      <Glyph kind={snap.kind} color={color} />
    </div>
  );
}

/**
 * r3f variant — places the glyph in 3-space via drei <Html>. Lazy-loads
 * drei so this file is safe to import in SSR / headless tests.
 */
export function SnapIndicator({ color = 'var(--forge-accent)' }) {
  const snap = useActiveSnap();
  const [Html, setHtml] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    (async () => {
      try {
        const drei = await import('@react-three/drei');
        if (!cancelled) setHtml(() => drei.Html);
      } catch (_) {
        // drei not present — fall back silently. SnapIndicatorHtml is
        // the alternative.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!snap || !snap.world || !Html) return null;
  const [x, y, z] = snap.world;
  return (
    <Html position={[x, y, z]}
          center
          zIndexRange={[100, 0]}
          style={{ pointerEvents: 'none' }}
          data-testid="forge-snap-html">
      <div data-testid="forge-snap-indicator"
           data-snap-kind={snap.kind}
           style={{ color, width: GLYPH_SIZE, height: GLYPH_SIZE }}>
        <Glyph kind={snap.kind} color={color} />
      </div>
    </Html>
  );
}

export default SnapIndicator;
