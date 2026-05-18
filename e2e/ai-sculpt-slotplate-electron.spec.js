import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Linear pattern, end to end, in the real ArchDisc desktop app: the AI is
 * asked for a plate with a row of holes. It must sketch ONE hole and use
 * linearPattern with mode "cut" — proof it patterns a feature in a row.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI sculpts a plate with a linear row of holes', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscAtomic && !!window.__archdiscSculptor, null, { timeout: 60000 });

  const description = 'A rectangular mounting bar 160 mm long, 30 mm wide and 8 mm thick, '
    + 'with a row of five 10 mm diameter holes evenly spaced 28 mm apart along its length.';

  const result = await win.evaluate(async ({ description, llm }) => {
    const { part, plan } = await window.__archdiscSculptor.sculptPart({
      description, llm, atomicApi: window.__archdiscAtomic,
    });
    window.__archdiscAtomic.render(part);
    return { plan, history: part.describe(), volume: part.solid.volume() };
  }, { description, llm });

  console.log('  AI-decided plan: ' + JSON.stringify(result.plan));
  console.log('  construction history: ' + result.history);
  console.log('  sculpted volume: ' + result.volume.toFixed(0) + ' mm^3');

  const usedLinear = result.plan.some(o => o.op === 'linearPattern' && o.mode === 'cut');
  expect(usedLinear).toBe(true);

  expect(result.volume).toBeGreaterThan(32000);
  expect(result.volume).toBeLessThan(38000);

  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-ai-slotplate.png') });
  await app.close();
});
