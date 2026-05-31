/**
 * SelfCritic — evaluates each autonomous build so the agent can learn from
 * it (Archie's self-evaluation feeding the learning loop). It scores a run
 * 0..1 from concrete, grounded signals — did a tool actually fire, did a
 * new body get registered, does that body have positive volume — and
 * emits short notes the SkillLibrary/AgentMemory turn into improvements.
 */

export class SelfCritic {
  /**
   * @param {object} obs
   * @param {object} obs.result      executeTool result { status, message }
   * @param {number} obs.bodiesBefore
   * @param {number} obs.bodiesAfter
   * @param {number|null} obs.lastVolume  volume of the newest foundation manifold (mm³)
   * @param {number=} obs.coverageBefore  perceived on-screen coverage before the build
   * @param {number=} obs.coverageAfter   perceived on-screen coverage after the build
   * @returns {{ score:number, ok:boolean, notes:string[] }}
   */
  critique(obs) {
    const notes = [];
    let score = 0;
    const status = obs?.result?.status;
    if (status === 'success') { score += 0.45; }
    else if (status === 'warn') { notes.push('tool returned a warning'); }
    else { notes.push(`tool status: ${status || 'unknown'}`); }

    const grew = (obs.bodiesAfter ?? 0) > (obs.bodiesBefore ?? 0);
    if (grew) { score += 0.25; notes.push('a new body was registered'); }
    else { notes.push('no new body appeared'); }

    if (typeof obs.lastVolume === 'number') {
      if (obs.lastVolume > 0) { score += 0.15; }
      else { notes.push('manifold volume is not positive — inverted/empty geometry'); }
    }

    // PERCEPTION signal: did the build actually put new pixels on screen?
    const seen = typeof obs.coverageAfter === 'number' && typeof obs.coverageBefore === 'number'
      && obs.coverageAfter > obs.coverageBefore + 0.0005;
    if (seen) { score += 0.15; notes.push('perceived new geometry on screen'); }
    else if (typeof obs.coverageAfter === 'number') { notes.push('no perceived change on screen'); }

    const ok = status === 'success' && grew;
    if (ok && score >= 0.9) notes.push('clean build');
    return { score: Math.min(1, score), ok, notes };
  }
}
