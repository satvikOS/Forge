import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Sketch-on-face, end to end, in the real ArchDisc desktop app: the AI is
 * asked for a part that needs a boss standing ON a base plate. It must use
 * startSketch with plane "top" — proof the part is built feature-on-feature,
 * not as one blob from z = 0.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI sculpts a base plate with a cylindrical boss on its top face', async () => {
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

  const description = 'A base plate 50 mm x 50 mm and 10 mm thick, with a cylindrical '
    + 'boss 20 mm in diameter and 25 mm tall standing on the centre of its top face.';

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

  const usedTop = result.plan.some(o => o.op === 'startSketch' && o.plane === 'top');
  expect(usedTop).toBe(true);

  expect(result.volume).toBeGreaterThan(30000);
  expect(result.volume).toBeLessThan(36000);

  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-ai-boss-part.png') });
  await app.close();
});
