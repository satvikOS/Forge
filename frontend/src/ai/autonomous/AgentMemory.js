/**
 * AgentMemory — persistent, curated, cross-session memory for the
 * autonomous agent (Archie). A closed memory loop (a curated memory store +
 * periodic "nudges"): the agent accumulates durable facts about the
 * project and itself, distils recent runs into learnings on a cadence,
 * and recalls them to ground the next goal.
 *
 * Storage: localStorage in-app (key `archdisc.agent.memory`), with a live
 * mirror on `window.__archdiscAgentMemory` for introspection + e2e.
 */

const KEY = 'archdisc.agent.memory';

function load() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    }
  } catch { /* private mode / quota — fall through to fresh */ }
  return null;
}

export class AgentMemory {
  constructor() {
    const s = load() || {};
    this.builtIds = s.builtIds || [];          // curriculum ids completed
    this.learnings = s.learnings || [];        // durable distilled facts
    this.runs = s.runs || [];                  // recent run records (capped)
    this.profile = s.profile || { focus: 'mechanical components', cyclesEver: 0 };
    this.itersSinceNudge = s.itersSinceNudge || 0;
    this.nudgeInterval = s.nudgeInterval || 4;  // distil every N runs
    this._mirror();
  }

  /** Record one completed run (goal + outcome). Caps the run log. */
  recordRun(run) {
    this.runs.push({ at: new Date().toISOString(), ...run });
    if (this.runs.length > 50) this.runs = this.runs.slice(-50);
    if (run.goalId && run.ok && !this.builtIds.includes(run.goalId)) this.builtIds.push(run.goalId);
    this.profile.cyclesEver = (this.profile.cyclesEver || 0) + 1;
    this.itersSinceNudge += 1;
    this.persist();
  }

  /** Add a durable learning (deduped by text). */
  addLearning(text, source = 'agent') {
    if (!text) return;
    if (this.learnings.some(l => l.text === text)) return;
    this.learnings.push({ text, source, at: new Date().toISOString() });
    if (this.learnings.length > 80) this.learnings = this.learnings.slice(-80);
    this.persist();
  }

  /**
   * Memory nudge: once enough runs have accrued, distil
   * them into a durable learning and reset the counter. Returns the
   * learning text if a nudge fired, else null. Best-effort + deterministic.
   */
  maybeNudge() {
    if (this.itersSinceNudge < this.nudgeInterval) return null;
    this.itersSinceNudge = 0;
    const recent = this.runs.slice(-this.nudgeInterval);
    const okCount = recent.filter(r => r.ok).length;
    const tools = [...new Set(recent.map(r => r.tool).filter(Boolean))];
    const text = `Across the last ${recent.length} cycles ${okCount} succeeded; exercised ${tools.join(', ') || 'no'} tools. Built so far: ${this.builtIds.length} of the curriculum.`;
    this.addLearning(text, 'nudge');
    return text;
  }

  /** Recall context relevant to planning the next goal. */
  recall() {
    return {
      builtIds: [...this.builtIds],
      recentLearnings: this.learnings.slice(-6).map(l => l.text),
      cyclesEver: this.profile.cyclesEver,
    };
  }

  /** Compact text for grounding an LLM. */
  summaryText() {
    const lines = [`Project memory (${this.profile.cyclesEver} cycles ever):`];
    if (this.builtIds.length) lines.push(`Built: ${this.builtIds.join(', ')}`);
    if (this.learnings.length) {
      lines.push('Learnings:');
      for (const l of this.learnings.slice(-6)) lines.push(`  - ${l.text}`);
    }
    return lines.join('\n');
  }

  persist() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(this._state()));
    } catch { /* ignore quota */ }
    this._mirror();
  }

  _state() {
    return {
      builtIds: this.builtIds, learnings: this.learnings, runs: this.runs,
      profile: this.profile, itersSinceNudge: this.itersSinceNudge, nudgeInterval: this.nudgeInterval,
    };
  }

  _mirror() {
    if (typeof window !== 'undefined') window.__archdiscAgentMemory = this._state();
  }

  /** Wipe (for a clean autonomous run / tests). */
  reset() {
    this.builtIds = []; this.learnings = []; this.runs = [];
    this.profile = { focus: 'mechanical components', cyclesEver: 0 };
    this.itersSinceNudge = 0;
    this.persist();
  }
}
