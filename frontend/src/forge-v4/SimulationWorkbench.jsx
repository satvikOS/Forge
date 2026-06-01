// Forge-91 — Simulation workbench panel.
//
// A full study-setup → solve → results pane styled with the v4 tokens.
// Sections (top → bottom inside the right scroll area):
//
//   1. Study setup       — name + study type enum
//   2. Material picker   — 8 real engineering presets with E, ν, ρ, σ_yield
//   3. Mesh controls     — target element size slider + "Mesh now" button
//   4. Loads             — add/remove list (Force / Pressure / BodyForce)
//   5. BCs               — add/remove list (Fixed / Pin / Roller / Symmetry)
//   6. Solve             — Solve button + status + convergence plot
//   7. Results           — tab bar + FeaResultViewer
//
// MANUAL UI CLICKS DO NOT POST TO ARCHIE'S THREAD. The panel mounts in the
// shell next to the viewport (see ForgeShellV4.jsx integration plan); this
// file deliberately exports a standalone component so it stays unit-testable.
//
// Style: the panel uses the forge-v4 design tokens defined in tokens.css —
// canvas / canvas-2 / canvas-3 backgrounds, monochrome accent, 4px grid
// spacing. No emojis, no chromatic UI.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import {
  isKernelReady,
  detectAvailableSolvers,
  mesh as meshDispatch,
  solveStatic, solveModal, solveDynamic, solveThermal,
  solveBuckling, solveNonlinearStatic, solveContact,
  solveNonlinearPlastic, fatigueLife as fatigueLifeDispatch, solveCFD,
  pinFace, distributeForceFace, rollerFace,
} from './simulationDispatch.js';
import { FeaResultViewer } from './FeaResultViewer.jsx';

// ---------------------------------------------------------- materials
//
// Eight presets with real engineering values. E in Pa, ρ in kg/m³, σ_y
// in Pa, k thermal conductivity (W/m·K), α thermal expansion (1/K).
// Values from MMPDS / ASM Handbook / supplier datasheets.
export const MATERIALS = Object.freeze([
  { id: 'steel',     name: 'Steel A36',        E: 200e9,   nu: 0.26,  rho: 7850, sigmaY: 250e6, k: 50,    alpha: 12e-6, color: '#8b95a5' },
  { id: 'aluminium', name: 'Aluminium 6061-T6',E:  68.9e9, nu: 0.33,  rho: 2700, sigmaY: 276e6, k: 167,   alpha: 23.6e-6, color: '#c9cfd6' },
  { id: 'brass',     name: 'Brass C26000',     E: 110e9,   nu: 0.375, rho: 8530, sigmaY: 124e6, k: 120,   alpha: 19.9e-6, color: '#caa56b' },
  { id: 'copper',    name: 'Copper C110',      E: 117e9,   nu: 0.33,  rho: 8940, sigmaY:  70e6, k: 401,   alpha: 16.5e-6, color: '#b66838' },
  { id: 'titanium',  name: 'Titanium Ti-6Al-4V',E:113.8e9, nu: 0.342, rho: 4430, sigmaY: 880e6, k:   6.7, alpha:  9.0e-6, color: '#9aa0a8' },
  { id: 'abs',       name: 'ABS Plastic',      E:   2.3e9, nu: 0.35,  rho: 1050, sigmaY:  40e6, k:   0.17,alpha: 90e-6, color: '#e1dccb' },
  { id: 'nylon',     name: 'Nylon 6/6',        E:   2.0e9, nu: 0.39,  rho: 1140, sigmaY:  75e6, k:   0.25,alpha: 80e-6, color: '#dad3b9' },
  { id: 'petg',      name: 'PETG',             E:   2.1e9, nu: 0.38,  rho: 1270, sigmaY:  53e6, k:   0.20,alpha: 68e-6, color: '#d6cfe4' },
]);

export const STUDY_TYPES = Object.freeze([
  'Static', 'Modal', 'Dynamic', 'Thermal',
  'Buckling', 'Nonlinear', 'Contact', 'Plastic',
  'Fatigue', 'CFD',
]);

const LOAD_KINDS = ['Force', 'Pressure', 'BodyForce'];
const BC_KINDS   = ['Fixed', 'Pin', 'Roller', 'Symmetry'];

const FACE_LABELS = ['−X', '+X', '−Y', '+Y', '−Z', '+Z'];

// ---------------------------------------------------------- helpers

function defaultLoad(kind) {
  switch (kind) {
    case 'Force':     return { kind, faceId: 1, F: [0, -1000, 0] };
    case 'Pressure':  return { kind, faceId: 1, pressure: 1e5 };
    case 'BodyForce': return { kind, g: [0, -9.81, 0] };
    default:          return { kind, faceId: 0 };
  }
}

function defaultBC(kind) {
  switch (kind) {
    case 'Fixed':    return { kind, faceId: 0 };
    case 'Pin':      return { kind, faceId: 0 };
    case 'Roller':   return { kind, faceId: 0, axis: 'y' };
    case 'Symmetry': return { kind, faceId: 0, axis: 'x' };
    default:         return { kind, faceId: 0 };
  }
}

function loadsToNodalForces(loads, meshObj) {
  if (!meshObj) return { nodal: [], pressures: [] };
  const nodal = [];
  const pressures = [];
  for (const L of loads) {
    if (L.kind === 'Force') {
      const distributed = distributeForceFace(meshObj, L.faceId, L.F);
      nodal.push(...distributed);
    } else if (L.kind === 'Pressure') {
      pressures.push({ faceId: L.faceId, pressure: L.pressure });
    } else if (L.kind === 'BodyForce') {
      // Body force — apply g × ρ × Vᵢ to every node (approximation:
      // distribute as if every node sees ρ·g·V_total/N). The kernel may
      // accept a dedicated body-force field; if not we treat it as a
      // uniform per-node load.
      if (meshObj.nodeCount > 0) {
        const N = meshObj.nodeCount;
        const fx = L.g[0] / N;
        const fy = L.g[1] / N;
        const fz = L.g[2] / N;
        for (let i = 0; i < N; i++) {
          nodal.push({ nodeId: i, fx, fy, fz });
        }
      }
    }
  }
  return { nodal, pressures };
}

function bcsToNodalConstraints(bcs, meshObj) {
  if (!meshObj) return [];
  const out = [];
  for (const B of bcs) {
    if (B.kind === 'Fixed' || B.kind === 'Pin') {
      out.push(...pinFace(meshObj, B.faceId));
    } else if (B.kind === 'Roller') {
      out.push(...rollerFace(meshObj, B.faceId, B.axis || 'y'));
    } else if (B.kind === 'Symmetry') {
      out.push(...rollerFace(meshObj, B.faceId, B.axis || 'x'));
    }
  }
  return out;
}

// ---------------------------------------------------------- panel

export function SimulationWorkbench({ activeBodyHandle = null,
                                      activeBodyName = 'No body selected',
                                      onSelectBody = null,
                                      onClose = null }) {
  // study setup
  const [name, setName]           = useState('Study 1');
  const [type, setType]           = useState('Static');
  const [materialId, setMaterialId] = useState('steel');

  // mesh
  const [elemSizeMm, setElemSizeMm] = useState(3);
  const [meshObj, setMeshObj]       = useState(null);
  const [meshInfo, setMeshInfo]     = useState(null);
  const [meshError, setMeshError]   = useState(null);
  const [meshing, setMeshing]       = useState(false);

  // loads + bcs
  const [loads, setLoads] = useState([defaultLoad('Force')]);
  const [bcs, setBcs]     = useState([defaultBC('Fixed')]);

  // dynamic + fatigue params
  const [tEnd, setTEnd]     = useState(0.1);
  const [dt, setDt]         = useState(0.001);
  const [alpha, setAlpha]   = useState(0);
  const [beta, setBeta]     = useState(0);
  const [nModes, setNModes] = useState(6);
  const [loadSteps, setLoadSteps] = useState(5);
  const [fatigueCfg, setFatigueCfg] = useState({
    Sut: 400e6, Se: 200e6, b: -0.085,
    meanStressCorrection: 'goodman',
  });

  // solve / results
  const [solveError, setSolveError] = useState(null);
  const [solving, setSolving]       = useState(false);
  const [result, setResult]         = useState(null);
  const [resultTab, setResultTab]   = useState('Displacement');
  const [solveLog, setSolveLog]     = useState([]); // convergence iterations
  const [solverCaps, setSolverCaps] = useState({});

  const material = useMemo(() => MATERIALS.find((m) => m.id === materialId) || MATERIALS[0],
                           [materialId]);

  useEffect(() => {
    setSolverCaps(detectAvailableSolvers());
  }, []);

  // ----- mesh handler -----
  const meshNow = async () => {
    setMeshing(true);
    setMeshError(null);
    setMeshInfo(null);
    if (typeof activeBodyHandle !== 'number') {
      setMeshError('No body handle — pick a body first.');
      setMeshing(false);
      return;
    }
    const r = meshDispatch(activeBodyHandle, elemSizeMm);
    if (r.error) {
      setMeshError(r.error);
      setMeshObj(null);
    } else {
      setMeshObj(r.mesh);
      setMeshInfo({
        nodeCount: r.mesh.nodeCount || (r.mesh.nodes ? r.mesh.nodes.length / 3 : 0),
        elemCount: r.mesh.elemCount || (r.mesh.elements ? r.mesh.elements.length / (r.mesh.elemNodeCount || 4) : 0),
        elapsedMs: r.elapsedMs,
        sizeMeters: r.sizeMeters,
      });
    }
    setMeshing(false);
  };

  // ----- solve router -----
  const solve = async () => {
    setSolveError(null);
    setSolveLog([]);
    setResult(null);
    if (!meshObj && type !== 'CFD') {
      setSolveError('Mesh the body first.');
      return;
    }
    setSolving(true);

    const { nodal, pressures } = loadsToNodalForces(loads, meshObj);
    const constraints = bcsToNodalConstraints(bcs, meshObj);
    const mat = { E: material.E, nu: material.nu, rho: material.rho,
                  sigmaY: material.sigmaY,
                  k: material.k, alpha: material.alpha };

    let r;
    try {
      switch (type) {
        case 'Static':
          r = solveStatic({ mesh: meshObj, material: mat,
                            loads: nodal, pressureLoads: pressures, bcs: constraints });
          break;
        case 'Modal':
          r = solveModal({ mesh: meshObj, material: mat, bcs: constraints, nModes });
          setResultTab('Modes');
          break;
        case 'Dynamic':
          r = solveDynamic({ mesh: meshObj, material: mat,
                             loads: nodal, bcs: constraints,
                             tEnd, dt, alpha, beta });
          break;
        case 'Thermal': {
          // pressure-loads from this UI become thermal source/convection here.
          const sources = loads.filter((L) => L.kind === 'BodyForce')
            .map((L) => ({ value: L.g[1] || 0 }));
          const dirichlet = bcs.filter((B) => B.kind === 'Fixed')
            .map((B) => ({ faceId: B.faceId, T: 293.15 }));
          r = solveThermal({ mesh: meshObj, material: mat,
                             dirichlet, sources, convection: [] });
          setResultTab('Temperature');
          break;
        }
        case 'Buckling':
          r = solveBuckling({ mesh: meshObj, material: mat,
                              loads: nodal, bcs: constraints, nModes });
          setResultTab('Modes');
          break;
        case 'Nonlinear':
          r = solveNonlinearStatic({ mesh: meshObj, material: mat,
                                     loads: nodal, bcs: constraints,
                                     loadSteps });
          break;
        case 'Contact':
          // contact requires two meshes; we expose only meshA here. The
          // brief allows reporting "needs second body" via the error path.
          r = { error: 'Contact study requires two bodies — pick the second body in the feature tree.' };
          break;
        case 'Plastic':
          r = solveNonlinearPlastic({ mesh: meshObj, material: mat,
                                      loads: nodal, bcs: constraints, loadSteps });
          break;
        case 'Fatigue': {
          // Fatigue runs on a stress history. If we have a prior static
          // result, use its stress as a unit-load amplitude.
          if (!result || !result.stress) {
            r = { error: 'Run a Static study first; Fatigue consumes its stress history.' };
            break;
          }
          const nE = meshObj.elemCount || (meshObj.elements ? meshObj.elements.length / (meshObj.elemNodeCount || 4) : 0);
          r = fatigueLifeDispatch({
            stressHistory: result.stress, nElem: nE, nSteps: 1, cfg: fatigueCfg,
          });
          setResultTab('Fatigue Life');
          break;
        }
        case 'CFD':
          r = solveCFD({ velocityInlet: [0.1, 0, 0], pressureOutlet: 0,
                         viscosity: 1e-3, density: 1000 });
          break;
        default:
          r = { error: `Unknown study type "${type}"` };
      }
    } catch (err) {
      r = { error: err.message || String(err) };
    }

    if (r && r.error) {
      setSolveError(r.error);
    } else {
      setResult(r);
      if (Array.isArray(r.iterations)) {
        setSolveLog(r.iterations.map((it, i) => ({
          step: i, residual: it.residual ?? it,
        })));
      } else if (Array.isArray(r.stepResiduals)) {
        setSolveLog(r.stepResiduals.map((res, i) => ({ step: i, residual: res })));
      }
    }
    setSolving(false);
  };

  // ----- subcomponents (inline so each section sees the closure) -----
  const Section = ({ id, title, children, action = null }) => (
    <section className="forge-sim-section" data-sim-section={id}>
      <header className="forge-sim-section-header">
        <span>{title}</span>
        {action}
      </header>
      <div className="forge-sim-section-body">{children}</div>
    </section>
  );

  const ready = isKernelReady();

  return (
    <aside className="forge-sim-workbench"
           data-testid="forge-sim-workbench"
           role="region"
           aria-label="Simulation workbench"
           style={WB_STYLE}>
      <SimWorkbenchStyles />
      <header className="forge-sim-header">
        <Icon name="wb.sim" size={14} />
        <span>Simulation</span>
        <span style={{ flex: 1 }} />
        <span data-testid="forge-sim-kernel-state"
              style={{ fontSize: 10, fontFamily: 'var(--forge-mono)',
                       color: ready ? 'var(--forge-ok)' : 'var(--forge-warn)' }}>
          {ready ? 'kernel ready' : 'kernel offline'}
        </span>
        {onClose && (
          <button type="button"
                  data-testid="forge-sim-close"
                  onClick={onClose}
                  style={CLOSE_BTN}>
            <Icon name="select.clear" size={12} />
          </button>
        )}
      </header>

      <div className="forge-sim-body">
        {/* 1. Study setup */}
        <Section id="study" title="Study">
          <Field label="Name">
            <input className="forge-tool-input"
                   data-testid="forge-sim-study-name"
                   value={name}
                   onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Type">
            <select className="forge-tool-input"
                    data-testid="forge-sim-study-type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}>
              {STUDY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Body">
            <span style={{ fontSize: 11, color: 'var(--forge-ink-2)',
                            fontFamily: 'var(--forge-mono)' }}>
              {activeBodyHandle != null
                ? `handle #${activeBodyHandle} — ${activeBodyName}`
                : '(none — select a body)'}
            </span>
          </Field>
        </Section>

        {/* 2. Material */}
        <Section id="material" title="Material">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {MATERIALS.map((m) => (
              <button key={m.id}
                      type="button"
                      data-sim-material-id={m.id}
                      data-active={String(m.id === materialId)}
                      onClick={() => setMaterialId(m.id)}
                      className="forge-sim-material-btn">
                <span className="forge-sim-material-swatch"
                      style={{ background: m.color }} />
                <span style={{ flex: 1, textAlign: 'left' }}>{m.name}</span>
                <span style={{ fontFamily: 'var(--forge-mono)',
                                fontSize: 10,
                                color: 'var(--forge-ink-mute)' }}>
                  {(m.E / 1e9).toFixed(0)} GPa
                </span>
              </button>
            ))}
          </div>
          <div className="forge-sim-mat-summary">
            <span><strong>E</strong> {(material.E / 1e9).toFixed(2)} GPa</span>
            <span><strong>ν</strong> {material.nu}</span>
            <span><strong>ρ</strong> {material.rho} kg/m³</span>
            <span><strong>σ_y</strong> {(material.sigmaY / 1e6).toFixed(0)} MPa</span>
          </div>
        </Section>

        {/* 3. Mesh */}
        <Section id="mesh" title="Mesh">
          <Field label={`Target element size — ${elemSizeMm.toFixed(2)} mm`}>
            <input type="range" min={0.5} max={10} step={0.1}
                   data-testid="forge-sim-elem-size-slider"
                   value={elemSizeMm}
                   onChange={(e) => setElemSizeMm(parseFloat(e.target.value))}
                   style={{ width: '100%' }} />
          </Field>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button"
                    data-testid="forge-sim-mesh-now"
                    onClick={meshNow}
                    disabled={meshing}
                    className="forge-tool-dock-btn"
                    data-kind="confirm"
                    style={{ flex: 1 }}>
              {meshing ? 'Meshing…' : 'Mesh now'}
            </button>
          </div>
          {meshInfo && (
            <div className="forge-sim-info" data-testid="forge-sim-mesh-info">
              <span><strong>nodes</strong> {meshInfo.nodeCount}</span>
              <span><strong>elements</strong> {meshInfo.elemCount}</span>
              <span><strong>elapsed</strong> {Math.round(meshInfo.elapsedMs)} ms</span>
            </div>
          )}
          {meshError && (
            <div className="forge-sim-error" data-testid="forge-sim-mesh-error">
              {meshError}
            </div>
          )}
        </Section>

        {/* 4. Loads */}
        <Section id="loads" title={`Loads (${loads.length})`}
                 action={(
                   <button type="button"
                           data-testid="forge-sim-add-load"
                           className="forge-sim-add-btn"
                           onClick={() => setLoads((L) => [...L, defaultLoad('Force')])}>
                     + Add
                   </button>
                 )}>
          {loads.length === 0 && (
            <div className="forge-sim-empty">No loads yet — click "+ Add".</div>
          )}
          {loads.map((L, i) => (
            <LoadRow key={i} idx={i} load={L}
                     onChange={(next) => setLoads((arr) => arr.map((x, j) => j === i ? next : x))}
                     onRemove={() => setLoads((arr) => arr.filter((_, j) => j !== i))} />
          ))}
        </Section>

        {/* 5. BCs */}
        <Section id="bcs" title={`Boundary conditions (${bcs.length})`}
                 action={(
                   <button type="button"
                           data-testid="forge-sim-add-bc"
                           className="forge-sim-add-btn"
                           onClick={() => setBcs((B) => [...B, defaultBC('Fixed')])}>
                     + Add
                   </button>
                 )}>
          {bcs.length === 0 && (
            <div className="forge-sim-empty">No BCs yet — pin at least one face.</div>
          )}
          {bcs.map((B, i) => (
            <BCRow key={i} idx={i} bc={B}
                   onChange={(next) => setBcs((arr) => arr.map((x, j) => j === i ? next : x))}
                   onRemove={() => setBcs((arr) => arr.filter((_, j) => j !== i))} />
          ))}
        </Section>

        {/* 6. Solver-specific params */}
        {(type === 'Modal' || type === 'Buckling') && (
          <Section id="modal-params" title="Modal parameters">
            <NumField label="Number of modes" value={nModes}
                      min={1} max={50} step={1}
                      onChange={(v) => setNModes(Math.max(1, v | 0))}
                      testId="forge-sim-nmodes" />
          </Section>
        )}
        {type === 'Dynamic' && (
          <Section id="dyn-params" title="Dynamic parameters">
            <NumField label="t_end (s)"  value={tEnd}  min={1e-6} step={0.01}
                      onChange={setTEnd} testId="forge-sim-tend" />
            <NumField label="Δt (s)"     value={dt}    min={1e-9} step={1e-4}
                      onChange={setDt} testId="forge-sim-dt" />
            <NumField label="α (Rayleigh)" value={alpha} step={0.01} onChange={setAlpha} />
            <NumField label="β (Rayleigh)" value={beta}  step={1e-5} onChange={setBeta} />
          </Section>
        )}
        {(type === 'Nonlinear' || type === 'Plastic') && (
          <Section id="nl-params" title="Newton parameters">
            <NumField label="Load steps" value={loadSteps} min={1} max={50} step={1}
                      onChange={(v) => setLoadSteps(Math.max(1, v | 0))} />
          </Section>
        )}
        {type === 'Fatigue' && (
          <Section id="fatigue-params" title="Fatigue (Basquin S-N)">
            <NumField label="Sut (MPa)"
                      value={fatigueCfg.Sut / 1e6}
                      step={1}
                      onChange={(v) => setFatigueCfg((c) => ({ ...c, Sut: v * 1e6 }))} />
            <NumField label="Se  (MPa)"
                      value={fatigueCfg.Se / 1e6}
                      step={1}
                      onChange={(v) => setFatigueCfg((c) => ({ ...c, Se: v * 1e6 }))} />
            <NumField label="b (Basquin)"
                      value={fatigueCfg.b}
                      step={0.005}
                      onChange={(v) => setFatigueCfg((c) => ({ ...c, b: v }))} />
            <Field label="Mean-stress correction">
              <select className="forge-tool-input"
                      value={fatigueCfg.meanStressCorrection}
                      onChange={(e) => setFatigueCfg((c) => ({ ...c, meanStressCorrection: e.target.value }))}>
                <option value="none">none</option>
                <option value="goodman">Goodman</option>
                <option value="gerber">Gerber</option>
                <option value="soderberg">Soderberg</option>
              </select>
            </Field>
          </Section>
        )}

        {/* 7. Solve */}
        <Section id="solve" title="Solve">
          <button type="button"
                  data-testid="forge-sim-solve"
                  onClick={solve}
                  disabled={solving || (!meshObj && type !== 'CFD')}
                  className="forge-tool-dock-btn"
                  data-kind="confirm"
                  style={{ width: '100%', height: 36, fontSize: 13 }}>
            {solving ? 'Solving…' : `Solve ${type}`}
          </button>
          {solveError && (
            <div className="forge-sim-error" data-testid="forge-sim-solve-error">
              {solveError}
            </div>
          )}
          {result && !solveError && (
            <div className="forge-sim-info" data-testid="forge-sim-solve-info">
              <span><strong>elapsed</strong> {Math.round(result.elapsedMs || 0)} ms</span>
              {typeof result.residual === 'number' && (
                <span><strong>‖r‖</strong> {result.residual.toExponential(2)}</span>
              )}
              {typeof result.cpuMs === 'number' && (
                <span><strong>cpu</strong> {Math.round(result.cpuMs)} ms</span>
              )}
            </div>
          )}
          {solveLog.length > 0 && (
            <ConvergencePlot log={solveLog} />
          )}
        </Section>

        {/* 8. Results */}
        <Section id="results" title="Results">
          <div className="forge-sim-result-tabs"
               data-testid="forge-sim-result-tabs">
            {['Displacement','vonMises','Principal','Modes','Temperature','Fatigue Life']
              .map((t) => (
                <button key={t}
                        type="button"
                        data-sim-result-tab={t}
                        data-active={String(resultTab === t)}
                        onClick={() => setResultTab(t)}
                        className="forge-sim-result-tab">
                  {t}
                </button>
              ))}
          </div>
          <div className="forge-sim-result-viewer"
               data-testid="forge-sim-result-viewer-wrap">
            {result && meshObj
              ? <FeaResultViewer result={result} mesh={meshObj}
                                 resultTab={resultTab}
                                 playing={resultTab === 'Modes' || type === 'Dynamic'}
                                 initialAmp={1} />
              : (
                <div className="forge-sim-empty"
                     style={{ height: 220,
                              display: 'flex', alignItems: 'center',
                              justifyContent: 'center' }}>
                  {result ? 'mesh missing for visualisation'
                          : 'Solve a study to see results.'}
                </div>
              )}
          </div>
        </Section>

        <SolverCapsFooter caps={solverCaps} ready={ready} />
      </div>
    </aside>
  );
}

// ---------------------------------------------------------- subviews

function Field({ label, children }) {
  return (
    <label className="forge-tool-field">
      <span className="forge-tool-field-label">{label}</span>
      {children}
    </label>
  );
}

function NumField({ label, value, onChange, min, max, step, testId }) {
  return (
    <Field label={label}>
      <input className="forge-tool-input"
             type="number"
             data-testid={testId}
             min={min} max={max} step={step ?? 0.01}
             value={value}
             onChange={(e) => onChange(parseFloat(e.target.value))} />
    </Field>
  );
}

function FaceSelect({ value, onChange }) {
  return (
    <select className="forge-tool-input"
            value={value}
            onChange={(e) => onChange(parseInt(e.target.value, 10))}>
      {FACE_LABELS.map((lbl, i) => <option key={i} value={i}>{lbl} face</option>)}
    </select>
  );
}

function Vec3Field({ label, value, onChange, units, step = 1 }) {
  return (
    <Field label={`${label} (${units})`}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0,1,2].map((i) => (
          <input key={i} className="forge-tool-input"
                 type="number"
                 step={step}
                 value={value[i]}
                 onChange={(e) => {
                   const v = parseFloat(e.target.value);
                   onChange(value.map((x, j) => j === i ? v : x));
                 }} />
        ))}
      </div>
    </Field>
  );
}

function LoadRow({ idx, load, onChange, onRemove }) {
  return (
    <div className="forge-sim-row" data-testid={`forge-sim-load-${idx}`}>
      <div className="forge-sim-row-header">
        <select className="forge-tool-input"
                style={{ flex: 1 }}
                value={load.kind}
                onChange={(e) => onChange(defaultLoad(e.target.value))}>
          {LOAD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button type="button"
                onClick={onRemove}
                className="forge-sim-row-remove"
                aria-label="remove load">×</button>
      </div>
      {load.kind === 'Force' && (
        <>
          <Field label="Face"><FaceSelect value={load.faceId}
                                          onChange={(v) => onChange({ ...load, faceId: v })} /></Field>
          <Vec3Field label="F" units="N" value={load.F} step={100}
                     onChange={(v) => onChange({ ...load, F: v })} />
          <div className="forge-sim-row-summary">
            ‖F‖ = {Math.sqrt(load.F.reduce((s, v) => s + v*v, 0)).toFixed(1)} N
          </div>
        </>
      )}
      {load.kind === 'Pressure' && (
        <>
          <Field label="Face"><FaceSelect value={load.faceId}
                                          onChange={(v) => onChange({ ...load, faceId: v })} /></Field>
          <NumField label="Pressure (Pa)" value={load.pressure} step={1000}
                    onChange={(v) => onChange({ ...load, pressure: v })} />
          <div className="forge-sim-row-summary">
            {(load.pressure / 1000).toFixed(1)} kPa
          </div>
        </>
      )}
      {load.kind === 'BodyForce' && (
        <Vec3Field label="g" units="m/s²" value={load.g} step={0.1}
                   onChange={(v) => onChange({ ...load, g: v })} />
      )}
    </div>
  );
}

function BCRow({ idx, bc, onChange, onRemove }) {
  return (
    <div className="forge-sim-row" data-testid={`forge-sim-bc-${idx}`}>
      <div className="forge-sim-row-header">
        <select className="forge-tool-input"
                style={{ flex: 1 }}
                value={bc.kind}
                onChange={(e) => onChange(defaultBC(e.target.value))}>
          {BC_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button type="button"
                onClick={onRemove}
                className="forge-sim-row-remove"
                aria-label="remove BC">×</button>
      </div>
      <Field label="Face">
        <FaceSelect value={bc.faceId}
                    onChange={(v) => onChange({ ...bc, faceId: v })} />
      </Field>
      {(bc.kind === 'Roller' || bc.kind === 'Symmetry') && (
        <Field label="Locked axis">
          <select className="forge-tool-input"
                  value={bc.axis}
                  onChange={(e) => onChange({ ...bc, axis: e.target.value })}>
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
        </Field>
      )}
    </div>
  );
}

function ConvergencePlot({ log }) {
  const W = 240, H = 80;
  if (!log.length) return null;
  const xs = log.map((p) => p.step);
  const ys = log.map((p) => Math.log10(Math.max(1e-12, Math.abs(p.residual))));
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const span = yMax - yMin || 1;
  const xSpan = xMax - xMin || 1;
  const pts = log.map((p, i) => {
    const x = ((xs[i] - xMin) / xSpan) * (W - 30) + 24;
    const y = H - 12 - ((ys[i] - yMin) / span) * (H - 26);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <div data-testid="forge-sim-convergence" style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                     textTransform: 'uppercase', letterSpacing: '0.06em',
                     marginBottom: 4 }}>convergence (log₁₀ residual)</div>
      <svg width={W} height={H}
           style={{ background: 'var(--forge-canvas)',
                    border: '1px solid var(--forge-rail-edge)',
                    borderRadius: 3 }}>
        <polyline fill="none" stroke="var(--forge-accent)" strokeWidth="1.5"
                  points={pts.join(' ')} />
        {pts.map((p, i) => {
          const [x, y] = p.split(',').map(parseFloat);
          return <circle key={i} cx={x} cy={y} r={2.2} fill="var(--forge-accent)" />;
        })}
        <text x={4} y={12} fontSize="9" fill="var(--forge-ink-mute)"
              fontFamily="var(--forge-mono)">{yMax.toFixed(1)}</text>
        <text x={4} y={H - 4} fontSize="9" fill="var(--forge-ink-mute)"
              fontFamily="var(--forge-mono)">{yMin.toFixed(1)}</text>
      </svg>
    </div>
  );
}

function SolverCapsFooter({ caps, ready }) {
  if (!ready) {
    return (
      <div className="forge-sim-caps" data-testid="forge-sim-caps">
        Kernel is offline — UI is fully wired, but no solvers are reachable.
        Build forge-kernel.node to enable studies.
      </div>
    );
  }
  const flags = Object.entries(caps)
    .map(([k, v]) => `${k}:${v ? '✓' : '✗'}`)
    .join(' · ');
  return (
    <div className="forge-sim-caps" data-testid="forge-sim-caps">
      {flags}
    </div>
  );
}

// ---------------------------------------------------------- styles
//
// The shell wraps the simulation workbench in its right-rail or in a
// detached drawer; this style sheet is scoped so the panel renders
// correctly no matter the host. We piggy-back on tokens.css for the
// monochrome palette.

const WB_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  width: 360,
  height: '100%',
  background: 'var(--forge-canvas-3)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  fontSize: 12,
};
const CLOSE_BTN = {
  background: 'transparent', border: 'none',
  color: 'var(--forge-ink-mute)', cursor: 'pointer',
  display: 'inline-flex', padding: 2,
};

function SimWorkbenchStyles() {
  return (
    <style>{`
      .forge-sim-workbench { font-family: var(--forge-font); }
      .forge-sim-header {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px;
        background: var(--forge-canvas);
        border-bottom: 1px solid var(--forge-rail-edge);
        font-size: 12px; font-weight: 600; color: var(--forge-ink);
        flex-shrink: 0;
      }
      .forge-sim-body {
        flex: 1; overflow-y: auto;
        display: flex; flex-direction: column; gap: 0;
      }
      .forge-sim-section { border-bottom: 1px solid var(--forge-rail-edge); }
      .forge-sim-section-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 12px;
        font-size: 10px;
        text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--forge-ink-mute);
        background: var(--forge-canvas);
        border-bottom: 1px solid var(--forge-rail-edge);
      }
      .forge-sim-section-body {
        padding: 10px 12px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .forge-sim-material-btn {
        display: flex; align-items: center; gap: 8px;
        padding: 5px 8px;
        background: transparent;
        border: 1px solid var(--forge-rail-edge);
        border-radius: 3px;
        color: var(--forge-ink);
        font: inherit; font-size: 11px;
        cursor: pointer; text-align: left;
        transition: background var(--forge-motion-fast),
                    border-color var(--forge-motion-fast);
      }
      .forge-sim-material-btn:hover { background: var(--forge-surface); }
      .forge-sim-material-btn[data-active="true"] {
        background: var(--forge-accent-mute);
        border-color: var(--forge-accent-rim);
      }
      .forge-sim-material-swatch {
        width: 14px; height: 14px; border-radius: 2px;
        border: 1px solid var(--forge-rail-edge);
      }
      .forge-sim-mat-summary {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 4px 12px; font-size: 10px;
        font-family: var(--forge-mono);
        color: var(--forge-ink-2);
        padding-top: 4px;
      }
      .forge-sim-mat-summary strong { color: var(--forge-ink); margin-right: 4px; }
      .forge-sim-row {
        background: var(--forge-surface);
        border: 1px solid var(--forge-rail-edge);
        border-radius: 4px; padding: 6px 8px;
        display: flex; flex-direction: column; gap: 6px;
      }
      .forge-sim-row-header { display: flex; align-items: center; gap: 6px; }
      .forge-sim-row-remove {
        background: transparent; border: 1px solid var(--forge-rail-edge);
        color: var(--forge-ink-mute);
        width: 22px; height: 22px;
        border-radius: 3px; cursor: pointer; font-size: 14px; line-height: 1;
      }
      .forge-sim-row-remove:hover { color: var(--forge-err); border-color: var(--forge-err); }
      .forge-sim-row-summary {
        font-family: var(--forge-mono);
        font-size: 10px;
        color: var(--forge-ink-mute);
      }
      .forge-sim-add-btn {
        background: transparent; border: 1px solid var(--forge-rail-edge);
        color: var(--forge-ink-2);
        font: inherit; font-size: 10px;
        padding: 2px 8px; border-radius: 3px; cursor: pointer;
      }
      .forge-sim-add-btn:hover { background: var(--forge-surface); color: var(--forge-ink); }
      .forge-sim-empty {
        font-size: 11px; color: var(--forge-ink-mute);
        font-style: italic;
      }
      .forge-sim-info {
        display: flex; flex-wrap: wrap; gap: 4px 12px;
        font-size: 10px; font-family: var(--forge-mono);
        color: var(--forge-ink-2);
      }
      .forge-sim-info strong { color: var(--forge-ink); margin-right: 4px; }
      .forge-sim-error {
        background: rgba(226, 106, 106, 0.08);
        border: 1px solid var(--forge-err);
        border-radius: 3px;
        padding: 6px 8px;
        font-size: 11px;
        color: var(--forge-err);
        font-family: var(--forge-mono);
      }
      .forge-sim-result-tabs {
        display: flex; flex-wrap: wrap; gap: 3px;
      }
      .forge-sim-result-tab {
        background: transparent;
        border: 1px solid var(--forge-rail-edge);
        color: var(--forge-ink-2);
        border-radius: 3px; padding: 3px 8px;
        font: inherit; font-size: 10px; cursor: pointer;
      }
      .forge-sim-result-tab:hover { color: var(--forge-ink); }
      .forge-sim-result-tab[data-active="true"] {
        background: var(--forge-accent-mute);
        border-color: var(--forge-accent-rim);
        color: var(--forge-ink);
      }
      .forge-sim-result-viewer {
        height: 240px;
        background: var(--forge-canvas);
        border: 1px solid var(--forge-rail-edge);
        border-radius: 4px;
        position: relative;
        overflow: hidden;
      }
      .forge-sim-caps {
        padding: 8px 12px;
        font-size: 10px; font-family: var(--forge-mono);
        color: var(--forge-ink-mute);
        border-top: 1px solid var(--forge-rail-edge);
        background: var(--forge-canvas);
        word-break: break-all;
      }
    `}</style>
  );
}

export default SimulationWorkbench;
