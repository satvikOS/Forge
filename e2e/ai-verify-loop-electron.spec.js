import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { sculptAndVerify, requestSculptPlan } from '../frontend/src/ai/sculptor/PartSculptor.js';
import { verifyRender } from '../frontend/src/ai/sculptor/PartVerifier.js';

/*
 * L2 closing loop, end to end, in the real ArchDisc desktop app: the AI
 * sculpts a part, ArchDisc renders it, the rendered image is shown to a
 * vision LLM, and the LLM judges whether it matches the intent (and revises
 * if not). design -> render -> see -> revise, closed.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI Sculptor sculpts, renders, and a vision LLM verifies the result', async () => {
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

  const description = 'A round flange disc 70 mm in diameter and 6 mm thick, '
    + 'with a 20 mm diameter bore through its centre.';

  const result = await sculptAndVerify({
    description,
    requestPlan: async () => requestSculptPlan({ description, llm }),
    executePlan: async (plan) => win.evaluate(async (p) => {
      const part = await window.__archdiscSculptor.executeSculptPlan(p, window.__archdiscAtomic);
      window.__archdiscAtomic.render(part);
      return { volume: part.solid.volume(), history: part.describe() };
    }, plan),
    renderAndCapture: async () => {
      await win.waitForTimeout(1500);
      const buf = await win.locator('canvas').first().screenshot();
      return 'data:image/png;base64,' + buf.toString('base64');
    },
    verify: ({ description, imageDataUrl }) => verifyRender({ description, imageDataUrl, llm }),
    maxRounds: 3,
  });

  console.log('  verify rounds: ' + JSON.stringify(result.rounds));
  console.log('  accepted: ' + result.accepted);
  console.log('  final result: ' + JSON.stringify(result.result));

  expect(result.rounds.length).toBeGreaterThanOrEqual(1);
  expect(typeof result.rounds[0].matches).toBe('boolean');
  expect(result.result.volume).toBeGreaterThan(0);

  await win.waitForTimeout(2000);
  await win.screenshot({ path: path.join(OUT, 'electron-ai-verified-part.png') });
  await app.close();
});
