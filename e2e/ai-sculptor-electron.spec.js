import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * L2 AI Sculptor, end to end, in the real ArchDisc desktop app: an LLM is
 * given ONLY a plain-text part description. It autonomously decides the
 * sequence of atomic CAD operations, and that sequence sculpts a real solid
 * in the viewport. No script hard-codes the steps — the AI does the modeling.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI Sculptor autonomously sculpts a part from a text prompt in the ArchDisc desktop app', async () => {
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

  const description = 'A rectangular mounting plate 80 mm wide, 60 mm deep and 8 mm thick, '
    + 'with a single 15 mm diameter hole drilled clean through its centre.';

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

  expect(result.plan.length).toBeGreaterThanOrEqual(4);
  expect(result.volume).toBeGreaterThan(20000);
  expect(result.volume).toBeLessThan(55000);

  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-ai-sculpted-part.png') });
  await app.close();
});
