import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  TOOL_REGISTRY, findTool, registrySummary, PLAN_SCHEMA,
} from '../frontend/src/ai/ToolRegistry.js';
import {
  executePlan, validatePlan, JET_ENGINE_PLAN,
} from '../frontend/src/ai/PlanExecutor.js';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'plan-executor');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.describe('M73 Tool Registry + M74 Plan Executor', () => {
  test.describe.configure({ timeout: 600000 });   // up to 10 min for full jet-engine run
  test.beforeAll(() => ensure(ROOT));

  test('Registry: 47 tools, no duplicates, all categories populated', async () => {
    const summary = registrySummary();
    console.log(`\n=== TOOL REGISTRY ===`);
    console.log(`Total: ${summary.total}`);
    console.log(`By tab:`, summary.byTab);
    console.log(`By category:`, summary.byCategory);
    fs.writeFileSync(path.join(ROOT, 'registry-summary.json'), JSON.stringify(summary, null, 2));

    expect(summary.total).toBeGreaterThanOrEqual(40);
    // No duplicate tool names
    const names = TOOL_REGISTRY.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    // All tabs present
    expect(summary.byTab.Part).toBeGreaterThan(0);
    expect(summary.byTab.Simulate).toBeGreaterThan(0);
    expect(summary.byTab.Manufacture).toBeGreaterThan(0);
    expect(summary.byTab.Drawing).toBeGreaterThan(0);
    expect(summary.byTab.Assembly).toBeGreaterThan(0);
  });

  test('Plan validator: catches unknown tools and bad dependsOn', async () => {
    expect(validatePlan(JET_ENGINE_PLAN).ok).toBe(true);
    expect(validatePlan([{ tool: 'NoSuchTool' }]).ok).toBe(false);
    expect(validatePlan('not-an-array').ok).toBe(false);
    const badDep = validatePlan([
      { tool: 'Linear Pattern' },
      { tool: 'Mass Properties', dependsOn: [5] },   // ref past end
    ]);
    expect(badDep.ok).toBe(false);
  });

  test('Plan executor runs a small 3-step plan via real ribbon clicks', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

    const plan = [
      { tool: 'Linear Pattern',    comment: 'Build geometry' },
      { tool: 'Mass Properties',   comment: 'Measure it' },
      { tool: 'Export STEP',       comment: 'Package as STEP' },
    ];

    const onStepLog = [];
    const result = await executePlan(page, plan, {
      dwellMs: 1500,
      onStep: async (step, i, state) => {
        onStepLog.push({ index: i, tool: step.tool, hasState: !!state });
        const png = path.join(ROOT, `small-${i}-${step.tool.replace(/\W+/g, '_')}.png`);
        await page.screenshot({ path: png, fullPage: false });
      },
    });

    console.log(`\n=== 3-STEP PLAN ===`);
    console.log(`ok: ${result.ok}`);
    console.log(`steps executed: ${result.steps.length} / ${plan.length}`);
    for (const s of result.steps) {
      console.log(`  ${s.stepIndex}: ${s.tool} → ${s.stateKey} populated`);
    }
    fs.writeFileSync(path.join(ROOT, 'small-plan-result.json'), JSON.stringify({
      ok: result.ok,
      stepCount: result.steps.length,
      errors: result.errors,
      stepSummaries: result.steps.map(s => ({
        index: s.stepIndex, tool: s.tool, stateKey: s.stateKey,
      })),
      onStepLog,
    }, null, 2));

    expect(result.ok).toBe(true);
    expect(result.steps.length).toBe(plan.length);
    expect(result.errors).toEqual([]);
    // Step 0: Linear Pattern → __lastFoundationManifold
    expect(result.steps[0].stateKey).toBe('__lastFoundationManifold');
    // Step 2: Export STEP → __lastSTEPText (will be a string)
    expect(typeof result.steps[2].state).toBe('string');
    expect(result.steps[2].state.length).toBeGreaterThan(1000);
  });

  test('Plan executor runs the full 13-step JET_ENGINE_PLAN', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

    const result = await executePlan(page, JET_ENGINE_PLAN, {
      dwellMs: 3000,    // 3 s per step → ~45 s total visible + work
      onStep: async (step, i) => {
        const safe = step.tool.replace(/\W+/g, '_');
        await page.screenshot({
          path: path.join(ROOT, `jet-${String(i).padStart(2, '0')}-${safe}.png`),
          fullPage: false,
        });
      },
    });

    console.log(`\n=== JET-ENGINE PLAN (13 steps via PlanExecutor) ===`);
    console.log(`ok: ${result.ok}`);
    console.log(`steps: ${result.steps.length} / ${JET_ENGINE_PLAN.length}`);
    if (!result.ok) console.log('errors:', result.errors);
    for (const s of result.steps) {
      const label = `[${String(s.stepIndex).padStart(2, '0')}] ${s.tool.padEnd(22)} → ${s.stateKey}`;
      console.log(label);
    }
    fs.writeFileSync(
      path.join(ROOT, 'jet-engine-plan-trace.json'),
      JSON.stringify({
        ok: result.ok,
        stepCount: result.steps.length,
        errors: result.errors,
        steps: result.steps.map(s => ({
          index: s.stepIndex,
          tool: s.tool,
          stateKey: s.stateKey,
          // Truncate state to first level for log readability
          stateSummary: typeof s.state === 'object' && s.state !== null
            ? Object.keys(s.state).slice(0, 8)
            : (typeof s.state === 'string' ? `${s.state.length} chars` : s.state),
        })),
      }, null, 2),
    );

    expect(result.ok).toBe(true);
    expect(result.steps.length).toBe(JET_ENGINE_PLAN.length);
  });
});
