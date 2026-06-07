// PUSH-181 (Slice-137) — CNC Setup Sheet generator panel.
//
// The CAM workbench (PUSH-46) gives the programmer a toolpath. The
// machinist standing at the mill needs something different: a fixed-
// width printed sheet listing every operation, the tool to chuck up at
// each step, the spindle/feed/depth numbers to dial in, the running
// cycle time, and a tool-change list. That document is the "setup
// sheet" — what comes out of HSMWorks's "Setup Sheet" command in
// Fusion, or Mastercam's "Setup Sheet" report. PUSH-181 ships exactly
// that for Forge.
//
// What this panel does:
//
//   * Scan window.__forgeCamResults (PUSH-46/98/117) + window.__forgeBodies.
//     Scan button refreshes both registries; auto-populates when the
//     panel first opens.
//   * Stock body picker — defaults to the largest body by bbox volume,
//     but the operator can override.
//   * Program / part / programmer / machine input fields land on
//     `meta` for the printed sheet.
//   * Generate → calls setupSheetMath.buildSheet(camResults, stock,
//     bodies, opts). The structured result renders to a table preview
//     PLUS an ASCII export panel (read-only textarea so the user can
//     ⌘A → ⌘C straight into a sticky note or the foreman's terminal).
//   * Hard requirement from the brief: the rendered preview MUST
//     contain "Operation 1" and at least one tool-change line, so
//     test-id `forge-cnc-setup-preview` carries both strings.
//
// Reachable via:
//   * `tools.cncSetupSheet` menu action,
//   * `window.__forgeOpenCncSetupSheet(true|false)`,
//   * `window.__forgeCncSetupSheetHelper.{buildSheet, toAscii, toCsv,
//      gatherCamResults}` headless surface used by the e2e + Archie.
//
// NO new deps. Real impl — no MVP, no stub, no fallback. If there are
// no cam results we tell the operator to run a cam op first; we do NOT
// fabricate a sheet from invented numbers.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  buildSheet, toAscii, toCsv, gatherCamResults,
  TOOL_REFERENCE, DEFAULT_FIXTURE,
} from './setupSheetMath.js';

const PANEL_W = 640;

// ─────────────────────────────────────────────────────────────────────
// Snapshot helpers.

function readBodies() {
  if (typeof window === 'undefined') return [];
  return Array.isArray(window.__forgeBodies) ? window.__forgeBodies.slice() : [];
}

function readCamResults() {
  // gatherCamResults() already folds in the per-strategy globals from
  // PUSH-98 / PUSH-117 plus the primary window.__forgeCamResults.
  return gatherCamResults();
}

// ─────────────────────────────────────────────────────────────────────
// Styles.

function panelStyle() {
  return {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
    right: 0,
    width: PANEL_W,
    maxWidth: '96vw',
    height: 'calc(100vh - var(--forge-topbar-h, 40px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 24px))',
    background: 'var(--forge-canvas-2, #161b22)',
    borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
    boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
    display: 'flex', flexDirection: 'column',
    fontSize: 12,
    color: 'var(--forge-ink, #dadde2)',
    zIndex: 1300,
  };
}

const HEADER_CELL = {
  padding: '6px 8px',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
};

const CELL = {
  padding: '4px 8px',
  fontFamily: 'var(--forge-mono, ui-monospace, SF Mono, Menlo, monospace)',
  fontSize: 11,
  textAlign: 'left',
};
const CELL_RIGHT = { ...CELL, textAlign: 'right' };

const inputStyle = {
  background: 'var(--forge-canvas, #0e1117)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  padding: '3px 6px',
  fontSize: 11,
  fontFamily: 'var(--forge-mono, monospace)',
  width: '100%',
  boxSizing: 'border-box',
};

const btnStyle = (variant) => ({
  background: variant === 'primary'
    ? 'var(--forge-accent-mute, #1f3a72)'
    : 'var(--forge-canvas, #0e1117)',
  border: '1px solid ' + (variant === 'primary'
    ? 'var(--forge-accent-rim, #3a7afe)'
    : 'var(--forge-rail-edge, #2a2d34)'),
  borderRadius: 3,
  color: 'var(--forge-ink, #dadde2)',
  font: 'inherit', fontSize: 11,
  padding: '4px 10px',
  cursor: 'pointer',
});

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function CncSetupSheetPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => readBodies());
  const [camResults, setCamResults] = useState(() => readCamResults());
  const [stockId, setStockId] = useState('');
  const [programName, setProgramName] = useState('PROG-001');
  const [partName, setPartName] = useState('');
  const [programmer, setProgrammer] = useState('Forge Operator');
  const [machine, setMachine] = useState('3-axis vertical mill');
  const [sheet, setSheet] = useState(null);
  const [scanStatus, setScanStatus] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  // Refresh-on-open: pull live bodies + cam results when the panel
  // becomes visible so the operator doesn't see a stale snapshot.
  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => {
      setBodies(readBodies());
      setCamResults(readCamResults());
    };
    refresh();
    window.addEventListener('forge:bodies-changed', refresh);
    return () => window.removeEventListener('forge:bodies-changed', refresh);
  }, [open]);

  // Auto-pick the largest body as stock the first time we see one.
  useEffect(() => {
    if (stockId) return;
    if (!bodies.length) return;
    // Use the same heuristic as setupSheetMath.resolveStock: largest
    // bbox volume wins (works for both spec-block and aabb bodies).
    let best = null, bestVol = -1;
    for (const b of bodies) {
      const s = b?.spec || b?.params;
      let vol = 0;
      if (s && Number.isFinite(s.dx) && Number.isFinite(s.dy) && Number.isFinite(s.dz)) {
        vol = s.dx * s.dy * s.dz;
      } else if (b?.aabb && b.aabb.length === 6) {
        vol = (b.aabb[3] - b.aabb[0]) * (b.aabb[4] - b.aabb[1]) * (b.aabb[5] - b.aabb[2]);
      } else if (s && Number.isFinite(s.width) && Number.isFinite(s.height) && Number.isFinite(s.distance)) {
        vol = s.width * s.height * s.distance;
      }
      if (vol > bestVol) { bestVol = vol; best = b; }
    }
    if (best) setStockId(best.id);
  }, [bodies, stockId]);

  const stockBody = useMemo(
    () => bodies.find((b) => b && b.id === stockId) || null,
    [bodies, stockId],
  );

  const onScan = useCallback(() => {
    const b = readBodies();
    const c = readCamResults();
    setBodies(b);
    setCamResults(c);
    setScanStatus(`scanned · ${b.length} bodies · ${c.length} cam result${c.length === 1 ? '' : 's'}`);
    setTimeout(() => setScanStatus(''), 3000);
  }, []);

  const onGenerate = useCallback(() => {
    if (!camResults || camResults.length === 0) {
      setSheet({ error: 'No cam results found. Run a CAM op (Profile / Adaptive / Drilling) first.' });
      return;
    }
    const s = buildSheet(camResults, stockBody, bodies, {
      programName,
      partName: partName || (stockBody?.name || 'PART'),
      programmer,
      machine,
    });
    setSheet(s);
    // Publish so e2e + Archie can read it.
    try {
      window.__forgeLastCncSetupSheet = s;
      window.__forgeLastCncSetupSheetAscii = toAscii(s);
    } catch {}
  }, [camResults, stockBody, bodies, programName, partName, programmer, machine]);

  const onCopyAscii = useCallback(async () => {
    if (!sheet || sheet.error) return;
    const ascii = toAscii(sheet);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(ascii);
        setCopyStatus('copied to clipboard');
      } else {
        setCopyStatus('clipboard API unavailable — select & copy manually');
      }
    } catch (e) {
      setCopyStatus(`copy failed: ${e.message || String(e)}`);
    }
    setTimeout(() => setCopyStatus(''), 3000);
  }, [sheet]);

  if (!open) return null;

  const ascii = sheet && !sheet.error ? toAscii(sheet) : '';

  return createPortal(
    <aside
      role="region"
      aria-label="CNC Setup Sheet generator"
      data-testid="forge-cnc-setup-panel"
      data-cam-result-count={camResults.length}
      data-body-count={bodies.length}
      style={panelStyle()}>

      <header style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px',
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        flexShrink: 0,
      }}>
        <strong style={{ fontSize: 13 }}>CNC Setup Sheet</strong>
        <span data-testid="forge-cnc-setup-counts"
              style={{
                fontFamily: 'var(--forge-mono, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px', borderRadius: 10,
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {camResults.length} cam op{camResults.length === 1 ? '' : 's'} · {bodies.length} bod{bodies.length === 1 ? 'y' : 'ies'}
        </span>
        <span style={{ flex: 1 }} />
        <button data-testid="forge-cnc-setup-scan"
                onClick={onScan}
                style={btnStyle()}>
          Scan
        </button>
        <button data-testid="forge-cnc-setup-generate"
                onClick={onGenerate}
                style={btnStyle('primary')}>
          Generate
        </button>
        <button data-testid="forge-cnc-setup-close"
                aria-label="Close CNC Setup Sheet panel"
                onClick={onClose}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                  padding: 2, fontSize: 14,
                }}>×</button>
      </header>

      {scanStatus && (
        <div data-testid="forge-cnc-setup-scan-status"
             style={{
               padding: '4px 12px', fontSize: 10,
               fontFamily: 'var(--forge-mono, monospace)',
               color: 'var(--forge-ok, #4caf50)',
             }}>
          {scanStatus}
        </div>
      )}

      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
        flexShrink: 0,
      }}>
        <label style={fieldLabelStyle}>
          <span style={fieldHintStyle}>Program</span>
          <input data-testid="forge-cnc-setup-program-name"
                 value={programName}
                 onChange={(e) => setProgramName(e.target.value)}
                 style={inputStyle} />
        </label>
        <label style={fieldLabelStyle}>
          <span style={fieldHintStyle}>Part name</span>
          <input data-testid="forge-cnc-setup-part-name"
                 value={partName}
                 onChange={(e) => setPartName(e.target.value)}
                 placeholder={stockBody?.name || 'PART'}
                 style={inputStyle} />
        </label>
        <label style={fieldLabelStyle}>
          <span style={fieldHintStyle}>Programmer</span>
          <input data-testid="forge-cnc-setup-programmer"
                 value={programmer}
                 onChange={(e) => setProgrammer(e.target.value)}
                 style={inputStyle} />
        </label>
        <label style={fieldLabelStyle}>
          <span style={fieldHintStyle}>Machine</span>
          <input data-testid="forge-cnc-setup-machine"
                 value={machine}
                 onChange={(e) => setMachine(e.target.value)}
                 style={inputStyle} />
        </label>
        <label style={{ ...fieldLabelStyle, gridColumn: '1 / span 2' }}>
          <span style={fieldHintStyle}>Stock body</span>
          <select data-testid="forge-cnc-setup-stock"
                  value={stockId}
                  onChange={(e) => setStockId(e.target.value)}
                  style={inputStyle}>
            <option value="">— pick a body —</option>
            {bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {(b.name || b.toolId || b.id)} {b.material ? ` · ${b.material}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto',
        background: 'var(--forge-canvas, #0e1117)',
      }}>
        {!sheet && (
          <div data-testid="forge-cnc-setup-empty"
               style={{
                 padding: 20, fontStyle: 'italic',
                 color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11,
               }}>
            Click <strong>Scan</strong> to refresh, then <strong>Generate</strong> to build
            the setup sheet from the cam results currently published on
            <code> window.__forgeCamResults</code>.
          </div>
        )}

        {sheet && sheet.error && (
          <div data-testid="forge-cnc-setup-error"
               style={{
                 margin: 12, padding: 8,
                 background: 'var(--forge-canvas-2, #3a1f1f)',
                 color: 'var(--forge-err, #f1c4c4)',
                 border: '1px solid var(--forge-err, #6d3434)',
                 borderRadius: 4,
               }}>
            {sheet.error}
          </div>
        )}

        {sheet && !sheet.error && (
          <SheetPreview sheet={sheet} ascii={ascii} onCopyAscii={onCopyAscii}
                        copyStatus={copyStatus} />
        )}
      </div>
    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────

const fieldLabelStyle = {
  display: 'flex', flexDirection: 'column', gap: 3,
};
const fieldHintStyle = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
};

function SheetPreview({ sheet, ascii, onCopyAscii, copyStatus }) {
  const meta = sheet.meta;
  return (
    <div data-testid="forge-cnc-setup-preview"
         data-operation-count={sheet.operations.length}
         data-tool-change-count={sheet.toolChanges.length}
         data-total-cycle-sec={sheet.totalCycleSec.toFixed(2)}>

      <section style={{ padding: '12px 12px 4px' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Program meta</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <MetaRow k="Program"   v={meta.programName} testid="meta-program" />
            <MetaRow k="Part"      v={meta.partName}    testid="meta-part" />
            <MetaRow k="Programmer" v={meta.programmer} testid="meta-programmer" />
            <MetaRow k="Machine"   v={meta.machine}     testid="meta-machine" />
            <MetaRow k="Generated" v={meta.generatedAt} testid="meta-generated" />
          </tbody>
        </table>
      </section>

      <section style={{ padding: '12px 12px 4px' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Stock + Fixture</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <MetaRow k="Body"     v={meta.stockName}     testid="stock-name" />
            <MetaRow k="Material" v={meta.stockMaterial} testid="stock-material" />
            <MetaRow k="Dims (X × Y × Z, mm)"
                     v={`${meta.stockDims.dx.toFixed(2)} × ${meta.stockDims.dy.toFixed(2)} × ${meta.stockDims.dz.toFixed(2)}  (${meta.stockDims.source})`}
                     testid="stock-dims" />
            <MetaRow k="Origin"   v={meta.fixture.origin}    testid="fix-origin" />
            <MetaRow k="Work offset" v={meta.fixture.workOffset} testid="fix-offset" />
            <MetaRow k="Clamping" v={meta.fixture.clampStyle}   testid="fix-clamp" />
          </tbody>
        </table>
      </section>

      <section style={{ padding: '12px 12px 4px' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Operations ({sheet.operations.length}) — total cycle{' '}
          <span data-testid="forge-cnc-setup-total-cycle">
            {sheet.totalCycleSec.toFixed(2)} s
          </span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{
              borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
              background: 'var(--forge-canvas-2, #161b22)',
            }}>
              <th style={HEADER_CELL}>#</th>
              <th style={HEADER_CELL}>Strategy</th>
              <th style={HEADER_CELL}>Tool</th>
              <th style={{ ...HEADER_CELL, textAlign: 'right' }}>RPM</th>
              <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Feed XY</th>
              <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Feed Z</th>
              <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Depth mm</th>
              <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Cycle s</th>
            </tr>
          </thead>
          <tbody>
            {sheet.operations.map((op) => (
              <tr key={op.index}
                  data-testid="forge-cnc-setup-op-row"
                  data-op-index={op.index}
                  data-op-strategy={op.strategy}
                  data-op-tool={op.tool.id}
                  style={{
                    borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
                  }}>
                <td style={CELL}>
                  <strong data-testid={`forge-cnc-setup-op-label-${op.index}`}>
                    Operation {op.index}
                  </strong>
                </td>
                <td style={CELL}>{op.strategy}</td>
                <td style={CELL}>{op.tool.name}</td>
                <td style={CELL_RIGHT}>{Math.round(op.spindleRPM)}</td>
                <td style={CELL_RIGHT}>{Math.round(op.feedXY)}</td>
                <td style={CELL_RIGHT}>{Math.round(op.feedZ)}</td>
                <td style={CELL_RIGHT}>{op.depthMm.toFixed(2)}</td>
                <td style={CELL_RIGHT}>{op.cycleTimeSec.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ padding: '12px 12px 4px' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Tool changes ({sheet.toolChanges.length})
        </div>
        {sheet.toolChanges.length === 0 ? (
          <div data-testid="forge-cnc-setup-no-tool-changes"
               style={{
                 fontStyle: 'italic',
                 color: 'var(--forge-ink-mute, #9aa1ab)',
                 fontSize: 11,
               }}>
            No tool changes — single tool used across all operations.
          </div>
        ) : (
          <ul style={{
            margin: 0, padding: 0, listStyle: 'none',
            fontFamily: 'var(--forge-mono, monospace)', fontSize: 11,
          }}>
            {sheet.toolChanges.map((tc, i) => (
              <li key={i}
                  data-testid="forge-cnc-setup-tool-change"
                  data-tc-at={tc.atOperation}
                  data-tc-from={tc.fromId}
                  data-tc-to={tc.toId}
                  style={{ padding: '2px 0' }}>
                Tool change at Operation {tc.atOperation}: {tc.from} → {tc.to}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ padding: '12px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', marginBottom: 6, gap: 8,
        }}>
          <span style={{ fontWeight: 600 }}>ASCII export</span>
          <button data-testid="forge-cnc-setup-copy-ascii"
                  onClick={onCopyAscii}
                  style={btnStyle()}>
            Copy
          </button>
          {copyStatus && (
            <span data-testid="forge-cnc-setup-copy-status"
                  style={{
                    fontSize: 10,
                    color: 'var(--forge-ok, #4caf50)',
                    fontFamily: 'var(--forge-mono, monospace)',
                  }}>
              {copyStatus}
            </span>
          )}
        </div>
        <textarea data-testid="forge-cnc-setup-ascii"
                  readOnly
                  value={ascii}
                  style={{
                    width: '100%', height: 200,
                    fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                    fontSize: 10,
                    background: 'var(--forge-canvas-2, #0e1117)',
                    color: 'var(--forge-ink, #dadde2)',
                    border: '1px solid var(--forge-rail-edge, #2a2d34)',
                    borderRadius: 3,
                    padding: 6,
                    whiteSpace: 'pre',
                    resize: 'vertical',
                  }} />
      </section>
    </div>
  );
}

function MetaRow({ k, v, testid }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--forge-rail-edge, #20232a)' }}>
      <td style={{
        padding: '3px 8px 3px 0',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        fontSize: 10,
        width: '40%',
      }}>
        {k}
      </td>
      <td data-testid={testid ? `forge-cnc-setup-${testid}` : undefined}
          style={{
            padding: '3px 0',
            fontFamily: 'var(--forge-mono, monospace)',
            fontSize: 11,
          }}>
        {v}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Exposes window.__forgeOpenCncSetupSheet(true|false)
// + window.__forgeCncSetupSheetHelper {buildSheet, toAscii, toCsv,
// gatherCamResults} so the e2e + Archie can drive the whole pipeline
// headlessly. Listens for `tools.cncSetupSheet` menu actions.

export function CncSetupSheetPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenCncSetupSheet = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseCncSetupSheet = () => setOpen(false);

    window.__forgeCncSetupSheetHelper = Object.freeze({
      buildSheet, toAscii, toCsv, gatherCamResults,
      TOOL_REFERENCE, DEFAULT_FIXTURE,
    });

    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.cncSetupSheet') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenCncSetupSheet; } catch {}
      try { delete window.__forgeCloseCncSetupSheet; } catch {}
      try { delete window.__forgeCncSetupSheetHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <CncSetupSheetPanel
      open={open}
      onClose={() => setOpen(false)} />
  );
}

export default CncSetupSheetPanelHost;
