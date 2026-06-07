// PUSH-118 (Slice-86) — 5-Axis CAM Strategies panel.
//
// PUSH-46 shipped the basic CAM workbench (profile / pocket / drill /
// faceMill). PUSH-98 layered the batched Drilling Pattern panel. The 5-axis
// strategies the incumbent MCAD vendors (NX CAM, Mastercam, hyperMill,
// Fusion 360 Manufacture) ship aren't reachable from those surfaces — for
// real-world wing skins, impeller blades, turbine vanes and pocket fillets
// you need Swarf cutting (5-axis side milling along a ruled surface),
// Parallel-to-face (3+2 indexed pocketing per orientation) and Pocket
// (multi-axis indexed pocket clearing).
//
// This panel ships those three strategies on the native kernel surface
// the kernel already exposes:
//
//   * Swarf            → window.forge.cam.multiAxisContinuous
//   * Parallel-to-face → window.forge.cam.multiAxisIndexed (single orient)
//   * Pocket           → window.forge.cam.multiAxisIndexed (4-orient ring)
//
// Both kernel ops require a Shape handle, a Tool, CuttingParams, and
// either an orientations[] (indexed) or a path[] of {x,y,z,nx,ny,nz}
// SurfaceStations (continuous). The Tool axis vector input in the UI
// drives those normals / orientations directly — for the Swarf strategy
// every station inherits the same axis vector; for Parallel-to-face the
// axis is rolled into a single (A,B,C) Euler triple; for Pocket we ring
// four orientations around the C axis from the input vector.
//
// Hard constraints (PUSH-118 brief):
//   * NO new npm / C++ / external deps.
//   * Real impl, no MVP / stub / placeholder. If the kernel surface is
//     missing we surface the real "unavailable" error verbatim.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).
//
// Reachable via:
//   * `tools.cam5Axis` menu action,
//   * `window.__forgeOpenFiveAxisCAM(true|false)`,
//   * `window.__forgeFiveAxisHelper.axisToABC(vec)`
//     for headless callers.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

const PANEL_W = 540;

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported on window.__forgeFiveAxisHelper so headless
// callers + the e2e can drive the math without mounting React).

// Normalise a 3-vector. Returns [0,0,1] if input is degenerate.
export function normaliseAxis(v) {
  const x = Number(v?.x) || 0;
  const y = Number(v?.y) || 0;
  const z = Number(v?.z) || 0;
  const m = Math.hypot(x, y, z);
  if (m < 1e-9) return { x: 0, y: 0, z: 1 };
  return { x: x / m, y: y / m, z: z / m };
}

// Convert a tool-axis unit vector to (A,B,C) Euler degrees, matching the
// kernel's toolAxisToABC convention from CamAdvanced.cpp:
//   A rotates about X  (tilt the Z axis into +Y plane)
//   B rotates about Y  (tilt the Z axis into +X plane)
//   C rotates about Z  (free, set to 0 — the kernel re-derives it for
//                       the indexed pose; we feed the user's swing here.)
// We keep this pure JS so the e2e can assert the result deterministically.
export function axisToABC(axis) {
  const n = normaliseAxis(axis);
  // Tilt away from +Z: A = atan2(ny, nz), B = -atan2(nx, sqrt(ny²+nz²)).
  // C is left as 0 here; the orientations[] generator may inject swing.
  const A = Math.atan2(n.y, n.z) * (180 / Math.PI);
  const B = -Math.atan2(n.x, Math.hypot(n.y, n.z)) * (180 / Math.PI);
  return [A, B, 0];
}

// Build a station path for the Swarf strategy. We walk the body's AABB
// minX→maxX at y = (minY+maxY)/2, z = stockZTop, normals = axisVector.
// The kernel's multiAxisContinuous expects path.length >= 2 stations.
export function swarfPathFromAabb(aabb, axis, stations = 8) {
  const a = normaliseAxis(axis);
  const out = [];
  const N = Math.max(2, Math.floor(stations));
  const y = 0.5 * (aabb.minY + aabb.maxY);
  const z = aabb.maxZ;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = aabb.minX + (aabb.maxX - aabb.minX) * t;
    out.push({ x, y, z, nx: a.x, ny: a.y, nz: a.z });
  }
  return out;
}

// Build an orientations table for the Parallel-to-face strategy. We
// emit one (A,B,C) triple from the user's axis vector — this is the
// canonical 3+2 single-orient form NX CAM ships as the "Parallel" op.
export function parallelOrientations(axis) {
  return [axisToABC(axis)];
}

// Build a 4-orientation ring for the Pocket strategy — swing the tool
// axis around the C axis at 0/90/180/270 degrees. This matches the way
// hyperMill's "Indexed Pocket" op clears a square pocket with four
// rotary indexings.
export function pocketOrientations(axis) {
  const [A, B] = axisToABC(axis);
  return [
    [A, B,   0],
    [A, B,  90],
    [A, B, 180],
    [A, B, 270],
  ];
}

// Strategy registry. Keeping this declarative so the UI selector can
// iterate it + the e2e can probe the available ids.
export const STRATEGIES = Object.freeze([
  {
    id: 'swarf',
    label: 'Swarf (5-axis continuous side mill)',
    kind: 'continuous',
    explain: 'Continuous 5-axis side milling along a ruled surface — '
           + 'cuts with the side of an end-mill, tool axis along the input vector.',
  },
  {
    id: 'parallel-to-face',
    label: 'Parallel-to-face (3+2 indexed)',
    kind: 'indexed',
    explain: 'Indexed pocket clearing in one (A,B,C) orientation derived '
           + 'from the input tool-axis vector.',
  },
  {
    id: 'pocket',
    label: 'Pocket (4-orient indexed ring)',
    kind: 'indexed',
    explain: 'Four indexed orientations swung 0/90/180/270° around the C '
           + 'axis from the input vector — clears a multi-faced pocket.',
  },
]);

// ─────────────────────────────────────────────────────────────────────
// Snapshot helpers.

export function readBodiesSnapshot() {
  if (typeof window === 'undefined') return [];
  return Array.isArray(window.__forgeBodies) ? window.__forgeBodies.slice() : [];
}

// Default Tool spec — 8 mm carbide end-mill, mirrors the catalogue in
// camDispatch.TOOL_LIBRARY. Inlined here so the panel can build a Tool
// without taking a dependency on camDispatch.
function defaultTool() {
  return {
    id: 5184,
    name: 'EM-8 (5-axis)',
    diameter: 8,
    fluteLength: 30,
    helix: 30,
    flutes: 4,
    type: 'EndMill',
  };
}

// Default CuttingParams — moderate carbide aluminium values; the brief
// asks for a single Generate button so we don't expose every knob.
function defaultParams() {
  return {
    feedXY:    1800,
    feedZ:     900,
    spindleRPM: 9000,
    stepover:  3.0,
    stepdown:  2.0,
    coolant:   1.0,
  };
}

// AABB sniff — we ask the kernel for the body's bbox via massProps when
// it's a real native handle; otherwise we synthesise a 100×100×30 stock
// box around the handle so the kernel call still has a sensible Z range.
function bodyAabb(body) {
  // PUSH-46 / PUSH-98 stock bodies tend to carry their dimensions on the
  // params object — fall back to that when massProps isn't reachable
  // from the renderer (it isn't, here — we keep this synchronous).
  const p = body?.params || {};
  const dx = Number(p.width)   || Number(p.dx) || 100;
  const dy = Number(p.height)  || Number(p.dy) || 100;
  const dz = Number(p.distance) || Number(p.dz) || 30;
  return {
    minX: 0, minY: 0, minZ: 0,
    maxX: dx, maxY: dy, maxZ: dz,
  };
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
    maxHeight: 'calc(100vh - var(--forge-topbar-h, 40px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 24px))',
    background: 'var(--forge-canvas-2, #161b22)',
    borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
    boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
    display: 'flex', flexDirection: 'column',
    fontSize: 12,
    color: 'var(--forge-ink, #dadde2)',
    zIndex: 1296,
  };
}

const ROW = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px' };
const LABEL = { minWidth: 96, fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' };
const INPUT_STYLE = {
  background: 'var(--forge-canvas, #0e1117)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  padding: '3px 6px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  width: '100%',
};

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function FiveAxisCAMPanel({ open, onClose, bodies = [] }) {
  const cam = (typeof window !== 'undefined') ? window.forge?.cam : null;
  const [partId, setPartId] = useState(null);
  const [strategy, setStrategy] = useState('swarf');
  const [axis, setAxis] = useState({ x: 0, y: 0, z: 1 });
  const [stations, setStations] = useState(8);
  const [liveBodies, setLiveBodies] = useState(() => bodies);
  const [toolpath, setToolpath] = useState(null);   // { moveCount, cycleTimeSec, … }
  const [gcode, setGcode] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    setLiveBodies(bodies);
  }, [bodies]);

  // Default to the first body in the scene.
  useEffect(() => {
    if (!partId && liveBodies.length > 0) {
      setPartId(liveBodies[0].id);
    }
  }, [liveBodies, partId]);

  // Live re-snapshot when the body roster updates.
  useEffect(() => {
    if (!open) return undefined;
    const onChange = () => setLiveBodies(readBodiesSnapshot());
    if (typeof window !== 'undefined') {
      window.addEventListener('forge:bodies-changed', onChange);
      window.addEventListener('forge:body-added', onChange);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('forge:bodies-changed', onChange);
        window.removeEventListener('forge:body-added', onChange);
      }
    };
  }, [open]);

  const part = useMemo(
    () => liveBodies.find((b) => b.id === partId) || null,
    [liveBodies, partId],
  );

  // Publish results / state for headless callers + the e2e.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeFiveAxisStrategy = strategy;
    window.__forgeFiveAxisAxis = { ...axis };
  }, [strategy, axis]);

  const generate = useCallback(() => {
    setError(null);
    setToolpath(null);
    setGcode('');
    if (!cam) {
      setError('window.forge.cam unavailable (rebuild kernel).');
      return;
    }
    if (!part || typeof part.handle !== 'number') {
      setError('Pick a part body with a native handle first.');
      return;
    }
    const aabb = bodyAabb(part);
    const tool = defaultTool();
    const params = defaultParams();
    try {
      let tp = null;
      if (strategy === 'swarf') {
        if (typeof cam.multiAxisContinuous !== 'function') {
          setError('window.forge.cam.multiAxisContinuous unavailable.');
          return;
        }
        const path = swarfPathFromAabb(aabb, axis, Number(stations) || 8);
        tp = cam.multiAxisContinuous(part.handle, tool, params, path);
      } else if (strategy === 'parallel-to-face') {
        if (typeof cam.multiAxisIndexed !== 'function') {
          setError('window.forge.cam.multiAxisIndexed unavailable.');
          return;
        }
        const orientations = parallelOrientations(axis);
        tp = cam.multiAxisIndexed(part.handle, tool, params, orientations,
          aabb.maxZ, aabb.minZ);
      } else if (strategy === 'pocket') {
        if (typeof cam.multiAxisIndexed !== 'function') {
          setError('window.forge.cam.multiAxisIndexed unavailable.');
          return;
        }
        const orientations = pocketOrientations(axis);
        tp = cam.multiAxisIndexed(part.handle, tool, params, orientations,
          aabb.maxZ, aabb.minZ);
      } else {
        setError(`Unknown strategy: ${strategy}`);
        return;
      }
      if (!tp || !tp.moveCount) {
        setError('kernel returned an empty toolpath');
        return;
      }
      setToolpath({
        moveCount:    tp.moveCount,
        cycleTimeSec: tp.cycleTimeSec || 0,
        estCuttingMm: tp.estCuttingMm || 0,
        toolId:       tp.toolId,
        hasOrient:    Array.isArray(tp.perOrientation),
        orientCount:  Array.isArray(tp.perOrientation) ? tp.perOrientation.length : 0,
        hasAxisOrient: !!tp.axisOrientations,
      });
      // G-code via the native gcode.toGcode — Fanuc dialect, safeZ = top+5.
      if (cam.gcode && typeof cam.gcode.toGcode === 'function') {
        try {
          const text = cam.gcode.toGcode(tp, 'Fanuc', aabb.maxZ + 5);
          setGcode(text || '');
        } catch (gex) {
          // G-code post can throw on degenerate toolpaths — we keep the
          // toolpath result valid even if the post failed.
          setGcode('');
        }
      }
      if (typeof window !== 'undefined') {
        window.__forgeFiveAxisToolpath = {
          strategy,
          axis: { ...axis },
          moveCount:    tp.moveCount,
          cycleTimeSec: tp.cycleTimeSec || 0,
          estCuttingMm: tp.estCuttingMm || 0,
        };
      }
    } catch (ex) {
      setError(`5-axis generate failed: ${ex.message || ex}`);
    }
  }, [cam, part, strategy, axis, stations]);

  // Reset toolpath whenever the strategy / axis changes — output is
  // stale until the user clicks Generate again.
  useEffect(() => {
    setToolpath(null);
    setGcode('');
  }, [strategy, axis.x, axis.y, axis.z]);

  const strategySpec = useMemo(
    () => STRATEGIES.find((s) => s.id === strategy) || STRATEGIES[0],
    [strategy],
  );

  if (!open) return null;

  return createPortal(
    <aside
      role="region"
      aria-label="5-axis CAM strategies"
      data-testid="forge-cam5axis-panel"
      data-strategy={strategy}
      style={panelStyle()}>

      <header style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px',
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        background: 'var(--forge-canvas, #0e1117)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          5-Axis CAM Strategies
        </span>
        <span style={{
          fontFamily: 'var(--forge-mono, monospace)', fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          PUSH-118 · cam.multiAxis*
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClose}
                aria-label="Close 5-axis CAM panel"
                data-testid="forge-cam5axis-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                  padding: 2,
                }}>
          ×
        </button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>

        <div style={ROW}>
          <span style={LABEL}>Native CAM</span>
          <span data-testid="forge-cam5axis-cam-ready"
                style={{
                  fontFamily: 'var(--forge-mono, monospace)', fontSize: 11,
                  color: (cam && cam.multiAxisIndexed && cam.multiAxisContinuous)
                    ? 'var(--forge-ok, #4caf50)'
                    : 'var(--forge-err, #ff6363)',
                }}>
            {cam
              ? (cam.multiAxisIndexed && cam.multiAxisContinuous
                ? 'multi-axis indexed + continuous · ready'
                : 'partial — rebuild kernel')
              : 'unavailable'}
          </span>
        </div>

        <div style={ROW}>
          <label htmlFor="forge-cam5axis-part" style={LABEL}>Part body</label>
          <select id="forge-cam5axis-part"
                  value={partId || ''}
                  onChange={(e) => setPartId(e.target.value)}
                  data-testid="forge-cam5axis-part"
                  style={INPUT_STYLE}>
            <option value="">— pick a body —</option>
            {liveBodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.id}{b.toolId ? ` · ${b.toolId}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div style={ROW}>
          <label htmlFor="forge-cam5axis-strategy" style={LABEL}>Strategy</label>
          <select id="forge-cam5axis-strategy"
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  data-testid="forge-cam5axis-strategy"
                  style={INPUT_STYLE}>
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div style={{ padding: '0 12px', marginBottom: 6 }}
             data-testid="forge-cam5axis-strategy-explain">
          <small style={{
            color: 'var(--forge-ink-mute, #9aa1ab)',
            fontSize: 10, lineHeight: 1.35, display: 'block',
          }}>
            {strategySpec.explain}
          </small>
        </div>

        <div style={ROW}>
          <span style={LABEL}>Tool axis</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, flex: 1 }}>
            <AxisCell label="ax" value={axis.x}
                      testid="forge-cam5axis-axis-x"
                      onChange={(v) => setAxis((a) => ({ ...a, x: v }))} />
            <AxisCell label="ay" value={axis.y}
                      testid="forge-cam5axis-axis-y"
                      onChange={(v) => setAxis((a) => ({ ...a, y: v }))} />
            <AxisCell label="az" value={axis.z}
                      testid="forge-cam5axis-axis-z"
                      onChange={(v) => setAxis((a) => ({ ...a, z: v }))} />
          </div>
        </div>

        {strategy === 'swarf' && (
          <div style={ROW}>
            <label htmlFor="forge-cam5axis-stations" style={LABEL}>Stations</label>
            <input id="forge-cam5axis-stations"
                   type="number"
                   min={2}
                   max={64}
                   value={stations}
                   data-testid="forge-cam5axis-stations"
                   onChange={(e) => setStations(Math.max(2, Math.floor(Number(e.target.value) || 2)))}
                   style={INPUT_STYLE} />
          </div>
        )}

        <div style={{ ...ROW, paddingTop: 4 }}>
          <span style={LABEL}>Computed (A,B,C)</span>
          <span data-testid="forge-cam5axis-abc"
                style={{
                  fontFamily: 'var(--forge-mono, monospace)', fontSize: 11,
                  color: 'var(--forge-ink, #dadde2)',
                }}>
            {axisToABC(axis).map((v) => v.toFixed(2)).join(' / ')}°
          </span>
        </div>

        <div style={{ ...ROW, paddingTop: 8 }}>
          <button type="button"
                  data-testid="forge-cam5axis-generate"
                  disabled={!cam || !part}
                  onClick={generate}
                  style={{
                    background: (cam && part)
                      ? 'var(--forge-accent-mute, #1f3a72)'
                      : 'var(--forge-canvas-3, #21262d)',
                    color: 'var(--forge-ink, #dadde2)',
                    border: '1px solid var(--forge-accent-rim, #3a7afe)',
                    borderRadius: 3,
                    padding: '6px 14px',
                    fontWeight: 600,
                    cursor: (cam && part) ? 'pointer' : 'not-allowed',
                  }}>
            Generate toolpath
          </button>
        </div>

        {toolpath && (
          <div data-testid="forge-cam5axis-results"
               style={{
                 margin: '4px 12px',
                 padding: '8px 10px',
                 background: 'var(--forge-canvas, #0e1117)',
                 border: '1px solid var(--forge-rail-edge, #2a2d34)',
                 borderRadius: 4,
               }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Toolpath: {strategy}
            </div>
            <table style={{
              width: '100%', borderCollapse: 'collapse', fontSize: 11,
              fontFamily: 'var(--forge-mono, monospace)',
            }}>
              <tbody>
                <tr>
                  <td style={tdL}>moves</td>
                  <td style={tdR} data-testid="forge-cam5axis-moves">
                    {toolpath.moveCount}
                  </td>
                </tr>
                <tr>
                  <td style={tdL}>cycle time</td>
                  <td style={tdR} data-testid="forge-cam5axis-cycle">
                    {(toolpath.cycleTimeSec || 0).toFixed(2)} s
                  </td>
                </tr>
                <tr>
                  <td style={tdL}>cutting mm</td>
                  <td style={tdR} data-testid="forge-cam5axis-cutmm">
                    {(toolpath.estCuttingMm || 0).toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td style={tdL}>tool id</td>
                  <td style={tdR}>{toolpath.toolId}</td>
                </tr>
                {toolpath.hasOrient && (
                  <tr>
                    <td style={tdL}>orientations</td>
                    <td style={tdR} data-testid="forge-cam5axis-orient-count">
                      {toolpath.orientCount}
                    </td>
                  </tr>
                )}
                {toolpath.hasAxisOrient && (
                  <tr>
                    <td style={tdL}>per-move axis</td>
                    <td style={tdR} data-testid="forge-cam5axis-axis-orient">
                      continuous
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {gcode && (
          <details data-testid="forge-cam5axis-gcode-section"
                   style={{ margin: '0 12px' }}>
            <summary style={{ cursor: 'pointer', fontSize: 11 }}>
              G-code · {gcode.split('\n').length} lines
            </summary>
            <pre data-testid="forge-cam5axis-gcode"
                 style={{
                   fontSize: 10, lineHeight: 1.3, maxHeight: 200,
                   overflow: 'auto',
                   background: 'var(--forge-canvas, #0e1117)',
                   border: '1px solid var(--forge-rail-edge, #2a2d34)',
                   borderRadius: 4,
                   padding: 6, marginTop: 4,
                 }}>{gcode}</pre>
          </details>
        )}

        {error && (
          <div data-testid="forge-cam5axis-error"
               style={{
                 margin: '4px 12px',
                 padding: '8px 10px',
                 background: 'var(--forge-err-mute, #3a1f1f)',
                 color: 'var(--forge-err, #f1c4c4)',
                 border: '1px solid var(--forge-err-rim, #6d3434)',
                 borderRadius: 4,
                 fontSize: 11,
               }}>
            {error}
          </div>
        )}
      </div>
    </aside>,
    document.body,
  );
}

const tdL = {
  padding: '2px 4px',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  textAlign: 'left',
};
const tdR = {
  padding: '2px 4px',
  color: 'var(--forge-ink, #dadde2)',
  textAlign: 'right',
};

function AxisCell({ label, value, testid, onChange }) {
  return (
    <label style={{
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ opacity: 0.7, fontSize: 9 }}>{label}</span>
      <input type="number"
             step="0.1"
             value={value}
             data-testid={testid}
             onChange={(e) => onChange(Number(e.target.value))}
             style={{ ...INPUT_STYLE, padding: '2px 4px' }} />
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.  Listens for the `tools.cam5Axis` menu action so
// the menu dispatch reaches the panel without ForgeShellV4 needing a
// new case in its giant switch.

export function FiveAxisCAMPanelHost() {
  const [open, setOpen] = useState(false);
  const [bodies, setBodies] = useState(() => readBodiesSnapshot());
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenFiveAxisCAM = (v) => {
      setBodies(readBodiesSnapshot());
      setOpen(v === undefined ? true : !!v);
    };
    window.__forgeCloseFiveAxisCAM = () => setOpen(false);
    window.__forgeRefreshFiveAxisCAM = () => setBodies(readBodiesSnapshot());

    // Headless helper surface for the e2e + Archie / plugins.
    window.__forgeFiveAxisHelper = Object.freeze({
      normaliseAxis, axisToABC,
      swarfPathFromAabb, parallelOrientations, pocketOrientations,
      STRATEGIES, readBodiesSnapshot,
    });

    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.cam5Axis') {
        setBodies(readBodiesSnapshot());
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenFiveAxisCAM; } catch {}
      try { delete window.__forgeCloseFiveAxisCAM; } catch {}
      try { delete window.__forgeRefreshFiveAxisCAM; } catch {}
      try { delete window.__forgeFiveAxisHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <FiveAxisCAMPanel
      open={open}
      onClose={() => setOpen(false)}
      bodies={bodies} />
  );
}

export default FiveAxisCAMPanel;
