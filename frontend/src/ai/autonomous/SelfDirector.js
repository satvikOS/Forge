/**
 * SelfDirector — the agent's autonomy: it decides its OWN next goal with no
 * human prompt — Archie's self-direction, grounded entirely in the
 * MechCapabilityMap so every self-set goal is a real Mech build.
 *
 * Two modes:
 *   • LLM (when a provider is configured): ask the model, grounded in the
 *     capability map + project memory, for the next valuable build.
 *   • Heuristic (fully offline / default): walk the capability curriculum
 *     in order — building each un-built component — then graduate to
 *     composing learned components into assemblies. Deterministic (no RNG),
 *     so an autonomous run is reproducible.
 */

import { capabilityMap } from './MechCapabilityMap.js';
import { PROVIDERS } from '../PlannerProviders.js';

export class SelfDirector {
  constructor({ providerCfg } = {}) {
    this.providerCfg = providerCfg || null;
  }

  /**
   * Choose the next goal.
   * @param {object} recall  AgentMemory.recall() — { builtIds, recentLearnings, cyclesEver }
   * @returns {Promise<{goalId, subject, tool, params, kind, source}>}
   */
  async nextGoal(recall) {
    const built = recall?.builtIds || [];
    const llm = this.providerCfg && PROVIDERS[this.providerCfg.provider];
    if (llm) {
      try {
        const g = await this._llmGoal(llm, recall);
        if (g) return { ...g, source: 'llm' };
      } catch { /* fall through to heuristic */ }
    }
    return this._heuristicGoal(built, recall?.cyclesEver || 0);
  }

  _heuristicGoal(built, cyclesEver) {
    const unbuilt = capabilityMap.unbuilt(built);
    if (unbuilt.length) {
      const c = capabilityMap.resolveCurriculum(unbuilt[0]);
      return { goalId: c.id, subject: c.subject, tool: c.tool, params: c.params, kind: c.kind, placed: c.placed, source: 'heuristic' };
    }
    // Curriculum exhausted → graduate to refining learned components, a
    // deterministic round-robin keyed on total cycles so each refine
    // targets a DIFFERENT component (and reuses/improves its skill).
    const all = capabilityMap.curriculum;
    const idx = cyclesEver % all.length;
    const c = capabilityMap.resolveCurriculum(all[idx]);
    return { goalId: c.id, subject: `${c.subject} (refine)`, tool: c.tool, params: c.params, kind: 'refine', placed: c.placed, source: 'heuristic' };
  }

  async _llmGoal(provider, recall) {
    const system = [
      'You direct an autonomous CAD agent inside ArchDisc Mech. Choose the single next component to build.',
      'Return ONLY JSON: {"goalId":"<curriculum id>","subject":"<short>","tool":"<exact Sculpt tool>","params":{}}.',
      capabilityMap.groundingSummary(),
    ].join('\n');
    const user = [
      `Already built: ${(recall?.builtIds || []).join(', ') || 'nothing yet'}.`,
      'Pick something NOT yet built when possible. JSON only.',
    ].join('\n');
    const text = await provider.generate({
      apiKey: this.providerCfg.apiKey, model: this.providerCfg.model,
      baseUrl: this.providerCfg.baseUrl, system, userMessage: user,
    });
    const m = text && text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    if (!obj.tool || !obj.goalId) return null;
    // Ground the LLM's params on the real tool defaults.
    return {
      goalId: obj.goalId, subject: obj.subject || obj.goalId, tool: obj.tool, kind: 'llm',
      params: { ...capabilityMap.defaultsFor(obj.tool), ...(obj.params || {}) },
    };
  }
}
