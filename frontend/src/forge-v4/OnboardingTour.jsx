// Forge-189 — Onboarding tutorial (guided tooltips).
//
// On first launch (gated by localStorage `forge.v4.onboarded`), step
// through 6 highlighted overlays explaining the key surfaces. User can
// Skip All or click Next / Done. Replayable via Help → Tour menu or
// window.__forgeStartTour().
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const STORAGE_KEY = 'forge.v4.onboarded';

const STEPS = [
  {
    targetSelector: '[data-testid="forge-wb-rail"]',
    placement: 'right',
    title: 'Workbench rail',
    body: 'Switch between Part, Sketch, Drawing, Sim, Mfg, and the ' +
          'discipline workbenches (Aero, Casting, Geotech, Acoustics, ' +
          'Welding FEA, Sun-path, Cost, Carbon LCA, Tolerance). Active ' +
          'workbench gets a copper border + label.',
  },
  {
    targetSelector: '[data-testid="forge-viewport"]',
    placement: 'top',
    title: 'Viewport',
    body: 'Native B-rep bodies render here via the OCCT kernel. Press 1–7 ' +
          'to swing through named views (iso/front/back/top/bottom/right/left). ' +
          'H frames the camera on the origin.',
  },
  {
    targetSelector: '[data-testid="forge-cmd-bar"]',
    placement: 'top',
    title: 'Command bar (Cmd+K)',
    body: 'Tell Forge what to do in natural language. Press Cmd+K from ' +
          'anywhere to focus the bar. Archie streams its plan into the ' +
          'sidebar on the right.',
  },
  {
    targetSelector: '[data-testid="forge-archie"]',
    placement: 'left',
    title: 'Archie sidebar',
    body: 'The persistent AI assistant thread. Conversations survive ' +
          'reload (per-thread localStorage). Cmd+N starts a fresh thread.',
  },
  {
    targetSelector: '[data-testid="forge-timeline"]',
    placement: 'bottom',
    title: 'Parametric timeline',
    body: 'Every operation lands here in order. Shift+click to roll the ' +
          'design back to that step, double-click to inspect, Backspace ' +
          'to truncate the history at that point.',
  },
  {
    targetSelector: '[data-testid="forge-aero-panel"], [data-testid="forge-cost-panel"], [data-testid="forge-tol-panel"], [data-testid="forge-app"]',
    placement: 'center',
    title: "You're ready",
    body: 'You can replay this tour any time from Help → Show Tour. ' +
          'Save with ⌘S, load with ⌘O, undo with ⌘Z. Have fun.',
  },
];

const tooltipStyle = {
  position: 'fixed', zIndex: 5500,
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-accent)',
  borderRadius: 4,
  padding: '10px 14px',
  fontSize: 12, fontFamily: 'var(--forge-mono)',
  color: 'var(--forge-ink)',
  maxWidth: 360,
  boxShadow: '0 6px 22px rgba(0,0,0,0.4)',
};

const overlayStyle = {
  position: 'fixed', inset: 0,
  background: 'rgba(8, 12, 18, 0.55)',
  zIndex: 5400,
  pointerEvents: 'auto',
};

const highlightStyle = (rect) => rect ? ({
  position: 'fixed',
  top: rect.top - 4, left: rect.left - 4,
  width: rect.width + 8, height: rect.height + 8,
  border: '2px solid var(--forge-accent)',
  borderRadius: 4,
  pointerEvents: 'none',
  zIndex: 5450,
  boxShadow: '0 0 0 9999px rgba(8,12,18,0.55)',
}) : null;

function placeTooltip(rect, placement) {
  if (!rect || placement === 'center' || !rect.width) {
    return {
      ...tooltipStyle,
      top: '40%', left: '50%', transform: 'translate(-50%, -50%)',
    };
  }
  const m = 12;
  switch (placement) {
    case 'top':    return { ...tooltipStyle, bottom: window.innerHeight - rect.top + m, left: rect.left };
    case 'bottom': return { ...tooltipStyle, top: rect.bottom + m, left: rect.left };
    case 'left':   return { ...tooltipStyle, right: window.innerWidth - rect.left + m, top: rect.top };
    case 'right':  return { ...tooltipStyle, left: rect.right + m, top: rect.top };
    default:       return { ...tooltipStyle, top: rect.bottom + m, left: rect.left };
  }
}

function findRect(selectors) {
  const list = (selectors || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const sel of list) {
    try {
      const el = document.querySelector(sel);
      if (el) return el.getBoundingClientRect();
    } catch { /* invalid selector */ }
  }
  return null;
}

export function OnboardingTourHost() {
  const [stepIdx, setStepIdx] = React.useState(-1);     // -1 = inactive
  const [rect, setRect] = React.useState(null);

  const start = React.useCallback(() => setStepIdx(0), []);
  const finish = React.useCallback(() => {
    setStepIdx(-1);
    try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* noop */ }
  }, []);

  // Resolve the highlighted element's rect on step change + on resize.
  React.useEffect(() => {
    if (stepIdx < 0 || stepIdx >= STEPS.length) { setRect(null); return; }
    const update = () => setRect(findRect(STEPS[stepIdx].targetSelector));
    update();
    const id = setInterval(update, 250);
    window.addEventListener('resize', update);
    return () => { clearInterval(id); window.removeEventListener('resize', update); };
  }, [stepIdx]);

  // Auto-start on first launch + install window APIs.
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeStartTour = start;
    window.__forgeFinishTour = finish;
    window.__forgeTourActive = () => stepIdx >= 0;
    const seen = (() => {
      try { return window.localStorage.getItem(STORAGE_KEY) === '1'; }
      catch { return true; }
    })();
    if (!seen) {
      // Defer to give the shell a chance to mount its testids.
      const t = setTimeout(() => setStepIdx(0), 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []);

  if (typeof document === 'undefined' || stepIdx < 0) return null;
  const step = STEPS[stepIdx];
  const onNext = () => {
    if (stepIdx + 1 >= STEPS.length) finish();
    else setStepIdx(stepIdx + 1);
  };
  const onPrev = () => setStepIdx(Math.max(0, stepIdx - 1));

  return createPortal(
    <>
      <div style={overlayStyle} data-testid="forge-tour-overlay" />
      {rect && step.placement !== 'center' && (
        <div style={highlightStyle(rect)} data-testid="forge-tour-highlight" />
      )}
      <div style={placeTooltip(rect, step.placement)}
           data-testid="forge-tour-tooltip">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {stepIdx + 1}/{STEPS.length}  ·  {step.title}
        </div>
        <div style={{ lineHeight: 1.45, marginBottom: 10 }}>
          {step.body}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {stepIdx > 0 && (
            <button onClick={onPrev}
                    style={{ background: 'transparent', border: '1px solid var(--forge-rail-edge)',
                             color: 'var(--forge-ink)', padding: '4px 10px',
                             cursor: 'pointer', fontFamily: 'var(--forge-mono)', fontSize: 11 }}
                    data-testid="forge-tour-prev">
              Back
            </button>
          )}
          <button onClick={finish}
                  style={{ background: 'transparent', border: '1px solid var(--forge-rail-edge)',
                           color: 'var(--forge-ink-mute)', padding: '4px 10px',
                           cursor: 'pointer', fontFamily: 'var(--forge-mono)', fontSize: 11 }}
                  data-testid="forge-tour-skip">
            Skip
          </button>
          <button onClick={onNext}
                  style={{ background: 'var(--forge-accent)', border: 'none',
                           color: '#0a0e14', padding: '4px 12px',
                           cursor: 'pointer', fontFamily: 'var(--forge-mono)',
                           fontSize: 11, fontWeight: 600 }}
                  data-testid="forge-tour-next">
            {stepIdx + 1 >= STEPS.length ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export default OnboardingTourHost;
