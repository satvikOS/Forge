/**
 * ArchDisc AI Session Memory + Decision Log.
 *
 * In-memory store of everything the AI orchestration knows about
 * the current design session:
 *   - User prompt
 *   - Detected domain + clarification answers
 *   - Plan (validated)
 *   - Step-by-step results from PlanExecutor
 *   - Verifier outputs (violations)
 *   - Manual overrides (when the user changes a parameter mid-plan)
 *   - Decisions made and their reasoning
 *
 * Serializable to JSON for persistence (drop to localStorage,
 * IndexedDB, or send to backend for cross-session memory).
 *
 * Decision log = an append-only event stream. Every change records
 * who/when/why so the design audit trail (which CS-E + AS9100 both
 * require) is captured automatically.
 */

export class SessionMemory {
  constructor(initial = {}) {
    this.sessionId = initial.sessionId ?? cryptoRandomId();
    this.startedAt = initial.startedAt ?? new Date().toISOString();
    this.userPrompt = initial.userPrompt ?? null;
    this.domain = initial.domain ?? null;
    this.clarifications = initial.clarifications ?? {};
    this.plan = initial.plan ?? null;
    this.stepResults = initial.stepResults ?? [];
    this.verification = initial.verification ?? null;
    this.manualOverrides = initial.manualOverrides ?? [];
    this.decisionLog = initial.decisionLog ?? [];
    this.metadata = initial.metadata ?? {};
  }

  setPrompt(prompt) {
    this.userPrompt = prompt;
    this.logDecision('prompt_set', { prompt }, 'user input');
  }
  setDomain(domain, confidence) {
    this.domain = domain;
    this.logDecision('domain_detected', { domain, confidence },
      `Clarifier matched ${confidence ? `${(confidence * 100).toFixed(0)}%` : 'unknown'} confidence`);
  }
  setClarification(id, value, by = 'user') {
    this.clarifications[id] = value;
    this.logDecision('clarification', { id, value }, `${by} answered`);
  }
  setPlan(plan, by = 'planner') {
    this.plan = plan;
    this.logDecision('plan_set', { stepCount: plan.length }, `${by} produced plan`);
  }
  recordStep(step) {
    this.stepResults.push(step);
    this.logDecision('step_executed', {
      index: step.stepIndex, tool: step.tool, stateKey: step.stateKey,
    }, step.comment ?? '');
  }
  recordVerification(verification) {
    this.verification = verification;
    this.logDecision('verification_run', {
      ok: verification.ok,
      errors: verification.errorCount,
      warnings: verification.warnCount,
    }, verification.ok ? 'all bounds satisfied' : 'violations detected');
  }
  recordOverride(field, oldVal, newVal, reason = '') {
    this.manualOverrides.push({ field, oldVal, newVal, when: new Date().toISOString(), reason });
    this.logDecision('manual_override', { field, oldVal, newVal }, reason);
  }
  logDecision(type, payload, reasoning = '') {
    this.decisionLog.push({
      when: new Date().toISOString(),
      type,
      payload,
      reasoning,
    });
  }

  /** Compact text summary, useful as LLM context. */
  summary() {
    const lines = [];
    lines.push(`Session ${this.sessionId.slice(0, 8)} (started ${this.startedAt})`);
    if (this.userPrompt) lines.push(`Prompt: ${this.userPrompt}`);
    if (this.domain) lines.push(`Domain: ${this.domain}`);
    if (Object.keys(this.clarifications).length) {
      lines.push(`Clarified:`);
      for (const [k, v] of Object.entries(this.clarifications)) lines.push(`  ${k} = ${v}`);
    }
    if (this.plan) lines.push(`Plan: ${this.plan.length} steps`);
    if (this.stepResults.length) {
      lines.push(`Steps executed: ${this.stepResults.length} / ${this.plan ? this.plan.length : '?'}`);
      for (const s of this.stepResults) lines.push(`  [${s.stepIndex}] ${s.tool}`);
    }
    if (this.verification) {
      lines.push(`Verification: ${this.verification.ok ? 'PASS' : 'FAIL'} (${this.verification.errorCount} errors, ${this.verification.warnCount} warnings)`);
    }
    if (this.manualOverrides.length) {
      lines.push(`Manual overrides: ${this.manualOverrides.length}`);
    }
    return lines.join('\n');
  }

  /** Full serialization. */
  toJSON() {
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      userPrompt: this.userPrompt,
      domain: this.domain,
      clarifications: this.clarifications,
      plan: this.plan,
      stepResults: this.stepResults,
      verification: this.verification,
      manualOverrides: this.manualOverrides,
      decisionLog: this.decisionLog,
      metadata: this.metadata,
    };
  }

  static fromJSON(obj) {
    return new SessionMemory(obj);
  }

  /** Filter the decision log by type — for audit reports. */
  decisionsByType(type) {
    return this.decisionLog.filter(d => d.type === type);
  }
}

function cryptoRandomId() {
  // 16-byte hex id; works in browser + Node 18+ without imports.
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
