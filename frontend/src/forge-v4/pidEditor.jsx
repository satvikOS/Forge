// Forge-169 — Piping & Instrumentation Diagram (P&ID) editor.
//
// Drag-drop schematic editor with a 10 mm grid (per ISA-5.1-2009
// §5.2 — "minor grid 10 mm" guidance).  The editor reads symbols
// from isa51Symbols.js, lets the user drop them on the canvas, draw
// connecting lines between symbol ports, and simulate process flow.
//
// Patterns lifted from MeshWorkbench / ArchWorkbench:
//
//   * `useSyncExternalStore` snapshot is cached against a numeric
//     version counter — same reference returned when nothing changed.
//     This avoids React #185 ("getSnapshot returned different values").
//   * The host's `useEffect` dep arrays are constant `[]` — listeners
//     attach/detach exactly once.
//   * Manual UI never writes to Archie's thread.
//
// Saved drawing JSON shape:
//   {
//     symbols: [{ id, defId, x, y, rotation, tag }],
//     lines:   [{ id, kind, points:[{x,y}], from:{sym,port}, to:{sym,port} }],
//   }

import React, { useCallback, useEffect, useMemo, useRef, useState,
                useSyncExternalStore } from 'react';
import {
  ISA51_SYMBOLS, ISA51_BY_ID, ISA51_GROUPS,
  LINE_TYPES, SYMBOL_STYLE, nextTag,
} from './isa51Symbols.js';
import { simulate as simulateFlow, FLUIDS, ROUGHNESS_MM }
  from './flowSimulator.js';

// ============================================================
// Editor store — external, cached snapshot
// ============================================================

const GRID_MM = 10;
const CELL_PX = 12;   // 1 grid cell = 12 px on screen
const SYMBOL_CELLS = 4; // symbols span 4 grid cells = 40 mm

let _state = {
  symbols: [],
  lines:   [],
  selectedSymId:  null,
  selectedLineId: null,
  pendingLine:    null,  // { kind, points: [...] } during drawing
  sim:            null,
  toolMode:       'select', // 'select' | 'drop' | 'line'
  dropDefId:      null,
  lineKind:       'process',
};
let _version = 0;
const _subs = new Set();
let _cachedSnap = null;
let _cachedSnapVer = -1;

function notify() { _version++; for (const fn of _subs) { try { fn(); } catch {} } }
function getSnapshot() {
  if (_cachedSnap && _cachedSnapVer === _version) return _cachedSnap;
  _cachedSnap = { ..._state, version: _version };
  _cachedSnapVer = _version;
  return _cachedSnap;
}
const STORE = {
  subscribe(cb) { _subs.add(cb); return () => _subs.delete(cb); },
  getSnapshot,
};

function update(patch) { _state = { ..._state, ...patch }; notify(); }

// ============================================================
// Schematic operations
// ============================================================

function addSymbol(defId, gridX, gridY) {
  const def = ISA51_BY_ID[defId];
  if (!def) return null;
  // Auto-tag for instruments — increment per first-letter.
  let tag = null;
  if (def.tag) {
    const used = _state.symbols.map((s) => s.tag).filter(Boolean);
    tag = nextTag(def.tag, used);
  }
  const sym = {
    id: `S${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)}`,
    defId,
    x: gridX, y: gridY,        // snapped grid coordinates
    rotation: 0,
    tag,
  };
  update({ symbols: [..._state.symbols, sym] });
  return sym;
}

function moveSymbol(id, gridX, gridY) {
  update({
    symbols: _state.symbols.map((s) =>
      s.id === id ? { ...s, x: gridX, y: gridY } : s),
  });
}

function deleteSymbol(id) {
  // Also drop any lines touching it.
  update({
    symbols: _state.symbols.filter((s) => s.id !== id),
    lines:   _state.lines.filter((l) =>
      l.from?.sym !== id && l.to?.sym !== id),
    selectedSymId: null,
  });
}

function addLine(kind, points, fromRef, toRef) {
  const line = {
    id: `L${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)}`,
    kind,
    points: [...points],
    from: fromRef,
    to:   toRef,
  };
  update({ lines: [..._state.lines, line] });
  return line;
}

function deleteLine(id) {
  update({
    lines: _state.lines.filter((l) => l.id !== id),
    selectedLineId: null,
  });
}

function clearSchematic() {
  update({ symbols: [], lines: [], sim: null,
           selectedSymId: null, selectedLineId: null });
}

function snapToGrid(px) { return Math.round(px / CELL_PX) * CELL_PX; }
function gridToPx(g)    { return g * CELL_PX; }

function symbolBox(sym) {
  const w = SYMBOL_CELLS * CELL_PX;
  const h = SYMBOL_CELLS * CELL_PX;
  return { x: sym.x, y: sym.y, w, h };
}
function portPx(sym, def, port) {
  // Port positions are in 0..100 normalised; map to symbol box.
  const box = symbolBox(sym);
  return {
    x: box.x + box.w * (port.x / 100),
    y: box.y + box.h * (port.y / 100),
  };
}

// Public surface — exposed so tests + Archie tool calls can poke
// the store deterministically.
export const PidStore = {
  getState: () => getSnapshot(),
  subscribe: STORE.subscribe,
  addSymbol,
  moveSymbol,
  deleteSymbol,
  addLine,
  deleteLine,
  clearSchematic,
  simulate(opts = {}) {
    const s = simulateFlow(_state, {
      ...opts,
      scale_m_per_unit: GRID_MM / 1000 / CELL_PX,
    });
    update({ sim: s });
    return s;
  },
  setToolMode(mode, dropDefId = null) {
    update({ toolMode: mode, dropDefId,
             pendingLine: mode === 'line'
               ? { kind: _state.lineKind, points: [] } : null });
  },
  setLineKind(kind) { update({ lineKind: kind }); },
  selectSymbol(id) { update({ selectedSymId: id, selectedLineId: null }); },
  selectLine(id)   { update({ selectedLineId: id, selectedSymId: null }); },
};

// ============================================================
// Symbol palette
// ============================================================

function SymbolPalette({ theme, onPick }) {
  return (
    <div data-testid="forge-pid-palette"
         style={{
           width: 200, overflowY: 'auto',
           padding: 8,
           borderRight: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
           background: theme === 'dark' ? '#16120c' : '#f7eece',
         }}>
      {ISA51_GROUPS.map((group) => (
        <div key={group} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7,
                        textTransform: 'uppercase', letterSpacing: 0.5,
                        marginBottom: 6 }}>
            {group}
          </div>
          <div style={{ display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 4 }}>
            {ISA51_SYMBOLS.filter((s) => s.group === group).map((sym) => (
              <button key={sym.id} type="button"
                      data-testid={`forge-pid-palette-${sym.id}`}
                      data-def-id={sym.id}
                      onClick={() => onPick(sym.id)}
                      title={sym.name}
                      style={{
                        background: theme === 'dark' ? '#241d12' : '#ebe0b4',
                        border: `1px solid ${theme === 'dark' ? '#4a3e2a' : '#a98a4a'}`,
                        borderRadius: 4,
                        padding: 4, cursor: 'pointer',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: 2,
                      }}>
                <svg viewBox="0 0 100 100" width={42} height={42}
                     style={SYMBOL_STYLE}
                     dangerouslySetInnerHTML={{ __html: sym.svg }} />
                <span style={{ fontSize: 9, opacity: 0.75,
                              textAlign: 'center', lineHeight: 1.05 }}>
                  {sym.tag || sym.name.replace(/ valve| pump| tank|HX/i, '')}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Canvas — SVG drag-drop
// ============================================================

function PidCanvas({ snap, theme }) {
  const dark = theme === 'dark';
  const ref = useRef(null);
  // 70 × 50 cells = 700 × 500 px = 700 × 500 mm at 10 mm grid.
  const COLS = 70, ROWS = 50;
  const W = COLS * CELL_PX, H = ROWS * CELL_PX;

  // Grid pattern.
  const gridPath = useMemo(() => {
    const lines = [];
    for (let c = 0; c <= COLS; c++) {
      lines.push(`M${c * CELL_PX} 0 V${H}`);
    }
    for (let r = 0; r <= ROWS; r++) {
      lines.push(`M0 ${r * CELL_PX} H${W}`);
    }
    return lines.join(' ');
  }, [W, H]);

  function clientToGrid(evt) {
    const rect = ref.current.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    return { x: snapToGrid(x), y: snapToGrid(y) };
  }

  function onCanvasClick(e) {
    const p = clientToGrid(e);
    if (snap.toolMode === 'drop' && snap.dropDefId) {
      addSymbol(snap.dropDefId, p.x, p.y);
      // Stay in drop mode so user can place multiple.
      return;
    }
    if (snap.toolMode === 'line') {
      const pending = snap.pendingLine || { kind: snap.lineKind, points: [] };
      // Snap to nearest symbol port if within 10 px.
      let snapped = p;
      let portRef = null;
      let bestDist = 14;
      for (const sym of snap.symbols) {
        const def = ISA51_BY_ID[sym.defId];
        if (!def) continue;
        for (let pi = 0; pi < def.ports.length; pi++) {
          const px = portPx(sym, def, def.ports[pi]);
          const d = Math.hypot(px.x - p.x, px.y - p.y);
          if (d < bestDist) {
            bestDist = d;
            snapped = { x: snapToGrid(px.x), y: snapToGrid(px.y) };
            portRef = { sym: sym.id, port: pi };
          }
        }
      }
      const nextPts = [...pending.points, snapped];
      // If clicked a 2nd port → close the polyline as a finished line.
      if (portRef && pending.points.length >= 1 && pending.from) {
        addLine(pending.kind, nextPts, pending.from, portRef);
        update({ pendingLine: { kind: snap.lineKind, points: [] } });
        return;
      }
      // First point with a port → record `from`.
      const newPending = {
        ...pending,
        points: nextPts,
        from: pending.from || portRef,
      };
      update({ pendingLine: newPending });
      return;
    }
    // select mode — clicking empty space clears selection.
    update({ selectedSymId: null, selectedLineId: null });
  }

  function onSymbolMouseDown(e, sym) {
    e.stopPropagation();
    if (snap.toolMode !== 'select') return;
    update({ selectedSymId: sym.id, selectedLineId: null });
    const startEvt = e;
    const start = { x: sym.x, y: sym.y };
    const move = (mv) => {
      const dx = mv.clientX - startEvt.clientX;
      const dy = mv.clientY - startEvt.clientY;
      moveSymbol(sym.id, snapToGrid(start.x + dx), snapToGrid(start.y + dy));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  return (
    <div ref={ref}
         data-testid="forge-pid-canvas"
         onClick={onCanvasClick}
         style={{
           position: 'relative',
           width: W, height: H,
           background: dark ? '#1a1813' : '#fbf3d4',
           border: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
           overflow: 'hidden',
           cursor: snap.toolMode === 'select' ? 'default' : 'crosshair',
         }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}
           style={{ display: 'block', position: 'absolute', inset: 0,
                    color: dark ? '#e9d9a8' : '#1a1612' }}>
        {/* grid */}
        <path d={gridPath}
              stroke={dark ? '#2a2419' : '#d8c98a'}
              strokeWidth={0.5} fill="none" />
        {/* lines */}
        {snap.lines.map((l) => {
          const lt = LINE_TYPES[l.kind] || LINE_TYPES.process;
          const path = polyPath(l.points);
          const selected = snap.selectedLineId === l.id;
          return (
            <path key={l.id} d={path}
                  data-testid={`forge-pid-line-${l.id}`}
                  data-line-id={l.id}
                  stroke={lt.stroke}
                  strokeWidth={selected ? lt.width + 1.5 : lt.width}
                  strokeDasharray={lt.dash === 'none' ? undefined : lt.dash}
                  fill="none"
                  onClick={(e) => {
                    e.stopPropagation();
                    update({ selectedLineId: l.id, selectedSymId: null });
                  }} />
          );
        })}
        {/* pending line preview */}
        {snap.pendingLine && snap.pendingLine.points.length > 0 && (
          <path d={polyPath(snap.pendingLine.points)}
                stroke={dark ? '#ffa057' : '#a05000'}
                strokeWidth={1.5}
                strokeDasharray="2 4" fill="none" />
        )}
        {/* symbols */}
        {snap.symbols.map((sym) => {
          const def = ISA51_BY_ID[sym.defId];
          if (!def) return null;
          const w = SYMBOL_CELLS * CELL_PX;
          const h = SYMBOL_CELLS * CELL_PX;
          const selected = snap.selectedSymId === sym.id;
          return (
            <g key={sym.id}
               data-testid={`forge-pid-sym-${sym.id}`}
               data-def-id={sym.defId}
               transform={`translate(${sym.x},${sym.y})`}
               onMouseDown={(e) => onSymbolMouseDown(e, sym)}
               style={{ cursor: snap.toolMode === 'select' ? 'grab' : 'pointer' }}>
              {selected && (
                <rect x={-2} y={-2} width={w + 4} height={h + 4}
                      fill="none"
                      stroke={dark ? '#ffa057' : '#a05000'}
                      strokeWidth={1.5}
                      strokeDasharray="3 3" />
              )}
              <g transform={`scale(${w / 100} ${h / 100})`}
                 style={SYMBOL_STYLE}
                 dangerouslySetInnerHTML={{ __html: def.svg }} />
              {sym.tag && (
                <text x={w / 2} y={h / 2 + 3} fontSize={9}
                      textAnchor="middle"
                      fill={dark ? '#e9d9a8' : '#1a1612'}>
                  {sym.tag}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function polyPath(pts) {
  if (!pts.length) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
}

// ============================================================
// Top toolbar
// ============================================================

function PidToolbar({ snap, theme, onSim, onExport, onImport, onClear }) {
  const dark = theme === 'dark';
  return (
    <div data-testid="forge-pid-toolbar"
         style={{
           display: 'flex', gap: 6, padding: '6px 10px',
           borderBottom: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
           background: dark ? '#16120c' : '#f1e3a8',
           alignItems: 'center', flexWrap: 'wrap',
         }}>
      <button type="button" onClick={() => PidStore.setToolMode('select')}
              data-testid="forge-pid-tool-select"
              style={btn(theme, snap.toolMode === 'select')}>Select</button>
      <button type="button" onClick={() => PidStore.setToolMode('line')}
              data-testid="forge-pid-tool-line"
              style={btn(theme, snap.toolMode === 'line')}>Line</button>
      <select value={snap.lineKind}
              data-testid="forge-pid-line-kind"
              onChange={(e) => PidStore.setLineKind(e.target.value)}
              style={sel(theme)}>
        {Object.values(LINE_TYPES).map((lt) => (
          <option key={lt.id} value={lt.id}>{lt.name}</option>
        ))}
      </select>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" onClick={onSim}
              data-testid="forge-pid-tool-simulate"
              style={btn(theme, false)}>Simulate Flow</button>
      <span style={{ flex: 1 }} />
      <button type="button" onClick={onClear}
              data-testid="forge-pid-tool-clear"
              style={btn(theme, false)}>Clear</button>
      <button type="button" onClick={onExport}
              data-testid="forge-pid-tool-export"
              style={btn(theme, false)}>Export JSON</button>
      <button type="button" onClick={onImport}
              data-testid="forge-pid-tool-import"
              style={btn(theme, false)}>Import JSON</button>
    </div>
  );
}

// ============================================================
// Right-side simulation results
// ============================================================

function PidSimResults({ snap, theme }) {
  const dark = theme === 'dark';
  if (!snap.sim) {
    return (
      <div data-testid="forge-pid-sim-empty"
           style={{ padding: 12, opacity: 0.6, fontSize: 12 }}>
        Click <b>Simulate Flow</b> to compute pressure drops with
        Darcy-Weisbach + Colebrook-White.
      </div>
    );
  }
  const s = snap.sim;
  return (
    <div data-testid="forge-pid-sim-results"
         style={{ padding: 12, fontSize: 12,
                  color: dark ? '#e9d9a8' : '#1a1612' }}>
      <div style={{ marginBottom: 8 }}>
        <b>Fluid:</b> {s.fluid} · <b>D:</b> {s.pipeDiameter_mm.toFixed(1)} mm ·{' '}
        <b>Q:</b> {s.flow_m3h.toFixed(2)} m³/h
      </div>
      <div style={{ marginBottom: 8 }}>
        <b>Total ΔP:</b> {s.totalDp_kPa.toFixed(2)} kPa ({s.lineCount} segments)
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={th(theme)}>Line</th>
            <th style={th(theme)}>L (m)</th>
            <th style={th(theme)}>V (m/s)</th>
            <th style={th(theme)}>Re</th>
            <th style={th(theme)}>f</th>
            <th style={th(theme)}>ΔP (kPa)</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.map((row) => (
            <tr key={row.lineId}>
              <td style={td(theme)}>{row.lineId.slice(0, 6)}</td>
              <td style={td(theme)}>{row.length_m.toFixed(2)}</td>
              <td style={td(theme)}>{row.velocity_ms.toFixed(2)}</td>
              <td style={td(theme)}>{row.reynolds.toFixed(0)}</td>
              <td style={td(theme)}>{row.frictionFactor.toFixed(4)}</td>
              <td style={td(theme)}>{row.dp_kPa.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Main editor body
// ============================================================

function PidEditorBody({ open, theme, onClose }) {
  const snap = useSyncExternalStore(STORE.subscribe, STORE.getSnapshot);

  const handleSim = useCallback(() => {
    try {
      PidStore.simulate();
    } catch (err) {
      console.warn('[pid.sim]', err.message);
    }
  }, []);

  const handleExport = useCallback(() => {
    const json = JSON.stringify({
      symbols: snap.symbols, lines: snap.lines,
    }, null, 2);
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pid-schematic.json';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.warn('[pid.export]', err.message);
    }
  }, [snap.symbols, snap.lines]);

  const handleImport = useCallback(() => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const obj = JSON.parse(txt);
        update({
          symbols: Array.isArray(obj.symbols) ? obj.symbols : [],
          lines:   Array.isArray(obj.lines)   ? obj.lines   : [],
        });
      } catch (err) {
        console.warn('[pid.import]', err.message);
      }
    };
    inp.click();
  }, []);

  const handleClear = useCallback(() => {
    clearSchematic();
  }, []);

  if (!open) return null;

  return (
    <div data-testid="forge-pid-editor"
         style={panelOuter(theme)}>
      <header style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', padding: '6px 12px',
        borderBottom: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
        background: theme === 'dark' ? '#1c1812' : '#ebe0b4',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          P&amp;ID Editor · ISA-5.1-2009
        </span>
        <button type="button" onClick={onClose}
                data-testid="forge-pid-close"
                style={btn(theme, false)}>Close</button>
      </header>
      <PidToolbar snap={snap} theme={theme}
                  onSim={handleSim} onExport={handleExport}
                  onImport={handleImport} onClear={handleClear} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <SymbolPalette theme={theme}
                       onPick={(id) => PidStore.setToolMode('drop', id)} />
        <div style={{ flex: 1, overflow: 'auto',
                      padding: 12,
                      background: theme === 'dark' ? '#0e0b07' : '#f4ead0' }}>
          <PidCanvas snap={snap} theme={theme} />
        </div>
        <div style={{ width: 340, overflowY: 'auto',
                      borderLeft: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
                      background: theme === 'dark' ? '#16120c' : '#f7eece' }}>
          <PidSimResults snap={snap} theme={theme} />
        </div>
      </div>
      <footer style={{ padding: '4px 12px',
                       borderTop: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
                       fontSize: 11, opacity: 0.7 }}>
        <span data-testid="forge-pid-status">
          {snap.toolMode === 'drop' && snap.dropDefId
            ? `placing ${ISA51_BY_ID[snap.dropDefId]?.name}`
            : snap.toolMode === 'line'
              ? `drawing ${LINE_TYPES[snap.lineKind].name} line`
              : `select · ${snap.symbols.length} symbols / ${snap.lines.length} lines`}
        </span>
      </footer>
    </div>
  );
}

// ============================================================
// Host
// ============================================================

const PID_PANEL_EVENT = 'forge:open-pid-panel';

export function PidEditorHost() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (typeof window === 'undefined') return;
    window.__forgeOpenPid = (opts = {}) => {
      if (opts && opts.theme) setTheme(opts.theme);
      setOpen(true);
    };
    window.__forgeClosePid = () => setOpen(false);
    window.__forgePidStore = PidStore;
    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.theme) setTheme(d.theme);
      setOpen(true);
    };
    window.addEventListener(PID_PANEL_EVENT, onEvt);
    return () => window.removeEventListener(PID_PANEL_EVENT, onEvt);
  }, []);

  return (
    <PidEditorBody open={open} theme={theme}
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
function btn(theme, active) {
  const dark = theme === 'dark';
  return {
    background: active ? (dark ? '#a3743a' : '#a98a4a')
                       : (dark ? '#2a241b' : '#e7dcb8'),
    color: active ? '#fff' : (dark ? '#e9d9a8' : '#1a1612'),
    border: `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4,
    padding: '4px 10px', fontSize: 11, cursor: 'pointer',
    letterSpacing: 0.3,
  };
}
function sel(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#1c1812' : '#f0e6c0',
    color: dark ? '#e9d9a8' : '#1a1612',
    border: `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4, padding: '3px 6px', fontSize: 11,
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

export default PidEditorBody;
