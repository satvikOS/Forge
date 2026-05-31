// Forge-57 — view state: named camera presets + display state.
//
// Persists alongside the active Archie thread (one thread = one
// design = one set of named views + one current display state). Keys
// live in the backend used by ArchieThreadStore (localStorage in the
// renderer, memory in SSR/tests).
//
// Display states:
//   'shaded'      — default PBR materials (every mesh visible)
//   'wireframe'   — edges-only render, no faces
//   'transparent' — translucent faces (50% opacity), edges drawn
//   'hidden'      — hidden-line render (HLR — the drawings projection)
//   'shaded-edges'— shaded + edge overlay (the SolidWorks default)
//
// Each is one numeric param the renderer reads to swap material props.
// The HLR path delegates to the kernel; the rest are pure r3f.

import { useCallback, useEffect, useState } from 'react';

const VIEWS_KEY   = (threadId) => `forge.v3.views.${threadId}`;
const DISPLAY_KEY = (threadId) => `forge.v3.display.${threadId}`;

export const DISPLAY_STATES = [
  'shaded',
  'shaded-edges',
  'wireframe',
  'transparent',
  'hidden',
];

export const DEFAULT_VIEWS = [
  { id: 'iso',    name: 'Iso',    position: [40, 25, 40],  target: [0,0,0], up: [0,1,0] },
  { id: 'front',  name: 'Front',  position: [0, 0, 60],    target: [0,0,0], up: [0,1,0] },
  { id: 'back',   name: 'Back',   position: [0, 0, -60],   target: [0,0,0], up: [0,1,0] },
  { id: 'top',    name: 'Top',    position: [0, 60, 0.01], target: [0,0,0], up: [0,0,-1] },
  { id: 'bottom', name: 'Bottom', position: [0,-60, 0.01], target: [0,0,0], up: [0,0, 1] },
  { id: 'right',  name: 'Right',  position: [60, 0, 0],    target: [0,0,0], up: [0,1,0] },
  { id: 'left',   name: 'Left',   position: [-60, 0, 0],   target: [0,0,0], up: [0,1,0] },
];

export function useViewState({ threadId, backend }) {
  const [views, setViews]       = useState(() => DEFAULT_VIEWS.slice());
  const [activeView, setActiveView] = useState('iso');
  const [displayState, setDisplayState] = useState('shaded');

  useEffect(() => {
    if (!threadId || !backend) return;
    try {
      const stored = backend.get(VIEWS_KEY(threadId));
      if (Array.isArray(stored) && stored.length) setViews(stored);
      const ds = backend.get(DISPLAY_KEY(threadId));
      if (typeof ds === 'string' && DISPLAY_STATES.includes(ds)) {
        setDisplayState(ds);
      }
    } catch { /* fall through */ }
  }, [threadId, backend]);

  const saveView = useCallback((name, snapshot) => {
    // snapshot = { position: [x,y,z], target: [x,y,z], up: [x,y,z] }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const entry = { id, name, ...snapshot };
    const next = [...views.filter((v) => v.id !== id), entry];
    setViews(next);
    if (threadId && backend) {
      try { backend.set(VIEWS_KEY(threadId), next); } catch {}
    }
    return entry;
  }, [views, threadId, backend]);

  const removeView = useCallback((id) => {
    const next = views.filter((v) => v.id !== id);
    setViews(next);
    if (threadId && backend) {
      try { backend.set(VIEWS_KEY(threadId), next); } catch {}
    }
  }, [views, threadId, backend]);

  const applyView = useCallback((id) => {
    const v = views.find((x) => x.id === id);
    if (v) setActiveView(v.id);
    return v || null;
  }, [views]);

  const cycleDisplay = useCallback(() => {
    setDisplayState((current) => {
      const i = DISPLAY_STATES.indexOf(current);
      const next = DISPLAY_STATES[(i + 1) % DISPLAY_STATES.length];
      if (threadId && backend) {
        try { backend.set(DISPLAY_KEY(threadId), next); } catch {}
      }
      return next;
    });
  }, [threadId, backend]);

  const setDisplay = useCallback((s) => {
    if (!DISPLAY_STATES.includes(s)) return;
    setDisplayState(s);
    if (threadId && backend) {
      try { backend.set(DISPLAY_KEY(threadId), s); } catch {}
    }
  }, [threadId, backend]);

  return {
    views, activeView, displayState,
    saveView, removeView, applyView,
    cycleDisplay, setDisplay,
  };
}
