import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Fillet, end to end, in the real ArchDisc desktop app: the AI is asked for a
 * block with rounded edges. It must use the fillet op. Verified by a real
 * solid in the viewport with a positive volume.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI sculpts a block and fillets its edges', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  test.setTimeout(300000);
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscSculptor, null, { timeout: 60000 });

  const description = 'A rectangular block 50 mm x 40 mm x 20 mm with all its edges '
    + 'rounded by a 4 mm fillet.';

  const result = await win.evaluate(async ({ description, llm }) => {
    const { part, plan } = await window.__archdiscSculptor.sculptPart({
      description, llm, atomicApi: window.__archdiscAtomic,
    });
    window.__archdiscAtomic.render(part);
    return { plan, history: part.describe(), volume: part.solid.volume() };
  }, { description, llm });

  console.log('  AI plan: ' + JSON.stringify(result.plan));
  console.log('  history: ' + result.history);
  console.log('  volume: ' + result.volume.toFixed(0) + ' mm^3');

  const usedFillet = result.plan.some((o) => o.op === 'fillet');
  expect(usedFillet).toBe(true);
  expect(result.volume).toBeGreaterThan(25000);
  expect(result.volume).toBeLessThan(40000);

  await win.waitForTimeout(2500);
  await win.screenshot({ path: path.join(OUT, 'ai-fillet-part.png') });
  await app.close();
});
