/**
 * ParityObjective — Archie's north star. Archie's whole purpose is to work
 * non-stop until the project reaches 1:1 (or better) parity with the
 * reference target (the Video-611 airliner). This module defines
 * what "parity" means as a concrete, measurable surface and scores how
 * close the agent currently is, so the loop can pursue it relentlessly.
 *
 * Parity score:
 *   base  = fraction of the required subsystem capabilities actually built
 *   bonus = "or better" — modest credit for refinement cycles once full
 *           coverage is reached, so >1.0 is achievable and the agent keeps
 *           improving rather than declaring victory at exactly 1:1.
 */

import { capabilityMap } from './MechCapabilityMap.js';

// The required subsystem capabilities for 1:1 parity = the full airliner
// build vocabulary (grounded in the capability curriculum). Building every
// one means Archie can construct the reference aircraft end-to-end.
const REQUIREMENTS = capabilityMap.curriculum.map(c => ({ id: c.id, subject: c.subject }));

export class ParityObjective {
  constructor(target = 1.0) {
    this.target = target;            // 1.0 = 1:1; >1 demands "better"
    this.requirements = REQUIREMENTS;
  }

  /** Requirements not yet built — what Archie should pursue next. */
  unmet(builtIds = []) {
    const done = new Set(builtIds);
    return this.requirements.filter(r => !done.has(r.id));
  }

  /** Parity score: 0..1 coverage + a refinement bonus past full coverage. */
  score(builtIds = [], refinements = 0) {
    const n = this.requirements.length || 1;
    const covered = this.requirements.filter(r => builtIds.includes(r.id)).length;
    const base = covered / n;
    const bonus = base >= 1 ? Math.min(0.5, refinements * 0.02) : 0;
    return +(base + bonus).toFixed(3);
  }

  /** Has 1:1 (or the configured better-than-1:1) parity been reached? */
  met(builtIds = [], refinements = 0) {
    return this.score(builtIds, refinements) >= this.target;
  }
}
