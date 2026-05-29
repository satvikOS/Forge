/**
 * AutonomousLoop — the non-stop, self-directed, self-improving agent loop
 * for ArchDisc Mech. This is Archie — ArchDisc's autonomous agent, for CAD:
 * instead of waiting for a human prompt, it directs ITSELF, builds real
 * geometry with Mech's own tools, critiques the result, learns a skill,
 * curates memory, and immediately starts the next cycle — forever (until
 * stopped).
 *
 *   observe → self-direct a goal → (reuse skill | plan) → execute via the
 *   real ribbon tool → self-critique → learn (skill + memory + nudge) →
 *   persist → repeat
 *
 * Decoupled from the workbench: the caller injects `executeTool`, a viewport
 * getter, and (optionally) a per-cycle callback + LLM provider config. State
 * is mirrored on `window.__archdiscAgent` for the UI + e2e introspection.
 */

import { capabilityMap } from './MechCapabilityMap.js';
import { AgentMemory } from './AgentMemory.js';
import { SkillLibrary } from './SkillLibrary.js';
import { SelfDirector } from './SelfDirector.js';
import { SelfCritic } from './SelfCritic.js';
import { ParityObjective } from './ParityObjective.js';
import { Perception } from './Perception.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Human-readable label for the model Archie is harnessing (cloud or local). */
function brainLabel(cfg) {
  if (!cfg || !cfg.provider) return 'heuristic (no model connected)';
  const local = cfg.baseUrl && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(cfg.baseUrl);
  return `${cfg.provider}${cfg.model ? ':' + cfg.model : ''}${local ? ' (local)' : ' (cloud)'}`;
}

export class AutonomousLoop {
  /**
   * @param {object} deps
   * @param {(group:string,tool:string,scene:object,viewport:object)=>Promise} deps.executeTool
   * @param {()=>object} deps.getViewport   returns { scene, camera, ... } (window.__archdiscViewport)
   * @param {object=} deps.providerCfg       BYO-LLM config (optional)
   * @param {(evt:object)=>void=} deps.onCycle
   * @param {number=} deps.cycleDelayMs       pause between cycles (watchable)
   */
  constructor(deps = {}) {
    this.executeTool = deps.executeTool;
    this.getViewport = deps.getViewport || (() => (typeof window !== 'undefined' ? window.__archdiscViewport : null));
    this.onCycle = deps.onCycle || (() => {});
    this.cycleDelayMs = deps.cycleDelayMs ?? 350;
    this.memory = new AgentMemory();
    this.skills = new SkillLibrary();
    this.director = new SelfDirector({ providerCfg: deps.providerCfg });
    this.brain = brainLabel(deps.providerCfg);
    this.critic = new SelfCritic();
    this.perception = new Perception();
    this.lastCoverage = 0;
    this.parity = new ParityObjective(deps.parityTarget ?? 1.0);
    this.refinements = 0;
    this.parityReachedAt = null;   // cycle at which 1:1 was first reached
    this.running = false;
    this.cycle = 0;
    this.maxCycles = 0;          // 0 = forever — Archie works non-stop toward parity
    this.log = [];
    this.currentGoal = null;
    this._mirror();
  }

  bodyCount() {
    try { return (typeof window !== 'undefined' && window.__archdiscRegistry?.list?.() || []).length; }
    catch { return 0; }
  }
  lastVolume() {
    try {
      const list = window.__archdiscRegistry?.list?.() || [];
      const last = list[list.length - 1];
      return last?.manifold?.volume ? last.manifold.volume() : null;
    } catch { return null; }
  }

  /** Start the non-stop loop. Returns immediately; loop runs in background. */
  start({ maxCycles = 0, reset = false } = {}) {
    if (this.running) return;
    if (reset) { this.memory.reset(); this.skills.reset(); this.cycle = 0; this.log = []; }
    this.maxCycles = maxCycles;
    this.running = true;
    this._mirror();
    this._run();   // not awaited — perpetual
  }

  stop() { this.running = false; this._mirror(); }

  async _run() {
    while (this.running && (this.maxCycles <= 0 || this.cycle < this.maxCycles)) {
      try { await this._cycle(); }
      catch (err) { this._record({ cycle: this.cycle, error: err.message }); }
      if (!this.running) break;
      await sleep(this.cycleDelayMs);
    }
    this.running = false;
    this._mirror();
  }

  async _cycle() {
    this.cycle += 1;
    const viewport = this.getViewport();
    const scene = viewport?.scene;

    // 1. observe + 2. self-direct
    const recall = this.memory.recall();
    const goal = await this.director.nextGoal(recall);
    this.currentGoal = goal;
    this._mirror();

    // 3. resolve the build recipe — a learned skill (reuse/improve) wins;
    //    else the goal. Multi-step subsystems (fans, gear, swept wings)
    //    carry `steps` (a sequence of tool calls); simple parts carry a
    //    single `tool`+`params`.
    const skill = this.skills.match(goal.goalId);
    let steps;
    if (skill && Array.isArray(skill.steps) && skill.steps.length) {
      steps = skill.steps;
    } else if (Array.isArray(goal.steps) && goal.steps.length) {
      steps = goal.steps;
    } else {
      const params = skill && skill.params ? { ...goal.params, ...skill.params } : { ...goal.params };
      const tool = (skill && skill.tool) || goal.tool;
      // un-placed standalone parts get spread along X so they stay readable
      const p = goal.placed ? params : { ...params, x: (this.cycle - 1) * 750 };
      steps = [{ tool, params: p }];
    }

    // 4. execute each step via the REAL ribbon tool (params injected → no dialog)
    const before = this.bodyCount();
    let result = { status: 'error', message: 'executeTool unavailable' };
    for (const st of steps) {
      if (typeof window !== 'undefined') {
        window.__archdiscPlanParams = window.__archdiscPlanParams || {};
        window.__archdiscPlanParams[st.tool] = st.params || {};
      }
      if (this.executeTool && scene && viewport) {
        result = await this.executeTool('part', st.tool, scene, viewport);
      }
    }
    const after = this.bodyCount();

    // 4b. PERCEIVE — Archie looks at its own render (machine vision over
    //     the actual pixels), so it knows the build is really on screen.
    const coverageBefore = this.lastCoverage;
    const percept = this.perception.perceive(viewport) || {};
    const coverageAfter = (typeof percept.coverage === 'number') ? percept.coverage : coverageBefore;
    this.lastCoverage = coverageAfter;

    // 5. self-critique (perception-aware)
    const verdict = this.critic.critique({ result, bodiesBefore: before, bodiesAfter: after, lastVolume: this.lastVolume(), coverageBefore, coverageAfter });

    // 6. learn — skill (auto-create/improve) + memory + nudge
    const recipeTool = goal.tool || (steps[0] && steps[0].tool) || null;
    const run = {
      goalId: goal.goalId, subject: goal.subject,
      tool: recipeTool, params: steps.length === 1 ? steps[0].params : undefined,
      steps, score: verdict.score, ok: verdict.ok,
      status: result.status, source: goal.source,
    };
    const skillOutcome = this.skills.learnFromRun(run);
    this.memory.recordRun(run);
    const nudge = this.memory.maybeNudge();
    if (verdict.notes?.length) this.memory.addLearning(`[${goal.goalId}] ${verdict.notes.join('; ')}`, 'critic');

    // 7. parity — the whole point: track progress toward 1:1-or-better.
    if (goal.kind === 'refine') this.refinements += 1;
    const parityScore = this.parity.score(this.memory.builtIds, this.refinements);
    const parityMet = parityScore >= this.parity.target;
    if (parityMet && this.parityReachedAt === null) {
      this.parityReachedAt = this.cycle;
      this.memory.addLearning(`1:1 parity reached at cycle ${this.cycle} — now working for BETTER.`, 'parity');
    }

    // 8. emit
    this._record({
      cycle: this.cycle, goal: goal.subject, goalId: goal.goalId, tool: recipeTool,
      steps: steps.length, source: goal.source, score: +verdict.score.toFixed(2), ok: verdict.ok,
      skill: skillOutcome.action, nudge: !!nudge, parity: parityScore,
      coverage: coverageAfter, message: result.message,
    });
  }

  _record(evt) {
    this.log.push({ at: Date.now(), ...evt });
    if (this.log.length > 200) this.log = this.log.slice(-200);
    this._mirror();
    try { this.onCycle(evt); } catch { /* UI best-effort */ }
  }

  state() {
    const parityScore = this.parity.score(this.memory.builtIds, this.refinements);
    return {
      running: this.running, cycle: this.cycle, maxCycles: this.maxCycles,
      brain: this.brain,
      goal: 'work non-stop until 1:1-or-better parity with the reference',
      parityScore, parityTarget: this.parity.target,
      parityMet: parityScore >= this.parity.target,
      parityReachedAt: this.parityReachedAt,
      perception: this.perception.last,
      unmet: this.parity.unmet(this.memory.builtIds).map(r => r.id),
      currentGoal: this.currentGoal,
      builtIds: this.memory.builtIds,
      skills: this.skills.list().map(s => ({ name: s.name, version: s.version, used: s.successCount, score: s.score })),
      learnings: this.memory.learnings.slice(-6).map(l => l.text),
      log: this.log.slice(-12),
    };
  }

  _mirror() {
    if (typeof window !== 'undefined') window.__archdiscAgent = this.state();
  }
}

// Lazily-constructed singleton, wired by the workbench.
let _instance = null;
export function getAutonomousLoop(deps) {
  if (!_instance && deps) _instance = new AutonomousLoop(deps);
  else if (_instance && deps) {
    // refresh injected deps (new viewport/provider on remount)
    if (deps.executeTool) _instance.executeTool = deps.executeTool;
    if (deps.getViewport) _instance.getViewport = deps.getViewport;
    if (deps.providerCfg) { _instance.director = new SelfDirector({ providerCfg: deps.providerCfg }); _instance.brain = brainLabel(deps.providerCfg); }
    if (deps.onCycle) _instance.onCycle = deps.onCycle;
  }
  return _instance;
}
