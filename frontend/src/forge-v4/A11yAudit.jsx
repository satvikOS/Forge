// Forge-196 — ARIA / screen-reader accessibility audit.
//
// `runAudit()` walks the live DOM and reports issues by category:
//
//   * button-no-name    — <button> with no visible text + no aria-label
//   * input-no-label    — <input>/<select>/<textarea> without an
//                          associated label or aria-label
//   * img-no-alt        — <img> missing alt (or empty when role != presentation)
//   * a-no-name         — <a href> with no accessible name
//   * heading-skip      — heading levels jump > 1 (e.g. h1 → h3)
//   * interactive-no-role — divs/spans with click handlers and no role
//
// Each issue carries a CSS selector path for quick triage. The audit
// runs synchronously and returns a structured report — the panel just
// renders it. `__forgeA11yAudit()` is exposed on window for e2e and
// scripting.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 560, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};

const buttonStyle = {
  background: 'var(--forge-accent)', border: 'none',
  color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
  fontWeight: 600, fontFamily: 'var(--forge-mono)',
};

function selectorFor(el) {
  if (!el) return '';
  if (el.id) return `#${el.id}`;
  let path = el.tagName.toLowerCase();
  if (el.dataset && el.dataset.testid) path += `[data-testid="${el.dataset.testid}"]`;
  else if (el.className && typeof el.className === 'string') {
    const cls = el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) path += `.${cls}`;
  }
  return path;
}

function accessibleName(el) {
  if (!el) return '';
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  if (el.tagName === 'INPUT' && el.placeholder) return el.placeholder.trim();
  const text = el.textContent || '';
  return text.trim();
}

function isInteractive(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'button' || tag === 'a' || tag === 'input'
      || tag === 'select' || tag === 'textarea') return true;
  if (el.getAttribute('role')) return true;
  if (el.onclick) return true;
  return false;
}

export function runAudit() {
  const out = {
    counts: {},
    issues: [],
    totalScanned: 0,
  };
  if (typeof document === 'undefined') return out;
  const all = document.querySelectorAll('*');
  out.totalScanned = all.length;
  let lastHeadingLevel = 0;
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    // buttons / button-like
    if (tag === 'button' && !accessibleName(el)) {
      out.issues.push({ kind: 'button-no-name', selector: selectorFor(el) });
    }
    // inputs (excluding submit/reset which usually have value attrs)
    if ((tag === 'input' || tag === 'select' || tag === 'textarea')
        && !accessibleName(el)) {
      // Check for associated label by id.
      const id = el.id;
      const labelled = id && document.querySelector(`label[for="${id}"]`);
      const wrapped  = el.closest('label');
      if (!labelled && !wrapped) {
        out.issues.push({ kind: 'input-no-label', selector: selectorFor(el) });
      }
    }
    // images
    if (tag === 'img') {
      const alt = el.getAttribute('alt');
      const role = el.getAttribute('role');
      if (alt === null && role !== 'presentation') {
        out.issues.push({ kind: 'img-no-alt', selector: selectorFor(el) });
      }
    }
    // anchors
    if (tag === 'a' && el.hasAttribute('href') && !accessibleName(el)) {
      out.issues.push({ kind: 'a-no-name', selector: selectorFor(el) });
    }
    // headings
    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1], 10);
      if (lastHeadingLevel > 0 && level - lastHeadingLevel > 1) {
        out.issues.push({ kind: 'heading-skip',
                          selector: selectorFor(el),
                          detail: `h${lastHeadingLevel} → h${level}` });
      }
      lastHeadingLevel = level;
    }
    // div/span with click handler but no role/tabindex
    if ((tag === 'div' || tag === 'span') && el.onclick
        && !el.getAttribute('role')
        && el.getAttribute('tabindex') == null) {
      out.issues.push({ kind: 'interactive-no-role', selector: selectorFor(el) });
    }
  }
  for (const i of out.issues) {
    out.counts[i.kind] = (out.counts[i.kind] || 0) + 1;
  }
  return out;
}

export function A11yAuditWorkbenchPanel({ open, onClose }) {
  const [report, setReport] = React.useState(null);
  const onRun = React.useCallback(() => setReport(runAudit()), []);
  React.useEffect(() => { if (open) onRun(); }, [open, onRun]);
  if (!open) return null;
  return (
    <div style={panelStyle} data-testid="forge-a11y-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Accessibility audit · ARIA / SR coverage</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-a11y-close">×</button>
      </header>

      <button onClick={onRun} style={buttonStyle}
              data-testid="forge-a11y-run">
        Re-run audit
      </button>

      {report && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-a11y-summary">
          <div>Total elements scanned   {report.totalScanned}</div>
          <div>Total issues             {report.issues.length}</div>
          {Object.entries(report.counts).map(([k, v]) => (
            <div key={k}>{k.padEnd(22, ' ')} {v}</div>
          ))}
        </section>
      )}

      {report && report.issues.length > 0 && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          maxHeight: 320, overflowY: 'auto' }}
                 data-testid="forge-a11y-list">
          {report.issues.slice(0, 80).map((i, k) => (
            <div key={k} style={{ color: 'var(--forge-bad, #ff6363)' }}>
              {i.kind.padEnd(22, ' ')}  {i.selector}
              {i.detail ? `  ${i.detail}` : ''}
            </div>
          ))}
          {report.issues.length > 80 && (
            <div style={{ color: 'var(--forge-ink-mute)' }}>
              … {report.issues.length - 80} more (showing first 80)
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function A11yAuditWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenA11yWorkbench  = () => setOpen(true);
    window.__forgeCloseA11yWorkbench = () => setOpen(false);
    window.__forgeA11yAudit          = runAudit;
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.a11y' || e?.detail?.id === 'workbench.a11y') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'a11y') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <A11yAuditWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default A11yAuditWorkbenchPanel;
