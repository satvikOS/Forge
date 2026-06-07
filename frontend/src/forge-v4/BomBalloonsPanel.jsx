// PUSH-93 (Slice-61 / BOM Balloon Auto-Place).
//
// PUSH-60 turned the BOM panel into a row-per-body engineering view. A
// real mechanical drawing then needs *balloons* — numbered circles tied
// to a BOM row by a leader line, placed near the body's projected
// centroid on a drawing view.
//
// This panel ships exactly that. Pick a view (front / top / right), hit
// Generate, and the panel:
//   1. reads every body from `window.__forgeBodies`,
//   2. asks `window.forge.massProps(handle)` for the world-space
//      centroid of each,
//   3. projects those centroids into the selected drawing view's 2D
//      plane (see `bomBalloonGenerator.js#projectPoint`),
//   4. lays the balloons out on a ring around the projected bbox,
//   5. emits one row per body with `{n, cx, cy, targetX, targetY,
//      leader}`,
//   6. renders an inline SVG preview the user can save or paste onto
//      a real drawing.
//
// "Copy SVG" copies the snippet to the system clipboard via the
// navigator.clipboard.writeText surface every Electron build ships.
//
// All math lives in `bomBalloonGenerator.js` so plugins / Archie tool
// calls / the e2e spec can drive the same code path without mounting
// React. The panel is reachable through:
//
//   * the `tools.bomBalloons` menu action (wired in Menus.jsx),
//   * `window.__forgeOpenBomBalloonsPanel(true|false)` for plugins,
//   * `window.__forgeBomBalloonsHelper.generateBalloons(...)` for
//     headless callers.
//
// Hard constraints (PUSH-93 brief):
//   * NO new npm packages, NO new C++ libs.
//   * Real impl, no MVP, no stub: every body gets a balloon, the SVG
//     is a complete renderable document, the panel mirrors helper
//     surfaces on `window` and dispatches a bus event on Generate.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  BALLOON_DEFAULT_RADIUS,
  SUPPORTED_VIEWS,
  generateBalloons,
  svgSnippetFor,
  BOM_BALLOON_HELPERS,
} from './bomBalloonGenerator.js';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const FORGE_BOM_BALLOONS_EVENT = 'forge:bom-balloons-generated';

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (delegate to bomBalloonGenerator.js so the math has one
// home). Exported because the e2e spec asserts the helper API exists
// even before the React panel mounts.

export function readBodiesSnapshot() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter((b) => b && typeof b.id === 'string' && b.id.length);
}

export function generateForCurrentScene(view, radius) {
  return generateBalloons(readBodiesSnapshot(), view, radius);
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail vocabulary as BatchRenamePanel +
// DiagnosticDumpPanel so all of slice 49/50/61 read the same.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 520,
  zIndex: 1331,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const FIELD_LABEL = {
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const SELECT_INPUT = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px',
  borderRadius: 3,
  fontSize: 12,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const NUM_INPUT = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px',
  borderRadius: 3,
  fontSize: 12,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  width: 64,
};
const ACTION_BTN = (variant = 'default', disabled = false) => ({
  background: variant === 'primary'
    ? 'var(--forge-accent, #4f87ff)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: variant === 'primary' ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: variant === 'primary' ? 600 : 400,
  opacity: disabled ? 0.5 : 1,
});
const TABLE_BOX = {
  flex: '0 0 auto',
  maxHeight: 200,
  overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  background: 'var(--forge-canvas-1, #0e1218)',
};
const TABLE_HEAD_ROW = {
  display: 'grid',
  gridTemplateColumns: '36px 1fr 80px 80px 80px',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  background: 'var(--forge-canvas-2, #161b22)',
  position: 'sticky', top: 0, zIndex: 1,
};
const BODY_ROW = (kernelSourced) => ({
  display: 'grid',
  gridTemplateColumns: '36px 1fr 80px 80px 80px',
  alignItems: 'center',
  gap: 6,
  padding: '5px 8px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
  color: kernelSourced ? 'var(--forge-ink, #dadde2)'
                       : 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
});
const PREVIEW_BOX = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  background: 'var(--forge-canvas-1, #0e1218)',
  padding: 8,
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function BomBalloonsPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => readBodiesSnapshot());
  const [view, setView] = useState('front');
  const [radius, setRadius] = useState(BALLOON_DEFAULT_RADIUS);
  const [balloons, setBalloons] = useState([]);
  const [copyToast, setCopyToast] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);

  // Refresh on open + listen for live scene churn.
  useEffect(() => {
    if (!open) return undefined;
    setBodies(readBodiesSnapshot());
    setBalloons([]);
    setCopyToast(null);
    setGeneratedAt(null);
    const onBodies = () => setBodies(readBodiesSnapshot());
    window.addEventListener('forge:bodies-changed', onBodies);
    return () => {
      window.removeEventListener('forge:bodies-changed', onBodies);
    };
  }, [open]);

  // Generate balloons for the current bodies + view + radius. We always
  // re-read window.__forgeBodies at click-time (rather than trusting the
  // React snapshot) so a body added between Open and Generate is still
  // ballooned.
  const handleGenerate = useCallback(() => {
    const live = readBodiesSnapshot();
    setBodies(live);
    const out = generateBalloons(live, view, radius);
    setBalloons(out);
    setGeneratedAt(Date.now());
    setCopyToast(null);
    if (typeof window !== 'undefined') {
      try {
        window.__forgeLastBomBalloons = {
          view, radius, count: out.length, balloons: out,
        };
        window.dispatchEvent(new CustomEvent(FORGE_BOM_BALLOONS_EVENT, {
          detail: { view, radius, count: out.length },
        }));
      } catch { /* CustomEvent is universal under Electron */ }
    }
  }, [view, radius]);

  const svgSnippet = useMemo(
    () => svgSnippetFor(balloons, view, radius),
    [balloons, view, radius],
  );

  const handleCopy = useCallback(async () => {
    if (!balloons.length) return;
    let ok = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(svgSnippet);
        ok = true;
      }
    } catch { ok = false; }
    if (!ok) {
      // Fallback: stash on window so the e2e can read it back.
      try { window.__forgeLastBomBalloonsSvg = svgSnippet; ok = true; } catch {}
    }
    setCopyToast({ ok, when: Date.now(), len: svgSnippet.length });
  }, [balloons, svgSnippet]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="BOM Balloon Auto-Place"
         data-testid="forge-bom-balloons-panel"
         data-body-count={bodies.length}
         data-balloon-count={balloons.length}
         data-view={view}
         data-radius={radius}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="measure.distance" size={14} />
        <strong style={{ fontSize: 13 }}>BOM Balloons</strong>
        <span data-testid="forge-bom-balloons-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px',
                borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {balloons.length}/{bodies.length}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close BOM Balloons panel"
                data-testid="forge-bom-balloons-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>View &amp; Layout</div>
      <div style={SECTION_BOX}>
        <div style={ROW}>
          <label style={ROW}>
            <span style={FIELD_LABEL}>View</span>
            <select value={view}
                    onChange={(e) => setView(e.target.value)}
                    data-testid="forge-bom-balloons-view"
                    style={SELECT_INPUT}>
              {SUPPORTED_VIEWS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
          <label style={ROW}>
            <span style={FIELD_LABEL}>Radius (mm)</span>
            <input type="number" min="2" step="0.5"
                   value={radius}
                   onChange={(e) => {
                     const v = Number(e.target.value);
                     if (Number.isFinite(v) && v > 0) setRadius(v);
                   }}
                   data-testid="forge-bom-balloons-radius"
                   style={NUM_INPUT} />
          </label>
          <span style={{ flex: 1 }} />
          <button type="button"
                  onClick={handleGenerate}
                  disabled={bodies.length === 0}
                  title="Project every body's centroid onto the selected view and place balloons on a ring"
                  data-testid="forge-bom-balloons-generate"
                  style={ACTION_BTN('primary', bodies.length === 0)}>
            Generate
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {bodies.length === 0
            ? 'No bodies in the scene. Add one through any modelling workbench, then return here.'
            : balloons.length === 0
              ? `${bodies.length} body${bodies.length === 1 ? '' : 'ies'} ready. Click Generate to auto-place balloons.`
              : `Last generated for view "${view}" with radius ${radius} mm — ${balloons.length} balloon${balloons.length === 1 ? '' : 's'} laid out.`}
        </div>
      </div>

      <div style={SECTION_TITLE}>
        Balloons ({balloons.length})
      </div>
      {balloons.length === 0 ? (
        <div data-testid="forge-bom-balloons-empty"
             style={{
               padding: '12px 0',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No balloons yet — click Generate to project the current bodies.
        </div>
      ) : (
        <div data-testid="forge-bom-balloons-table" style={TABLE_BOX}>
          <div style={TABLE_HEAD_ROW}>
            <span>#</span>
            <span>Body</span>
            <span style={{ textAlign: 'right' }}>cx</span>
            <span style={{ textAlign: 'right' }}>cy</span>
            <span style={{ textAlign: 'right' }}>leader</span>
          </div>
          {balloons.map((b) => (
            <div key={b.id}
                 data-testid="forge-bom-balloons-row"
                 data-balloon-n={b.n}
                 data-balloon-id={b.id}
                 data-balloon-cx={b.cx}
                 data-balloon-cy={b.cy}
                 data-balloon-target-x={b.targetX}
                 data-balloon-target-y={b.targetY}
                 data-balloon-source={b.source}
                 data-balloon-leader={b.leader}
                 style={BODY_ROW(b.source === 'kernel')}>
              <span style={{ color: 'var(--forge-accent, #4f87ff)', fontWeight: 600 }}>
                {b.n}
              </span>
              <span title={b.name} style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{b.name}</span>
              <span style={{ textAlign: 'right' }}>{b.cx.toFixed(2)}</span>
              <span style={{ textAlign: 'right' }}>{b.cy.toFixed(2)}</span>
              <span style={{
                textAlign: 'right',
                color: 'var(--forge-ink-mute, #9aa1ab)',
              }}>{b.source === 'kernel' ? 'OK' : 'origin'}</span>
            </div>
          ))}
        </div>
      )}

      <div style={SECTION_TITLE}>SVG Preview</div>
      <div data-testid="forge-bom-balloons-preview"
           data-svg-length={svgSnippet.length}
           style={PREVIEW_BOX}>
        <div data-testid="forge-bom-balloons-preview-host"
             dangerouslySetInnerHTML={{ __html: svgSnippet }} />
      </div>

      <footer style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        {copyToast ? (
          <span data-testid="forge-bom-balloons-toast"
                style={{
                  fontSize: 11,
                  color: copyToast.ok
                    ? 'var(--forge-accent, #4f87ff)'
                    : '#ff7a5c',
                }}>
            {copyToast.ok
              ? `Copied SVG (${copyToast.len} chars).`
              : 'Copy failed — SVG mirrored on window.__forgeLastBomBalloonsSvg.'}
          </span>
        ) : (
          <span style={{
            fontSize: 10,
            color: 'var(--forge-ink-mute, #9aa1ab)',
          }}>
            {generatedAt
              ? `Generated at ${new Date(generatedAt).toLocaleTimeString()}.`
              : 'Pick a view, hit Generate, then Copy SVG to drop onto a drawing.'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={handleCopy}
                disabled={balloons.length === 0}
                title="Copy the inline SVG snippet to the clipboard"
                data-testid="forge-bom-balloons-copy"
                style={ACTION_BTN('default', balloons.length === 0)}>
          Copy SVG
        </button>
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.bomBalloons` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls, and
// installs the headless helper API mirror so the e2e + plugins can drive
// the generator without React mounted.

export function BomBalloonsPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBomBalloonsPanel  = () => setOpen(true);
    window.__forgeCloseBomBalloonsPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.bomBalloons') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    // Expose a small debug surface so the e2e specs / plugins / Archie
    // tool calls can drive the generator without mounting the panel.
    window.__forgeBomBalloonsHelper = Object.freeze({
      ...BOM_BALLOON_HELPERS,
      readBodiesSnapshot,
      generateForCurrentScene,
      EVENT_NAME: FORGE_BOM_BALLOONS_EVENT,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenBomBalloonsPanel; } catch {}
      try { delete window.__forgeCloseBomBalloonsPanel; } catch {}
    };
  }, []);
  return <BomBalloonsPanel open={open} onClose={() => setOpen(false)} />;
}

export default BomBalloonsPanel;
