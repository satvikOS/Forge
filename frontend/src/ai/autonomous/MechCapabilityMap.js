/**
 * MechCapabilityMap — the autonomous agent's model of *what ArchDisc Mech
 * can do*. This is what makes Archie "fully familiar with Mech": it is
 * grounded in the real tool registry + the Sculpt param schemas, not
 * generic knowledge. Every goal the agent self-directs and every plan it
 * runs is drawn from THIS map, so it can only ask Mech to do things Mech
 * actually supports.
 *
 * Grounding principle: the agent reasons over a concrete capability
 * surface, not an open-ended imagination.
 */

import { TOOL_REGISTRY, registrySummary } from '../ToolRegistry.js';
import { TOOL_PARAM_SCHEMAS, defaultsForTool } from '../../foundation/ToolParamSchemas.js';

// The pure-sculpt construction tools (Part tab → Sculpt group) the agent
// builds geometry with. Grounded in the actual ToolParamSchemas keys.
const SCULPT_TOOLS = Object.keys(TOOL_PARAM_SCHEMAS).filter(n => n.startsWith('Sculpt '));

// PARITY TARGET = Video-611: a commercial twin-engine AIRLINER. The
// curriculum is the airliner's subsystems, each a single-call body producer
// PLACED at its real aircraft coordinate (Z = nose+→tail−, Y up, X = span),
// so building the whole curriculum ASSEMBLES a coherent aeroplane. `placed`
// tells the loop to honour the part's own x/y/z (not spread it in a row).
// All grounded in real Sculpt tools (Loft = bodies of revolution along +Z,
// Crown Panel = lifting/airfoil surfaces).
const CURRICULUM = [
  { id: 'fuselage', subject: 'the fuselage barrel', tool: 'Sculpt Loft', kind: 'body', placed: true,
    params: { r1: 320, r2: 320, height: 4200, x: 0, y: 900, z: -2100, color: 0xeef0f2 } },
  // Curved ogive nose (radome) — three frustums of increasing slope
  // approximate the smooth inward curve of a real airliner nose, vs a single
  // sharp cone.
  { id: 'nose', subject: 'the ogive nose radome', kind: 'assembly', placed: true, steps: [
    { tool: 'Sculpt Loft', params: { r1: 320, r2: 286, height: 300, x: 0, y: 900, z: 2100, color: 0xeef0f2 } },
    { tool: 'Sculpt Loft', params: { r1: 286, r2: 196, height: 300, x: 0, y: 900, z: 2400, color: 0xeef0f2 } },
    { tool: 'Sculpt Loft', params: { r1: 196, r2: 46, height: 300, x: 0, y: 900, z: 2700, color: 0xeef0f2 } },
  ] },
  { id: 'tailcone', subject: 'the tail cone', tool: 'Sculpt Loft', kind: 'body', placed: true,
    params: { r1: 80, r2: 320, height: 1150, x: 0, y: 900, z: -3250, color: 0xeef0f2 } },
  { id: 'wingR', subject: 'the right main wing (swept, tapered, airfoil)', tool: 'Sculpt Wing', kind: 'surface', placed: true,
    params: { side: 'R', rootChord: 1500, tipChord: 520, span: 3400, sweepDeg: 27, dihedralDeg: 5, rootThick: 0.13, tipThick: 0.10, n: 24, x: 0, y: 820, z: -650, color: 0xdfe3e7 } },
  { id: 'wingL', subject: 'the left main wing (swept, tapered, airfoil)', tool: 'Sculpt Wing', kind: 'surface', placed: true,
    params: { side: 'L', rootChord: 1500, tipChord: 520, span: 3400, sweepDeg: 27, dihedralDeg: 5, rootThick: 0.13, tipThick: 0.10, n: 24, x: 0, y: 820, z: -650, color: 0xdfe3e7 } },
  { id: 'hstabR', subject: 'the right horizontal stabiliser (swept)', tool: 'Sculpt Wing', kind: 'surface', placed: true,
    params: { side: 'R', rootChord: 720, tipChord: 300, span: 1350, sweepDeg: 30, dihedralDeg: 4, rootThick: 0.10, tipThick: 0.08, n: 20, x: 0, y: 985, z: -2780, color: 0xdfe3e7 } },
  { id: 'hstabL', subject: 'the left horizontal stabiliser (swept)', tool: 'Sculpt Wing', kind: 'surface', placed: true,
    params: { side: 'L', rootChord: 720, tipChord: 300, span: 1350, sweepDeg: 30, dihedralDeg: 4, rootThick: 0.10, tipThick: 0.08, n: 20, x: 0, y: 985, z: -2780, color: 0xdfe3e7 } },
  { id: 'vfin', subject: 'the vertical fin (swept)', tool: 'Sculpt Wing', kind: 'surface', placed: true,
    params: { side: 'R', rootChord: 850, tipChord: 360, span: 950, sweepDeg: 40, dihedralDeg: 0, rootThick: 0.11, tipThick: 0.09, n: 20, rz: 90, x: 0, y: 1180, z: -2700, color: 0xdfe3e7 } },
  { id: 'engineL', subject: 'the left engine nacelle', tool: 'Sculpt Loft', kind: 'body', placed: true,
    params: { r1: 165, r2: 140, height: 820, x: -1550, y: 600, z: -150, color: 0xb9bcc1 } },
  { id: 'engineR', subject: 'the right engine nacelle', tool: 'Sculpt Loft', kind: 'body', placed: true,
    params: { r1: 165, r2: 140, height: 820, x: 1550, y: 600, z: -150, color: 0xb9bcc1 } },
  { id: 'pylonL', subject: 'the left engine pylon', tool: 'Sculpt Crown Panel', kind: 'surface', placed: true,
    params: { width: 90, length: 700, crownX: 10, crownZ: 0, thickness: 60, nu: 8, nv: 10, x: -1550, y: 760, z: -150, color: 0xdfe3e7 } },
  { id: 'pylonR', subject: 'the right engine pylon', tool: 'Sculpt Crown Panel', kind: 'surface', placed: true,
    params: { width: 90, length: 700, crownX: 10, crownZ: 0, thickness: 60, nu: 8, nv: 10, x: 1550, y: 760, z: -150, color: 0xdfe3e7 } },
  { id: 'windows', subject: 'the cabin window band', tool: 'Sculpt Perforated Panel', kind: 'surface', placed: true,
    params: { w: 3000, h: 90, t: 30, holeR: 18, cols: 34, rows: 1, spacing: 86, x: 0, y: 1040, z: -600, color: 0x10181f } },
  { id: 'titles', subject: 'the fuselage titles', tool: 'Sculpt Embossed Text', kind: 'surface', placed: true,
    params: { text: 'ARCHDISC', size: 180, depth: 18, x: -300, y: 1080, z: 360, color: 0x1a3a6a } },

  // ── DETAIL TIER — pushing PAST 1:1: real turbofan fans (hub + radial
  //    blades), landing gear (strut + wheel), winglets. Multi-step
  //    assemblies that compose existing Sculpt tools in one cycle.
  { id: 'fanL', subject: 'the left turbofan fan', kind: 'assembly', placed: true, steps: [
    { tool: 'Sculpt Rectangle', params: { cx: 95, cy: 0, w: 120, h: 24, plane: 'XY' } },
    { tool: 'Sculpt Circular Pattern', params: { mode: 'extrude', count: 24, distance: 16, angle: 360 } },
    { tool: 'Sculpt Circle', params: { cx: 0, cy: 0, r: 52, plane: 'XY' } },
    { tool: 'Sculpt Extrude', params: { distance: 16 } },
    { tool: 'Sculpt Place Body', params: { x: -1550, y: 600, z: 690, color: 0x16191c } },
  ] },
  { id: 'fanR', subject: 'the right turbofan fan', kind: 'assembly', placed: true, steps: [
    { tool: 'Sculpt Rectangle', params: { cx: 95, cy: 0, w: 120, h: 24, plane: 'XY' } },
    { tool: 'Sculpt Circular Pattern', params: { mode: 'extrude', count: 24, distance: 16, angle: 360 } },
    { tool: 'Sculpt Circle', params: { cx: 0, cy: 0, r: 52, plane: 'XY' } },
    { tool: 'Sculpt Extrude', params: { distance: 16 } },
    { tool: 'Sculpt Place Body', params: { x: 1550, y: 600, z: 690, color: 0x16191c } },
  ] },
  { id: 'gearNose', subject: 'the nose landing gear', kind: 'assembly', placed: true, steps: [
    { tool: 'Sculpt Circle', params: { cx: 0, cy: 0, r: 22, plane: 'XY' } },
    { tool: 'Sculpt Extrude', params: { distance: 420 } },
    { tool: 'Sculpt Place Body', params: { rx: 90, x: 0, y: 560, z: 1450, color: 0x2a2e34 } },
    { tool: 'Sculpt Tire', params: { rimR: 36, outerR: 85, width: 60, treadCount: 14, treadDepth: 8, axis: 'X', x: 0, y: 130, z: 1450, color: 0x141414 } },
  ] },
  { id: 'gearMainL', subject: 'the left main gear', kind: 'assembly', placed: true, steps: [
    { tool: 'Sculpt Circle', params: { cx: 0, cy: 0, r: 26, plane: 'XY' } },
    { tool: 'Sculpt Extrude', params: { distance: 440 } },
    { tool: 'Sculpt Place Body', params: { rx: 90, x: -650, y: 560, z: -650, color: 0x2a2e34 } },
    { tool: 'Sculpt Tire', params: { rimR: 42, outerR: 100, width: 80, treadCount: 16, treadDepth: 8, axis: 'X', x: -650, y: 120, z: -650, color: 0x141414 } },
  ] },
  { id: 'gearMainR', subject: 'the right main gear', kind: 'assembly', placed: true, steps: [
    { tool: 'Sculpt Circle', params: { cx: 0, cy: 0, r: 26, plane: 'XY' } },
    { tool: 'Sculpt Extrude', params: { distance: 440 } },
    { tool: 'Sculpt Place Body', params: { rx: 90, x: 650, y: 560, z: -650, color: 0x2a2e34 } },
    { tool: 'Sculpt Tire', params: { rimR: 42, outerR: 100, width: 80, treadCount: 16, treadDepth: 8, axis: 'X', x: 650, y: 120, z: -650, color: 0x141414 } },
  ] },
  { id: 'wingletL', subject: 'the left winglet', tool: 'Sculpt Crown Panel', kind: 'surface', placed: true,
    params: { width: 230, length: 470, crownX: 18, crownZ: 0, thickness: 46, nu: 8, nv: 8, rz: 78, x: -3380, y: 1130, z: -1880, color: 0xdfe3e7 } },
  { id: 'wingletR', subject: 'the right winglet', tool: 'Sculpt Crown Panel', kind: 'surface', placed: true,
    params: { width: 230, length: 470, crownX: 18, crownZ: 0, thickness: 46, nu: 8, nv: 8, rz: -78, x: 3380, y: 1130, z: -1880, color: 0xdfe3e7 } },

  // ── Finer detail — flight-deck glazing + engine exhaust cones.
  { id: 'cockpit', subject: 'the flight-deck windscreen', tool: 'Sculpt Crown Panel', kind: 'surface', placed: true,
    params: { width: 300, length: 360, crownX: 60, crownZ: 30, thickness: 26, nu: 14, nv: 12, rx: -28, x: 0, y: 1140, z: 1480, color: 0x0a0e12 } },
  { id: 'exhaustL', subject: 'the left engine exhaust cone', tool: 'Sculpt Loft', kind: 'body', placed: true,
    params: { r1: 130, r2: 42, height: 300, x: -1550, y: 600, z: -700, color: 0x191c1f } },
  { id: 'exhaustR', subject: 'the right engine exhaust cone', tool: 'Sculpt Loft', kind: 'body', placed: true,
    params: { r1: 130, r2: 42, height: 300, x: 1550, y: 600, z: -700, color: 0x191c1f } },
];

export class MechCapabilityMap {
  constructor() {
    this.sculptTools = SCULPT_TOOLS;
    this.curriculum = CURRICULUM;
    this.allTools = TOOL_REGISTRY.map(t => t.name);
  }

  /** Default params for a sculpt tool (so the agent always has valid dials). */
  defaultsFor(tool) { return defaultsForTool(tool); }

  /** A curriculum entry merged with the tool's real defaults. Multi-step
   * (assembly) entries carry their own full `steps` and pass through. */
  resolveCurriculum(entry) {
    if (Array.isArray(entry.steps)) return { ...entry };
    return { ...entry, params: { ...this.defaultsFor(entry.tool), ...(entry.params || {}) } };
  }

  /** Curriculum entries the agent has NOT built yet (per memory's built set). */
  unbuilt(builtIds = []) {
    const done = new Set(builtIds);
    return this.curriculum.filter(c => !done.has(c.id));
  }

  /** The FULL ribbon-tool surface (CAD + CAM + CAE), grouped by tab, with
   *  each tool's purpose — so Archie knows every capability, not just the
   *  sculpt construction tools. */
  toolCatalog() {
    const byTab = {};
    for (const t of TOOL_REGISTRY) (byTab[t.tab] = byTab[t.tab] || []).push(t);
    const lines = ['Full ribbon-tool surface (CAD + CAM + CAE):'];
    for (const tab of Object.keys(byTab)) {
      lines.push(`  ${tab} tab:`);
      for (const t of byTab[tab]) lines.push(`    - ${t.name} [${t.category}]: ${t.description}`);
    }
    return lines.join('\n');
  }

  /** The exact B-rep / NURBS kernel op surface — the precise geometry
   *  foundation beneath the mesh tools. Stated statically (kernel-free) so
   *  this module never pulls the kernel WASM at import. */
  kernelSummary() {
    return [
      'Exact B-rep / NURBS kernel (ArchDiscKernel facade, ~44 ops) — the precise',
      'geometry engine beneath the mesh tools:',
      '  - Primitives: box, cylinder, sphere, cone, torus',
      '  - Booleans: fuse / cut / common + fuseAll / non-manifold / coincident / lattice',
      '  - Features: extrude, revolve, fillet, chamfer, variable-radius fillet, profile extrude/revolve/sweep',
      '  - Local ops: shell, thicken, offset, draft',
      '  - Surfacing: sweep, loft, pipe-shell sweep, tangent loft, stitch faces, convergent solid',
      '  - NURBS: build/refine/elevate/curvature, auto-trim B-rep, surface-surface intersection, trimmed face',
      '  - Blends: G2/G3 edge blends, cliff-edge, mitre/setback corners, face-face, hold-line, n-sided patch',
      '  - Sheet metal: base/edge flange, flat pattern, hem, jog, miter flange, sketched bend',
      '  - Healing: simplify, auto-fill faces, auto-repair self-intersection, harmonize normals',
      '  - Direct modeling: push/pull face, move face, delete-face-and-heal, feature infer',
      '  - Sections: planar section, imprint, partition, replace face; subdivide; retopology',
      '  - Inspect: point classify, ray fire, curve/surface eval, mass properties, adjacency, Class-A zebra',
      '  - Data exchange: STEP AP242 + IGES import/export, faceting / hidden-line',
      'A custom exact-kernel WASM build is in progress to deepen this',
      '(auto-trim NURBS, true G2 variational blends, parametric trim curves).',
    ].join('\n');
  }

  /** The engineering domains Archie spans — every discipline rides on the
   *  one exact-geometry substrate. */
  engineeringDomains() {
    return [
      'Engineering domains (all on one exact-geometry substrate):',
      '  - CAD: sketch + part modelling (atomic Sculpt tools AND the exact B-rep kernel)',
      '  - CAM: 2.5/3-axis milling G-code, pocket clearing, post-processing, additive slice preview',
      '  - CAE: static/modal/buckling/frame/rotordynamics FEA, steady thermal, CFD, fatigue,',
      '    forced vibration, stress concentration, topology optimization',
      '  - Machine elements: bearing life, gear mesh, shaft sizing, bolted joint, spring, pressure vessel',
      '  - Propulsion: Brayton cycle, compressor/turbine stage, combustor, nozzle, blade cooling, heat exchanger, mission',
      '  - Assembly + kinematics: mates, motion study, mass properties',
      '  - Hand-off: 3-view/section drawings, STL/STEP/glTF export, costing, DFM, quotes',
    ].join('\n');
  }

  /** Concise, durable facts seeded into AgentMemory so Archie is familiar
   *  with the WHOLE platform every session ("burned in"). */
  knowledgeFacts() {
    const s = registrySummary();
    return [
      `Mech is a full CAD/CAM/CAE platform: ${s.total} ribbon tools across ${Object.keys(s.byTab).join(', ')} tabs, ~24 atomic Sculpt construction tools, and a ~44-op exact B-rep/NURBS kernel.`,
      'CAD = sketch + part modelling via the Sculpt tools AND the exact B-rep kernel (primitives, booleans, features, surfacing, NURBS, blends, sheet-metal, healing, direct ops, sections).',
      'CAM = milling G-code (2.5/3-axis), pocket clearing, post-processing, additive slicing.',
      'CAE = FEA (static/modal/buckling/frame/rotordynamics), thermal, CFD, fatigue, vibration, topology optimization, plus machine-element + propulsion calculators.',
      'Data exchange: STEP AP242, IGES, STL, glTF — in and out.',
      'The exact-geometry substrate is the ArchDisc B-rep kernel; a custom exact-kernel WASM build is underway to deepen it (auto-trim NURBS, true G2 blends, parametric trim).',
      'Archie builds via the real ribbon tools (no bypass), self-critiques with machine vision over its own render, learns reusable skills, curates memory, and works non-stop toward 1:1-or-better parity with the reference.',
    ];
  }

  /** Compact-but-COMPLETE grounding text for an LLM self-director / planner —
   *  the full platform, not just the sculpt tools. */
  groundingSummary() {
    return [
      'ArchDisc Mech — your complete capability surface (you, Archie, are fully familiar with all of it):',
      '',
      'Atomic Sculpt construction tools (build geometry from scratch):',
      ...this.sculptTools.map(t => `  - ${t}`),
      '',
      this.toolCatalog(),
      '',
      this.kernelSummary(),
      '',
      this.engineeringDomains(),
      '',
      'Current parity curriculum (the airliner you assemble subsystem-by-subsystem):',
      ...this.curriculum.map(c => `  • ${c.id}: ${c.subject}${c.tool ? ` via "${c.tool}"` : ' (multi-step assembly)'}`),
      '',
      'You may compose multiple tools into an assembly in one cycle.',
    ].join('\n');
  }
}

export const capabilityMap = new MechCapabilityMap();
