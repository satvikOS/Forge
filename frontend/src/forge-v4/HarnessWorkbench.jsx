// Forge-168 — Wiring harness workbench.
//
// Layout:
//   ┌──────────────────────────────────────────────────────────────┐
//   │ Header · "Wiring Harness · Forge-168" · close                │
//   ├────────────────┬─────────────────────────────────────────────┤
//   │ Cable list     │   Per-cable inspector                        │
//   │  + Add cable   │   - Cable picker (grouped by kind)           │
//   │  · pick cable  │   - Connector A / Connector B pickers        │
//   │  · pick conn A │   - Waypoint editor (xyz, mm)                │
//   │  · pick conn B │   - Bend-radius status + length              │
//   │ Cut list       │   - "Generate body" → adds to scene          │
//   │ Bundles        │                                              │
//   └────────────────┴─────────────────────────────────────────────┘
//
// All numbers are SI internally (m); the UI lets the user edit in
// mm.  Generate body wraps the routed polyline as a tube; the shell
// already accepts arbitrary BufferGeometry via __forgeAppendBody.
//
// Manual UI never writes to Archie's thread.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ALL_CABLES, cablesByFamily, getCable,
} from './cableLibrary.js';
import {
  ALL_CONNECTORS, connectorsByFamily, getConnector,
} from './connectorLibrary.js';
import { routeHarness } from './harnessRouter.js';

const HARNESS_PANEL_EVENT = 'forge:open-harness-panel';

// ─────────────────────────────────────────────────────────────────────
// Styles (shared visual language with the spring designer)
// ─────────────────────────────────────────────────────────────────────

const panelStyle = {
  position: 'fixed',
  top: 72, left: 76, right: 16, bottom: 48,
  background: 'rgba(10,11,14,0.98)',
  color: '#ebecef',
  border: '1px solid #1d2027',
  borderRadius: 6,
  boxShadow: '0 14px 38px rgba(0,0,0,0.5)',
  fontFamily: 'ui-sans-serif, system-ui',
  zIndex: 8500,
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
  fontSize: 12,
};
const headerStyle = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '8px 12px', background: '#000',
  borderBottom: '1px solid #1d2027',
};
const bodyStyle = {
  flex: 1, overflow: 'hidden', padding: 12,
  display: 'grid', gap: 12,
  gridTemplateColumns: '320px 1fr',
  alignItems: 'stretch',
};
const sectionStyle = {
  border: '1px solid #1d2027', borderRadius: 6,
  background: '#101218', padding: 12,
  display: 'flex', flexDirection: 'column',
  minHeight: 0,
};
const sectionTitleStyle = {
  fontWeight: 600, fontSize: 11, color: '#cdd2dc',
  marginBottom: 8, letterSpacing: 0.4, textTransform: 'uppercase',
};
const fieldRowStyle = {
  display: 'grid', gridTemplateColumns: '110px 1fr',
  alignItems: 'center', gap: 8, marginBottom: 6,
};
const labelStyle = { color: '#9aa1ad', fontSize: 11 };
const inputStyle = {
  width: '100%', background: '#0a0b0e', color: '#ebecef',
  border: '1px solid #1d2027', borderRadius: 3,
  padding: '4px 8px', fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};
const selectStyle = { ...inputStyle, padding: '4px 6px' };
const okBadge = {
  display: 'inline-block', padding: '2px 8px',
  borderRadius: 3, fontSize: 10,
  background: '#093f1d', color: '#65eb88',
  border: '1px solid #1a6e3a',
};
const failBadge = {
  ...okBadge,
  background: '#3f0e15', color: '#ff8a96',
  border: '1px solid #6e1f2b',
};
const generateBtnStyle = {
  background: '#1a4a8a', color: '#fff',
  border: '1px solid #2e6fc4', borderRadius: 4,
  padding: '6px 16px', fontSize: 12, cursor: 'pointer',
};
const ghostBtn = {
  background: 'transparent', border: '1px solid #1d2027',
  color: '#ebecef', borderRadius: 3, padding: '3px 8px',
  cursor: 'pointer', fontSize: 11,
};
const closeBtn = {
  background: 'transparent', color: '#ebecef',
  border: 'none', fontSize: 18, cursor: 'pointer',
  marginLeft: 'auto',
};
const listRowStyle = (active) => ({
  padding: '6px 8px',
  borderRadius: 3,
  background: active ? '#1a2a45' : 'transparent',
  cursor: 'pointer',
  border: '1px solid ' + (active ? '#2e6fc4' : 'transparent'),
  marginBottom: 4,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
});
const cutListCell = {
  padding: '3px 6px', fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  borderBottom: '1px dotted #1d2027',
};
const colsStyle = {
  display: 'grid',
  gridTemplateColumns: '40px 1fr 70px 70px 70px',
  gap: 4, alignItems: 'center',
};

// ─────────────────────────────────────────────────────────────────────
// Constructors
// ─────────────────────────────────────────────────────────────────────

function blankCable(seedIdx = 0) {
  return {
    id: `cable-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    cableId: 'awg-18',
    fromConnectorId: 'jst-xh-4',
    toConnectorId: 'molex-minifit-jr-4',
    label: `Cable ${seedIdx + 1}`,
    waypoints: [
      [0,    0,    0],
      [0.10, 0.05, 0],
      [0.20, 0.0,  0],
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Cable picker (grouped optgroups)
// ─────────────────────────────────────────────────────────────────────

function CablePicker({ value, onChange, testid }) {
  const groups = useMemo(() => cablesByFamily(), []);
  return (
    <select style={selectStyle} value={value} data-testid={testid}
            onChange={(e) => onChange(e.target.value)}>
      {Array.from(groups.entries()).map(([kind, list]) => (
        <optgroup key={kind} label={kind.toUpperCase()}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ConnectorPicker({ value, onChange, testid }) {
  const groups = useMemo(() => connectorsByFamily(), []);
  return (
    <select style={selectStyle} value={value} data-testid={testid}
            onChange={(e) => onChange(e.target.value)}>
      {Array.from(groups.entries()).map(([fam, list]) => (
        <optgroup key={fam} label={fam}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Waypoint editor
// ─────────────────────────────────────────────────────────────────────

function WaypointEditor({ waypoints, onChange }) {
  const update = (i, axis, val) => {
    const v = parseFloat(val);
    const next = waypoints.map((w, idx) => idx === i
      ? w.map((c, ax) => ax === axis ? (Number.isFinite(v) ? v / 1000 : c) : c)
      : w);
    onChange(next);
  };
  const addRow = () => {
    const last = waypoints[waypoints.length - 1] || [0, 0, 0];
    onChange([...waypoints, [last[0] + 0.05, last[1], last[2]]]);
  };
  const removeRow = (i) => {
    if (waypoints.length <= 2) return;
    onChange(waypoints.filter((_, idx) => idx !== i));
  };

  return (
    <div data-testid="forge-harness-waypoints">
      <div style={{ ...colsStyle, color: '#9aa1ad', fontSize: 10,
                    marginBottom: 4 }}>
        <span>#</span>
        <span style={{ textAlign: 'center' }}>x (mm)</span>
        <span style={{ textAlign: 'center' }}>y (mm)</span>
        <span style={{ textAlign: 'center' }}>z (mm)</span>
        <span />
      </div>
      {waypoints.map((wp, i) => (
        <div key={i} style={colsStyle}>
          <span style={{ color: '#7f8694', fontSize: 11 }}>{i + 1}</span>
          <input style={inputStyle} value={String((wp[0] * 1000).toFixed(2))}
                 data-testid={`forge-harness-wp-${i}-x`}
                 onChange={(e) => update(i, 0, e.target.value)} />
          <input style={inputStyle} value={String((wp[1] * 1000).toFixed(2))}
                 data-testid={`forge-harness-wp-${i}-y`}
                 onChange={(e) => update(i, 1, e.target.value)} />
          <input style={inputStyle} value={String((wp[2] * 1000).toFixed(2))}
                 data-testid={`forge-harness-wp-${i}-z`}
                 onChange={(e) => update(i, 2, e.target.value)} />
          <button style={ghostBtn} onClick={() => removeRow(i)}
                  data-testid={`forge-harness-wp-${i}-del`}>×</button>
        </div>
      ))}
      <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
        <button style={ghostBtn} onClick={addRow}
                data-testid="forge-harness-wp-add">+ waypoint</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Per-cable inspector
// ─────────────────────────────────────────────────────────────────────

function CableInspector({ cable, route, onUpdate, onGenerate }) {
  if (!cable) {
    return (
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Inspector</div>
        <div style={{ color: '#7f8694' }}>Add a cable from the list to begin.</div>
      </div>
    );
  }
  const spec = getCable(cable.cableId);
  const cA = getConnector(cable.fromConnectorId);
  const cB = getConnector(cable.toConnectorId);

  return (
    <div style={sectionStyle} data-testid="forge-harness-inspector">
      <div style={sectionTitleStyle}>Inspector · {cable.label}</div>
      <div style={fieldRowStyle}>
        <span style={labelStyle}>Label</span>
        <input style={inputStyle} value={cable.label}
               data-testid="forge-harness-label"
               onChange={(e) => onUpdate({ label: e.target.value })} />
      </div>
      <div style={fieldRowStyle}>
        <span style={labelStyle}>Cable</span>
        <CablePicker value={cable.cableId} testid="forge-harness-cable-picker"
                     onChange={(v) => onUpdate({ cableId: v })} />
      </div>
      <div style={fieldRowStyle}>
        <span style={labelStyle}>Connector A</span>
        <ConnectorPicker value={cable.fromConnectorId}
                         testid="forge-harness-conn-a"
                         onChange={(v) => onUpdate({ fromConnectorId: v })} />
      </div>
      <div style={fieldRowStyle}>
        <span style={labelStyle}>Connector B</span>
        <ConnectorPicker value={cable.toConnectorId}
                         testid="forge-harness-conn-b"
                         onChange={(v) => onUpdate({ toConnectorId: v })} />
      </div>
      <div style={{ marginTop: 6 }}>
        <div style={sectionTitleStyle}>Waypoints</div>
        <WaypointEditor waypoints={cable.waypoints}
                        onChange={(wps) => onUpdate({ waypoints: wps })} />
      </div>
      {route && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#cdd2dc' }}>
          <div>Length: <b data-testid="forge-harness-route-length">
            {(route.length_m * 1000).toFixed(1)} mm
          </b></div>
          <div>Min bend radius (computed): <b>
            {route.minRadius_m === Infinity ? '∞' : (route.minRadius_m * 1000).toFixed(1) + ' mm'}
          </b></div>
          <div>Required ({spec?.label || cable.cableId}): <b>
            {(route.requiredRadius_m * 1000).toFixed(1)} mm
          </b></div>
          <div style={{ marginTop: 6 }}>
            <Badge ok={route.ok} testid="forge-harness-route-ok"
                   labelOk="Bend OK" labelFail={`Bend ✗ (${route.violations.length} viol.)`} />
            {cA && (
              <span style={{ marginLeft: 8, color: '#9aa1ad', fontSize: 10 }}>
                A: {cA.family} {cA.pinCount}p
              </span>
            )}
            {cB && (
              <span style={{ marginLeft: 8, color: '#9aa1ad', fontSize: 10 }}>
                B: {cB.family} {cB.pinCount}p
              </span>
            )}
          </div>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <button style={generateBtnStyle} onClick={onGenerate}
                data-testid="forge-harness-generate">
          Generate body
        </button>
      </div>
    </div>
  );
}

function Badge({ ok, labelOk, labelFail, testid }) {
  return (
    <span style={ok ? okBadge : failBadge}
          data-testid={testid}
          data-pass={ok ? 'true' : 'false'}>
      {ok ? labelOk : labelFail}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Left rail — cable list + cut-list + bundles
// ─────────────────────────────────────────────────────────────────────

function LeftRail({
  cables, activeId, onSelect, onAdd, onDelete,
  cutList, bundles, bundleStrategy, onBundleStrategy,
}) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr 1fr',
                  gap: 12, minHeight: 0 }}>
      <div style={sectionStyle} data-testid="forge-harness-cable-list">
        <div style={sectionTitleStyle}>Cables ({cables.length})</div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {cables.map((c) => (
            <div key={c.id} style={listRowStyle(c.id === activeId)}
                 data-testid={`forge-harness-cable-${c.id}`}
                 data-active={c.id === activeId ? 'true' : 'false'}
                 onClick={() => onSelect(c.id)}>
              <span>{c.label}</span>
              <span style={{ color: '#7f8694', float: 'right', fontSize: 10 }}>
                {c.cableId}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button style={ghostBtn} onClick={onAdd}
                  data-testid="forge-harness-add-cable">+ Cable</button>
          {activeId && (
            <button style={ghostBtn} onClick={() => onDelete(activeId)}
                    data-testid="forge-harness-del-cable">− Cable</button>
          )}
        </div>
      </div>
      <div style={sectionStyle} data-testid="forge-harness-cutlist">
        <div style={sectionTitleStyle}>Cut list</div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {cutList.length === 0 && (
            <div style={{ color: '#7f8694' }}>No cables routed yet.</div>
          )}
          {cutList.map((row) => (
            <div key={row.id} style={cutListCell}
                 data-testid={`forge-harness-cut-${row.id}`}>
              <div>{row.cableId} · <b>{row.length_mm.toFixed(1)} mm</b></div>
              <div style={{ color: '#7f8694', fontSize: 10 }}>
                {row.fromConnectorId} → {row.toConnectorId}
                {row.bundleId ? ` · in ${row.bundleId}` : ''}
                {row.ok ? '' : ` · ${row.violationCount} violations`}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={sectionStyle} data-testid="forge-harness-bundles">
        <div style={sectionTitleStyle}>Bundles</div>
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Strategy</span>
          <select style={selectStyle} value={bundleStrategy}
                  data-testid="forge-harness-bundle-strategy"
                  onChange={(e) => onBundleStrategy(e.target.value)}>
            <option value="auto">Auto (share path)</option>
            <option value="none">None</option>
          </select>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {bundles.length === 0 && (
            <div style={{ color: '#7f8694' }}>No bundles detected.</div>
          )}
          {bundles.map((b) => (
            <div key={b.id} style={cutListCell}
                 data-testid={`forge-harness-bundle-${b.id}`}>
              <div>{b.id} · OD <b>{b.bundleOD_mm.toFixed(2)} mm</b></div>
              <div style={{ color: '#7f8694', fontSize: 10 }}>
                {b.cableIds.length} cables · min r {(b.minRadius_m * 1000).toFixed(1)} mm /
                req {(b.requiredRadius_m * 1000).toFixed(1)} mm
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────

export function HarnessWorkbench({ open, onClose, onGenerate }) {
  const [cables, setCables]   = useState(() => [blankCable(0)]);
  const [activeId, setActive] = useState(() => null);
  const [bundleStrategy, setBundleStrategy] = useState('auto');

  // Make sure an active id always points at a cable (or null when empty).
  useEffect(() => {
    if (cables.length === 0) { if (activeId !== null) setActive(null); return; }
    if (!cables.find((c) => c.id === activeId)) setActive(cables[0].id);
  }, [cables, activeId]);

  const active = cables.find((c) => c.id === activeId) || null;

  const onAdd = useCallback(() => {
    setCables((arr) => {
      const next = [...arr, blankCable(arr.length)];
      return next;
    });
  }, []);
  const onDelete = useCallback((id) => {
    setCables((arr) => arr.filter((c) => c.id !== id));
  }, []);
  const updateActive = useCallback((patch) => {
    setCables((arr) => arr.map((c) =>
      c.id === activeId ? { ...c, ...patch } : c));
  }, [activeId]);

  // Routing — derived from cables + bundleStrategy.
  const harness = useMemo(() => routeHarness(cables, {
    bundleStrategy, samplesPerSegment: 28,
  }), [cables, bundleStrategy]);
  const activeRoute = harness.routes.find((r) => r.id === activeId) || null;

  const onGen = useCallback(() => {
    if (!active || !activeRoute) return;
    onGenerate?.({ cable: active, route: activeRoute, harness });
  }, [active, activeRoute, harness, onGenerate]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-harness-workbench">
      <header style={headerStyle}>
        <span style={{ fontWeight: 600 }}>Wiring Harness</span>
        <span style={{ color: '#7f8694', fontSize: 11 }}>
          Forge-168 · Catmull-Rom + bend-radius
        </span>
        <button style={closeBtn} onClick={onClose}
                data-testid="forge-harness-close">×</button>
      </header>
      <div style={bodyStyle}>
        <LeftRail cables={cables}
                  activeId={activeId}
                  onSelect={setActive}
                  onAdd={onAdd}
                  onDelete={onDelete}
                  cutList={harness.cutList}
                  bundles={harness.bundles}
                  bundleStrategy={bundleStrategy}
                  onBundleStrategy={setBundleStrategy} />
        <CableInspector cable={active}
                        route={activeRoute}
                        onUpdate={updateActive}
                        onGenerate={onGen} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Body geometry — turn the routed polyline into a tube swept by a
// circular cross-section sized to the cable OD (or bundle OD).
// Returns { positions, normals, indices, triangleCount } so the shell
// can render via a generic mesh body.
// ─────────────────────────────────────────────────────────────────────

export function generateRoutedTubeMesh(polyline, radius_m, opts = {}) {
  const radialSegs = Math.max(6, opts.radialSegs || 10);
  const N = polyline.length;
  if (N < 2 || radius_m <= 0) {
    return { positions: new Float32Array(),
             normals:   new Float32Array(),
             indices:   new Uint32Array(),
             triangleCount: 0 };
  }
  const positions = [];
  const normals = [];
  const indices = [];

  let prevN = null;
  for (let i = 0; i < N; i++) {
    const Pcur = polyline[i];
    const Pnext = polyline[Math.min(i + 1, N - 1)];
    const Pprev = polyline[Math.max(i - 1, 0)];
    const T = normalize3([
      Pnext[0] - Pprev[0],
      Pnext[1] - Pprev[1],
      Pnext[2] - Pprev[2],
    ]);
    let N0;
    if (i === 0) {
      N0 = Math.abs(T[2]) < 0.9
        ? normalize3(cross3(T, [0, 0, 1]))
        : normalize3(cross3(T, [1, 0, 0]));
    } else {
      N0 = normalize3(subtract3(prevN, scale3(T, dot3(prevN, T))));
    }
    const B0 = normalize3(cross3(T, N0));
    prevN = N0;
    for (let j = 0; j < radialSegs; j++) {
      const a = (j / radialSegs) * 2 * Math.PI;
      const cosA = Math.cos(a), sinA = Math.sin(a);
      const nx = N0[0] * cosA + B0[0] * sinA;
      const ny = N0[1] * cosA + B0[1] * sinA;
      const nz = N0[2] * cosA + B0[2] * sinA;
      positions.push(Pcur[0] + radius_m * nx,
                     Pcur[1] + radius_m * ny,
                     Pcur[2] + radius_m * nz);
      normals.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < N - 1; i++) {
    const a = i * radialSegs;
    const b = (i + 1) * radialSegs;
    for (let j = 0; j < radialSegs; j++) {
      const j2 = (j + 1) % radialSegs;
      const v00 = a + j,  v01 = a + j2;
      const v10 = b + j,  v11 = b + j2;
      indices.push(v00, v10, v11, v00, v11, v01);
    }
  }
  const idxBuf = indices.length < 65535
    ? new Uint16Array(indices) : new Uint32Array(indices);
  return {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    indices:   idxBuf,
    triangleCount: indices.length / 3,
  };
}

function normalize3(v) {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}
function subtract3(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function scale3(a, s)    { return [a[0]*s, a[1]*s, a[2]*s]; }
function dot3(a, b)      { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function cross3(a, b) {
  return [a[1]*b[2] - a[2]*b[1],
          a[2]*b[0] - a[0]*b[2],
          a[0]*b[1] - a[1]*b[0]];
}

// ─────────────────────────────────────────────────────────────────────
// Host
// ─────────────────────────────────────────────────────────────────────

export function HarnessWorkbenchHost() {
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(false);
  const versionRef = useRef(0);

  useEffect(() => {
    if (mountedRef.current) return undefined;
    mountedRef.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenHarness = (v) => {
      setOpen(typeof v === 'boolean' ? v : true);
    };
    window.__forgeCloseHarness = () => setOpen(false);
    const onEvt = () => setOpen(true);
    window.addEventListener(HARNESS_PANEL_EVENT, onEvt);
    const onClick = (e) => {
      const tab = e.target?.closest?.('[data-wb="harness"]');
      if (tab) setOpen(true);
    };
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener(HARNESS_PANEL_EVENT, onEvt);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  const onGenerate = useCallback(({ cable, route, harness }) => {
    versionRef.current += 1;
    const spec = getCable(cable.cableId);
    const cableOD_m = (spec?.od_mm || 5) / 1000;
    const mesh = generateRoutedTubeMesh(route.polyline, cableOD_m / 2);
    const body = {
      id: `harness-${cable.id}`,
      kind: 'synthetic',
      synthetic: {
        kind: 'cylinder',
        r: cableOD_m * 1000 / 2,
        h: route.length_m * 1000,
        segments: 24,
      },
      label: `Harness · ${cable.label} · ${(route.length_m * 1000).toFixed(1)} mm`,
      harness: {
        cable, route,
        mesh,
        bundle: route.bundleId || null,
        cutList: harness.cutList,
        bundles: harness.bundles,
      },
    };
    if (typeof window !== 'undefined') {
      window.__forgeHarness = Object.freeze({
        version: versionRef.current,
        lastGenerated: { id: body.id, cable, route },
        cutList: harness.cutList,
        bundles: harness.bundles,
      });
      window.__forgeAppendBody?.(body);
      window.dispatchEvent(new CustomEvent('forge:body-added', { detail: body }));
    }
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <HarnessWorkbench open={open}
                      onClose={() => setOpen(false)}
                      onGenerate={onGenerate} />,
    document.body);
}

export default HarnessWorkbench;
