// Forge-162 — Inspection / FAI workbench.
//
// Panel for first-article-inspection workflows:
//   1. Import a CMM measurement file (AICON / Hexagon DMIS /
//      ISO 22093 I++) — or load a built-in sample for demos.
//   2. Compute per-point deviation, ISO 14253 conformity zoning,
//      and statistical analysis (mean, σ, Cp, Cpk).
//   3. Render an XY heatmap overlay (red/green/blue palette).
//   4. Generate a sign-off-ready FAI PDF (jsPDF) with feature
//      table, deviation vectors, statistics, sign-off block.
//
// Pattern matches MeshWorkbench / ArchWorkbench:
//   * useSyncExternalStore + version-counter snapshot cache.
//   * Host useEffect deps = [].
//   * Manual UI never writes to Archie's thread.

import React, { useCallback, useEffect, useRef, useState,
                useSyncExternalStore } from 'react';
import { importCmm } from './cmmImport.js';
import { computeHeatmap, colourFor } from './deviationHeatmap.js';
// faiReportPdf is dynamically imported inside InspectionDispatch.generateReport
// so the static-analysis pass (Vite/Rollup) does not see `import('jspdf')` as a
// hard dependency. jspdf is an honest-fallback target: when missing, the
// dispatch emits a plain-text FAI report instead. See feedback-forge-no-mvp.

let _state = {
  measurement: null,
  heatmap:     null,
  meta: {
    partNumber: '', revision: '', customer: '',
    inspector: '', drawing: '', device: '',
  },
  status:    'idle',
  pdfNote:   null,
  history:   [],
};
let _version = 0;
const _subs = new Set();
let _cachedSnap = null;
let _cachedSnapVer = -1;
function notify() { _version++; for (const fn of _subs) { try { fn(); } catch {} } }
const STORE = {
  subscribe(cb) { _subs.add(cb); return () => _subs.delete(cb); },
  getSnapshot() {
    if (_cachedSnap && _cachedSnapVer === _version) return _cachedSnap;
    _cachedSnap = { ..._state, version: _version };
    _cachedSnapVer = _version;
    return _cachedSnap;
  },
};
function update(patch) { _state = { ..._state, ...patch }; notify(); }
function pushHistory(label) {
  _state = { ..._state, history: [..._state.history, { ts: Date.now(), label }] };
  notify();
}

// ============================================================
// Dispatch — exposed on window for tests + Archie
// ============================================================

export const InspectionDispatch = {
  store: STORE,
  getState: () => STORE.getSnapshot(),

  loadMeasurementText(text, hint) {
    update({ status: 'parsing CMM' });
    const m = importCmm(text, hint);
    update({ measurement: m, heatmap: null,
             status: `loaded ${m.source.toUpperCase()} · ${m.features.length} features` });
    pushHistory(`load ${m.source} (${m.features.length} features)`);
    return m;
  },

  loadSample() {
    // Synthetic 24-feature mock part — 18 within tolerance, 4 within
    // the uncertainty band ("warn"), 2 out of tolerance ("fail").
    const features = [];
    function add(id, kind, nom, dev, tolHi) {
      const probed = {
        x: nom.x + dev.x, y: nom.y + dev.y, z: nom.z + dev.z,
      };
      features.push({
        id, name: id, kind,
        nominal: { ...nom, radius: nom.radius ?? 0 },
        probed,
        tolerance: { hi: tolHi, lo: -tolHi },
        result: null,
      });
    }
    for (let i = 0; i < 18; i++) {
      add(`PT${100 + i}`, 'point',
          { x: 10 + i * 4, y: 20 + (i % 5) * 6, z: 5 },
          { x: rand(-0.03), y: rand(-0.03), z: rand(-0.03) }, 0.05);
    }
    for (let i = 0; i < 4; i++) {
      add(`PT${200 + i}`, 'point',
          { x: 30 + i * 5, y: 40, z: 8 },
          { x: rand(0.04), y: rand(0.04), z: rand(0.04) }, 0.05);
    }
    add('SPH301', 'sphere', { x: 60, y: 30, z: 12, radius: 10 },
        { x: 0.08, y: -0.07, z: 0.05 }, 0.05);
    add('CYL302', 'cylinder', { x: 80, y: 50, z: 6, radius: 5 },
        { x: 0.07, y: 0.06, z: -0.04 }, 0.05);
    // Compute classify for each.
    for (const f of features) {
      const dx = (f.probed.x ?? 0) - (f.nominal.x ?? 0);
      const dy = (f.probed.y ?? 0) - (f.nominal.y ?? 0);
      const dz = (f.probed.z ?? 0) - (f.nominal.z ?? 0);
      const dev = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const tol = Math.abs(f.tolerance.hi);
      const status =
        dev <= tol * 0.8 ? 'pass'
        : dev <= tol     ? 'warn'
        :                  'fail';
      f.result = { deviation: dev, dx, dy, dz, status };
    }
    const m = { source: 'sample', features };
    update({ measurement: m, heatmap: null,
             status: `loaded sample part · ${features.length} features` });
    pushHistory(`load sample (${features.length} features)`);
    return m;
  },

  compute() {
    if (!_state.measurement) throw new Error('inspection: no measurement loaded');
    const h = computeHeatmap(_state.measurement);
    update({ heatmap: h,
             status: `computed · pass ${h.conformity.pass} / warn ${h.conformity.warn} / fail ${h.conformity.fail}` });
    pushHistory('compute heatmap');
    return h;
  },

  setMeta(patch) {
    update({ meta: { ..._state.meta, ...patch } });
  },

  async generateReport(opts = {}) {
    if (!_state.measurement) throw new Error('inspection: no measurement loaded');
    if (!_state.heatmap)     throw new Error('inspection: heatmap missing — compute first');
    // Dynamic import keeps the jspdf static reference out of the Rollup graph.
    const pdfMod = await import('./faiReportPdf.js');
    try {
      const { blob } = await pdfMod.generateFaiReport({
        measurement: _state.measurement,
        heatmap:     _state.heatmap,
        meta:        _state.meta,
      });
      // Save via download.
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (_state.meta.partNumber || 'fai-report') + '.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
      update({ pdfNote: 'PDF generated', status: 'FAI PDF saved' });
      pushHistory('PDF report generated');
      return { ok: true };
    } catch (err) {
      // jspdf missing — emit a plain-text report so the workflow
      // still produces a deliverable.
      const txt = pdfMod.generateFaiReportText({
        measurement: _state.measurement,
        heatmap:     _state.heatmap,
        meta:        _state.meta,
      });
      const blob = new Blob([txt], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (_state.meta.partNumber || 'fai-report') + '.txt';
      a.click();
      URL.revokeObjectURL(a.href);
      update({ pdfNote: `jspdf unavailable: ${err.message} · text saved`,
               status: 'FAI text saved (jspdf missing)' });
      pushHistory(`PDF unavailable, text saved: ${err.message}`);
      return { ok: true, fallback: 'text' };
    }
  },

  clear() {
    update({ measurement: null, heatmap: null, pdfNote: null,
             status: 'cleared', history: [] });
  },
};

function rand(s) { return (Math.random() - 0.5) * 2 * s; }

// ============================================================
// Heatmap renderer — XY scatter
// ============================================================

function HeatmapPlot({ snap, theme }) {
  const dark = theme === 'dark';
  if (!snap.heatmap) {
    return (
      <div data-testid="forge-inspect-heatmap-empty"
           style={{ padding: 20, opacity: 0.55,
                    background: dark ? '#0e0b07' : '#f4ead0', height: 280 }}>
        Load a measurement and click <b>Compute heatmap</b>.
      </div>
    );
  }
  const h = snap.heatmap;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of h.points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) { minX = -1; maxX = 1; minY = -1; maxY = 1; }
  const padX = (maxX - minX) * 0.08 + 1;
  const padY = (maxY - minY) * 0.08 + 1;
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;
  const w = maxX - minX, h2 = maxY - minY;
  const range = Math.max(0.001, Math.max(Math.abs(h.min), Math.abs(h.max)));
  return (
    <svg data-testid="forge-inspect-heatmap"
         viewBox={`${minX} ${-maxY} ${w} ${h2}`}
         preserveAspectRatio="xMidYMid meet"
         style={{ width: '100%', height: 280, display: 'block',
                  background: dark ? '#0e0b07' : '#f4ead0' }}>
      {h.points.map((p, i) => {
        const c = colourFor(p.signed, range);
        return <circle key={i} cx={p.x} cy={-p.y} r={Math.max(0.4, w / 120)}
                       fill={c} stroke={p.status === 'fail' ? '#fff' : 'none'}
                       strokeWidth={w / 600} />;
      })}
    </svg>
  );
}

// ============================================================
// Feature pass/fail table
// ============================================================

function FeatureTable({ snap, theme }) {
  const dark = theme === 'dark';
  if (!snap.measurement) {
    return (
      <div data-testid="forge-inspect-feature-table-empty"
           style={{ padding: 12, opacity: 0.55, fontSize: 12 }}>
        No measurement loaded.
      </div>
    );
  }
  return (
    <table data-testid="forge-inspect-feature-table"
           style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr>
          <th style={th(theme)}>ID</th>
          <th style={th(theme)}>Kind</th>
          <th style={th(theme)}>Nominal</th>
          <th style={th(theme)}>Probed</th>
          <th style={th(theme)}>Tol ±</th>
          <th style={th(theme)}>Dev</th>
          <th style={th(theme)}>Status</th>
        </tr>
      </thead>
      <tbody>
        {snap.measurement.features.map((f, i) => (
          <tr key={i} data-status={f.result?.status}>
            <td style={td(theme)}>{f.id}</td>
            <td style={td(theme)}>{f.kind}</td>
            <td style={td(theme)}>{fmtXYZ(f.nominal)}</td>
            <td style={td(theme)}>{fmtXYZ(f.probed)}</td>
            <td style={td(theme)}>{fmtMm(f.tolerance.hi)}</td>
            <td style={td(theme)}>{fmtMm(f.result?.deviation ?? 0)}</td>
            <td style={{ ...td(theme),
                         color: f.result?.status === 'fail' ? '#ff7042'
                              : f.result?.status === 'warn' ? '#f0b048'
                              : '#5fc88a',
                         fontWeight: 600 }}>
              {f.result?.status?.toUpperCase() ?? '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fmtMm(v) {
  if (v == null || !Number.isFinite(v)) return '-';
  return `${v.toFixed(4)} mm`;
}
function fmtXYZ(p) {
  if (!p || p.x == null) return '-';
  return `(${(+p.x).toFixed(2)}, ${(+p.y).toFixed(2)}, ${(+p.z).toFixed(2)})`;
}

// ============================================================
// Statistical summary
// ============================================================

function StatsBlock({ snap, theme }) {
  if (!snap.heatmap) return null;
  const s = snap.heatmap.stats;
  const cf = snap.heatmap.conformity;
  return (
    <div data-testid="forge-inspect-stats"
         style={{ padding: 12, fontSize: 12,
                  display: 'grid', gridTemplateColumns: '1fr 1fr',
                  gap: 4 }}>
      <span>Features</span><b>{s.count}</b>
      <span>Mean Δ</span><b>{fmtMm(s.mean)}</b>
      <span>σ</span><b>{fmtMm(s.stdev)}</b>
      <span>Cp</span><b>{Number.isFinite(s.Cp) ? s.Cp.toFixed(3) : '∞'}</b>
      <span>Cpk</span><b>{Number.isFinite(s.Cpk) ? s.Cpk.toFixed(3) : '∞'}</b>
      <span>Pass / Warn / Fail</span>
      <b style={{ color: cf.fail > 0 ? '#ff7042' : '#5fc88a' }}>
        {cf.pass} / {cf.warn} / {cf.fail}
      </b>
    </div>
  );
}

// ============================================================
// Toolbar + meta form
// ============================================================

function InspectionToolbar({ theme, snap, onLoadSample, onImport,
                              onCompute, onReport, onClear }) {
  const dark = theme === 'dark';
  return (
    <div data-testid="forge-inspect-toolbar"
         style={{
           display: 'flex', flexWrap: 'wrap', gap: 6,
           padding: '6px 10px',
           borderBottom: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
           background: dark ? '#16120c' : '#f1e3a8',
         }}>
      <button type="button" onClick={onLoadSample}
              data-testid="forge-inspect-load-sample"
              style={btn(theme)}>Load sample part</button>
      <button type="button" onClick={onImport}
              data-testid="forge-inspect-import"
              style={btn(theme)}>Import CMM (.mmp / DMIS / I++)</button>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" onClick={onCompute}
              data-testid="forge-inspect-compute"
              style={btn(theme)}>Compute heatmap</button>
      <button type="button" onClick={onReport}
              data-testid="forge-inspect-report"
              style={btn(theme)}>Generate FAI report</button>
      <span style={{ flex: 1 }} />
      <button type="button" onClick={onClear}
              data-testid="forge-inspect-clear"
              style={btn(theme)}>Clear</button>
    </div>
  );
}

function MetaForm({ snap, theme }) {
  const fields = [
    ['Part #',   'partNumber'],
    ['Rev',      'revision'],
    ['Drawing',  'drawing'],
    ['Customer', 'customer'],
    ['Inspector','inspector'],
    ['CMM dev',  'device'],
  ];
  return (
    <div data-testid="forge-inspect-meta-form"
         style={{ padding: 8, display: 'grid',
                  gridTemplateColumns: '80px 1fr', gap: 4,
                  fontSize: 11,
                  background: theme === 'dark' ? '#1c1812' : '#ebe0b4' }}>
      {fields.map(([label, key]) => (
        <React.Fragment key={key}>
          <span style={{ opacity: 0.7 }}>{label}</span>
          <input data-testid={`forge-inspect-meta-${key}`}
                 type="text" value={snap.meta[key] || ''}
                 onChange={(e) => InspectionDispatch.setMeta({ [key]: e.target.value })}
                 style={inp(theme)} />
        </React.Fragment>
      ))}
    </div>
  );
}

function HistoryList({ snap, theme }) {
  return (
    <ul data-testid="forge-inspect-history"
        style={{ listStyle: 'none', margin: 0, padding: '8px 12px',
                 fontSize: 11 }}>
      {snap.history.length === 0 && <li style={{ opacity: 0.55 }}>No events yet.</li>}
      {snap.history.map((h, i) => (
        <li key={i} style={{ marginBottom: 3 }}>
          <span style={{ opacity: 0.55 }}>{new Date(h.ts).toLocaleTimeString()}</span>{' '}
          {h.label}
        </li>
      ))}
    </ul>
  );
}

// ============================================================
// Body
// ============================================================

function InspectionBody({ open, theme, onClose }) {
  const snap = useSyncExternalStore(STORE.subscribe, STORE.getSnapshot);

  const onLoadSample = useCallback(() => {
    InspectionDispatch.loadSample();
  }, []);
  const onImport = useCallback(() => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.mmp,.dmis,.dmo,.txt,.csv,.ipp,.i++';
    inp.onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        InspectionDispatch.loadMeasurementText(text);
      } catch (err) {
        console.warn('[inspection.import]', err.message);
        update({ status: `import failed: ${err.message}` });
      }
    };
    inp.click();
  }, []);
  const onCompute = useCallback(() => {
    try { InspectionDispatch.compute(); }
    catch (err) { console.warn('[inspection.compute]', err.message); }
  }, []);
  const onReport = useCallback(async () => {
    try { await InspectionDispatch.generateReport(); }
    catch (err) { console.warn('[inspection.report]', err.message); }
  }, []);
  const onClear = useCallback(() => InspectionDispatch.clear(), []);

  if (!open) return null;

  return (
    <div data-testid="forge-inspect-workbench"
         style={panelOuter(theme)}>
      <header style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', padding: '6px 12px',
        borderBottom: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
        background: theme === 'dark' ? '#1c1812' : '#ebe0b4',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Inspection · First Article (FAI)
        </span>
        <button type="button" onClick={onClose}
                data-testid="forge-inspect-close"
                style={btn(theme)}>Close</button>
      </header>
      <InspectionToolbar theme={theme} snap={snap}
                          onLoadSample={onLoadSample}
                          onImport={onImport}
                          onCompute={onCompute}
                          onReport={onReport}
                          onClear={onClear} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: 230, borderRight: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
                      overflowY: 'auto',
                      background: theme === 'dark' ? '#16120c' : '#f7eece' }}>
          <MetaForm snap={snap} theme={theme} />
          <StatsBlock snap={snap} theme={theme} />
          <HistoryList snap={snap} theme={theme} />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <HeatmapPlot snap={snap} theme={theme} />
          <FeatureTable snap={snap} theme={theme} />
        </div>
      </div>
      <footer style={{ padding: '4px 12px',
                       borderTop: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
                       fontSize: 11, opacity: 0.85 }}>
        <span data-testid="forge-inspect-status">{snap.status}</span>
        {snap.pdfNote && <span style={{ marginLeft: 14, opacity: 0.7 }}>{snap.pdfNote}</span>}
      </footer>
    </div>
  );
}

// ============================================================
// Host
// ============================================================

const PANEL_EVENT = 'forge:open-inspect-panel';

export function InspectionWorkbenchHost() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (typeof window === 'undefined') return;
    window.__forgeOpenInspect = (opts = {}) => {
      if (opts && opts.theme) setTheme(opts.theme);
      setOpen(true);
    };
    window.__forgeCloseInspect = () => setOpen(false);
    window.__forgeInspectionDispatch = InspectionDispatch;
    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.theme) setTheme(d.theme);
      setOpen(true);
    };
    window.addEventListener(PANEL_EVENT, onEvt);
    return () => window.removeEventListener(PANEL_EVENT, onEvt);
  }, []);
  return (
    <InspectionBody open={open} theme={theme}
                    onClose={() => setOpen(false)} />
  );
}

// ============================================================
// Style helpers
// ============================================================

function panelOuter(theme) {
  const dark = theme === 'dark';
  return {
    position: 'absolute',
    top: 72, left: 76, right: 16, bottom: 48,
    background: dark ? 'rgba(16,14,11,0.97)' : 'rgba(252,247,232,0.97)',
    color: dark ? '#e9d9a8' : '#1a1612',
    border: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    borderRadius: 6, boxShadow: '0 14px 38px rgba(0,0,0,0.5)',
    fontFamily: 'ui-sans-serif, system-ui',
    zIndex: 8500,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };
}
function btn(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#2a241b' : '#e7dcb8',
    color: dark ? '#e9d9a8' : '#1a1612',
    border: `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4,
    padding: '5px 10px', fontSize: 11, cursor: 'pointer',
    letterSpacing: 0.3,
  };
}
function inp(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#0e0b07' : '#fffaea',
    color: dark ? '#e9d9a8' : '#1a1612',
    border: `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 3, padding: '2px 6px', fontSize: 11,
  };
}
function th(theme) {
  const dark = theme === 'dark';
  return {
    textAlign: 'left', padding: '4px 6px',
    borderBottom: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    background: dark ? '#1c1812' : '#ebe0b4',
    fontWeight: 600,
  };
}
function td(theme) {
  const dark = theme === 'dark';
  return {
    padding: '3px 6px',
    borderBottom: `1px solid ${dark ? '#2a241b' : '#d8c98a'}`,
    fontFamily: 'ui-monospace, Menlo, monospace',
  };
}

export default InspectionBody;
