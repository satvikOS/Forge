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
   * @returns {{ score:number, ok:boolean, notes:string[] }}
   */
  critique(obs) {
    const notes = [];
    let score = 0;
    const status = obs?.result?.status;
    if (status === 'success') { score += 0.5; }
    else if (status === 'warn') { notes.push('tool returned a warning'); }
    else { notes.push(`tool status: ${status || 'unknown'}`); }

    const grew = (obs.bodiesAfter ?? 0) > (obs.bodiesBefore ?? 0);
    if (grew) { score += 0.3; notes.push('a new body was registered'); }
    else { notes.push('no new body appeared'); }

    if (typeof obs.lastVolume === 'number') {
      if (obs.lastVolume > 0) { score += 0.2; }
      else { notes.push('manifold volume is not positive — inverted/empty geometry'); }
    }

    const ok = status === 'success' && grew;
    if (ok && score >= 0.9) notes.push('clean build');
    return { score: Math.min(1, score), ok, notes };
  }
}
