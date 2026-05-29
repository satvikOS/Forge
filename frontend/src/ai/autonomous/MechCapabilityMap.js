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
  { id: 'nose', subject: 'the nose cone', tool: 'Sculpt Loft', kind: 'body', placed: true,
    params: { r1: 320, r2: 55, height: 850, x: 0, y: 900, z: 2100, color: 0xeef0f2 } },
  { id: 'tailcone', subject: 'the tail cone', tool: 'Sculpt Loft', kind: 'body', placed: true,
    params: { r1: 80, r2: 320, height: 1150, x: 0, y: 900, z: -3250, color: 0xeef0f2 } },
  { id: 'wings', subject: 'the main wing', tool: 'Sculpt Crown Panel', kind: 'surface', placed: true,
    params: { width: 7200, length: 1150, crownX: 80, crownZ: 0, thickness: 110, nu: 26, nv: 14, x: 0, y: 900, z: -750, color: 0xdfe3e7 } },
  { id: 'hstab', subject: 'the horizontal stabiliser', tool: 'Sculpt Crown Panel', kind: 'surface', placed: true,
    params: { width: 2900, length: 600, crownX: 35, crownZ: 0, thickness: 70, nu: 18, nv: 10, x: 0, y: 980, z: -2750, color: 0xdfe3e7 } },
  { id: 'vfin', subject: 'the vertical fin', tool: 'Sculpt Crown Panel', kind: 'surface', placed: true,
    params: { width: 1100, length: 650, crownX: 35, crownZ: 0, thickness: 70, nu: 16, nv: 10, rz: 90, x: 0, y: 1380, z: -2650, color: 0xdfe3e7 } },
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
];

export class MechCapabilityMap {
  constructor() {
    this.sculptTools = SCULPT_TOOLS;
    this.curriculum = CURRICULUM;
    this.allTools = TOOL_REGISTRY.map(t => t.name);
  }

  /** Default params for a sculpt tool (so the agent always has valid dials). */
  defaultsFor(tool) { return defaultsForTool(tool); }

  /** A curriculum entry merged with the tool's real defaults. */
  resolveCurriculum(entry) {
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
