// Forge-165 — Lattice / metamaterial Workbench.
//
// Floating panel exposing the TPMS implicit-surface generator and the
// strut-truss generator from latticeGenerator.js.
//
// Layout:
//   ┌─────────────────────────────────────────────┐
//   │ header · TPMS | Strut tabs · close          │
//   ├─────────────────────────────────────────────┤
//   │ TPMS tab:                                   │
//   │   surface picker (6 options)                │
//   │   cell size (mm)    isovalue                │
//   │   resolution (16/32/64/128)                 │
//   │   volume-fraction target (%)                │
//   │ Strut tab:                                  │
//   │   pattern picker (6 options)                │
//   │   strut radius (mm)                         │
//   │   gradient (uniform/linear/radial)          │
//   │ Solid material (steel/Ti/Al/PA12) — drives  │
//   │   Gibson-Ashby estimate                     │
//   │ [ Generate ]                                │
//   ├─────────────────────────────────────────────┤
//   │ Output:                                     │
//   │   ρ_relative    volume fraction      mass   │
//   │   E_eff / E_solid   E_eff (GPa)             │
//   │   σ_y,eff / σ_y,solid                       │
//   │   triangles / vertices                      │
//   └─────────────────────────────────────────────┘
//
// React #185 hygiene:
//   * `useSyncExternalStore` snapshots are cached against a numeric
//     version counter so React sees a stable reference.
//   * The host's effect deps array is `[]` — listeners attach exactly
//     once. Manual UI never writes to Archie's thread.

import React, {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import {
  LatticeDispatch,
  TPMS_LIBRARY, STRUT_LIBRARY,
  generateTpmsMesh, generateStrutLattice,
  estimateGibsonAshby, createLatticeBody,
} from './latticeGenerator.js';

/* ================================================================== */
/*  small lattice store                                               */
/* ================================================================== */

let _state = {
  mode:    'tpms',        // 'tpms' | 'strut'
  mesh:    null,          // last generated mesh record
  output:  null,          // { rhoRel, volumeFraction, eRatio, eEffGPa,
                          //   syRatio, sigmaYEffMPa, mass_g, ... }
  body:    null,          // last registered body
  pending: null,
};
let _version = 0;
const _subs = new Set();
let _cachedSnap = null;
let _cachedSnapVer = -1;

function notify() {
  _version++;
  for (const fn of _subs) { try { fn(); } catch {} }
}

const STORE = {
  subscribe(cb) { _subs.add(cb); return () => _subs.delete(cb); },
  getSnapshot() {
    if (_cachedSnap && _cachedSnapVer === _version) return _cachedSnap;
    _cachedSnap = {
      mode:    _state.mode,
      mesh:    _state.mesh,
      output:  _state.output,
      body:    _state.body,
      pending: _state.pending,
      version: _version,
    };
    _cachedSnapVer = _version;
    return _cachedSnap;
  },
};

function setMode(mode)        { _state = { ..._state, mode };       notify(); }
function setMesh(mesh)        { _state = { ..._state, mesh };       notify(); }
function setOutput(output)    { _state = { ..._state, output };     notify(); }
function setBody(body)        { _state = { ..._state, body };       notify(); }
function setPending(msg)      { _state = { ..._state, pending: msg }; notify(); }

/* ================================================================== */
/*  solid material catalogue (drives Gibson-Ashby parent values)      */
/* ================================================================== */

const SOLID_MATERIALS = [
  { id: 'steel',  label: 'Steel (S235)',        E: 210, sigmaY: 235, rho: 7.85 },
  { id: 'ti6al4v',label: 'Titanium (Ti6Al4V)',  E: 114, sigmaY: 880, rho: 4.43 },
  { id: 'al7075', label: 'Aluminium (7075-T6)', E:  72, sigmaY: 503, rho: 2.81 },
  { id: 'pa12',   label: 'Nylon (PA12)',        E:   1.7, sigmaY: 48, rho: 1.01 },
  { id: 'inconel',label: 'Inconel 718',         E: 200, sigmaY: 1035,rho: 8.19 },
];
// E in GPa, sigmaY in MPa, rho in g/cm³.

/* ================================================================== */
/*  body picker — synth body has mesh inline, native has handle       */
/* ================================================================== */

/* ================================================================== */
/*  TPMS / Strut form panels                                          */
/* ================================================================== */

function NumberRow({ label, value, onChange, step = 0.1, min, max, testid, suffix }) {
  return (
    <label style={rowStyle}>
      <span style={labelCellStyle}>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        data-testid={testid}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        style={numInputStyle}
      />
      {suffix ? <span style={suffixStyle}>{suffix}</span> : null}
    </label>
  );
}

function SelectRow({ label, value, onChange, options, testid }) {
  return (
    <label style={rowStyle}>
      <span style={labelCellStyle}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
        style={selectStyle}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function TpmsForm(props) {
  const {
    surface, setSurface, cellMm, setCellMm,
    isovalue, setIsovalue, resolution, setResolution,
    targetVolumeFrac, setTargetVolumeFrac,
  } = props;
  return (
    <div data-testid="forge-lattice-tpms-form" style={formStyle}>
      <SelectRow
        label="Surface"
        testid="forge-lattice-tpms-surface"
        value={surface}
        onChange={setSurface}
        options={TPMS_LIBRARY.map((s) => ({ value: s.id, label: s.label }))}
      />
      <NumberRow
        label="Cell size"
        testid="forge-lattice-tpms-cell"
        value={cellMm}
        onChange={setCellMm}
        step={0.5} min={0.5} max={500}
        suffix="mm"
      />
      <NumberRow
        label="Isovalue"
        testid="forge-lattice-tpms-iso"
        value={isovalue}
        onChange={setIsovalue}
        step={0.05} min={-1.5} max={1.5}
      />
      <SelectRow
        label="Resolution"
        testid="forge-lattice-tpms-res"
        value={String(resolution)}
        onChange={(v) => setResolution(parseInt(v, 10))}
        options={[
          { value: '16',  label: '16 (preview)' },
          { value: '32',  label: '32 (standard)' },
          { value: '64',  label: '64 (fine)' },
          { value: '128', label: '128 (production)' },
        ]}
      />
      <NumberRow
        label="ρ target"
        testid="forge-lattice-tpms-vf"
        value={targetVolumeFrac}
        onChange={setTargetVolumeFrac}
        step={0.01} min={0.05} max={0.95}
        suffix="(0–1)"
      />
    </div>
  );
}

function StrutForm(props) {
  const {
    pattern, setPattern, cellMm, setCellMm,
    radiusMm, setRadiusMm, gradient, setGradient,
    segments, setSegments,
  } = props;
  return (
    <div data-testid="forge-lattice-strut-form" style={formStyle}>
      <SelectRow
        label="Pattern"
        testid="forge-lattice-strut-pattern"
        value={pattern}
        onChange={setPattern}
        options={STRUT_LIBRARY.map((s) => ({ value: s.id, label: s.label }))}
      />
      <NumberRow
        label="Cell size"
        testid="forge-lattice-strut-cell"
        value={cellMm}
        onChange={setCellMm}
        step={0.5} min={0.5} max={500}
        suffix="mm"
      />
      <NumberRow
        label="Strut radius"
        testid="forge-lattice-strut-radius"
        value={radiusMm}
        onChange={setRadiusMm}
        step={0.05} min={0.05} max={50}
        suffix="mm"
      />
      <SelectRow
        label="Gradient"
        testid="forge-lattice-strut-gradient"
        value={gradient}
        onChange={setGradient}
        options={[
          { value: 'uniform', label: 'Uniform' },
          { value: 'linear',  label: 'Linear (+Z)' },
          { value: 'radial',  label: 'Radial (centre→edge)' },
        ]}
      />
      <NumberRow
        label="Segments"
        testid="forge-lattice-strut-segments"
        value={segments}
        onChange={(v) => setSegments(Math.max(3, Math.min(64, Math.round(v))))}
        step={1} min={3} max={64}
        suffix="per strut"
      />
    </div>
  );
}

function OutputCard({ output, theme }) {
  if (!output) {
    return (
      <div data-testid="forge-lattice-output-empty"
           style={outputEmptyStyle(theme)}>
        Click <b>Generate</b> to compute the lattice.
      </div>
    );
  }
  const rhoRelPct = (output.rhoRel * 100).toFixed(2);
  return (
    <div data-testid="forge-lattice-output" style={outputStyle(theme)}>
      <Row k="ρ relative"
           v={`${output.rhoRel.toFixed(4)} (${rhoRelPct} %)`}
           testid="forge-lattice-out-rho" />
      <Row k="Volume fraction (mesh)"
           v={output.meshVolumeFraction != null
              ? output.meshVolumeFraction.toFixed(4) : '—'}
           testid="forge-lattice-out-vf" />
      <Row k="Mass"
           v={output.mass_g != null ? `${output.mass_g.toFixed(3)} g` : '—'}
           testid="forge-lattice-out-mass" />
      <hr style={hrStyle} />
      <Row k="Gibson-Ashby C"
           v={output.C.toFixed(3)}
           testid="forge-lattice-out-C" />
      <Row k="Gibson-Ashby n"
           v={output.n.toFixed(3)}
           testid="forge-lattice-out-n" />
      <Row k="E_eff / E_solid"
           v={output.eRatio.toFixed(5)}
           testid="forge-lattice-out-Eratio" />
      <Row k="E_eff"
           v={output.eEffGPa != null
              ? `${output.eEffGPa.toFixed(3)} GPa` : '—'}
           testid="forge-lattice-out-Eeff" />
      <Row k="σ_y,eff"
           v={output.sigmaYEffMPa != null
              ? `${output.sigmaYEffMPa.toFixed(2)} MPa` : '—'}
           testid="forge-lattice-out-sy" />
      <hr style={hrStyle} />
      <Row k="Triangles"
           v={String(output.triangles)}
           testid="forge-lattice-out-tris" />
      <Row k="Vertices"
           v={String(output.vertices)}
           testid="forge-lattice-out-verts" />
      {output.surfaceArea != null ? (
        <Row k="Surface area"
             v={`${output.surfaceArea.toFixed(2)} mm²`}
             testid="forge-lattice-out-area" />
      ) : null}
      {output.strutCount != null ? (
        <Row k="Strut count"
             v={String(output.strutCount)}
             testid="forge-lattice-out-struts" />
      ) : null}
    </div>
  );
}

function Row({ k, v, testid }) {
  return (
    <div data-testid={testid} style={rowOut}>
      <span style={{ opacity: 0.65 }}>{k}</span>
      <span style={{ fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
        {v}
      </span>
    </div>
  );
}

/* ================================================================== */
/*  workbench                                                         */
/* ================================================================== */

export function LatticeWorkbench({ open = true, theme = 'dark', onClose }) {
  const snap = useSyncExternalStore(STORE.subscribe, STORE.getSnapshot,
                                    STORE.getSnapshot);

  // Form state
  const [surface,       setSurface]       = useState('gyroid');
  const [cellMm,        setCellMm]        = useState(10);
  const [isovalue,      setIsovalue]      = useState(0);
  const [resolution,    setResolution]    = useState(32);
  const [targetVF,      setTargetVF]      = useState(0.5);

  const [pattern,       setPattern]       = useState('octet');
  const [strutCellMm,   setStrutCellMm]   = useState(10);
  const [radiusMm,      setRadiusMm]      = useState(0.5);
  const [gradient,      setGradient]      = useState('uniform');
  const [segments,      setSegments]      = useState(12);

  const [solidMatId,    setSolidMatId]    = useState('ti6al4v');
  const solidMat = useMemo(
    () => SOLID_MATERIALS.find((m) => m.id === solidMatId) || SOLID_MATERIALS[0],
    [solidMatId],
  );

  const mode = snap.mode;

  // Publish dispatch + store on window for tests / Archie console.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeLatticeDispatch = LatticeDispatch;
    window.__forgeLatticeStore    = STORE;
  }, []);

  // Publish current mesh + output (read-only — tests inspect).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeLatticeMesh   = snap.mesh;
    window.__forgeLatticeOutput = snap.output;
    window.__forgeLatticeBody   = snap.body;
  }, [snap.version]);

  const onGenerate = useCallback(async () => {
    setPending('Generating…');
    try {
      let mesh, params, topology, kind;
      if (mode === 'tpms') {
        // Optionally tune isovalue to hit target volume fraction by
        // sampling a coarse field and binary-searching. For Forge-165
        // we honour the user's isovalue directly; the achieved
        // volumeFraction is reported back in the stats. This avoids
        // adding a second slow march cycle. The target field is
        // surfaced in the body params for downstream tools.
        mesh = generateTpmsMesh({
          surface, cellMm, isovalue, resolution,
        });
        params = { mode: 'tpms', surface, cellMm, isovalue, resolution,
                   targetVolumeFraction: targetVF };
        topology = surface;
        kind = 'tpms';
      } else {
        mesh = generateStrutLattice({
          pattern, cellMm: strutCellMm, radiusMm, gradient, segments,
        });
        params = { mode: 'strut', pattern, cellMm: strutCellMm,
                   radiusMm, gradient, segments };
        topology = pattern;
        kind = 'strut';
      }
      setMesh({ positions: mesh.positions, indices: mesh.indices });

      // ρ_relative — for strut lattices we use the geometric volume
      // fraction directly. For TPMS the mesher reports the fraction of
      // sample points where f(x,y,z) < isovalue (i.e. solid material).
      const rhoRel = Math.max(1e-3, Math.min(0.999, mesh.stats.volumeFraction));

      // Cell volume in mm³ → mass in g via ρ_solid [g/cm³].
      const cellVol_mm3 = (kind === 'tpms' ? cellMm : strutCellMm) ** 3;
      const cellVol_cm3 = cellVol_mm3 / 1000;
      const mass_g = rhoRel * cellVol_cm3 * solidMat.rho;

      const ga = estimateGibsonAshby({
        kind, topology, rhoRel,
        eSolidGPa: solidMat.E,
        sigmaYSolidMPa: solidMat.sigmaY,
      });

      const output = {
        rhoRel,
        meshVolumeFraction: mesh.stats.volumeFraction,
        mass_g,
        triangles: mesh.stats.triangles,
        vertices:  mesh.stats.vertices,
        surfaceArea: mesh.stats.surfaceArea ?? null,
        strutCount:  mesh.stats.strutCount ?? null,
        C: ga.C, n: ga.n, m: ga.m, Csigma: ga.Csigma,
        eRatio: ga.eRatio, syRatio: ga.syRatio,
        eEffGPa:      ga.eEffGPa,
        sigmaYEffMPa: ga.sigmaYEffMPa,
        solidMat: solidMat.id,
        topology, kind,
      };
      setOutput(output);

      // Register as a body so the feature tree sees it.
      const body = await createLatticeBody({
        mesh,
        label: kind === 'tpms'
          ? `Lattice · ${TPMS_LIBRARY.find((s) => s.id === surface)?.label}`
          : `Lattice · ${STRUT_LIBRARY.find((s) => s.id === pattern)?.label}`,
        params: { ...params, gibsonAshby: { C: ga.C, n: ga.n, eRatio: ga.eRatio } },
      });
      setBody(body);

      setPending(`Generated · ${mesh.stats.triangles} tris · ρ=${rhoRel.toFixed(3)}`);
    } catch (err) {
      setPending(`Generate failed: ${err.message}`);
    }
  }, [mode, surface, cellMm, isovalue, resolution, targetVF,
      pattern, strutCellMm, radiusMm, gradient, segments, solidMat]);

  if (!open) return null;

  return (
    <div className="forge-lattice-workbench"
         data-testid="forge-lattice"
         data-theme={theme}
         style={panelOuter(theme)}>
      <header style={headerStyle(theme)}>
        <span data-testid="forge-lattice-title"
              style={{ fontWeight: 600, letterSpacing: 0.6 }}>
          Lattice / Metamaterial
        </span>
        <span style={{ opacity: 0.7, fontSize: 11 }}
              data-testid="forge-lattice-surface-count">
          {TPMS_LIBRARY.length} TPMS · {STRUT_LIBRARY.length} strut
        </span>
        <span style={{ flex: 1 }} />
        {onClose ? (
          <button type="button"
                  data-tool="lattice.close"
                  data-testid="forge-lattice-close"
                  onClick={onClose}
                  style={btnBase(theme)}>Close</button>
        ) : null}
      </header>

      <nav style={tabBarStyle(theme)} aria-label="Lattice mode">
        <button type="button"
                data-testid="forge-lattice-tab-tpms"
                data-active={String(mode === 'tpms')}
                onClick={() => setMode('tpms')}
                style={tabBtnStyle(theme, mode === 'tpms')}>
          TPMS (implicit)
        </button>
        <button type="button"
                data-testid="forge-lattice-tab-strut"
                data-active={String(mode === 'strut')}
                onClick={() => setMode('strut')}
                style={tabBtnStyle(theme, mode === 'strut')}>
          Strut (truss)
        </button>
      </nav>

      <div style={bodyStyle}>
        <div style={leftColumnStyle}>
          {mode === 'tpms' ? (
            <TpmsForm
              surface={surface}     setSurface={setSurface}
              cellMm={cellMm}       setCellMm={setCellMm}
              isovalue={isovalue}   setIsovalue={setIsovalue}
              resolution={resolution} setResolution={setResolution}
              targetVolumeFrac={targetVF}
              setTargetVolumeFrac={setTargetVF}
            />
          ) : (
            <StrutForm
              pattern={pattern}     setPattern={setPattern}
              cellMm={strutCellMm}  setCellMm={setStrutCellMm}
              radiusMm={radiusMm}   setRadiusMm={setRadiusMm}
              gradient={gradient}   setGradient={setGradient}
              segments={segments}   setSegments={setSegments}
            />
          )}

          <SelectRow
            label="Solid material"
            testid="forge-lattice-solid-mat"
            value={solidMatId}
            onChange={setSolidMatId}
            options={SOLID_MATERIALS.map((m) => ({
              value: m.id,
              label: `${m.label}  ·  E=${m.E} GPa  ·  ρ=${m.rho} g/cm³`,
            }))}
          />

          <button type="button"
                  data-tool="lattice.generate"
                  data-testid="forge-lattice-generate"
                  onClick={onGenerate}
                  style={generateBtnStyle(theme)}>
            Generate lattice body
          </button>
        </div>

        <div style={rightColumnStyle}>
          <OutputCard output={snap.output} theme={theme} />
        </div>
      </div>

      <footer style={footerStyle(theme)}>
        <span data-testid="forge-lattice-status">
          {snap.pending || 'idle'}
        </span>
      </footer>
    </div>
  );
}

/* ================================================================== */
/*  host — auto-opens via tools menu, custom event, or rail click     */
/* ================================================================== */

const LATTICE_PANEL_EVENT = 'forge:open-lattice-panel';

export function LatticeWorkbenchHost() {
  const [open, setOpen]   = useState(false);
  const [theme, setTheme] = useState('dark');
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (typeof window === 'undefined') return;

    window.__forgeOpenLattice = (opts = {}) => {
      if (opts && opts.theme) setTheme(opts.theme);
      setOpen(true);
    };
    window.__forgeCloseLattice = () => setOpen(false);
    window.__forgeLatticeDispatch = LatticeDispatch;
    window.__forgeLatticeStore    = STORE;

    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.theme) setTheme(d.theme);
      setOpen(true);
    };
    window.addEventListener(LATTICE_PANEL_EVENT, onEvt);

    const onClick = (e) => {
      const tab = e.target?.closest?.('[data-wb="lattice"]');
      if (tab) {
        const t = window.__forgeTheme;
        if (t === 'dark' || t === 'light') setTheme(t);
        setOpen(true);
      }
    };
    document.addEventListener('click', onClick, true);

    return () => {
      window.removeEventListener(LATTICE_PANEL_EVENT, onEvt);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  return (
    <LatticeWorkbench open={open}
                      theme={theme}
                      onClose={() => setOpen(false)} />
  );
}

/* ================================================================== */
/*  styling                                                           */
/* ================================================================== */

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
    overflow:    'hidden',
  };
}

function headerStyle(theme) {
  const dark = theme === 'dark';
  return {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '8px 12px',
    borderBottom: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
  };
}

function tabBarStyle(theme) {
  const dark = theme === 'dark';
  return {
    display: 'flex', gap: 4, padding: '6px 10px',
    borderBottom: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
  };
}

function tabBtnStyle(theme, active) {
  const dark = theme === 'dark';
  return {
    background: active
      ? (dark ? '#52462f' : '#d4be7e')
      : (dark ? '#2a241b' : '#e7dcb8'),
    color:      dark ? '#e9d9a8' : '#1a1612',
    border:     `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderBottom: active
      ? `2px solid ${dark ? '#e9d9a8' : '#1a1612'}` : `1px solid transparent`,
    borderRadius: 4,
    padding:    '6px 14px',
    fontSize:   12,
    cursor:     'pointer',
    letterSpacing: 0.3,
    fontWeight: active ? 600 : 400,
  };
}

function btnBase(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#2a241b' : '#e7dcb8',
    color:      dark ? '#e9d9a8' : '#1a1612',
    border:     `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4,
    padding:    '5px 12px',
    fontSize:   12,
    cursor:     'pointer',
    letterSpacing: 0.3,
  };
}

function generateBtnStyle(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#6b562a' : '#c8a851',
    color:      dark ? '#fff2c2' : '#1a1612',
    border:     `1px solid ${dark ? '#a07a30' : '#8e6b1f'}`,
    borderRadius: 4,
    padding:    '8px 14px',
    fontSize:   12,
    cursor:     'pointer',
    letterSpacing: 0.4,
    fontWeight: 600,
    marginTop:  8,
    boxShadow:  '0 2px 6px rgba(0,0,0,0.3)',
  };
}

const bodyStyle = {
  display: 'flex',
  gap: 12,
  padding: '8px 12px',
  flex: 1,
  overflow: 'auto',
};

const leftColumnStyle = {
  flex: '1 1 50%',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const rightColumnStyle = {
  flex: '1 1 50%',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const formStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};

const labelCellStyle = {
  width: 120,
  opacity: 0.78,
  letterSpacing: 0.3,
};

const numInputStyle = {
  width: 80,
  padding: '3px 6px',
  background: 'transparent',
  color: 'inherit',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 3,
  fontSize: 12,
};

const selectStyle = {
  flex: 1,
  padding: '3px 6px',
  background: 'transparent',
  color: 'inherit',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 3,
  fontSize: 12,
};

const suffixStyle = {
  fontSize: 11,
  opacity: 0.6,
};

function outputStyle(theme) {
  const dark = theme === 'dark';
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '10px 12px',
    background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    border: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    borderRadius: 4,
    fontSize: 12,
  };
}

function outputEmptyStyle(theme) {
  return {
    ...outputStyle(theme),
    opacity: 0.55,
    fontStyle: 'italic',
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  };
}

const rowOut = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
};

const hrStyle = {
  border: 'none',
  borderTop: '1px solid rgba(255,255,255,0.10)',
  margin: '4px 0',
};

function footerStyle(theme) {
  const dark = theme === 'dark';
  return {
    padding: '6px 12px',
    borderTop: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    fontSize: 11, opacity: 0.85,
    display: 'flex', gap: 16, alignItems: 'center',
  };
}

export default LatticeWorkbench;
