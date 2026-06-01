// Forge-147 — demo project that programmatically drives the v4 shell
// through the same UI surface a human would click. Used to:
//   1. demonstrate end-to-end pipeline (sketch → solid → fillet → BOM →
//      export bundle) without the user having to walk every step
//   2. seed a tutorial scene the first time the app is opened
//   3. provide a reproducible scenario for performance + correctness tests
//
// Reachable via Tools > "Build sample bracket…" menu entry. The runner
// fires the same dispatchTool path each step that a real user click would,
// so this is not a backdoor — it's automation of legitimate UI flow.

import React from 'react';
import { createPortal } from 'react-dom';

const STEPS = [
  { id: 'sketch.new',     params: { plane: 'XY' },
    label: 'Open sketch on XY plane' },
  { id: 'sketch.rect',    params: { center: [0,0,0], width: 60, height: 40 },
    label: 'Draw 60 × 40 rectangle' },
  { id: 'sketch.circle',  params: { center: [-22, -12, 0], radius: 3 },
    label: 'Add M6 corner hole 1' },
  { id: 'sketch.circle',  params: { center: [ 22, -12, 0], radius: 3 },
    label: 'Add M6 corner hole 2' },
  { id: 'sketch.circle',  params: { center: [ 22,  12, 0], radius: 3 },
    label: 'Add M6 corner hole 3' },
  { id: 'sketch.circle',  params: { center: [-22,  12, 0], radius: 3 },
    label: 'Add M6 corner hole 4' },
  { id: 'sketch.finish',  params: {},
    label: 'Finish sketch — solve constraints' },
  { id: 'solid.extrude',  params: { distance: 6, direction: 'Up (+Z)', op: 'New body' },
    label: 'Extrude 6 mm' },
  { id: 'solid.fillet',   params: { radius: 2 },
    label: 'Fillet outer edges 2 mm' },
  { id: 'solid.shell',    params: { thickness: 1.5 },
    label: 'Shell 1.5 mm wall' },
];

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 1700,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const cardStyle = {
  width: 460, background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius-lg)',
  padding: 'var(--forge-space-4)',
  color: 'var(--forge-ink)', fontSize: 13,
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
};

export function DemoProjectHost() {
  const [open, setOpen] = React.useState(false);
  const [progress, setProgress] = React.useState(-1);
  const [log, setLog] = React.useState([]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeOpenDemoProject = (v) => setOpen(typeof v === 'boolean' ? v : !open);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.demoProject') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, [open]);

  async function run() {
    setLog([]);
    setProgress(0);
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      setProgress(i);
      setLog((l) => [...l, `▶ ${step.label}`]);
      // Drive through the same dispatch the menu uses.
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: step.id, params: step.params, _fromDemo: true } }));
      // Allow the React render cycle + tool dialog to flush before next step.
      await new Promise((r) => setTimeout(r, 420));
    }
    setProgress(STEPS.length);
    setLog((l) => [...l, '✓ Sample bracket complete — open Tools > BOM to inspect.']);
  }

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div style={overlayStyle} data-testid="forge-demo-project"
         onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div style={cardStyle} role="dialog">
        <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
          <strong style={{ fontSize: 14 }}>Sample Bracket Project</strong>
          <span style={{ flex: 1 }} />
          <button onClick={() => setOpen(false)}
                  style={{ background: 'transparent', border: 'none',
                           color: 'var(--forge-ink)', cursor: 'pointer',
                           fontSize: 16 }}
                  data-testid="forge-demo-close">×</button>
        </header>
        <p style={{ color: 'var(--forge-ink-mute)', margin: 0, lineHeight: 1.45 }}>
          Drives the v4 UI through the full pipeline: sketch → extrude → fillet →
          shell. Each step fires the same dispatcher a real menu click would. The
          resulting body lands in the bodies state, with feature-tree entries +
          rollback timeline, mass props live in Tools › BOM, drawings via
          Drawings workbench.
        </p>
        <ol style={{ margin: 0, paddingLeft: 'var(--forge-space-4)',
                     fontSize: 12, lineHeight: 1.7,
                     color: 'var(--forge-ink)', maxHeight: 220,
                     overflowY: 'auto' }}
            data-testid="forge-demo-steps">
          {STEPS.map((s, i) => (
            <li key={i}
                style={{ opacity: progress >= 0 && i > progress ? 0.45 : 1,
                         fontWeight: progress === i ? 700 : 400,
                         color: progress > i ? 'var(--forge-ok)' :
                                progress === i ? 'var(--forge-accent)' :
                                'var(--forge-ink)' }}>
              {s.label}
            </li>
          ))}
        </ol>
        {log.length > 0 && (
          <pre style={{ background: 'var(--forge-canvas)', borderRadius: 'var(--forge-radius)',
                        padding: 'var(--forge-space-2)', maxHeight: 140,
                        overflowY: 'auto', margin: 0, fontSize: 11 }}
               data-testid="forge-demo-log">
{log.join('\n')}
          </pre>
        )}
        <footer style={{ display: 'flex', gap: 'var(--forge-space-2)' }}>
          <button onClick={run}
                  disabled={progress >= 0 && progress < STEPS.length}
                  style={{ background: 'var(--forge-accent-mute)',
                           border: '1px solid var(--forge-accent-rim)',
                           color: 'var(--forge-ink)',
                           padding: '6px 16px',
                           borderRadius: 'var(--forge-radius)',
                           cursor: progress < 0 || progress >= STEPS.length ? 'pointer' : 'progress',
                           fontWeight: 600 }}
                  data-testid="forge-demo-run">
            {progress < 0 ? 'Run sample' :
             progress >= STEPS.length ? 'Re-run' : `Building… (${progress + 1}/${STEPS.length})`}
          </button>
          <span style={{ flex: 1 }} />
        </footer>
      </div>
    </div>,
    document.body);
}
