// PUSH-143 (Slice-103) — Full ASME Y14.5-2018 semantic GD&T validator panel.
//
// PUSH-92 added a Feature Control Frame builder (window.__forgeGdtFrames).
// This panel consumes that store and runs the asmeY145Rules.js rules
// engine — datum precedence, modifier compatibility, composite frame
// validity, material-condition usage, etc. — and presents a real
// inspection report with row-level pass/fail.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { validateFrames, summariseFrames } from './asmeY145Rules.js';

export const FORGE_ASME_VALIDATOR_EVENT = 'forge:asme-validator-run';

function readFrames() {
  if (typeof window === 'undefined') return [];
  const arr = window.__forgeGdtFrames;
  return Array.isArray(arr) ? arr : [];
}

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0, bottom: 'var(--forge-statusbar-h, 24px)',
  width: 520, zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 8,
  color: 'var(--forge-ink)', fontSize: 12, overflowY: 'auto',
};
const chip = (label, value, color) => (
  <div style={{
    padding: '6px 10px', borderRadius: 4, background: 'var(--forge-canvas)',
    border: '1px solid var(--forge-rail-edge)',
    color, fontFamily: 'var(--forge-mono)', fontSize: 11,
  }}>{label} <strong>{value}</strong></div>
);

export function AsmeValidatorPanel({ open, onClose }) {
  const [frames, setFrames] = useState(() => readFrames());
  const [report, setReport] = useState(null);

  useEffect(() => {
    if (!open) return;
    setFrames(readFrames());
    const onChange = () => setFrames(readFrames());
    window.addEventListener('forge:gdt-frames-changed', onChange);
    return () => window.removeEventListener('forge:gdt-frames-changed', onChange);
  }, [open]);

  const run = useCallback(() => {
    const r = validateFrames(frames);
    setReport(r);
    try {
      window.__forgeAsmeValidatorReport = r;
      window.dispatchEvent(new CustomEvent(FORGE_ASME_VALIDATOR_EVENT, { detail: r }));
    } catch {}
  }, [frames]);

  const summary = useMemo(() => report ? summariseFrames(report) : null, [report]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-asme-validator-panel"
         data-frame-count={frames.length}>
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>ASME Y14.5 Validator</strong>
        <button onClick={onClose}
                data-testid="forge-asme-validator-close"
                style={{ background: 'transparent', border: '1px solid var(--forge-rail-edge)',
                         color: 'var(--forge-ink)', cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)' }}>
        Frames in store: <strong data-testid="forge-asme-frame-count">{frames.length}</strong>
      </div>
      <button onClick={run}
              data-testid="forge-asme-run"
              style={{ background: 'var(--forge-accent, #2c4d2a)', color: '#dfeedd', border: 'none',
                       padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
        Run validation
      </button>

      {summary && (
        <div data-testid="forge-asme-summary" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {chip('Pass', summary.framesPassed, '#7ec07e')}
          {chip('Fail', summary.framesFailed, '#ff8a8a')}
          {chip('Violations', summary.totalViolations, '#ffd479')}
        </div>
      )}

      {report && (
        <section data-testid="forge-asme-report" style={{
          fontFamily: 'var(--forge-mono)', fontSize: 11,
          maxHeight: 360, overflowY: 'auto',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--forge-rail-edge)' }}>
                <th style={{ textAlign: 'left', padding: 4 }}>#</th>
                <th style={{ textAlign: 'left', padding: 4 }}>Frame</th>
                <th style={{ textAlign: 'left', padding: 4 }}>Pass</th>
                <th style={{ textAlign: 'left', padding: 4 }}>Violations</th>
              </tr>
            </thead>
            <tbody>
              {report.byFrame.map((r, i) => (
                <tr key={i} data-row="report" data-frame-index={i} data-pass={String(r.pass)}>
                  <td style={{ padding: 4 }}>{i + 1}</td>
                  <td style={{ padding: 4 }}>{r.frame?.formatted || r.frame?.symbol || '—'}</td>
                  <td style={{ padding: 4, color: r.pass ? '#7ec07e' : '#ff8a8a' }}>
                    {r.pass ? '✓' : '✗'}
                  </td>
                  <td style={{ padding: 4, color: 'var(--forge-ink-mute)' }}>
                    {(r.violations || []).map((v) => v.rule).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

export function AsmeValidatorPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenAsmeValidator = (b) => setOpen(b === undefined ? true : !!b);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.asmeValidator') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AsmeValidatorPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default AsmeValidatorPanel;
