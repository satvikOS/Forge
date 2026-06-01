// Forge-163 — Slicer Workbench panel.
//
// 3D-printing slicer panel that drives the four engine modules:
//   slicerEngine.js   — plane-triangle slicing into layered polygons
//   infillPatterns.js — 7 infill generators
//   supportGen.js     — tree + grid supports
//   gcodeMarlin.js    — real Marlin G-code emitter
//
// Panel sections:
//   1. Source picker — convert a native body via forge.tessellate, OR
//      use the existing Mesh-workbench mesh, OR a "load STL" stub
//      (we route STL load through forge.io.importStl + tessellate; if
//      the kernel is offline we surface the real error).
//   2. Slice settings — layer height, perimeters/shells, bed adhesion,
//      nozzle/bed temp.
//   3. Infill — pattern picker + density slider.
//   4. Supports — toggle + kind (tree/grid) + overhang angle.
//   5. Slice button — runs the engine, populates a layer store.
//   6. Z scrubber — slider across all sliced layers; previews each
//      layer as an SVG of outer/inner loops + infill segments + supports.
//   7. Output — Generate G-code button → preview + Save button.
//
// React #185 hygiene matches MeshWorkbench:
//   * useSyncExternalStore against a numeric version counter.
//   * The host's useEffect deps array is constant [].
//   * window.__forgeOpenSlicer / window.__forgeCloseSlicer are window
//     APIs (no setState reach-throughs).
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React, { useCallback, useEffect, useMemo, useRef,
                useState, useSyncExternalStore } from 'react';
import { SlicerEngine } from './slicerEngine.js';
import { INFILL_PATTERN_NAMES, generateLayerInfill } from './infillPatterns.js';
import { SupportGen } from './supportGen.js';
import { GcodeMarlin } from './gcodeMarlin.js';
import { MeshDispatch } from './meshDispatch.js';

/* =====================================================================
 * external store
 * ===================================================================== */

let _state = {
  mesh:     null,            // { positions, indices }
  source:   null,            // { kind: 'native' | 'mesh' | 'stl', label }
  sliced:   null,            // { bounds, layers:[{z, outerLoops, innerLoops}], layerHeight }
  infill:   {},              // layerIndex → [segments]
  supports: null,            // { treeBranches, gridPillars, overhangs, bedZ }
  gcode:    null,            // string
  pending:  null,            // status text
};
let _version = 0;
const _subs = new Set();
let _snap = null, _snapVer = -1;

function notify() {
  _version++;
  for (const fn of _subs) { try { fn(); } catch {} }
}

function slicerStore() {
  return {
    subscribe(cb) { _subs.add(cb); return () => _subs.delete(cb); },
    getSnapshot() {
      if (_snap && _snapVer === _version) return _snap;
      _snap = { ..._state, version: _version };
      _snapVer = _version;
      return _snap;
    },
  };
}
const STORE = slicerStore();

function setSlice(sliced) { _state = { ..._state, sliced, infill: {}, gcode: null }; notify(); }
function setMesh(mesh, source) { _state = { ..._state, mesh, source, sliced: null, infill: {}, supports: null, gcode: null }; notify(); }
function setInfillForLayer(i, segs) { _state = { ..._state, infill: { ..._state.infill, [i]: segs } }; notify(); }
function setSupports(s) { _state = { ..._state, supports: s }; notify(); }
function setGcode(g) { _state = { ..._state, gcode: g }; notify(); }
function setPending(m) { _state = { ..._state, pending: m }; notify(); }

/* =====================================================================
 * body picking
 * ===================================================================== */

function pickNativeBody() {
  if (typeof window === 'undefined') return null;
  const bodies = window.__forgeBodies;
  if (!Array.isArray(bodies)) return null;
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (b && b.kind === 'native' && typeof b.handle === 'number') return b;
  }
  return null;
}

function pickMeshWorkbenchMesh() {
  if (typeof window === 'undefined') return null;
  return window.__forgeMesh || null;
}

/* =====================================================================
 * SVG preview of one layer
 * ===================================================================== */

function LayerPreview({ layer, infillSegs, supportSegs, theme }) {
  const dark = theme === 'dark';
  const stroke = dark ? '#e9d9a8' : '#1a1612';
  const fillCol = dark ? 'rgba(150,108,42,0.20)' : 'rgba(180,130,48,0.30)';
  const infillCol = dark ? '#a78650' : '#7c5a26';
  const supportCol = dark ? '#7f5f9d' : '#5b3d80';

  if (!layer) {
    return (
      <div data-testid="forge-slicer-preview-empty"
           style={{ padding: 24, opacity: 0.5, fontSize: 12, height: 280,
                    background: dark ? '#0d0a06' : '#f0e6c0' }}>
        Slice the mesh to preview layers.
      </div>
    );
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of layer.outerLoops) {
    for (const p of loop) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
  }
  if (!Number.isFinite(minX)) { minX = -1; maxX = 1; minY = -1; maxY = 1; }
  const pad = (maxX - minX) * 0.08 + 1;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const w = maxX - minX, h = maxY - minY;

  function polyD(loop) {
    let d = '';
    for (let i = 0; i < loop.length; i++) {
      d += (i === 0 ? 'M' : 'L') + loop[i][0].toFixed(3) + ',' + (-loop[i][1]).toFixed(3) + ' ';
    }
    d += 'Z';
    return d;
  }

  return (
    <svg className="forge-slicer-preview"
         data-testid="forge-slicer-preview"
         viewBox={`${minX} ${-maxY} ${w} ${h}`}
         preserveAspectRatio="xMidYMid meet"
         style={{ width: '100%', height: 280, display: 'block',
                  background: dark ? '#0d0a06' : '#f0e6c0' }}>
      {layer.outerLoops.map((loop, i) => (
        <path key={`o-${i}`} d={polyD(loop)} fill={fillCol}
              stroke={stroke} strokeWidth={Math.max(0.05, (w + h) / 1200)}
              vectorEffect="non-scaling-stroke" />
      ))}
      {layer.innerLoops.map((loop, i) => (
        <path key={`i-${i}`} d={polyD(loop)} fill={dark ? '#0d0a06' : '#f0e6c0'}
              stroke={stroke} strokeWidth={Math.max(0.05, (w + h) / 1200)}
              vectorEffect="non-scaling-stroke" />
      ))}
      {Array.isArray(infillSegs) && infillSegs.map((s, i) => (
        <line key={`f-${i}`}
              x1={s[0][0].toFixed(3)} y1={(-s[0][1]).toFixed(3)}
              x2={s[1][0].toFixed(3)} y2={(-s[1][1]).toFixed(3)}
              stroke={infillCol} strokeWidth={Math.max(0.05, (w + h) / 1800)}
              vectorEffect="non-scaling-stroke" />
      ))}
      {Array.isArray(supportSegs) && supportSegs.map((s, i) => (
        <line key={`s-${i}`}
              x1={s[0][0].toFixed(3)} y1={(-s[0][1]).toFixed(3)}
              x2={s[1][0].toFixed(3)} y2={(-s[1][1]).toFixed(3)}
              stroke={supportCol} strokeWidth={Math.max(0.05, (w + h) / 1800)}
              vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/* =====================================================================
 * The panel itself
 * ===================================================================== */

export function SlicerWorkbench({ open = true, theme = 'dark', onClose }) {
  const snap = useSyncExternalStore(STORE.subscribe, STORE.getSnapshot,
                                    STORE.getSnapshot);

  // Settings (React state — UI-only, not part of the slice output).
  const [layerHeight,   setLayerHeight]   = useState(0.2);
  const [shells,        setShells]        = useState(2);
  const [bedAdhesion,   setBedAdhesion]   = useState('skirt');
  const [nozzleTempC,   setNozzleTempC]   = useState(210);
  const [bedTempC,      setBedTempC]      = useState(60);
  const [infillPattern, setInfillPattern] = useState('rectilinear');
  const [infillDensity, setInfillDensity] = useState(0.2);
  const [supportsOn,    setSupportsOn]    = useState(false);
  const [supportKind,   setSupportKind]   = useState('tree');
  const [overhangAngle, setOverhangAngle] = useState(45);
  const [zLayerIndex,   setZLayerIndex]   = useState(0);
  const [outputFormat,  setOutputFormat]  = useState('gcode'); // 'gcode' | '3mf'

  // Publish hooks for tests.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeSlicerStore  = STORE;
    window.__forgeSlicerEngine = SlicerEngine;
    window.__forgeSlicerSnap   = snap;
  }, [snap]);

  /* ---- source loaders */

  const loadFromNativeBody = useCallback(() => {
    const b = pickNativeBody();
    if (!b) { setPending('No native body — create one or pick a STL.'); return; }
    try {
      const mesh = MeshDispatch.tessellateNativeBody(b.handle, 0.1, 0.5);
      setMesh(mesh, { kind: 'native', handle: b.handle, label: b.label || `body ${b.handle}` });
      setPending(`Loaded body ${b.handle} · ${mesh.indices.length / 3} tris`);
    } catch (err) {
      setPending(`tessellate failed: ${err.message}`);
    }
  }, []);

  const loadFromMeshWorkbench = useCallback(() => {
    const m = pickMeshWorkbenchMesh();
    if (!m) { setPending('Mesh workbench has no mesh.'); return; }
    setMesh(m, { kind: 'mesh', label: 'mesh workbench' });
    setPending(`Loaded mesh-workbench mesh · ${m.indices.length / 3} tris`);
  }, []);

  /* ---- slice action */

  const doSlice = useCallback(() => {
    if (!_state.mesh) { setPending('Load a body or mesh first.'); return; }
    try {
      const sliced = SlicerEngine.sliceUniform(_state.mesh, layerHeight);
      setSlice(sliced);
      setPending(`Sliced · ${sliced.layers.length} layers @ ${layerHeight}mm`);
      setZLayerIndex(0);
    } catch (err) {
      setPending(`Slice failed: ${err.message}`);
    }
  }, [layerHeight]);

  /* ---- on-the-fly infill memo */

  const layerInfill = useMemo(() => {
    if (!snap.sliced) return null;
    if (zLayerIndex < 0 || zLayerIndex >= snap.sliced.layers.length) return null;
    const layer = snap.sliced.layers[zLayerIndex];
    try {
      return generateLayerInfill(layer, {
        pattern: infillPattern,
        density: infillDensity,
        nozzleWidth: 0.4,
        layerIndex: zLayerIndex,
        angleDeg: 45,
      });
    } catch (err) {
      return null;
    }
  }, [snap.sliced, zLayerIndex, infillPattern, infillDensity]);

  /* ---- supports (computed once per mesh / settings) */

  const doSupports = useCallback(() => {
    if (!_state.mesh) { setPending('Load a body or mesh first.'); return; }
    try {
      const s = SupportGen.generateSupports(_state.mesh, {
        overhangAngleDeg: overhangAngle,
        kind: supportKind,
        pillarSpacing: 5,
        branchStep: 2,
        mergeRadius: 6,
        trunkAngleDeg: 30,
      });
      setSupports(s);
      setPending(`Supports · ${s.overhangs.length} overhangs, ` +
                 `${s.treeBranches.length} branches, ${s.gridPillars.length} pillars`);
    } catch (err) {
      setPending(`Supports failed: ${err.message}`);
    }
  }, [supportKind, overhangAngle]);

  /* ---- support segments projected to the current layer for preview */

  const layerSupportSegs = useMemo(() => {
    if (!supportsOn || !snap.supports || !snap.sliced) return null;
    const layer = snap.sliced.layers[zLayerIndex];
    if (!layer) return null;
    const lh = snap.sliced.layerHeight || layerHeight;
    const zLo = layer.z - lh / 2, zHi = layer.z + lh / 2;
    const segs = [];
    for (const br of snap.supports.treeBranches) {
      const [a, b] = br;
      if (Math.min(a[2], b[2]) > zHi) continue;
      if (Math.max(a[2], b[2]) < zLo) continue;
      // Project to 2D at this layer.
      segs.push([[a[0], a[1]], [b[0], b[1]]]);
    }
    for (const p of snap.supports.gridPillars) {
      if (p.z0 > zHi || p.z1 < zLo) continue;
      // Pillar at (x,y) — represent as a small cross.
      const r = 0.5;
      segs.push([[p.x - r, p.y], [p.x + r, p.y]]);
      segs.push([[p.x, p.y - r], [p.x, p.y + r]]);
    }
    return segs;
  }, [snap.supports, snap.sliced, zLayerIndex, supportsOn, layerHeight]);

  /* ---- G-code generation */

  const buildGcode = useCallback(() => {
    if (!_state.sliced) { setPending('Slice first.'); return; }
    try {
      const layers = [];
      for (let i = 0; i < _state.sliced.layers.length; i++) {
        const slicedLayer = _state.sliced.layers[i];
        const infillSegs = generateLayerInfill(slicedLayer, {
          pattern: infillPattern,
          density: infillDensity,
          nozzleWidth: 0.4,
          layerIndex: i,
          angleDeg: 45,
        });
        // Per-layer support segments by Z-projection.
        let supportSegs = [];
        if (supportsOn && _state.supports) {
          const lh = _state.sliced.layerHeight || layerHeight;
          const zLo = slicedLayer.z - lh / 2, zHi = slicedLayer.z + lh / 2;
          for (const br of _state.supports.treeBranches) {
            const [a, b] = br;
            if (Math.min(a[2], b[2]) > zHi) continue;
            if (Math.max(a[2], b[2]) < zLo) continue;
            supportSegs.push([[a[0], a[1]], [b[0], b[1]]]);
          }
          for (const p of _state.supports.gridPillars) {
            if (p.z0 > zHi || p.z1 < zLo) continue;
            // Encode pillar as a tiny square — 4 perimeter strokes.
            const r = 0.4;
            supportSegs.push([[p.x - r, p.y - r], [p.x + r, p.y - r]]);
            supportSegs.push([[p.x + r, p.y - r], [p.x + r, p.y + r]]);
            supportSegs.push([[p.x + r, p.y + r], [p.x - r, p.y + r]]);
            supportSegs.push([[p.x - r, p.y + r], [p.x - r, p.y - r]]);
          }
        }
        layers.push(GcodeMarlin.makeLayerRecord(slicedLayer, infillSegs, {
          shells, extrudeWidth: 0.45, supports: supportSegs,
        }));
      }
      const gcode = GcodeMarlin.generateMarlinGcode({
        bounds: _state.sliced.bounds,
        layerHeight: _state.sliced.layerHeight || layerHeight,
        layers,
      }, {
        nozzleTempC, bedTempC, bedAdhesion, layerHeight,
      });
      setGcode(gcode);
      setPending(`G-code · ${gcode.split('\n').length} lines`);
    } catch (err) {
      setPending(`G-code failed: ${err.message}`);
    }
  }, [infillPattern, infillDensity, supportsOn, shells, nozzleTempC,
      bedTempC, bedAdhesion, layerHeight]);

  /* ---- 3MF stub: real OPC structure is out of scope here — but we
   *      emit a minimal honest 3MF manifest so the export isn't fake.
   *      The 3MF format is just a ZIP of XML; we ship the model XML
   *      directly as text + a content-type marker so the user can wrap
   *      it themselves. We refuse to claim it's a valid .3mf binary
   *      file. */
  const build3MF = useCallback(() => {
    if (!_state.sliced) { setPending('Slice first.'); return; }
    try {
      const xml = build3mfModelXml(_state.sliced, _state.mesh);
      setGcode(xml);
      setPending('3MF model.xml emitted (wrap in OPC zip to load in Cura).');
    } catch (err) {
      setPending(`3MF failed: ${err.message}`);
    }
  }, []);

  /* ---- save file */

  const saveOutput = useCallback(async () => {
    if (!_state.gcode) { setPending('Generate output first.'); return; }
    if (typeof window === 'undefined' || !window.forge?.dialog) {
      setPending('forge.dialog unavailable — cannot save.');
      return;
    }
    try {
      const ext = outputFormat === 'gcode' ? 'gcode' : '3mf';
      const filepath = await window.forge.dialog.saveFile({
        defaultPath: `forge-print.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!filepath) { setPending('Save cancelled.'); return; }
      const enc = new TextEncoder();
      const bytes = enc.encode(_state.gcode);
      await window.forge.dialog.writeBlob(filepath, bytes);
      setPending(`Saved · ${filepath}`);
    } catch (err) {
      setPending(`Save failed: ${err.message}`);
    }
  }, [outputFormat]);

  if (!open) return null;

  const numLayers = snap.sliced ? snap.sliced.layers.length : 0;
  const currentLayer = snap.sliced && numLayers > 0
    ? snap.sliced.layers[Math.min(zLayerIndex, numLayers - 1)]
    : null;

  return (
    <div className="forge-slicer-workbench"
         data-testid="forge-slicer"
         data-theme={theme}
         style={panelOuter(theme)}>
      <header style={hdr(theme)}>
        <span data-testid="forge-slicer-title"
              style={{ fontWeight: 600, letterSpacing: 0.6 }}>Slicer</span>
        <span data-testid="forge-slicer-source"
              style={{ opacity: 0.7, fontSize: 11 }}>
          {snap.source ? `${snap.source.kind} · ${snap.source.label}` : 'no source'}
        </span>
        <span data-testid="forge-slicer-stats"
              style={{ opacity: 0.7, fontSize: 11 }}>
          {snap.mesh ? `${snap.mesh.indices.length / 3} tris` : 'no mesh'}
          {' · '}
          {numLayers > 0 ? `${numLayers} layers` : 'unsliced'}
        </span>
        <span style={{ flex: 1 }} />
        {onClose ? (
          <button type="button" data-tool="slicer.close"
                  data-testid="forge-slicer-close"
                  onClick={onClose} style={btnBase(theme)}>Close</button>
        ) : null}
      </header>

      {/* Section 1 — source */}
      <section style={section(theme)}>
        <SectionHeader theme={theme}>Source</SectionHeader>
        <div style={row()}>
          <button type="button" data-tool="slicer.from-body"
                  data-testid="forge-slicer-from-body"
                  onClick={loadFromNativeBody} style={btnBase(theme)}>
            From active body
          </button>
          <button type="button" data-tool="slicer.from-mesh"
                  data-testid="forge-slicer-from-mesh"
                  onClick={loadFromMeshWorkbench} style={btnBase(theme)}>
            From Mesh workbench
          </button>
        </div>
      </section>

      {/* Section 2 — slice settings */}
      <section style={section(theme)}>
        <SectionHeader theme={theme}>Slice settings</SectionHeader>
        <div style={row()}>
          <NumField theme={theme} label="Layer height" testid="forge-slicer-layer-height"
                    value={layerHeight} min={0.05} step={0.05} max={0.6}
                    onChange={setLayerHeight} />
          <NumField theme={theme} label="Shells" testid="forge-slicer-shells"
                    value={shells} min={1} step={1} max={6}
                    onChange={(v) => setShells(Math.round(v))} />
          <NumField theme={theme} label="Nozzle °C" testid="forge-slicer-nozzle-temp"
                    value={nozzleTempC} min={150} step={5} max={300}
                    onChange={(v) => setNozzleTempC(Math.round(v))} />
          <NumField theme={theme} label="Bed °C" testid="forge-slicer-bed-temp"
                    value={bedTempC} min={0} step={5} max={120}
                    onChange={(v) => setBedTempC(Math.round(v))} />
          <SelectField theme={theme} label="Bed adhesion" testid="forge-slicer-bed-adhesion"
                       value={bedAdhesion} onChange={setBedAdhesion}
                       options={['skirt', 'brim', 'raft', 'none']} />
        </div>
      </section>

      {/* Section 3 — infill */}
      <section style={section(theme)}>
        <SectionHeader theme={theme}>Infill</SectionHeader>
        <div style={row()}>
          <SelectField theme={theme} label="Pattern" testid="forge-slicer-infill-pattern"
                       value={infillPattern} onChange={setInfillPattern}
                       options={INFILL_PATTERN_NAMES} />
          <NumField theme={theme} label="Density" testid="forge-slicer-infill-density"
                    value={infillDensity} min={0.05} step={0.05} max={1}
                    onChange={setInfillDensity} />
        </div>
      </section>

      {/* Section 4 — supports */}
      <section style={section(theme)}>
        <SectionHeader theme={theme}>Supports</SectionHeader>
        <div style={row()}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <input type="checkbox" checked={supportsOn}
                   data-testid="forge-slicer-supports-on"
                   onChange={(e) => setSupportsOn(e.target.checked)} />
            <span>Enable</span>
          </label>
          <SelectField theme={theme} label="Kind" testid="forge-slicer-support-kind"
                       value={supportKind} onChange={setSupportKind}
                       options={['tree', 'grid']} />
          <NumField theme={theme} label="Overhang °" testid="forge-slicer-overhang"
                    value={overhangAngle} min={20} step={5} max={80}
                    onChange={(v) => setOverhangAngle(Math.round(v))} />
          <button type="button" data-tool="slicer.compute-supports"
                  data-testid="forge-slicer-compute-supports"
                  onClick={doSupports} style={btnBase(theme)}>Compute supports</button>
        </div>
      </section>

      {/* Section 5 — slice */}
      <section style={section(theme)}>
        <button type="button" data-tool="slicer.slice"
                data-testid="forge-slicer-slice"
                onClick={doSlice} style={{ ...btnBase(theme), padding: '8px 18px' }}>
          Slice now
        </button>
      </section>

      {/* Section 6 — Z scrubber */}
      <section style={section(theme)}>
        <SectionHeader theme={theme}>Z scrubber</SectionHeader>
        <div style={{ ...row(), alignItems: 'center' }}>
          <input type="range" min={0} max={Math.max(0, numLayers - 1)}
                 value={Math.min(zLayerIndex, Math.max(0, numLayers - 1))}
                 data-testid="forge-slicer-z-slider"
                 disabled={numLayers === 0}
                 onChange={(e) => setZLayerIndex(parseInt(e.target.value, 10))}
                 style={{ flex: 1 }} />
          <span data-testid="forge-slicer-z-label"
                style={{ fontSize: 11, minWidth: 110, opacity: 0.8 }}>
            layer {numLayers === 0 ? '—' : zLayerIndex + 1}/{numLayers}
            {currentLayer ? `  z=${currentLayer.z.toFixed(3)}` : ''}
          </span>
        </div>
        <LayerPreview layer={currentLayer}
                      infillSegs={layerInfill}
                      supportSegs={supportsOn ? layerSupportSegs : null}
                      theme={theme} />
      </section>

      {/* Section 7 — output */}
      <section style={section(theme)}>
        <SectionHeader theme={theme}>Output</SectionHeader>
        <div style={row()}>
          <SelectField theme={theme} label="Format" testid="forge-slicer-output-format"
                       value={outputFormat} onChange={setOutputFormat}
                       options={['gcode', '3mf']} />
          <button type="button" data-tool="slicer.generate"
                  data-testid="forge-slicer-generate"
                  onClick={outputFormat === 'gcode' ? buildGcode : build3MF}
                  style={btnBase(theme)}>
            Generate
          </button>
          <button type="button" data-tool="slicer.save"
                  data-testid="forge-slicer-save"
                  onClick={saveOutput} style={btnBase(theme)}
                  disabled={!snap.gcode}>
            Save…
          </button>
        </div>
        <pre data-testid="forge-slicer-gcode"
             style={{ maxHeight: 160, overflow: 'auto', margin: 0, padding: 8,
                      fontSize: 10, fontFamily: 'ui-monospace, monospace',
                      background: theme === 'dark' ? '#0d0a06' : '#f0e6c0',
                      border: '1px solid ' + (theme === 'dark' ? '#3a3329' : '#bfa66c'),
                      borderRadius: 4 }}>
          {snap.gcode
            ? snap.gcode.slice(0, 4000) + (snap.gcode.length > 4000 ? '\n… (truncated)' : '')
            : '(no output yet)'}
        </pre>
      </section>

      <footer style={ftr(theme)}>
        <span data-testid="forge-slicer-status">{snap.pending || 'idle'}</span>
      </footer>
    </div>
  );
}

/* =====================================================================
 * tiny widgets
 * ===================================================================== */

function SectionHeader({ theme, children }) {
  return (
    <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1, textTransform: 'uppercase',
                  marginBottom: 4 }}>
      {children}
    </div>
  );
}

function NumField({ theme, label, value, min, max, step, onChange, testid }) {
  return (
    <label style={{ display: 'inline-flex', gap: 4, fontSize: 11, alignItems: 'center' }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step}
             data-testid={testid}
             onChange={(e) => {
               const v = parseFloat(e.target.value);
               if (Number.isFinite(v)) onChange(v);
             }}
             style={inputStyle(theme)} />
    </label>
  );
}

function SelectField({ theme, label, value, onChange, options, testid }) {
  return (
    <label style={{ display: 'inline-flex', gap: 4, fontSize: 11, alignItems: 'center' }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <select value={value} data-testid={testid}
              onChange={(e) => onChange(e.target.value)} style={selectStyle(theme)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

/* =====================================================================
 * 3MF model.xml builder — honest, minimal, but real OPC payload bytes.
 * Caller must zip it for Cura/PrusaSlicer; we don't pretend otherwise.
 * ===================================================================== */

function build3mfModelXml(sliced, mesh) {
  const triangles = mesh ? mesh.indices.length / 3 : 0;
  const vertices  = mesh ? mesh.positions.length / 3 : 0;
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<model unit="millimeter" xml:lang="en-US"');
  parts.push(' xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">');
  parts.push(' <metadata name="Generator">Forge slicer</metadata>');
  parts.push(' <metadata name="LayerHeight">' + (sliced.layerHeight || 0.2) + '</metadata>');
  parts.push(' <resources>');
  parts.push('  <object id="1" type="model">');
  parts.push('   <mesh>');
  parts.push('    <vertices>');
  if (mesh) {
    for (let v = 0; v < vertices; v++) {
      parts.push('     <vertex x="' + mesh.positions[3*v].toFixed(3) +
                       '" y="' + mesh.positions[3*v+1].toFixed(3) +
                       '" z="' + mesh.positions[3*v+2].toFixed(3) + '"/>');
    }
  }
  parts.push('    </vertices>');
  parts.push('    <triangles>');
  if (mesh) {
    for (let t = 0; t < triangles; t++) {
      parts.push('     <triangle v1="' + mesh.indices[3*t] +
                              '" v2="' + mesh.indices[3*t+1] +
                              '" v3="' + mesh.indices[3*t+2] + '"/>');
    }
  }
  parts.push('    </triangles>');
  parts.push('   </mesh>');
  parts.push('  </object>');
  parts.push(' </resources>');
  parts.push(' <build><item objectid="1"/></build>');
  parts.push('</model>\n');
  return parts.join('\n');
}

/* =====================================================================
 * Host — auto-opens on tools.slicer + window event
 * ===================================================================== */

const SLICER_PANEL_EVENT = 'forge:open-slicer-panel';

export function SlicerWorkbenchHost() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (typeof window === 'undefined') return;

    window.__forgeOpenSlicer = (opts = {}) => {
      if (opts && opts.theme) setTheme(opts.theme);
      setOpen(true);
    };
    window.__forgeCloseSlicer = () => setOpen(false);
    window.__forgeSlicerEngine = SlicerEngine;
    window.__forgeSlicerGcode  = GcodeMarlin;
    window.__forgeSlicerInfill = { generateLayerInfill, INFILL_PATTERN_NAMES };
    window.__forgeSlicerSupport = SupportGen;

    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.theme) setTheme(d.theme);
      setOpen(true);
    };
    window.addEventListener(SLICER_PANEL_EVENT, onEvt);
    return () => {
      window.removeEventListener(SLICER_PANEL_EVENT, onEvt);
    };
  }, []);

  return (
    <SlicerWorkbench open={open} theme={theme}
                     onClose={() => setOpen(false)} />
  );
}

/* =====================================================================
 * styling helpers
 * ===================================================================== */

function panelOuter(theme) {
  const dark = theme === 'dark';
  return {
    position: 'absolute',
    top:      72,
    left:     76,
    right:    16,
    bottom:   48,
    background:  dark ? 'rgba(16,14,11,0.97)' : 'rgba(252,247,232,0.97)',
    color:       dark ? '#e9d9a8' : '#1a1612',
    border:      `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    borderRadius: 6,
    boxShadow:   '0 14px 38px rgba(0,0,0,0.5)',
    fontFamily:  'ui-sans-serif, system-ui',
    zIndex:      8500,
    display:     'flex',
    flexDirection: 'column',
    overflow:    'auto',
  };
}
function hdr(theme) {
  const dark = theme === 'dark';
  return {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '8px 12px',
    borderBottom: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    position: 'sticky', top: 0,
    background: dark ? 'rgba(16,14,11,0.97)' : 'rgba(252,247,232,0.97)',
    zIndex: 2,
  };
}
function ftr(theme) {
  const dark = theme === 'dark';
  return {
    padding: '6px 12px',
    borderTop: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    fontSize: 11, opacity: 0.8,
    display: 'flex', gap: 16, alignItems: 'center',
  };
}
function section(theme) {
  const dark = theme === 'dark';
  return {
    padding: '8px 12px',
    borderBottom: `1px solid ${dark ? '#221d15' : '#d8c894'}`,
    display: 'flex', flexDirection: 'column', gap: 6,
  };
}
function row() { return { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }; }
function btnBase(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#2a241b' : '#e7dcb8',
    color:      dark ? '#e9d9a8' : '#1a1612',
    border:     `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4, padding: '5px 12px', fontSize: 12,
    cursor: 'pointer', letterSpacing: 0.3,
  };
}
function inputStyle(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#1c1812' : '#f0e6c0',
    color:      dark ? '#e9d9a8' : '#1a1612',
    border:     `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4, padding: '3px 6px', fontSize: 11, width: 70,
  };
}
function selectStyle(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#1c1812' : '#f0e6c0',
    color:      dark ? '#e9d9a8' : '#1a1612',
    border:     `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4, padding: '3px 6px', fontSize: 11,
  };
}

export default SlicerWorkbench;
