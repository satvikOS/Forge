/**
 * uiWorkflow.js — shared e2e helpers for the sophistication-retrofit specs.
 *
 * All interactions use dispatchEvent rather than .click() because the
 * ribbon's scrollable container intercepts real Playwright pointer events.
 *
 * Import example (bare specifier, no node:):
 *   import { buildPrimitive, selectBodies, clickRibbonTool } from './helpers/uiWorkflow.js';
 */
import path from 'path';

// ─── Regex helpers ─────────────────────────────────────────────────────────


export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Ribbon navigation ────────────────────────────────────────────────────────

/**
 * Click a top-level ribbon tab (e.g. 'Part', 'Surface', 'Simulate').
 * The tab buttons carry class `ribbon-tab`.
 */
export async function clickRibbonTab(win, label) {
  await win
    .locator('button.ribbon-tab')
    .filter({ hasText: new RegExp('^' + escapeRe(label) + '$') })
    .first()
    .evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

/**
 * Click a ribbon tool button by its visible label text.
 * Tool buttons carry class `ribbon-tool` and contain a `.ribbon-tool-label` child.
 */
export async function clickRibbonTool(win, label) {
  await win
    .locator('button.ribbon-tool:has(.ribbon-tool-label)')
    .filter({
      has: win.locator('.ribbon-tool-label', {
        hasText: new RegExp('^' + escapeRe(label) + '$'),
      }),
    })
    .first()
    .evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

// ─── Tool-param dialog ────────────────────────────────────────────────────────

/**
 * Wait for the ToolParamDialog modal to appear.
 */
export async function waitForDialog(win) {
  await win
    .locator('.tpd-dialog')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 });
}

/**
 * Fill dialog fields by name and click Run.
 * `values` is an object mapping field `data-field` names to values.
 * When `values` is omitted or empty, the dialog defaults are accepted as-is.
 * Waits for the dialog to close after clicking Run.
 */
export async function fillDialog(win, values) {
  for (const [name, value] of Object.entries(values || {})) {
    await win
      .locator(`.tpd-input[data-field="${name}"]`)
      .first()
      .fill(String(value));
  }
  await win.locator('.tpd-btn-run').first().click({ force: true });
  await win
    .locator('.tpd-dialog')
    .first()
    .waitFor({ state: 'detached', timeout: 30000 });
}

// ─── Primitive building ───────────────────────────────────────────────────────

/**
 * Build a body by clicking a Part-tab primitive ribbon tool and filling its dialog.
 *
 * 1. Switches to the Part tab.
 * 2. (Optional) Injects `params` into `window.__archdiscPlanParams[toolName]` so
 *    the ToolParamDialog bypass picks them up — this is the correct path under
 *    Playwright (navigator.webdriver=true) where the dialog auto-bypasses.
 * 3. Clicks the named primitive tool (e.g. 'Box', 'Cylinder', 'Sphere').
 * 4. Waits until `window.__lastBrepShape.id` changes (tool executed).
 * 5. Returns the new body id.
 *
 * Note: Under Playwright `navigator.webdriver===true` → ToolParamDialog.js
 * auto-resolves with defaults immediately (bypass). The dialog is never
 * rendered. Specs should NOT call waitForDialog/fillDialog for these tools;
 * instead pass custom values via `params` here so they land in planParams.
 *
 * @param {import('@playwright/test').Page} win
 * @param {string} toolName   e.g. 'Box'
 * @param {object} [params]   e.g. { dx: 30, dy: 30, dz: 30 }
 * @returns {Promise<string>} the new body id from window.__lastBrepShape.id
 */
export async function buildPrimitive(win, toolName, params) {
  const before = await win.evaluate(
    () => (window.__lastBrepShape && window.__lastBrepShape.id) || null,
  );
  // Inject custom params before the click so the bypass picks them up.
  if (params && Object.keys(params).length > 0) {
    await win.evaluate(
      ([name, vals]) => {
        if (!window.__archdiscPlanParams) window.__archdiscPlanParams = {};
        window.__archdiscPlanParams[name] = vals;
      },
      [toolName, params],
    );
  }
  await clickRibbonTab(win, 'Part');
  await win.waitForTimeout(120);
  await clickRibbonTool(win, toolName);
  await win.waitForFunction(
    (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
    before,
    { timeout: 60000 },
  );
  return win.evaluate(() => window.__lastBrepShape.id);
}

/**
 * Inject a one-shot params override for a named tool, consumed by the
 * ToolParamDialog bypass on the next click. Use this when you need to
 * pass non-default values for a multi-step op (arity-1, arity-2, etc.)
 * where you call clickRibbonTool yourself rather than using buildPrimitive.
 *
 * @param {import('@playwright/test').Page} win
 * @param {string} toolName   Exact tool name matching the schema key
 * @param {object} params     Field values to override
 */
export async function injectToolParams(win, toolName, params) {
  await win.evaluate(
    ([name, vals]) => {
      if (!window.__archdiscPlanParams) window.__archdiscPlanParams = {};
      window.__archdiscPlanParams[name] = vals;
    },
    [toolName, params],
  );
}

// ─── Body selection ───────────────────────────────────────────────────────────

/**
 * Programmatically select bodies in the BodyRegistry by id.
 *
 * Uses `window.__archdiscRegistry` (exposed by WorkbenchMechanical.jsx useEffect).
 * Multi-select is applied via `selectMany(ids)` when available, falling back to
 * repeated `select(id, additive)` calls for backwards-compat.
 *
 * @param {import('@playwright/test').Page} win
 * @param {string[]} ids  Body ids to select (e.g. ['body-001', 'body-002'])
 */
export async function selectBodies(win, ids) {
  await win.evaluate((ids) => {
    const reg = window.__archdiscRegistry;
    if (!reg) throw new Error('selectBodies: __archdiscRegistry not exposed on window');
    if (typeof reg.clearSelection === 'function') reg.clearSelection();
    if (typeof reg.selectMany === 'function') {
      reg.selectMany(ids);
    } else {
      // Fallback: additive single-select for 2nd+ body
      ids.forEach((id, i) => reg.select(id, i > 0));
    }
  }, ids);
}

/**
 * Return the path module so callers can compute screenshot dirs.
 * (Re-exported as a convenience — callers can also import path directly.)
 */
export { path };
