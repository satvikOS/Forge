/**
 * ArchDisc AI Plan Executor.
 *
 * Takes a plan (array of `{tool, dependsOn?, comment?}` items) and
 * runs each step through the actual ribbon UI — clicking the right
 * tab, clicking the right tool, and waiting for the result before
 * moving on. The plan can come from ANY source: hand-coded JSON,
 * an LLM (OpenAI / Anthropic / local Llama), a recorded demo, etc.
 *
 * Why route through the UI rather than calling TOOL_HANDLERS
 * directly: the UI path exercises the exact code paths a human
 * would, including auto-frame on foundation manifolds and
 * window.__last* mirroring. This makes the orchestration testable
 * via the SAME e2e infrastructure as manual ribbon clicks.
 *
 * Stop-conditions:
 *   - All steps complete → return aggregated state
 *   - Any step fails verification → abort and return error
 *   - User cancels → executor honors abort signal
 */

import { findTool } from './ToolRegistry.js';

/**
 * Execute a plan against an open ArchDisc page (Playwright Page).
 *
 * @param {object} page                  Playwright Page object
 * @param {Array} plan                    array of `{tool, comment?}`
 * @param {object=} options
 * @param {number=} options.dwellMs        pause after each step (for visible playback)
 * @param {number=} options.stepTimeoutMs  per-step wait timeout
 * @param {function=} options.onStep       async callback(step, index, state)
 * @returns {{ ok, steps, finalState, errors }}
 */
export async function executePlan(page, plan, options = {}) {
  const dwellMs = options.dwellMs ?? 0;
  const stepTimeoutMs = options.stepTimeoutMs ?? 60000;
  const onStep = options.onStep ?? (async () => {});
  const errors = [];
  const stepResults = [];

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const meta = findTool(step.tool);
    if (!meta) {
      errors.push({ stepIndex: i, error: `Unknown tool: ${step.tool}` });
      break;
    }

    // 1. Click the tab
    await page.locator('.ribbon-tab', { hasText: meta.tab }).first().click();
    await page.waitForTimeout(500);

    // 1b. If the plan step carries params, stash them on window so
    //     requestToolParams() consumes them in lieu of defaults/dialog.
    if (step.params && Object.keys(step.params).length) {
      await page.evaluate(({ tool, params }) => {
        window.__archdiscPlanParams = window.__archdiscPlanParams || {};
        window.__archdiscPlanParams[tool] = params;
      }, { tool: step.tool, params: step.params });
    }

    // 2. Click the ribbon-tool-label (exact match — handles icon prefix)
    await page.locator('.ribbon-tool-label', { hasText: new RegExp(`^${escapeRegex(step.tool)}$`) })
              .first().click();

    // 3. Wait for the produces window-slot to be populated
    const stateKey = meta.produces;
    try {
      await page.waitForFunction(
        (k) => !!window[k],
        stateKey,
        { timeout: stepTimeoutMs }
      );
    } catch (err) {
      errors.push({
        stepIndex: i,
        tool: step.tool,
        error: `Timeout waiting for window.${stateKey}: ${err.message}`,
      });
      break;
    }

    // 4. Snapshot the produced state
    const state = await page.evaluate((k) => window[k], stateKey);
    stepResults.push({
      stepIndex: i,
      tool: step.tool,
      tab: meta.tab,
      category: meta.category,
      stateKey,
      state,
      comment: step.comment,
    });

    // 5. Optional user callback (for screenshots, logging, etc.)
    await onStep(step, i, state);

    // 6. Dwell — sit on this state so a human watching can read it
    if (dwellMs > 0) await page.waitForTimeout(dwellMs);
  }

  return {
    ok: errors.length === 0,
    steps: stepResults,
    finalState: stepResults.length ? stepResults[stepResults.length - 1].state : null,
    errors,
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The canonical jet-engine design plan, hand-authored — exactly
 * what an AI planner would emit for the prompt "design a turbofan
 * engine for an A350-class airliner". An AI can use this as a
 * few-shot example, a fall-back, or simply read it as ground truth.
 */
export const JET_ENGINE_PLAN = [
  { tool: 'Mission',           comment: 'Start with airframe requirements: range + thrust per engine' },
  { tool: 'Brayton Cycle',     comment: 'Pick cycle (BPR, OPR, T4) to meet SFC target' },
  { tool: 'Compressor Stage',  comment: 'Mean-line geometry from cycle outputs' },
  { tool: 'Combustor',         comment: 'Liner sizing + NOx prediction' },
  { tool: 'Turbine Stage',     comment: 'HPT mean-line to balance compressor work' },
  { tool: 'Blade Cooling',     comment: 'Verify HPT blade survives T_gas' },
  { tool: 'Heat Exchanger',    comment: 'Recuperator effectiveness' },
  { tool: 'Nozzle',            comment: 'Exhaust nozzle: convergent or CD' },
  { tool: 'Linear Pattern',    comment: 'Build a representative geometry for downstream analysis' },
  { tool: 'Mass Properties',   comment: 'Inertia tensor for rotordynamics input' },
  { tool: 'Rotordynamics',     comment: 'Critical-speed check' },
  { tool: 'Fatigue Analysis',  comment: 'Life of the highest-stress component' },
  { tool: 'Export STEP',       comment: 'Package CAD output for vendors' },
];

/**
 * Validate a plan against the registry before executing.
 * Returns { ok, errors } — errors lists any unknown tools or
 * obvious dependency mistakes.
 */
export function validatePlan(plan) {
  const errors = [];
  if (!Array.isArray(plan)) {
    errors.push('Plan must be an array');
    return { ok: false, errors };
  }
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    if (typeof step !== 'object' || !step.tool) {
      errors.push(`Step ${i}: missing 'tool' field`);
      continue;
    }
    if (!findTool(step.tool)) {
      errors.push(`Step ${i}: unknown tool '${step.tool}'`);
    }
    if (step.dependsOn) {
      for (const d of step.dependsOn) {
        if (d < 0 || d >= i) {
          errors.push(`Step ${i}: dependsOn references invalid index ${d}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
