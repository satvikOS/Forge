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

  /** Compact grounding text for an LLM self-director / planner. */
  groundingSummary() {
    return [
      'ArchDisc Mech — sculpt-construction capabilities you (the agent) can use:',
      ...this.curriculum.map(c => `  • ${c.id}: build ${c.subject} via "${c.tool}"`),
      '',
      'You may also compose multiple sculpt tools into an assembly. Full tool registry:',
      registrySummary(),
    ].join('\n');
  }
}

export const capabilityMap = new MechCapabilityMap();
