/**
 * SkillLibrary — procedural memory for the autonomous agent (Archie).
 * The skills system + closed learning loop:
 *   • AUTO-CREATE: after a complex task succeeds, distil it into a reusable
 *     skill (the tool sequence + params that worked).
 *   • SELF-IMPROVE: when a later run for the same goal scores higher, the
 *     skill is patched (better params, bumped version).
 *   • REUSE: the loop matches a goal to a learned skill and replays it
 *     instead of re-planning from scratch.
 *
 * A "skill" here is a named, versioned, replayable recipe (the agent's
 * procedural memory). Persisted to localStorage
 * (`archdisc.agent.skills`) + mirrored on `window.__archdiscAgentSkills`.
 */

const KEY = 'archdisc.agent.skills';

function load() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    }
  } catch { /* fall through */ }
  return {};
}

export class SkillLibrary {
  constructor() {
    this.skills = load() || {};   // goalId -> skill
    this._mirror();
  }

  /** Find a learned skill for a goal id. */
  match(goalId) { return this.skills[goalId] || null; }

  list() { return Object.values(this.skills); }

  /**
   * Auto-create or self-improve a skill from a completed run.
   * Returns { action: 'created'|'improved'|'kept', skill }.
   *
   * @param {object} run  { goalId, subject, tool, params, steps, score, ok }
   */
  learnFromRun(run) {
    if (!run || !run.ok || !run.goalId) return { action: 'kept', skill: null };
    const existing = this.skills[run.goalId];
    if (!existing) {
      const skill = {
        name: `build-${run.goalId}`,
        goalId: run.goalId,
        description: `Build ${run.subject || run.goalId} (auto-created from a successful run).`,
        tool: run.tool || null,
        params: run.params || {},
        steps: run.steps || (run.tool ? [{ tool: run.tool, params: run.params || {} }] : []),
        score: run.score ?? 1,
        version: 1,
        successCount: 1,
        createdAt: new Date().toISOString(),
        lastImproved: null,
      };
      this.skills[run.goalId] = skill;
      this.persist();
      return { action: 'created', skill };
    }
    // Self-improve: a strictly better run replaces the recipe.
    existing.successCount = (existing.successCount || 0) + 1;
    if ((run.score ?? 0) > (existing.score ?? 0)) {
      existing.params = run.params || existing.params;
      existing.steps = run.steps || existing.steps;
      existing.score = run.score;
      existing.version = (existing.version || 1) + 1;
      existing.lastImproved = new Date().toISOString();
      this.persist();
      return { action: 'improved', skill: existing };
    }
    this.persist();
    return { action: 'kept', skill: existing };
  }

  summaryText() {
    const all = this.list();
    if (!all.length) return 'No skills learned yet.';
    return ['Learned skills:', ...all.map(s => `  • ${s.name} v${s.version} (used ${s.successCount}×, score ${s.score})`)].join('\n');
  }

  persist() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(this.skills));
    } catch { /* ignore */ }
    this._mirror();
  }

  _mirror() {
    if (typeof window !== 'undefined') window.__archdiscAgentSkills = this.skills;
  }

  reset() { this.skills = {}; this.persist(); }
}
