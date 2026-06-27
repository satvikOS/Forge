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

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  isKernelReady,
  detectAvailableSolvers,
} from './simulationDispatch.js';
import {
  MATERIALS, STUDY_TYPES, LOAD_KINDS, BC_KINDS, FACE_LABELS,
  defaultLoad, defaultBC,
  loadsToNodalForces, bcsToNodalConstraints,
  SIM_TREE, sectionForNode, isCoreStudyType,
} from './simulationModel.js';
import {
  simStore, runMesh, runStudy, installSimSetupApi,
} from './simulationStore.js';
import { FeaResultViewer } from './FeaResultViewer.jsx';
import { TopologyResultViewer } from './TopologyResultViewer.jsx';
import { runTopologyOptimisation, TOPOLOGY_DEFAULTS } from './topologyOptimisation.js';
import { runCrackPropagation, CRACK_DEFAULTS } from './crackPropagation.js';
import { runAdaptiveRefinement, ADAPTIVE_DEFAULTS } from './adaptiveMesh.js';

// The simulation catalogues + builders now live in simulationModel.js (the
// single, unit-testable source of truth shared with the Archie-CUA control
// surface). Re-export the two public ones for backward compatibility.
export { MATERIALS, STUDY_TYPES };

// ---------------------------------------------------------- panel

export function SimulationWorkbench({ activeBodyHandle = null,
                                      activeBodyName = 'No body selected',
                                      onSelectBody = null,
                                      onClose = null }) {
  // ── Event-reducer store (Inc 2) ──────────────────────────────────────
  // The setup + status fields live in the external simulationStore so the
  // Archie-CUA `sim.setup.*` setters drive the SAME state the buttons do,
  // WITHOUT any window-API setState (the re-render race that breaks tests).
  // The panel SUBSCRIBES here; every handler dispatches an action.
  const s = useSyncExternalStore(simStore.subscribe, simStore.getState, simStore.getState);
  const {
    name, type, materialId, elemSizeMm,
    meshObj, meshInfo, meshError, meshing, meshQuality,
    loads, bcs, tEnd, dt, alpha, beta, nModes, loadSteps, fatigueCfg,
    result, resultTab, solveError, solving, solveLog,
    focusedSection,
  } = s;
  const dispatch = simStore.dispatch;

  // Same-named shim setters → store actions, so the existing JSX handlers
  // need no rewrite. Functional updates (setLoads(arr => …)) are supported;
  // each reads the freshest store value to avoid stale closures.
  const setField = (key) => (next) => {
    const value = typeof next === 'function' ? next(simStore.getState()[key]) : next;
    dispatch({ type: 'SET', key, value });
  };
  const setName       = setField('name');
  const setType       = setField('type');
  const setMaterialId = setField('materialId');
  const setElemSizeMm = setField('elemSizeMm');
  const setLoads      = setField('loads');
  const setBcs        = setField('bcs');
  const setTEnd       = setField('tEnd');
  const setDt         = setField('dt');
  const setAlpha      = setField('alpha');
  const setBeta       = setField('beta');
  const setNModes     = setField('nModes');
  const setLoadSteps  = setField('loadSteps');
  const setFatigueCfg = setField('fatigueCfg');
  const setResultTab  = setField('resultTab');
  const setResult     = setField('result');
  const setSolveError = setField('solveError');
  const setSolving    = setField('solving');
  const setSolveLog   = setField('solveLog');
  const setMeshObj    = setField('meshObj');

  // SimScale-style unified study tree — the left rail focuses + scrolls the
  // matching existing sub-section (the section itself is untouched). Focus
  // lives in the store too, so a CUA `focus` dispatch and a human click are
  // the same action.
  const bodyRef = useRef(null);
  const focusNode = (nodeId) => {
    const section = sectionForNode(nodeId);
    if (!section) return;
    dispatch({ type: 'FOCUS', section });
    const el = bodyRef.current &&
      bodyRef.current.querySelector(`[data-sim-section="${section}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  // Forge-132 — advanced study cfgs
  const [topoCfg, setTopoCfg] = useState({
    volumeFraction: 0.30,
    penalty:        TOPOLOGY_DEFAULTS.penalty,
    filterRadius:   TOPOLOGY_DEFAULTS.filterRadius,
    maxIters:       TOPOLOGY_DEFAULTS.maxIters,
    symmetry:       null,
    drawDirection:  null,
  });
  const [crackCfg, setCrackCfg] = useState({
    tip:           [0, 0, 0],
    direction:     [1, 0, 0],
    initialLength: 0.005,
    growthIncrement: CRACK_DEFAULTS.growthIncrement,
    maxSteps:      CRACK_DEFAULTS.maxSteps,
    KIC:           CRACK_DEFAULTS.KIC,
    planeStress:   false,
  });
  const [adaptCfg, setAdaptCfg] = useState({
    initialSizeMm:   3,
    errorTolerance:  ADAPTIVE_DEFAULTS.errorTolerance,
    refineFraction:  ADAPTIVE_DEFAULTS.refineFraction,
    refineRatio:     ADAPTIVE_DEFAULTS.refineRatio,
    maxIters:        ADAPTIVE_DEFAULTS.maxIters,
  });
  // Forge-132 — advanced result panes
  const [topoResult,  setTopoResult]  = useState(null);
  const [crackResult, setCrackResult] = useState(null);
  const [adaptResult, setAdaptResult] = useState(null);

  // solverCaps stays component-local — it is a one-shot capability probe,
  // not study state the CUA surface drives.
  const [solverCaps, setSolverCaps] = useState({});

  const material = useMemo(() => MATERIALS.find((m) => m.id === materialId) || MATERIALS[0],
                           [materialId]);

  useEffect(() => {
    setSolverCaps(detectAvailableSolvers());
    // Mount the Archie-CUA surface + push the active body into the store so
    // `sim.setup.mesh/solve` can resolve it. Idempotent.
    installSimSetupApi();
  }, []);
  useEffect(() => {
    dispatch({ type: 'SET_BODY', handle: activeBodyHandle, name: activeBodyName });
  }, [activeBodyHandle, activeBodyName]);

  // ----- mesh handler ----- routes through the store controller so the
  // panel button + the CUA `sim.setup.mesh` setter mesh identically (and
  // both get the Inc-4 quality report).
  const meshNow = () => { runMesh(simStore, { activeBodyHandle }); };

  // ----- solve router -----
  const solve = async () => {
    // Adaptive refinement re-meshes inside the loop, so it can start
    // without a pre-built mesh.
    if (!meshObj && type !== 'CFD' && type !== 'Adaptive Refinement') {
      setSolveError('Mesh the body first.');
      return;
    }

    // CORE study types go through the shared store controller — the SAME
    // runStudy the Archie-CUA `sim.setup.solve` setter calls (which itself
    // calls runStudyCore, the function the headless Inc-1/Inc-2 gates use).
    // Panel button and CUA agent therefore provably solve identically; the
    // controller dispatches SOLVE_BEGIN/DONE/ERROR + publishes the result
    // mirror. The maths lives in ONE place (simulationModel.js).
    if (isCoreStudyType(type)) {
      runStudy(simStore, { activeBodyHandle });
      return;
    }

    // Advanced studies (Contact / Topology / Crack / Adaptive) keep their
    // dedicated runners + result viewers.
    setSolveError(null);
    setSolveLog([]);
    setResult(null);
    setSolving(true);
    const { nodal, pressures } = loadsToNodalForces(loads, meshObj);
    const constraints = bcsToNodalConstraints(bcs, meshObj);
    const mat = { E: material.E, nu: material.nu, rho: material.rho,
                  sigmaY: material.sigmaY,
                  k: material.k, alpha: material.alpha };

    let r;
    try {
      switch (type) {
        case 'Contact':
          // contact requires two meshes; we expose only meshA here. The
          // brief allows reporting "needs second body" via the error path.
          r = { error: 'Contact study requires two bodies — pick the second body in the feature tree.' };
          break;
        case 'Topology Optimisation': {
          setTopoResult(null);
          r = runTopologyOptimisation({
            mesh: meshObj, material: mat,
            loads: nodal, pressureLoads: pressures, bcs: constraints,
            opts: {
              volumeFraction: topoCfg.volumeFraction,
              penalty:        topoCfg.penalty,
              filterRadius:   topoCfg.filterRadius,
              maxIters:       topoCfg.maxIters,
              symmetry:       topoCfg.symmetry,
              drawDirection:  topoCfg.drawDirection,
            },
          });
          if (r && !r.error) {
            setTopoResult(r);
            setSolveLog((r.iterations || []).map((it, i) => ({
              step: i, residual: it.compliance,
            })));
          }
          break;
        }
        case 'Crack Propagation': {
          setCrackResult(null);
          r = runCrackPropagation({
            mesh: meshObj, material: mat,
            loads: nodal, pressureLoads: pressures, bcs: constraints,
            crackTip:       crackCfg.tip,
            crackDirection: crackCfg.direction,
            crackLength:    crackCfg.initialLength,
            opts: {
              growthIncrement: crackCfg.growthIncrement,
              maxSteps:        crackCfg.maxSteps,
              KIC:             crackCfg.KIC,
              planeStress:     crackCfg.planeStress,
            },
          });
          if (r && !r.error) {
            setCrackResult(r);
            setSolveLog((r.steps || []).map((s, i) => ({
              step: i, residual: s.K_I || 0,
            })));
          }
          break;
        }
        case 'Adaptive Refinement': {
          setAdaptResult(null);
          if (typeof activeBodyHandle !== 'number') {
            r = { error: 'Adaptive refinement needs a kernel bodyHandle.' };
            break;
          }
          r = runAdaptiveRefinement({
            bodyHandle:    activeBodyHandle,
            material:      mat,
            initialSizeMm: adaptCfg.initialSizeMm,
            loads:         nodal,
            pressureLoads: pressures,
            bcs:           constraints,
            buildLoads: (m) => loadsToNodalForces(loads, m).nodal,
            buildBcs:   (m) => bcsToNodalConstraints(bcs, m),
            opts: {
              errorTolerance: adaptCfg.errorTolerance,
              refineFraction: adaptCfg.refineFraction,
              refineRatio:    adaptCfg.refineRatio,
              maxIters:       adaptCfg.maxIters,
            },
          });
          if (r && !r.error) {
            setAdaptResult(r);
            // Use the final mesh for downstream visualisation.
            if (r.finalMesh) setMeshObj(r.finalMesh);
            setSolveLog((r.cycles || []).map((c, i) => ({
              step: i, residual: c.relativeError ?? 0,
            })));
          }
          break;
        }
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
    <section className="forge-sim-section" data-sim-section={id}
             data-focused={String(focusedSection === id)}>
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

      <div className="forge-sim-main">
        {/* SimScale-style unified study tree (left rail) */}
        <nav className="forge-sim-tree" data-testid="forge-sim-tree"
             aria-label="Simulation study tree">
          {SIM_TREE.map((node, i) => (
            <button key={node.id}
                    type="button"
                    className="forge-sim-tree-node"
                    data-sim-tree-node={node.id}
                    data-active={String(focusedSection === node.section)}
                    onClick={() => focusNode(node.id)}>
              <span className="forge-sim-tree-rail" aria-hidden="true">
                {i < SIM_TREE.length - 1 ? '├' : '└'}
              </span>
              <span className="forge-sim-tree-label">{node.label}</span>
            </button>
          ))}
        </nav>

      <div className="forge-sim-body" ref={bodyRef}>
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
          {meshQuality && <MeshQualityReport q={meshQuality} />}
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

        {/* Forge-132 advanced study param panels */}
        {type === 'Topology Optimisation' && (
          <Section id="topo-params" title="Topology (SIMP)">
            <NumField label={`Volume fraction — ${topoCfg.volumeFraction.toFixed(2)}`}
                      value={topoCfg.volumeFraction}
                      min={0.1} max={0.9} step={0.05}
                      onChange={(v) => setTopoCfg((c) => ({ ...c, volumeFraction: Math.max(0.1, Math.min(0.9, v)) }))}
                      testId="forge-topo-vf" />
            <NumField label={`Penalty exponent — ${topoCfg.penalty.toFixed(2)}`}
                      value={topoCfg.penalty}
                      min={1} max={6} step={0.1}
                      onChange={(v) => setTopoCfg((c) => ({ ...c, penalty: Math.max(1, v) }))}
                      testId="forge-topo-penalty" />
            <NumField label="Filter radius (× h)"
                      value={topoCfg.filterRadius}
                      min={0.5} max={5} step={0.1}
                      onChange={(v) => setTopoCfg((c) => ({ ...c, filterRadius: Math.max(0.1, v) }))}
                      testId="forge-topo-filter" />
            <NumField label="Max iterations"
                      value={topoCfg.maxIters}
                      min={1} max={200} step={1}
                      onChange={(v) => setTopoCfg((c) => ({ ...c, maxIters: Math.max(1, v | 0) }))}
                      testId="forge-topo-iters" />
            <Field label="Symmetry plane">
              <select className="forge-tool-input"
                      data-testid="forge-topo-sym"
                      value={topoCfg.symmetry || ''}
                      onChange={(e) => setTopoCfg((c) => ({ ...c, symmetry: e.target.value || null }))}>
                <option value="">none</option>
                <option value="x">about X</option>
                <option value="y">about Y</option>
                <option value="z">about Z</option>
              </select>
            </Field>
            <Field label="Casting draw direction">
              <select className="forge-tool-input"
                      data-testid="forge-topo-draw"
                      value={topoCfg.drawDirection ? topoCfg.drawDirection.join(',') : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTopoCfg((c) => ({ ...c,
                          drawDirection: v ? v.split(',').map(parseFloat) : null }));
                      }}>
                <option value="">none</option>
                <option value="1,0,0">+X</option>
                <option value="0,1,0">+Y</option>
                <option value="0,0,1">+Z</option>
                <option value="-1,0,0">−X</option>
                <option value="0,-1,0">−Y</option>
                <option value="0,0,-1">−Z</option>
              </select>
            </Field>
          </Section>
        )}
        {type === 'Crack Propagation' && (
          <Section id="crack-params" title="Crack (XFEM)">
            <Vec3Field label="Tip" units="m" value={crackCfg.tip} step={0.001}
                       onChange={(v) => setCrackCfg((c) => ({ ...c, tip: v }))} />
            <Vec3Field label="Direction" units="unit" value={crackCfg.direction} step={0.1}
                       onChange={(v) => setCrackCfg((c) => ({ ...c, direction: v }))} />
            <NumField label="Initial length (m)" value={crackCfg.initialLength}
                      min={1e-6} step={1e-4}
                      onChange={(v) => setCrackCfg((c) => ({ ...c, initialLength: v }))}
                      testId="forge-crack-len" />
            <NumField label="Δa per step (m)" value={crackCfg.growthIncrement}
                      min={1e-6} step={1e-4}
                      onChange={(v) => setCrackCfg((c) => ({ ...c, growthIncrement: v }))}
                      testId="forge-crack-da" />
            <NumField label="Max steps" value={crackCfg.maxSteps}
                      min={1} max={500} step={1}
                      onChange={(v) => setCrackCfg((c) => ({ ...c, maxSteps: Math.max(1, v | 0) }))}
                      testId="forge-crack-steps" />
            <NumField label="K_IC (Pa·√m)" value={crackCfg.KIC} min={0} step={1e7}
                      onChange={(v) => setCrackCfg((c) => ({ ...c, KIC: Math.max(0, v) }))} />
            <Field label="Plane assumption">
              <select className="forge-tool-input"
                      value={crackCfg.planeStress ? 'stress' : 'strain'}
                      onChange={(e) => setCrackCfg((c) => ({ ...c, planeStress: e.target.value === 'stress' }))}>
                <option value="strain">plane strain</option>
                <option value="stress">plane stress</option>
              </select>
            </Field>
          </Section>
        )}
        {type === 'Adaptive Refinement' && (
          <Section id="adapt-params" title="h-Adaptive">
            <NumField label="Initial h (mm)" value={adaptCfg.initialSizeMm}
                      min={0.5} max={20} step={0.5}
                      onChange={(v) => setAdaptCfg((c) => ({ ...c, initialSizeMm: Math.max(0.5, v) }))}
                      testId="forge-adapt-h" />
            <NumField label={`Error tolerance — ${(adaptCfg.errorTolerance*100).toFixed(1)}%`}
                      value={adaptCfg.errorTolerance}
                      min={0.001} max={0.5} step={0.005}
                      onChange={(v) => setAdaptCfg((c) => ({ ...c, errorTolerance: Math.max(0.001, v) }))}
                      testId="forge-adapt-tol" />
            <NumField label={`Refine fraction — ${(adaptCfg.refineFraction*100).toFixed(0)}%`}
                      value={adaptCfg.refineFraction}
                      min={0.05} max={0.9} step={0.05}
                      onChange={(v) => setAdaptCfg((c) => ({ ...c, refineFraction: Math.max(0.05, Math.min(0.9, v)) }))}
                      testId="forge-adapt-frac" />
            <NumField label={`h shrink ratio — ${adaptCfg.refineRatio.toFixed(2)}`}
                      value={adaptCfg.refineRatio}
                      min={0.3} max={0.99} step={0.05}
                      onChange={(v) => setAdaptCfg((c) => ({ ...c, refineRatio: Math.max(0.3, Math.min(0.99, v)) }))}
                      testId="forge-adapt-ratio" />
            <NumField label="Max iterations" value={adaptCfg.maxIters}
                      min={1} max={20} step={1}
                      onChange={(v) => setAdaptCfg((c) => ({ ...c, maxIters: Math.max(1, v | 0) }))}
                      testId="forge-adapt-iters" />
          </Section>
        )}

        {/* 7. Solve */}
        <Section id="solve" title="Solve">
          <button type="button"
                  data-testid="forge-sim-solve"
                  onClick={solve}
                  disabled={solving || (!meshObj && type !== 'CFD' && type !== 'Adaptive Refinement')}
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
            {type === 'Topology Optimisation' && topoResult ? (
              <TopologyResultViewer mesh={meshObj}
                                    density={topoResult.density}
                                    compliance={topoResult.compliance}
                                    iterations={topoResult.iterations}
                                    initialThreshold={0.3} />
            ) : type === 'Crack Propagation' && crackResult ? (
              <CrackResultSummary result={crackResult} />
            ) : type === 'Adaptive Refinement' && adaptResult ? (
              <AdaptiveResultSummary result={adaptResult} />
            ) : result && meshObj
              ? <FeaResultViewer result={result} mesh={meshObj}
                                 resultTab={resultTab}
                                 playing={resultTab === 'Modes' || type === 'Dynamic'}
                                 initialAmp={1} />
              : (
                <div className="forge-sim-empty"
                     style={{ height: 220,
                              display: 'flex', alignItems: 'center',
                              justifyContent: 'center' }}>
                  {(type === 'Topology Optimisation' ||
                    type === 'Crack Propagation' ||
                    type === 'Adaptive Refinement') && !isKernelReady()
                    ? 'kernel required'
                    : result ? 'mesh missing for visualisation'
                             : 'Solve a study to see results.'}
                </div>
              )}
          </div>
        </Section>

        <SolverCapsFooter caps={solverCaps} ready={ready} />
      </div>
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

// Task #66 Inc 4 — per-element FEA mesh-quality report (aspect histogram +
// min/avg/worst aspect, min dihedral, volume; poor-element flag). Reads the
// structured report feaMeshQuality() computed on the last mesh.
function MeshQualityReport({ q }) {
  if (!q) return null;
  const maxBin = Math.max(1, ...q.histogram.map((b) => b.count));
  const fmtEdge = (v) => (v === Infinity ? '∞' : v);
  return (
    <div className="forge-sim-quality" data-testid="forge-sim-mesh-quality"
         data-element-type={q.elementType}
         data-poor-count={q.poorCount}>
      <div className="forge-sim-quality-head">
        mesh quality — {q.elementType} · {q.elemCount} elem
        <span className={q.poorCount > 0 ? 'forge-sim-quality-bad' : 'forge-sim-quality-ok'}>
          {q.poorCount > 0 ? `${q.poorCount} poor` : 'all good'}
        </span>
      </div>
      <div className="forge-sim-info">
        <span><strong>aspect</strong> {q.aspect.min.toFixed(2)} / {q.aspect.avg.toFixed(2)} / {
          Number.isFinite(q.aspect.worst) ? q.aspect.worst.toFixed(2) : '∞'}</span>
        <span><strong>min ∠</strong> {q.minDihedralDeg.min.toFixed(1)}°</span>
        <span><strong>Σvol</strong> {q.volume.total.toExponential(2)} m³</span>
      </div>
      <div className="forge-sim-quality-hist" aria-label="aspect-ratio histogram">
        {q.histogram.map((b, i) => (
          <div key={i} className="forge-sim-quality-bar-wrap"
               title={`aspect ${fmtEdge(b.loEdge)}–${fmtEdge(b.hiEdge)}: ${b.count}`}>
            <div className="forge-sim-quality-bar"
                 data-bin={i}
                 style={{ height: `${Math.round((b.count / maxBin) * 100)}%` }} />
            <span className="forge-sim-quality-tick">{fmtEdge(b.hiEdge)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CrackResultSummary({ result }) {
  const steps = Array.isArray(result.steps) ? result.steps : [];
  return (
    <div data-testid="forge-crack-result"
         style={{ height: '100%', overflow: 'auto',
                  padding: 10, fontFamily: 'var(--forge-mono)',
                  fontSize: 10, color: 'var(--forge-ink-2)' }}>
      <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em',
                     color: 'var(--forge-ink-mute)', marginBottom: 6 }}>
        crack steps ({steps.length})
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
        <thead>
          <tr style={{ color: 'var(--forge-ink-mute)' }}>
            <th style={{ textAlign: 'left' }}>n</th>
            <th>K_I</th>
            <th>K_II</th>
            <th>K_III</th>
            <th>J</th>
            <th>tip</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => (
            <tr key={i} data-testid={`forge-crack-step-${i}`}>
              <td>{i}</td>
              <td>{(s.K_I || 0).toExponential(2)}</td>
              <td>{(s.K_II || 0).toExponential(2)}</td>
              <td>{(s.K_III || 0).toExponential(2)}</td>
              <td>{(s.J || 0).toExponential(2)}</td>
              <td>[{s.tip.map((v) => v.toFixed(4)).join(', ')}]</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.finalTip && (
        <div data-testid="forge-crack-final" style={{ marginTop: 8 }}>
          final tip [{result.finalTip.map((v) => v.toFixed(4)).join(', ')}]
        </div>
      )}
    </div>
  );
}

function AdaptiveResultSummary({ result }) {
  const cycles = Array.isArray(result.cycles) ? result.cycles : [];
  return (
    <div data-testid="forge-adapt-result"
         style={{ height: '100%', overflow: 'auto',
                  padding: 10, fontFamily: 'var(--forge-mono)',
                  fontSize: 10, color: 'var(--forge-ink-2)' }}>
      <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em',
                     color: 'var(--forge-ink-mute)', marginBottom: 6 }}>
        adaptive cycles ({cycles.length}) — {result.converged ? 'converged' : 'iters hit'}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
        <thead>
          <tr style={{ color: 'var(--forge-ink-mute)' }}>
            <th style={{ textAlign: 'left' }}>n</th>
            <th>h (mm)</th>
            <th>nodes</th>
            <th>elem</th>
            <th>‖η‖</th>
            <th>rel err</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((c, i) => (
            <tr key={i} data-testid={`forge-adapt-cycle-${i}`}>
              <td>{i}</td>
              <td>{(c.elemSizeMm || 0).toFixed(2)}</td>
              <td>{c.nNode}</td>
              <td>{c.nElem}</td>
              <td>{c.etaGlobal != null ? c.etaGlobal.toExponential(2) : '—'}</td>
              <td>{c.relativeError != null ? (c.relativeError * 100).toFixed(2) + '%' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  width: 524,
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
      .forge-sim-main {
        flex: 1; min-height: 0;
        display: flex; flex-direction: row;
      }
      .forge-sim-tree {
        width: 164px; flex-shrink: 0;
        display: flex; flex-direction: column; gap: 1px;
        padding: 8px 6px;
        background: var(--forge-canvas-2, var(--forge-canvas));
        border-right: 1px solid var(--forge-rail-edge);
        overflow-y: auto;
      }
      .forge-sim-tree-node {
        display: flex; align-items: center; gap: 6px;
        padding: 6px 8px;
        background: transparent; border: 1px solid transparent;
        border-radius: 3px;
        color: var(--forge-ink-2);
        font: inherit; font-size: 11px; text-align: left;
        cursor: pointer;
        transition: background var(--forge-motion-fast),
                    color var(--forge-motion-fast);
      }
      .forge-sim-tree-node:hover { background: var(--forge-surface); color: var(--forge-ink); }
      .forge-sim-tree-node[data-active="true"] {
        background: var(--forge-accent-mute);
        border-color: var(--forge-accent-rim);
        color: var(--forge-ink);
      }
      .forge-sim-tree-rail {
        font-family: var(--forge-mono);
        color: var(--forge-ink-mute);
        width: 10px; text-align: center;
      }
      .forge-sim-tree-label { flex: 1; }
      .forge-sim-body {
        flex: 1; min-width: 0; overflow-y: auto;
        display: flex; flex-direction: column; gap: 0;
      }
      .forge-sim-section {
        border-bottom: 1px solid var(--forge-rail-edge);
        scroll-margin-top: 0;
      }
      .forge-sim-section[data-focused="true"] {
        box-shadow: inset 2px 0 0 var(--forge-accent-rim);
      }
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
      .forge-sim-quality {
        display: flex; flex-direction: column; gap: 6px;
        padding: 6px 8px;
        background: var(--forge-surface);
        border: 1px solid var(--forge-rail-edge);
        border-radius: 4px;
      }
      .forge-sim-quality-head {
        display: flex; align-items: center; justify-content: space-between;
        font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--forge-ink-mute);
      }
      .forge-sim-quality-ok  { color: var(--forge-ok); }
      .forge-sim-quality-bad { color: var(--forge-err); }
      .forge-sim-quality-hist {
        display: flex; align-items: flex-end; gap: 3px;
        height: 48px; padding-top: 4px;
      }
      .forge-sim-quality-bar-wrap {
        flex: 1; height: 100%;
        display: flex; flex-direction: column; justify-content: flex-end;
        align-items: center; gap: 2px;
      }
      .forge-sim-quality-bar {
        width: 100%; min-height: 1px;
        background: var(--forge-accent-rim);
        border-radius: 1px;
      }
      .forge-sim-quality-bar[data-bin="4"],
      .forge-sim-quality-bar[data-bin="5"] { background: var(--forge-err); }
      .forge-sim-quality-tick {
        font-family: var(--forge-mono); font-size: 8px;
        color: var(--forge-ink-mute);
      }
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

// ============================================================
// Host — mounts the Simulation workbench as a right-docked panel,
// sources the active body handle from the live body registry, and
// wires open/close via window globals + the forge:menu-action and
// forge:wb-changed events (so it is reachable from the Tools menu
// and the global command search). Forge-91 / PUSH-48.
// ============================================================

function readActiveBody() {
  if (typeof window === 'undefined') return { handle: null, name: 'No body selected' };
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const sel = window.__forgeSelection;
  // Prefer an explicitly-selected native body, else the last native body.
  const selIds = sel && sel.ids ? sel.ids : (Array.isArray(sel) ? sel : []);
  let pick = null;
  if (selIds && selIds.length) {
    pick = bodies.find((b) => b && b.kind === 'native' && selIds.includes(b.id));
  }
  if (!pick) {
    for (let i = bodies.length - 1; i >= 0; i--) {
      if (bodies[i] && bodies[i].kind === 'native' && bodies[i].handle != null) { pick = bodies[i]; break; }
    }
  }
  if (!pick) return { handle: null, name: 'No body selected' };
  return { handle: pick.handle, name: pick.name || pick.id || 'Body' };
}

const SIM_PANEL_EVENT = 'forge:open-simulation';

export function SimulationWorkbenchHost() {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState({ handle: null, name: 'No body selected' });
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    const refresh = () => setBody(readActiveBody());
    window.__forgeOpenSimulation = () => { refresh(); setOpen(true); };
    window.__forgeCloseSimulation = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.simulation' || id === 'workbench.simulation' || id === 'tools.fea') {
        refresh(); setOpen(true);
      }
    };
    const onEvt = () => { refresh(); setOpen(true); };
    const syncWb = () => { if (window.__forgeActiveWb === 'simulation') { refresh(); setOpen(true); } };
    window.addEventListener('forge:menu-action', onMenu);
    window.addEventListener(SIM_PANEL_EVENT, onEvt);
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener(SIM_PANEL_EVENT, onEvt);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);

  if (typeof document === 'undefined' || !open) return null;
  const overlay = {
    position: 'absolute', top: 56, right: 0, bottom: 0,
    zIndex: 8400, display: 'flex', height: 'auto',
    boxShadow: '-8px 0 28px rgba(0,0,0,0.45)',
  };
  return createPortal(
    <div style={overlay} data-testid="forge-sim-host">
      <SimulationWorkbench
        activeBodyHandle={body.handle}
        activeBodyName={body.name}
        onClose={() => setOpen(false)}
      />
    </div>,
    document.body,
  );
}
