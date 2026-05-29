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

// A curriculum of buildable subjects, ordered easy→hard, each expressed as
// a tool + the dial-overrides that make it a recognisable real component.
// The SelfDirector walks this when no LLM is configured, so the agent is
// productive fully offline. Every entry is a REAL Mech capability.
// Every entry is a SINGLE-CALL body producer (one tool → one registered
// body) so the agent can build it hands-free in one cycle.
const CURRICULUM = [
  { id: 'gear', subject: 'a spur gear', tool: 'Sculpt Gear', kind: 'component',
    params: { module: 8, teeth: 24, thickness: 90, boreR: 50 } },
  { id: 'spring', subject: 'a helical spring', tool: 'Sculpt Spring', kind: 'component',
    params: { coilR: 110, wireR: 18, pitch: 80, turns: 7 } },
  { id: 'bearing', subject: 'a ball bearing', tool: 'Sculpt Bearing', kind: 'component',
    params: { boreR: 70, outerR: 150, width: 80, balls: 10 } },
  { id: 'thread', subject: 'a threaded rod', tool: 'Sculpt Thread', kind: 'component',
    params: { length: 500, majorR: 70, pitch: 60, threadDepth: 16 } },
  { id: 'cam', subject: 'a radial cam', tool: 'Sculpt Cam', kind: 'component',
    params: { baseR: 110, lift: 60, noseWidth: 120, thickness: 90, boreR: 40 } },
  { id: 'crown', subject: 'a Class-A crowned panel', tool: 'Sculpt Crown Panel', kind: 'surface',
    params: { width: 1800, length: 2000, crownX: 120, crownZ: 90, thickness: 50 } },
  { id: 'pipe', subject: 'a swept pipe', tool: 'Sculpt Pipe', kind: 'component',
    params: { radius: 60, x2: 0, y2: 900, z2: 0, bend: 200 } },
  { id: 'flex', subject: 'a corrugated flex pipe', tool: 'Sculpt Flex Pipe', kind: 'component',
    params: { length: 600, radius: 90, amplitude: 24, convolutions: 12 } },
  { id: 'grille', subject: 'a perforated grille', tool: 'Sculpt Perforated Panel', kind: 'surface',
    params: { w: 1400, h: 700, t: 40, holeR: 14, cols: 26, rows: 12, spacing: 50 } },
  { id: 'tire', subject: 'a tread-wrapped tyre', tool: 'Sculpt Tire', kind: 'component',
    params: { rimR: 286, outerR: 537, width: 315, treadCount: 28, axis: 'X' } },
  { id: 'badge', subject: 'an embossed VOLVO badge', tool: 'Sculpt Embossed Text', kind: 'surface',
    params: { text: 'ARCHDISC', size: 280, depth: 40 } },
  { id: 'fasteners', subject: 'an instanced bolt array', tool: 'Sculpt Bolt Array', kind: 'instanced',
    params: { count: 120, layout: 'grid', spacing: 60 } },
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
