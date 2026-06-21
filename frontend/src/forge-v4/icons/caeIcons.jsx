// caeIcons.jsx — Hand-authored CAE / Simulate icon set for ArchDisc Forge.
//
// Toolbar-grade glyphs in the visual language of Siemens NX / Dassault CATIA /
// SolidWorks Simulation. Every icon is drawn on a 24×24 grid, monochrome
// (currentColor only, no fills/colours), 1.5 px stroke, rounded caps/joins,
// all content kept inside [2,22] with 2 px safe padding and a consistent
// visual weight + complexity across the whole set.
//
// Each id matches the REAL tool/command ids surfaced by the app:
//   • AI-bridge tools  (frontend/src/ai/ForgeToolBridge.js):
//       simulate.fea-static / -modal / -thermal / -buckling / -nonlinear /
//       -fatigue / -dynamic / -contact, simulate.cfd,
//       simulate.dynamics-motion, simulate.multibody-dynamics,
//       simulate.tolerance-stack
//   • SimulationWorkbench study types (frontend/src/forge-v4/SimulationWorkbench.jsx):
//       Static / Modal / Dynamic / Thermal / Buckling / Nonlinear / Contact /
//       Plastic / Fatigue / CFD / Topology Optimisation / Crack Propagation /
//       Adaptive Refinement
//   • Setup ops: new-study, apply-material, mesh-control, mesh-generate,
//       fixture (Fixed/Pin/Roller/Symmetry), force, pressure, torque,
//       gravity (BodyForce), bearing-load, temperature, convection, contact
//   • Solve / post: run-solve, results-stress / -displacement / -strain /
//       -fos / -temperature / -velocity, probe-result, animate, report
//
// The map is the default export; every component is also a named export.
// Pure presentational SVG — no behaviour, no logic.

import React from 'react';

/**
 * Shared chrome so every glyph is byte-for-byte on-standard. Children are the
 * hand-authored <path>/<line>/<circle> primitives unique to each operation.
 */
function Svg({ size = 18, children, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

// A small reusable solid bracket body used by several setup glyphs so the
// "part under analysis" reads consistently across the set. (rendered inline
// where used — kept here only as a documented reference shape)
//   <path d="M5 14V8l5-3 9 3v6l-9 3z" />  // iso block

// ─────────────────────────────────────────────────────────────────────────
//  STUDY CREATION
// ─────────────────────────────────────────────────────────────────────────

// new-study — analysis folder/tree node with a "+" (NX: new simulation file)
export const NewStudy = (props) => (
  <Svg {...props}>
    <path d="M3 6.5l2-2h5l2 2h5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <path d="M12 10v6M9 13h6" />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────
//  STUDY TYPES — each depicts the physics it solves
// ─────────────────────────────────────────────────────────────────────────

// static — cantilever beam fixed at the wall, sagging under a point load arrow
export const Static = (props) => (
  <Svg {...props}>
    <path d="M4 4v16" />
    <path d="M4 4l-1.5 1.5M4 8l-1.5 1.5M4 12l-1.5 1.5M4 16l-1.5 1.5M4 20l-1.5 1.5" />
    <path d="M4 9h14" />
    <path d="M18 9v5M16 12l2 2 2-2" />
  </Svg>
);

// modal — vibrating string / standing-wave mode shape between two supports
export const Modal = (props) => (
  <Svg {...props}>
    <path d="M3 12c2.5-7 5-7 7 0s4.5 7 7 0" opacity="0.45" />
    <path d="M3 12c3-9 6-9 9 0s6 9 9 0" />
    <path d="M3 18v-3M21 18v-3" />
  </Svg>
);

// dynamic — transient response: a load pulse over a time axis (response curve)
export const Dynamic = (props) => (
  <Svg {...props}>
    <path d="M3 19V5M3 19h17" />
    <path d="M3 14c3 0 3-7 6-7s3 9 6 6 3-4 5-7" />
  </Svg>
);

// thermal — solid block with a heat gradient (hot/cold faces) + thermometer
export const Thermal = (props) => (
  <Svg {...props}>
    <path d="M4 8h9v9H4z" />
    <path d="M7 8v9M10 8v9" opacity="0.5" />
    <path d="M18 5v8a2.5 2.5 0 1 0 2 0V5a1 1 0 0 0-2 0z" />
    <path d="M19 14v-5" />
  </Svg>
);

// buckling — slender column under axial load bowing sideways (Euler buckling)
export const Buckling = (props) => (
  <Svg {...props}>
    <path d="M12 3v2M10 4l2-1 2 1" />
    <path d="M12 5c5 3 5 11 0 14" />
    <path d="M12 19v2M4 21h16" />
  </Svg>
);

// nonlinear — load–displacement curve that goes nonlinear (yield knee)
export const Nonlinear = (props) => (
  <Svg {...props}>
    <path d="M4 19V4M4 19h16" />
    <path d="M4 17c3-1 5-3 6-7s3-4 9 1" />
  </Svg>
);

// contact — two bodies pressing together with a contact interface line
export const Contact = (props) => (
  <Svg {...props}>
    <path d="M3 5h7v14H3z" />
    <path d="M21 5h-7v14h7" opacity="0.5" />
    <path d="M12 4v16" strokeDasharray="2 1.6" />
    <path d="M14 9l-2 3 2 3M10 9l2 3-2 3" />
  </Svg>
);

// plastic — stress-strain curve with permanent set (residual strain offset)
export const Plastic = (props) => (
  <Svg {...props}>
    <path d="M4 19V4M4 19h16" />
    <path d="M4 16c2-9 4-9 6-9s3 2 9 1" />
    <path d="M10 16v3" strokeDasharray="1.6 1.6" />
  </Svg>
);

// fatigue — S–N curve / cyclic wave with a crack-fracture break
export const Fatigue = (props) => (
  <Svg {...props}>
    <path d="M3 9c1.5-3 3 3 4.5 0s3 3 4.5 0" />
    <path d="M14 9l1.5 4-2 1 2.5 5" />
    <path d="M3 19h18" />
  </Svg>
);

// cfd — streamlines flowing past a body (laminar Navier-Stokes)
export const Cfd = (props) => (
  <Svg {...props}>
    <circle cx="13" cy="12" r="3.5" />
    <path d="M3 7c5 0 5 0 8 3M3 12h6M3 17c5 0 5 0 8-3" />
    <path d="M18 12h3M19 10.5l2 1.5-2 1.5" />
  </Svg>
);

// drop / impact — part falling onto a ground line with impact burst (drop test)
export const DropTest = (props) => (
  <Svg {...props}>
    <path d="M9 3h6v6H9z" />
    <path d="M12 9v5M10.5 12l1.5 2 1.5-2" />
    <path d="M4 19h16" />
    <path d="M9 21l1-2M12 22v-2M15 21l-1-2" />
  </Svg>
);

// topology optimisation — organic optimised lattice inside a design envelope
export const TopologyOptimisation = (props) => (
  <Svg {...props}>
    <path d="M4 5h16v14H4z" />
    <path d="M7 19c1-5 4-5 5-8s4-3 5-6" />
    <path d="M7 5c2 4 2 4 5 4s4 3 8 4" opacity="0.55" />
  </Svg>
);

// crack propagation — body with a growing crack and a stress-intensity arrow
export const CrackPropagation = (props) => (
  <Svg {...props}>
    <path d="M4 6h16v12H4z" />
    <path d="M4 12l4 1-2 2 4 1-2-2 5 1" />
    <path d="M16 14l4 0M18 12l2 2-2 2" />
  </Svg>
);

// adaptive refinement — a coarse cell auto-subdividing into finer cells
export const AdaptiveRefinement = (props) => (
  <Svg {...props}>
    <path d="M4 4h16v16H4z" />
    <path d="M4 12h8M12 4v16" />
    <path d="M12 8h4M12 16h4M16 4v16" />
    <path d="M14 12v8M16 12v8" opacity="0.55" />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────
//  STUDY SETUP — material, mesh
// ─────────────────────────────────────────────────────────────────────────

// apply-material — solid body with a swatch/dropper applying a material
export const ApplyMaterial = (props) => (
  <Svg {...props}>
    <path d="M3 13V8l5-3 9 3v5l-9 3z" />
    <path d="M3 8l5 3 9-3M8 11v5" opacity="0.6" />
    <path d="M19 5l-4 4M18 4l2 2-1.5 1.5-2-2z" />
  </Svg>
);

// mesh-control — local mesh sizing control on one face (graded element size)
export const MeshControl = (props) => (
  <Svg {...props}>
    <path d="M4 6h16v12H4z" />
    <path d="M4 12h16M10 6v12" opacity="0.5" />
    <path d="M14 12h6M14 15h6M17 12v6M14 18v-6" />
    <circle cx="14" cy="12" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);

// mesh-generate — body tessellated into a finite-element triangle/tet mesh
export const MeshGenerate = (props) => (
  <Svg {...props}>
    <path d="M5 5l7-2 7 2v8l-7 6-7-6z" />
    <path d="M5 5l7 6 7-6M12 11v8" />
    <path d="M5 9l7 2 7-2M8.5 4l3.5 7 3.5-7" opacity="0.6" />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────
//  CONSTRAINTS / FIXTURES
// ─────────────────────────────────────────────────────────────────────────

// fixture / fixed — a fully fixed (clamped) face: hatched ground wall
export const Fixture = (props) => (
  <Svg {...props}>
    <path d="M6 3v18" />
    <path d="M6 3L3 6M6 7L3 10M6 11L3 14M6 15L3 18M6 19l-3 3" />
    <path d="M6 12h7" />
    <path d="M17 9h4v6h-4z" />
  </Svg>
);

// pin / hinge support — pinned triangle support (1 reaction, free rotation)
export const PinSupport = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="8" r="2" />
    <path d="M12 10l-5 8h10z" />
    <path d="M5 20h14" />
    <path d="M6 20l-1.5 1.5M9 20l-1.5 1.5M12 20l-1.5 1.5M15 20l-1.5 1.5M18 20l-1.5 1.5" />
  </Svg>
);

// roller support — roller (normal locked, tangential free): triangle on rollers
export const RollerSupport = (props) => (
  <Svg {...props}>
    <path d="M12 4l-5 8h10z" />
    <circle cx="8.5" cy="15" r="2" />
    <circle cx="15.5" cy="15" r="2" />
    <path d="M4 19h16" />
  </Svg>
);

// symmetry — symmetry plane mirroring a half-body across a dashed plane
export const SymmetryConstraint = (props) => (
  <Svg {...props}>
    <path d="M12 3v18" strokeDasharray="2.2 2" />
    <path d="M5 7h4v10H5z" />
    <path d="M15 7h4v10h-4z" opacity="0.5" />
    <path d="M9 12h2M13 12h2" />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────
//  LOADS
// ─────────────────────────────────────────────────────────────────────────

// force-load — concentrated force vector (single bold arrow) onto a face
export const ForceLoad = (props) => (
  <Svg {...props}>
    <path d="M4 5h4v14H4z" />
    <path d="M8 12h11" />
    <path d="M15 8l4 4-4 4" />
  </Svg>
);

// pressure — distributed pressure: a row of arrows pushing onto a face
export const Pressure = (props) => (
  <Svg {...props}>
    <path d="M6 17h12" />
    <path d="M9 6v8M9 14l-2-2M9 14l2-2" />
    <path d="M12 6v8M12 14l-2-2M12 14l2-2" />
    <path d="M15 6v8M15 14l-2-2M15 14l2-2" />
  </Svg>
);

// torque — a moment / torque arrow (curved arc with arrowhead) about an axis
export const Torque = (props) => (
  <Svg {...props}>
    <path d="M12 12V4" strokeDasharray="2 1.8" />
    <path d="M6 9a8 8 0 1 0 12 0" />
    <path d="M18 6v3.5h-3.5" />
  </Svg>
);

// gravity / body force — downward field arrows over the whole body (BodyForce)
export const Gravity = (props) => (
  <Svg {...props}>
    <path d="M6 4v12M6 16l-2-2M6 16l2-2" />
    <path d="M12 4v12M12 16l-2-2M12 16l2-2" />
    <path d="M18 4v12M18 16l-2-2M18 16l2-2" />
    <path d="M4 20h16" />
  </Svg>
);

// bearing-load — radial bearing load: shaft hole with a distributed cosine load
export const BearingLoad = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="10" r="5" />
    <circle cx="12" cy="10" r="2" />
    <path d="M12 18v3M9 19l3 2 3-2" />
    <path d="M8 14l1.5 1.5M16 14l-1.5 1.5M12 16v1.5" opacity="0.7" />
  </Svg>
);

// temperature — prescribed temperature BC: thermometer touching a face
export const Temperature = (props) => (
  <Svg {...props}>
    <path d="M11 4v9a3 3 0 1 0 4 0V4a2 2 0 0 0-4 0z" />
    <path d="M13 13V7" />
    <path d="M4 8h5M4 12h5M4 16h5" opacity="0.7" />
  </Svg>
);

// convection — convective surface: wavy heat-transfer streams off a wall
export const Convection = (props) => (
  <Svg {...props}>
    <path d="M5 4v16" />
    <path d="M5 4L3 6M5 9L3 11M5 14L3 16M5 19l-2 2" opacity="0.7" />
    <path d="M9 8c2-2 4 2 6 0s4 2 6 0" />
    <path d="M9 13c2-2 4 2 6 0s4 2 6 0" />
    <path d="M9 18c2-2 4 2 6 0s4 2 6 0" />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────
//  SOLVE
// ─────────────────────────────────────────────────────────────────────────

// run-solve — run the solver: a play triangle inside a solver/CPU square
export const RunSolve = (props) => (
  <Svg {...props}>
    <path d="M5 5h14v14H5z" />
    <path d="M10 9l6 3-6 3z" />
    <path d="M2 9v6M22 9v6M9 2h6M9 22h6" opacity="0.6" />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────
//  RESULTS / POST-PROCESSING
// ─────────────────────────────────────────────────────────────────────────

// results-stress (von Mises) — deformed part with a stress contour band + legend
export const ResultsStress = (props) => (
  <Svg {...props}>
    <path d="M5 16c3-4 8-4 11-9" />
    <path d="M5 16c3-3 8-3 11-7" opacity="0.55" />
    <path d="M5 16c3-5 8-5 11-11" opacity="0.55" />
    <path d="M19 5v14M19 5l-1.5 1.5M19 19l-1.5-1.5" />
  </Svg>
);

// results-displacement — undeformed (dashed) vs deformed (solid) shape overlay
export const ResultsDisplacement = (props) => (
  <Svg {...props}>
    <path d="M4 6h10v6H4z" strokeDasharray="2.2 1.8" />
    <path d="M7 9l4-3 9 3v6l-9 4-4-3z" />
    <path d="M14 7l2-2M16 13l2-2" opacity="0.6" />
  </Svg>
);

// results-strain — a unit element stretched/sheared into a strained parallelogram
export const ResultsStrain = (props) => (
  <Svg {...props}>
    <path d="M5 6h8v8H5z" strokeDasharray="2.2 1.8" />
    <path d="M9 18l3-8h8l-3 8z" />
    <path d="M5 6l4 4M13 6l7 4M13 14l-1 4" opacity="0.55" />
  </Svg>
);

// results-fos (factor of safety) — shield with a check (safety margin met)
export const ResultsFos = (props) => (
  <Svg {...props}>
    <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" />
    <path d="M8.5 12l2.5 2.5 5-5" />
  </Svg>
);

// results-temperature — temperature field contour bands + a thermometer marker
export const ResultsTemperature = (props) => (
  <Svg {...props}>
    <path d="M4 7h11M4 11h11M4 15h11" />
    <path d="M19 4v9a2.5 2.5 0 1 0 2 0V4a1 1 0 0 0-2 0z" />
    <circle cx="20" cy="16" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

// results-velocity — velocity vector field (flow arrows of varying length)
export const ResultsVelocity = (props) => (
  <Svg {...props}>
    <path d="M4 7h8M9 4.5L12 7l-3 2.5" />
    <path d="M4 12h12M13 9.5L16 12l-3 2.5" />
    <path d="M4 17h6M7 14.5L10 17l-3 2.5" />
  </Svg>
);

// probe-result — query a node value: a probe/pointer reading off a contour
export const ProbeResult = (props) => (
  <Svg {...props}>
    <path d="M3 17c4-5 8-5 12-11" />
    <path d="M14 13l5-7M16 5h3v3" />
    <path d="M16 16l2 2-1.5 1.5-2-2z" />
    <circle cx="13.5" cy="13.5" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

// animate — play the deformation/mode animation across timeline frames
export const Animate = (props) => (
  <Svg {...props}>
    <path d="M4 5h16v11H4z" />
    <path d="M10 8l5 2.5-5 2.5z" />
    <path d="M5 20h2M9 20h2M13 20h2M17 20h2" />
  </Svg>
);

// report — analysis report sheet with a results chart + signature line
export const Report = (props) => (
  <Svg {...props}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
    <path d="M9 17v-3M12 17v-5M15 17v-2" />
    <path d="M9 10h4" opacity="0.7" />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────
//  RIGID-BODY / MOTION / TOLERANCE (other simulate.* AI-bridge tools)
// ─────────────────────────────────────────────────────────────────────────

// dynamics-motion / multibody — linkage swinging about a pivot (motion study)
export const Multibody = (props) => (
  <Svg {...props}>
    <circle cx="6" cy="6" r="2" />
    <path d="M7.5 7.5l5 5" />
    <circle cx="14" cy="14" r="2" />
    <path d="M15.5 15.5l3 3" />
    <path d="M6 6a10 10 0 0 1 10 10" strokeDasharray="2 2" opacity="0.6" />
    <path d="M18 14v3.5h-3.5" />
  </Svg>
);

// tolerance-stack — dimension stack-up chain across a stacked assembly
export const ToleranceStack = (props) => (
  <Svg {...props}>
    <path d="M4 6h5v12H4zM9 6h6v12H9zM15 6h5v12h-5z" />
    <path d="M4 21h16" />
    <path d="M4 21v-1.5M9 21v-1.5M15 21v-1.5M20 21v-1.5" />
    <path d="M5.5 22.5l-1.5-1.5 1.5-1.5M18.5 22.5l1.5-1.5-1.5-1.5" />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────
//  ID → COMPONENT MAP  (real tool/command ids + sensible aliases)
// ─────────────────────────────────────────────────────────────────────────

const caeIcons = {
  // ── study creation ──
  'new-study': NewStudy,
  'cae.new-study': NewStudy,
  'simulate.new-study': NewStudy,
  'study.new': NewStudy,

  // ── study types (workbench STUDY_TYPES) ──
  'Static': Static,
  'static': Static,
  'simulate.fea-static': Static,
  'fea.solveStatic': Static,

  'Modal': Modal,
  'modal': Modal,
  'simulate.fea-modal': Modal,
  'fea.solveModal': Modal,

  'Dynamic': Dynamic,
  'dynamic': Dynamic,
  'simulate.fea-dynamic': Dynamic,
  'fea.solveDynamic': Dynamic,

  'Thermal': Thermal,
  'thermal': Thermal,
  'simulate.fea-thermal': Thermal,
  'fea.solveThermal': Thermal,

  'Buckling': Buckling,
  'buckling': Buckling,
  'simulate.fea-buckling': Buckling,
  'fea.solveBuckling': Buckling,

  'Nonlinear': Nonlinear,
  'nonlinear': Nonlinear,
  'simulate.fea-nonlinear': Nonlinear,
  'fea.solveNonlinearStatic': Nonlinear,

  'Contact': Contact,
  'contact': Contact,
  'simulate.fea-contact': Contact,
  'fea.solveContact': Contact,

  'Plastic': Plastic,
  'plastic': Plastic,
  'fea.solveNonlinearPlastic': Plastic,

  'Fatigue': Fatigue,
  'fatigue': Fatigue,
  'simulate.fea-fatigue': Fatigue,
  'fea.fatigueLife': Fatigue,

  'CFD': Cfd,
  'cfd': Cfd,
  'simulate.cfd': Cfd,

  'drop': DropTest,
  'drop-test': DropTest,
  'simulate.drop-test': DropTest,

  'Topology Optimisation': TopologyOptimisation,
  'topology': TopologyOptimisation,
  'topology-optimisation': TopologyOptimisation,

  'Crack Propagation': CrackPropagation,
  'crack': CrackPropagation,
  'crack-propagation': CrackPropagation,

  'Adaptive Refinement': AdaptiveRefinement,
  'adaptive': AdaptiveRefinement,
  'adaptive-refinement': AdaptiveRefinement,

  // ── setup: material + mesh ──
  'apply-material': ApplyMaterial,
  'materials': ApplyMaterial,
  'cae.apply-material': ApplyMaterial,

  'mesh-control': MeshControl,
  'mesh.control': MeshControl,
  'cae.mesh-control': MeshControl,

  'mesh-generate': MeshGenerate,
  'mesh': MeshGenerate,
  'mesh.generate': MeshGenerate,
  'fea.meshFromBrep': MeshGenerate,

  // ── constraints / fixtures (BC_KINDS) ──
  'fixture': Fixture,
  'constraint': Fixture,
  'Fixed': Fixture,
  'fixed': Fixture,

  'Pin': PinSupport,
  'pin': PinSupport,
  'pin-support': PinSupport,

  'Roller': RollerSupport,
  'roller': RollerSupport,
  'roller-support': RollerSupport,

  'Symmetry': SymmetryConstraint,
  'symmetry': SymmetryConstraint,

  // ── loads (LOAD_KINDS + extras) ──
  'force-load': ForceLoad,
  'Force': ForceLoad,
  'force': ForceLoad,

  'pressure': Pressure,
  'Pressure': Pressure,

  'torque': Torque,
  'Torque': Torque,
  'moment': Torque,

  'gravity': Gravity,
  'BodyForce': Gravity,
  'body-force': Gravity,

  'bearing-load': BearingLoad,
  'bearing': BearingLoad,

  'temperature': Temperature,
  'temp-bc': Temperature,

  'convection': Convection,
  'Convection': Convection,

  'contact-load': Contact,

  // ── solve ──
  'run-solve': RunSolve,
  'solve': RunSolve,
  'run': RunSolve,
  'fea.solve': RunSolve,

  // ── results / post ──
  'results-stress': ResultsStress,
  'stress': ResultsStress,
  'vonMises': ResultsStress,
  'von-mises': ResultsStress,
  'results': ResultsStress,

  'results-displacement': ResultsDisplacement,
  'displacement': ResultsDisplacement,

  'results-strain': ResultsStrain,
  'strain': ResultsStrain,

  'results-fos': ResultsFos,
  'fos': ResultsFos,
  'factor-of-safety': ResultsFos,
  'safety': ResultsFos,

  'results-temperature': ResultsTemperature,
  'result-temperature': ResultsTemperature,

  'results-velocity': ResultsVelocity,
  'velocity': ResultsVelocity,

  'probe-result': ProbeResult,
  'probe': ProbeResult,

  'animate': Animate,
  'animation': Animate,

  'report': Report,
  'cae.report': Report,

  // ── motion / multibody / tolerance (other simulate.* AI tools) ──
  'simulate.dynamics-motion': Multibody,
  'simulate.multibody-dynamics': Multibody,
  'multibody': Multibody,
  'dynamics-motion': Multibody,

  'simulate.tolerance-stack': ToleranceStack,
  'tolerance-stack': ToleranceStack,
  'tolerance': ToleranceStack,
};

export default caeIcons;
