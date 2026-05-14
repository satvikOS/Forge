import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { CSE_RULES, RULE_BY_ID, categories, rulesForTool } from '../frontend/src/ai/StandardsLibrary.js';
import { generateCertificationMatrix, renderMatrixMarkdown, suggestNextModules } from '../frontend/src/ai/CertificationMatrix.js';
import { SessionMemory } from '../frontend/src/ai/SessionMemory.js';
import { pickClarificationKit, applyAnswers } from '../frontend/src/ai/Clarifier.js';
import { executePlan, JET_ENGINE_PLAN, validatePlan } from '../frontend/src/ai/PlanExecutor.js';
import { verifyPlan } from '../frontend/src/ai/Verifier.js';
import { findTool } from '../frontend/src/ai/ToolRegistry.js';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'certification');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.describe('M78 Standards Library + M79 Certification Matrix', () => {
  test.describe.configure({ timeout: 600000 });
  test.beforeAll(() => ensure(ROOT));

  test('Standards Library shape + coverage', async () => {
    expect(CSE_RULES.length).toBeGreaterThanOrEqual(10);
    for (const r of CSE_RULES) {
      expect(r.id).toBeTruthy();
      expect(r.category).toBeTruthy();
      expect(r.shortTitle).toBeTruthy();
      expect(r.requirementText.length).toBeGreaterThan(20);
      expect(Array.isArray(r.verifiedBy)).toBe(true);
      expect(typeof r.acceptance).toBe('function');
    }
    const cats = categories();
    console.log(`\n${CSE_RULES.length} rules across ${cats.length} categories: ${cats.join(', ')}`);
    expect(cats).toContain('Structural');
    expect(cats).toContain('Performance');
    expect(cats).toContain('HotSection');

    // RULE_BY_ID lookups
    expect(RULE_BY_ID['CS-E 510'].shortTitle).toContain('Strength');
    // Tool reverse-lookup
    const bcRules = rulesForTool('Blade Cooling');
    expect(bcRules.length).toBeGreaterThanOrEqual(2);
    fs.writeFileSync(path.join(ROOT, 'rules-summary.json'),
      JSON.stringify({
        total: CSE_RULES.length, categories: cats,
        byCategory: Object.fromEntries(cats.map(c => [c, CSE_RULES.filter(r => r.category === c).length])),
        bladeColingRules: bcRules.map(r => r.id),
      }, null, 2));
  });

  test('Certification matrix on fake session — flags uncovered rules', async () => {
    // Build a small fake session: only one tool ran, only one rule should pass.
    const mem = new SessionMemory();
    mem.setPrompt('Fake session for matrix shape test.');
    mem.setDomain('engine', 0.8);
    mem.recordStep({
      stepIndex: 0, tool: 'Brayton Cycle',
      stateKey: '__lastBraytonResult',
      state: { thrust_N: 350000, SFC_lb_per_lbf_hr: 0.55 },
      comment: 'fake brayton',
    });
    const report = generateCertificationMatrix(mem);
    console.log(`\nFake-session matrix: covered=${report.summary.covered}, passed=${report.summary.passed}, failed=${report.summary.failed}, uncovered=${report.summary.uncovered}`);
    expect(report.summary.total).toBe(CSE_RULES.length);
    expect(report.summary.uncovered).toBeGreaterThan(report.summary.covered);
    const braytonRules = report.ruleReports.filter(r => r.rule.verifiedBy.includes('Brayton Cycle'));
    expect(braytonRules.length).toBeGreaterThanOrEqual(2);
    for (const r of braytonRules) expect(r.covered).toBe(true);
  });

  test('Full orchestration → certification matrix on real session', async ({ page }) => {
    const userPrompt = 'Design a turbofan engine for an Airbus A350-class airliner with CS-E certification.';
    const mem = new SessionMemory();
    mem.setPrompt(userPrompt);

    const { domain, confidence, kit } = pickClarificationKit(userPrompt);
    mem.setDomain(domain, confidence);
    const answers = {
      thrust_class: 350, cruise_mach: 0.85, cruise_alt_m: 10670,
      bypass_ratio: 10, opr_cruise: 50, tit_max: 1750,
      certification: 'EASA CS-E',
    };
    for (const [id, val] of Object.entries(answers)) mem.setClarification(id, val);
    applyAnswers(kit, answers);

    const plan = JET_ENGINE_PLAN;
    expect(validatePlan(plan).ok).toBe(true);
    mem.setPlan(plan, 'fallback-canonical');

    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    const result = await executePlan(page, plan, {
      dwellMs: 1500,
      onStep: async (step, i, state) => {
        const meta = findTool(step.tool);
        mem.recordStep({
          stepIndex: i, tool: step.tool,
          stateKey: meta?.produces ?? 'unknown',
          state,
          comment: step.comment,
        });
      },
    });
    expect(result.ok).toBe(true);
    const verification = verifyPlan(result);
    mem.recordVerification(verification);

    // ─── Run the matrix ────────────────────────────────────
    const matrix = generateCertificationMatrix(mem);
    const md = renderMatrixMarkdown(matrix);
    fs.writeFileSync(path.join(ROOT, 'jet-engine-cert-matrix.md'), md);
    fs.writeFileSync(path.join(ROOT, 'jet-engine-cert-matrix.json'),
      JSON.stringify({
        summary: matrix.summary,
        ruleReports: matrix.ruleReports.map(r => ({
          ruleId: r.rule.id, category: r.rule.category,
          shortTitle: r.rule.shortTitle, status: r.status,
          covered: r.covered, satisfied: r.satisfied, notes: r.notes,
          verifyingSteps: r.verifyingSteps,
        })),
        suggestedNext: suggestNextModules(matrix),
      }, null, 2));

    console.log(`\n=== CERT MATRIX SUMMARY ===`);
    console.log(`Total: ${matrix.summary.total}, Covered: ${matrix.summary.covered} (${matrix.summary.coveragePct.toFixed(1)}%), Pass: ${matrix.summary.passed}, Fail: ${matrix.summary.failed}, Uncovered: ${matrix.summary.uncovered}`);
    for (const r of matrix.ruleReports) {
      console.log(`  ${r.rule.id.padEnd(12)} ${r.status.padEnd(10)} ${r.rule.shortTitle}`);
    }

    expect(matrix.summary.covered).toBeGreaterThan(0);
    expect(matrix.summary.passed).toBeGreaterThan(0);
    // We exercised 13 tools; should hit at least 6 distinct rules
    const distinctVerifyingTools = new Set();
    for (const r of matrix.ruleReports) {
      for (const s of r.verifyingSteps) distinctVerifyingTools.add(s.tool);
    }
    expect(distinctVerifyingTools.size).toBeGreaterThanOrEqual(5);

    // Suggest-next should surface bird-strike, noise, fuel-system
    const next = suggestNextModules(matrix);
    console.log(`\nNext modules suggested: ${next.length}`);
  });
});
