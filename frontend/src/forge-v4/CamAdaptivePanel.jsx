// PUSH-117 (Slice-85) — CAM Adaptive Clearing strategy panel.
//
// Adaptive clearing is the high-MRR, constant-chip-load roughing
// strategy that replaces conventional zig-zag pocketing in modern HSM
// CAM. Where pocketing emits straight cuts that ramp tool engagement
// from 0 → 100 % at every corner, adaptive clearing traces an
// Archimedean spiral whose feedrate is modulated by the engagement arc
// so the chip load stays roughly constant. forge::cam::adaptiveClear3Axis
// (CamAdvanced.cpp:145, exposed as kernel.cam.adaptiveClear in preload.js
// line 203) implements exactly this; PUSH-117 is the strategy panel that
// drives it from the UI.
//
// What this panel does:
//
//   * Lists every body in window.__forgeBodies + lets the user pick a
//     stock body (the to-be-machined block) AND a part body (the
//     finished geometry the kernel tells the toolpath to clear around).
//   * Tool diameter (mm) — default 6 mm.
//   * Stepover (% of tool Ø) — default 40 %.
//   * Stepdown (mm) — default 3 mm. Doubles as the kernel zStep.
//   * z-top / z-bottom (mm) — adaptive zMax / zMin. Default 20 → 0.
//   * Engagement-arc helix angle (default 3°) + minRadius
//     (default = toolRadius, drives the feed-rate falloff).
//   * Stock AABB — auto-computed from the stock body via either
//     window.forge.tessellate (sum of triangle vertex extents) OR
//     window.forge.getInstanceAABB if the body is an instance. If
//     neither path works the user can override the six numbers by hand
//     in the panel.
//   * Generate → window.forge.cam.adaptiveClear(stock, aabb, tool, params,
//     adaptive) returns a real native toolpath { moveCount, cycleTimeSec,
//     estCuttingMm }. We render it in a small results table.
//   * NO new deps. NO stubs. If forge.cam.adaptiveClear is null we
//     surface the real "unavailable" error verbatim instead of a stub.
//
// Reachable via:
//   * `tools.camAdaptive` menu action (Menus.jsx — Tools section),
//   * `window.__forgeOpenCamAdaptive(true|false)` imperative,
//   * `window.__forgeCamAdaptiveHelper.runAdaptive({...})` headless
//     helper so the e2e + Archie / plugins can drive the kernel call
//     without mounting React.
//
// Does NOT post to Archie's thread, does NOT auto-open the Archie dock
// (Forge-manual-not-Archie rule for manual UI clicks).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

const PANEL_W = 560;
const STORAGE_KEY = 'forge.v4.camAdaptive.lastParams';

// ─────────────────────────────────────────────────────────────────────
// Native-tool defaults — match the catalogue in camDispatch.TOOL_LIBRARY
// so the kernel sees the same numbers the rest of the CAM workbench
// uses. Inlined here so the panel does not take a dependency on the
// camDispatch module (which pulls in twenty other strategies).

export function adaptiveDefaults({ diameter = 6 } = {}) {
  return {
    diameter,
    stepoverPct: 40,                  // % of tool Ø
    stepdown:    3,                   // mm — kernel zStep
    zTop:        20,                  // mm — adaptive.zMax
    zBottom:     0,                   // mm — adaptive.zMin
    helixAngle:  3,                   // deg
    minRadius:   diameter * 0.5,      // mm — feed-rate falloff floor
    feedXY:      1200,                // mm/min
    feedZ:       300,                 // mm/min
    spindleRPM:  16000,
  };
}

export function nativeAdaptiveTool(diameter) {
  return {
    id: 217000 + Math.round(diameter * 100),
    name: `Adaptive Ø${diameter}`,
    diameter,
    fluteLength: Math.max(20, diameter * 6),
    helix: 35,
    flutes: 4,
    type: 'EndMill',
  };
}

export function nativeCuttingParams(d, p) {
  return {
    feedXY:     Number(p.feedXY) || 1200,
    feedZ:      Number(p.feedZ)  || 300,
    spindleRPM: Number(p.spindleRPM) || 16000,
    stepover:   (Number(d) || 6) * ((Number(p.stepoverPct) || 40) / 100),
    stepdown:   Number(p.stepdown) || 3,
    coolant:    1.0,
  };
}

export function nativeAdaptiveParams(d, p) {
  return {
    stepover:   (Number(d) || 6) * ((Number(p.stepoverPct) || 40) / 100),
    zMax:       Number(p.zTop)    || 20,
    zMin:       Number(p.zBottom) || 0,
    helixAngle: Number(p.helixAngle) || 3,
    minRadius:  Number(p.minRadius)  || (Number(d) || 6) * 0.5,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Stock AABB autocompute. Three fallbacks, in order of preference:
//   1. body.aabb already on the body record (some seed paths attach it),
//   2. window.forge.tessellate(handle) → walk vertex extents,
//   3. user-supplied manual numbers from the panel inputs.

export function computeStockAabb(body) {
  if (!body) return null;
  if (body.aabb && body.aabb.length === 6) {
    return Float64Array.from(body.aabb);
  }
  const handle = body.handle;
  const forge = (typeof window !== 'undefined') ? window.forge : null;
  if (handle && forge && typeof forge.tessellate === 'function') {
    try {
      const mesh = forge.tessellate(handle, 0.05, 0.05);
      const verts = mesh?.positions || mesh?.vertices || mesh?.coords;
      if (verts && verts.length >= 3) {
        let minX =  Infinity, minY =  Infinity, minZ =  Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i + 2 < verts.length; i += 3) {
          const x = verts[i], y = verts[i + 1], z = verts[i + 2];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
        if (isFinite(minX) && minX <= maxX) {
          return Float64Array.from([minX, minY, minZ, maxX, maxY, maxZ]);
        }
      }
    } catch (_) { /* fall through */ }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Headless run helper. Used by the e2e + Archie. Returns the native
// toolpath shape: { ok, moveCount, cycleTimeSec, cuttingLengthMm, error? }.

export function runAdaptive({ stock, part, params }) {
  const forge = (typeof window !== 'undefined') ? window.forge : null;
  const cam   = forge && forge.cam;
  if (!cam || typeof cam.adaptiveClear !== 'function') {
    return { ok: false,
             error: 'window.forge.cam.adaptiveClear unavailable (rebuild kernel)' };
  }
  if (!stock || stock.handle == null) {
    return { ok: false, error: 'stock body missing or has no handle' };
  }
  let aabb = params && params.aabb ? params.aabb : computeStockAabb(stock);
  if (!aabb) {
    return { ok: false, error: 'stock AABB unavailable — please override manually' };
  }
  if (!(aabb instanceof Float64Array)) aabb = Float64Array.from(aabb);
  const d = Number(params.diameter) || 6;
  const tool   = nativeAdaptiveTool(d);
  const cut    = nativeCuttingParams(d, params);
  const ap     = nativeAdaptiveParams(d, params);
  // Kernel needs the part shape passed via the first arg (it carves the
  // toolpath around the part inside the stock AABB).
  const shape  = (part && part.handle != null) ? part.handle : stock.handle;
  try {
    const tp = cam.adaptiveClear(shape, aabb, tool, cut, ap);
    if (!tp) return { ok: false, error: 'kernel returned null toolpath' };
    return {
      ok: true,
      moveCount: tp.moveCount || 0,
      cycleTimeSec: tp.cycleTimeSec || 0,
      cuttingLengthMm: tp.estCuttingMm || 0,
      raw: tp,
    };
  } catch (ex) {
    return { ok: false, error: ex && ex.message ? ex.message : String(ex) };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Panel.

function panelStyle() {
  return {
    position: 'fixed',
    top: 96,
    right: 24,
    width: PANEL_W,
    maxHeight: '84vh',
    background: '#181a1f',
    color: '#dadde2',
    border: '1px solid #2a2d34',
    borderRadius: 10,
    fontSize: 12,
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 6px 22px rgba(0,0,0,0.45)',
    zIndex: 952,
    display: 'flex', flexDirection: 'column',
  };
}

const th = { textAlign: 'left', padding: '3px 5px',
             borderBottom: '1px solid #2a2d34', fontWeight: 600 };
const td = { padding: '3px 5px', borderBottom: '1px solid #20232a' };

export function CamAdaptivePanel({ onClose }) {
  const [bodies, setBodies] = useState(() =>
    (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies))
      ? window.__forgeBodies.slice() : []);
  const [stockId, setStockId] = useState(null);
  const [partId, setPartId]   = useState(null);
  const [params, setParams]   = useState(() => {
    try {
      const raw = (typeof window !== 'undefined')
        ? window.localStorage?.getItem(STORAGE_KEY) : null;
      if (raw) return { ...adaptiveDefaults(), ...JSON.parse(raw) };
    } catch (_) {}
    return adaptiveDefaults();
  });
  const [aabbOverride, setAabbOverride] = useState(null); // manual stock AABB
  const [result, setResult] = useState(null);
  const [error,  setError]  = useState(null);
  const [aabbStatus, setAabbStatus] = useState('');

  const cam = (typeof window !== 'undefined' && window.forge) ? window.forge.cam : null;

  // Live body roster — same pattern as DrillingPatternPanel.
  useEffect(() => {
    const refresh = () => {
      if (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies)) {
        setBodies(window.__forgeBodies.slice());
      }
    };
    refresh();
    if (typeof window !== 'undefined') {
      window.addEventListener('forge:bodies-changed', refresh);
      window.addEventListener('forge:body-added', refresh);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('forge:bodies-changed', refresh);
        window.removeEventListener('forge:body-added', refresh);
      }
    };
  }, []);

  // Auto-pick the first two bodies (stock then part). If only one
  // body is present, it's both stock and part — the kernel still
  // returns a valid toolpath because the part shape lives inside the
  // stock AABB and the spiral simply clears the whole bbox.
  useEffect(() => {
    if (!stockId && bodies.length > 0) setStockId(bodies[0].id);
    if (!partId && bodies.length > 1) setPartId(bodies[1].id);
    else if (!partId && bodies.length > 0) setPartId(bodies[0].id);
  }, [bodies, stockId, partId]);

  const stock = useMemo(() => bodies.find((b) => b.id === stockId) || null,
    [bodies, stockId]);
  const part  = useMemo(() => bodies.find((b) => b.id === partId)  || null,
    [bodies, partId]);

  // Recompute the auto-AABB whenever the stock changes — the user can
  // still override by editing the six numeric inputs below.
  useEffect(() => {
    if (!stock) { setAabbStatus(''); return; }
    const a = computeStockAabb(stock);
    if (a) {
      setAabbStatus(`auto · ${a[3] - a[0] |0}×${a[4] - a[1] |0}×${a[5] - a[2] |0}`);
      setAabbOverride(Array.from(a));
    } else {
      setAabbStatus('auto unavailable — enter manually');
      setAabbOverride([0, 0, 0, 100, 100, 30]);
    }
  }, [stock]);

  const updateParam = useCallback((key, value) => {
    setParams((p) => {
      const next = { ...p, [key]: Number(value) };
      try {
        if (typeof window !== 'undefined') {
          window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
        }
      } catch (_) {}
      return next;
    });
  }, []);

  const onGenerate = useCallback(() => {
    setResult(null);
    setError(null);
    if (!cam || typeof cam.adaptiveClear !== 'function') {
      setError('window.forge.cam.adaptiveClear unavailable (rebuild kernel).');
      return;
    }
    if (!stock || stock.handle == null) {
      setError('Pick a stock body before generating.');
      return;
    }
    const aabb = aabbOverride && aabbOverride.length === 6
      ? Float64Array.from(aabbOverride.map((n) => Number(n) || 0))
      : computeStockAabb(stock);
    const r = runAdaptive({
      stock, part,
      params: { ...params, aabb },
    });
    if (!r.ok) { setError(r.error); return; }
    setResult({
      moveCount:        r.moveCount,
      cycleTimeSec:     r.cycleTimeSec,
      cuttingLengthMm:  r.cuttingLengthMm,
    });
    // Publish for headless e2e + Archie consumers.
    try { window.__forgeCamAdaptiveResult = r; } catch (_) {}
  }, [cam, stock, part, params, aabbOverride]);

  return createPortal(
    <div data-testid="forge-cam-adaptive-panel" style={panelStyle()}>
      <Header onClose={onClose} cam={!!cam} bodies={bodies.length} />
      <div style={{ padding: 10, overflowY: 'auto' }}>

        <Row label="Stock body">
          <select data-testid="forge-cam-adaptive-stock"
                  value={stockId || ''}
                  onChange={(e) => setStockId(e.target.value)}
                  style={selStyle}>
            <option value="">— pick a body —</option>
            {bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.id}{b.toolId ? ` · ${b.toolId}` : ''}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Part body">
          <select data-testid="forge-cam-adaptive-part"
                  value={partId || ''}
                  onChange={(e) => setPartId(e.target.value)}
                  style={selStyle}>
            <option value="">— pick a body —</option>
            {bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.id}{b.toolId ? ` · ${b.toolId}` : ''}
              </option>
            ))}
          </select>
        </Row>

        <div style={{ marginTop: 8, display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <NumField label="Tool Ø (mm)"
                    testid="forge-cam-adaptive-diameter"
                    value={params.diameter}
                    onChange={(v) => updateParam('diameter', v)} />
          <NumField label="Stepover (%)"
                    testid="forge-cam-adaptive-stepover"
                    value={params.stepoverPct}
                    onChange={(v) => updateParam('stepoverPct', v)} />
          <NumField label="Stepdown (mm)"
                    testid="forge-cam-adaptive-stepdown"
                    value={params.stepdown}
                    onChange={(v) => updateParam('stepdown', v)} />
        </div>

        <div style={{ marginTop: 6, display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <NumField label="z-top (mm)"
                    testid="forge-cam-adaptive-ztop"
                    value={params.zTop}
                    onChange={(v) => updateParam('zTop', v)} />
          <NumField label="z-bottom (mm)"
                    testid="forge-cam-adaptive-zbottom"
                    value={params.zBottom}
                    onChange={(v) => updateParam('zBottom', v)} />
          <NumField label="Helix (deg)"
                    testid="forge-cam-adaptive-helix"
                    value={params.helixAngle}
                    onChange={(v) => updateParam('helixAngle', v)} />
        </div>

        <div style={{ marginTop: 6, display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <NumField label="Min radius (mm)"
                    testid="forge-cam-adaptive-minradius"
                    value={params.minRadius}
                    onChange={(v) => updateParam('minRadius', v)} />
          <NumField label="Feed XY"
                    testid="forge-cam-adaptive-feedxy"
                    value={params.feedXY}
                    onChange={(v) => updateParam('feedXY', v)} />
          <NumField label="RPM"
                    testid="forge-cam-adaptive-rpm"
                    value={params.spindleRPM}
                    onChange={(v) => updateParam('spindleRPM', v)} />
        </div>

        <div data-testid="forge-cam-adaptive-aabb-status"
             style={{ marginTop: 8, opacity: 0.75 }}>
          Stock AABB: {aabbStatus}
        </div>

        {aabbOverride && (
          <div style={{ marginTop: 4, display: 'grid',
                        gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
            {['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'].map((label, i) => (
              <NumField key={label}
                        label={label}
                        testid={`forge-cam-adaptive-aabb-${i}`}
                        value={aabbOverride[i]}
                        onChange={(v) => setAabbOverride((arr) => {
                          const next = (arr || [0,0,0,0,0,0]).slice();
                          next[i] = Number(v);
                          return next;
                        })} />
            ))}
          </div>
        )}

        <button data-testid="forge-cam-adaptive-generate"
                onClick={onGenerate}
                disabled={!cam || !stock}
                style={generateBtnStyle(!!cam && !!stock)}>
          Generate Adaptive Toolpath
        </button>

        {result && (
          <div data-testid="forge-cam-adaptive-results"
               style={{ marginTop: 12, borderTop: '1px solid #2a2d34',
                        paddingTop: 8 }}>
            <strong>Toolpath result</strong>
            <table data-testid="forge-cam-adaptive-results-table"
                   style={{ width: '100%', borderCollapse: 'collapse',
                            marginTop: 4, fontSize: 11 }}>
              <thead style={{ background: '#0e1014' }}>
                <tr>
                  <th style={th}>Metric</th>
                  <th style={th}>Value</th>
                  <th style={th}>Unit</th>
                </tr>
              </thead>
              <tbody>
                <tr data-testid="forge-cam-adaptive-row-moveCount">
                  <td style={td}>Move count</td>
                  <td style={td}
                      data-testid="forge-cam-adaptive-value-moveCount">
                    {result.moveCount}
                  </td>
                  <td style={td}>moves</td>
                </tr>
                <tr data-testid="forge-cam-adaptive-row-cycleTimeSec">
                  <td style={td}>Cycle time</td>
                  <td style={td}
                      data-testid="forge-cam-adaptive-value-cycleTimeSec">
                    {Number(result.cycleTimeSec).toFixed(3)}
                  </td>
                  <td style={td}>s</td>
                </tr>
                <tr data-testid="forge-cam-adaptive-row-cuttingLength">
                  <td style={td}>Cutting length</td>
                  <td style={td}
                      data-testid="forge-cam-adaptive-value-cuttingLength">
                    {Number(result.cuttingLengthMm).toFixed(2)}
                  </td>
                  <td style={td}>mm</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {error && (
          <div data-testid="forge-cam-adaptive-error"
               style={{ marginTop: 10, padding: 8,
                        background: '#3a1f1f', color: '#f1c4c4',
                        border: '1px solid #6d3434', borderRadius: 4 }}>
            {error}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components.

function Header({ onClose, cam, bodies }) {
  return (
    <div style={{
      padding: '8px 12px',
      borderBottom: '1px solid #2a2d34',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <div>
        Adaptive Clearing{' '}
        <span style={{ opacity: 0.55 }}>
          · PUSH-117 · forge.cam.adaptiveClear ·{' '}
          {cam ? 'ready' : 'unavailable'} · {bodies} bodies
        </span>
      </div>
      <button data-testid="forge-cam-adaptive-close"
              onClick={onClose}
              aria-label="Close adaptive clearing panel"
              style={{ background: 'transparent', color: '#dadde2',
                       border: 'none', cursor: 'pointer',
                       fontSize: 16, lineHeight: 1 }}>×</button>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ marginTop: 6, display: 'flex',
                  alignItems: 'center', gap: 6 }}>
      <label style={{ minWidth: 70 }}>{label}:</label>
      {children}
    </div>
  );
}

function NumField({ label, value, onChange, testid }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ opacity: 0.7, fontSize: 10 }}>{label}</span>
      <input type="number"
             data-testid={testid}
             value={value}
             onChange={(e) => onChange(e.target.value)}
             style={{ background: '#0e1014', color: '#dadde2',
                      border: '1px solid #2a2d34', borderRadius: 4,
                      padding: '3px 4px', width: '100%' }} />
    </label>
  );
}

function generateBtnStyle(enabled) {
  return {
    marginTop: 12, padding: '6px 12px',
    background: enabled ? '#2c4d2a' : '#1a1c20',
    color: '#dfeedd',
    border: '1px solid #3a6738',
    borderRadius: 4,
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontWeight: 600,
  };
}

const selStyle = {
  flex: 1, background: '#0e1014', color: '#dadde2',
  border: '1px solid #2a2d34', borderRadius: 4, padding: '3px 4px',
};

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Listens for `tools.camAdaptive` on the
// `forge:menu-action` bus so Menus.jsx does not need a new switch case,
// and exposes window.__forgeOpenCamAdaptive(true|false) + a headless
// helper (window.__forgeCamAdaptiveHelper.runAdaptive(…)).

export function CamAdaptivePanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenCamAdaptive = (v) =>
      setOpen(v === undefined ? true : !!v);
    window.__forgeCloseCamAdaptive = () => setOpen(false);

    // Headless helper for the e2e + Archie / plugins.
    window.__forgeCamAdaptiveHelper = Object.freeze({
      runAdaptive,
      adaptiveDefaults,
      nativeAdaptiveTool,
      nativeCuttingParams,
      nativeAdaptiveParams,
      computeStockAabb,
    });

    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.camAdaptive') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenCamAdaptive; } catch (_) {}
      try { delete window.__forgeCloseCamAdaptive; } catch (_) {}
      try { delete window.__forgeCamAdaptiveHelper; } catch (_) {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (!open) return null;
  return <CamAdaptivePanel onClose={() => setOpen(false)} />;
}

export default CamAdaptivePanelHost;
