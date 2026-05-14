import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { detectDomain, pickClarificationKit, applyAnswers, unansweredRequired } from '../frontend/src/ai/Clarifier.js';
import { verifyStep, verifyPlan } from '../frontend/src/ai/Verifier.js';
import { SessionMemory } from '../frontend/src/ai/SessionMemory.js';
import { executePlan, JET_ENGINE_PLAN, validatePlan } from '../frontend/src/ai/PlanExecutor.js';
import { TOOL_REGISTRY, findTool } from '../frontend/src/ai/ToolRegistry.js';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'orchestration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.describe('M75 Clarifier + M76 Verifier + M77 SessionMemory', () => {
  test.describe.configure({ timeout: 600000 });
  test.beforeAll(() => ensure(ROOT));

  // ─── M75: Clarifier ─────────────────────────────────────────
  test('Clarifier detects domain from prompt', async () => {
    const cases = [
      ['Design a turbofan for the A350 successor.', 'engine'],
      ['I need a bracket that takes 2 kN tensile load.', 'structure'],
      ['Build a planetary gearbox with 5:1 ratio.', 'gearbox'],
      ['ASME pressure vessel for a chemical reactor.', 'pressure_vessel'],
      ['Sheet metal enclosure with 3 bends.', 'sheet_metal'],
      ['Random unrelated text.', 'generic'],
    ];
    for (const [prompt, expectedDomain] of cases) {
      const d = detectDomain(prompt);
      console.log(`"${prompt}" → ${d.domain} (${(d.confidence * 100).toFixed(0)}%)`);
      expect(d.domain).toBe(expectedDomain);
    }
  });

  test('Clarifier returns engine-design kit with required questions', async () => {
    const { domain, kit } = pickClarificationKit('Build a Rolls-Royce engine for Airbus.');
    console.log(`\nDomain: ${domain}`);
    console.log(`Kit: ${kit.name}`);
    console.log(`Questions: ${kit.questions.length}`);
    expect(domain).toBe('engine');
    expect(kit.questions.length).toBeGreaterThanOrEqual(8);
    // Critical fields must be present
    const ids = kit.questions.map(q => q.id);
    expect(ids).toContain('thrust_class');
    expect(ids).toContain('bypass_ratio');
    expect(ids).toContain('tit_max');
    expect(ids).toContain('certification');

    // Unanswered-required filter
    const partial = { thrust_class: 350, bypass_ratio: 10 };
    const missing = unansweredRequired(kit, partial);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every(q => q.required)).toBe(true);

    // applyAnswers fills defaults for unanswered
    const merged = applyAnswers(kit, partial);
    expect(merged.thrust_class).toBe(350);
    expect(merged.bypass_ratio).toBe(10);
    expect(merged.tit_max).toBe(1750);     // default
    fs.writeFileSync(path.join(ROOT, 'clarifier-engine.json'), JSON.stringify({
      domain, kit_name: kit.name, questions: kit.questions, merged,
    }, null, 2));
  });

  // ─── M76: Verifier ──────────────────────────────────────────
  test('Verifier catches out-of-bounds metric in single step', async () => {
    const fakeStep = {
      stepIndex: 0, tool: 'Blade Cooling',
      state: { T_metal_max_K: 1600, survives_long_life: false },
    };
    const violations = verifyStep(fakeStep);
    console.log(`\nFake blade-cooling violations:`);
    for (const v of violations) console.log(`  ${v.severity}: ${v.tool}.${v.metric} actual=${v.actual} expected=${v.expected}`);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(violations.some(v => v.severity === 'error')).toBe(true);
  });

  test('Verifier passes on in-bounds metrics', async () => {
    const goodStep = {
      stepIndex: 0, tool: 'Blade Cooling',
      state: { T_metal_max_K: 1018, survives_long_life: true },
    };
    const violations = verifyStep(goodStep);
    expect(violations).toEqual([]);
  });

  // ─── M77: SessionMemory ─────────────────────────────────────
  test('SessionMemory captures decisions + serializes to JSON', async () => {
    const mem = new SessionMemory();
    mem.setPrompt('Design a turbofan for the A350.');
    mem.setDomain('engine', 0.4);
    mem.setClarification('thrust_class', 350);
    mem.setClarification('tit_max', 1750);
    mem.setPlan(JET_ENGINE_PLAN.slice(0, 3), 'planner');
    mem.recordStep({ stepIndex: 0, tool: 'Mission', stateKey: '__lastMissionResult', comment: 'start' });
    mem.recordOverride('thrust_class', 350, 400, 'user wanted growth margin');
    mem.recordVerification({ ok: true, violations: [], errorCount: 0, warnCount: 0, infoCount: 0 });

    const json = mem.toJSON();
    fs.writeFileSync(path.join(ROOT, 'session-memory.json'), JSON.stringify(json, null, 2));
    console.log(`\nSession summary:\n${mem.summary()}`);

    expect(mem.decisionLog.length).toBeGreaterThanOrEqual(7);
    expect(mem.decisionsByType('manual_override').length).toBe(1);
    expect(mem.decisionsByType('clarification').length).toBe(2);
    // Round-trip
    const restored = SessionMemory.fromJSON(json);
    expect(restored.userPrompt).toBe(mem.userPrompt);
    expect(restored.decisionLog.length).toBe(mem.decisionLog.length);
  });

  // ─── INTEGRATION: full orchestration loop ───────────────────
  test('Full orchestration: prompt → Clarifier → plan → execute → Verifier → log', async ({ page }) => {
    const userPrompt = 'Design a turbofan engine for an Airbus A350-class airliner.';
    const mem = new SessionMemory();
    mem.setPrompt(userPrompt);

    // Step 1: Clarifier
    const { domain, confidence, kit } = pickClarificationKit(userPrompt);
    mem.setDomain(domain, confidence);
    console.log(`\nDomain detected: ${domain} (${(confidence * 100).toFixed(0)}% confidence)`);
    console.log(`Clarification kit: ${kit.name}`);
    console.log(`  ${kit.questions.length} questions in kit`);

    // Step 2: Simulate user answers (in real flow, AskUserQuestion would gather these)
    const userAnswers = {
      thrust_class: 350, cruise_mach: 0.85, cruise_alt_m: 10670,
      bypass_ratio: 10, opr_cruise: 50, tit_max: 1750,
      certification: 'EASA CS-E',
    };
    for (const [id, val] of Object.entries(userAnswers)) mem.setClarification(id, val);
    const merged = applyAnswers(kit, userAnswers);
    console.log(`Merged clarifications:`, merged);

    // Step 3: Plan — use the canonical fallback (in real flow, LLM would emit one)
    const plan = JET_ENGINE_PLAN;
    const v = validatePlan(plan);
    expect(v.ok).toBe(true);
    mem.setPlan(plan, 'fallback-canonical');

    // Step 4: Execute
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    const result = await executePlan(page, plan, {
      dwellMs: 1500,
      onStep: async (step, i, state) => {
        const meta = findTool(step.tool);
        mem.recordStep({
          stepIndex: i, tool: step.tool,
          stateKey: meta?.produces ?? 'unknown',
          comment: step.comment,
        });
      },
    });
    expect(result.ok).toBe(true);

    // Step 5: Verifier
    const verification = verifyPlan(result);
    mem.recordVerification(verification);
    console.log(`\n=== VERIFICATION ===`);
    console.log(`ok: ${verification.ok}, errors: ${verification.errorCount}, warnings: ${verification.warnCount}, info: ${verification.infoCount}`);
    for (const v of verification.violations) {
      console.log(`  [${v.severity}] ${v.tool}.${v.metric}: actual=${v.actual}, expected=${v.expected}`);
    }

    // Step 6: Persist the session
    fs.writeFileSync(path.join(ROOT, 'orchestration-session.json'), JSON.stringify(mem.toJSON(), null, 2));
    console.log(`\n=== SESSION SUMMARY ===\n${mem.summary()}`);

    // Verification should pass — all our plan steps produce in-bounds metrics
    expect(verification.ok).toBe(true);
    expect(mem.decisionLog.length).toBeGreaterThan(20);
    expect(mem.stepResults.length).toBe(plan.length);
  });
});
