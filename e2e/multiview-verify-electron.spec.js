import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { verifyRender } from '../frontend/src/ai/sculptor/PartVerifier.js';

/*
 * Proof of multi-angle vision verification: sculpt one part, orbit the camera
 * through five angles capturing a screenshot at each, send all five to the
 * vision LLM in one call, and confirm a verdict comes back. The five view
 * images are saved so a human can see the part really was captured all round.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the vision verifier judges a part from five orbited camera angles', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  test.setTimeout(180000);
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscSculptor && !!window.__archdiscOrbitView, null, { timeout: 60000 });

  const description = 'A flat ring (annulus) 40 mm outer diameter, 24 mm inner diameter, 4 mm thick.';

  await win.evaluate(async ({ description, llm }) => {
    const { part } = await window.__archdiscSculptor.sculptPart({
      description, llm, atomicApi: window.__archdiscAtomic,
    });
    window.__archdiscAtomic.render(part);
  }, { description, llm });

  const views = [];
  const angles = [30, 100, 170, 240, 310];
  for (let i = 0; i < angles.length; i++) {
    await win.evaluate((a) => window.__archdiscOrbitView(a, 22), angles[i]);
    await win.waitForTimeout(400);
    const buf = await win.locator('canvas').first().screenshot();
    fs.writeFileSync(path.join(OUT, `multiview-${i + 1}.png`), buf);
    views.push('data:image/png;base64,' + buf.toString('base64'));
  }
  expect(views.length).toBe(5);
  expect(views[0]).not.toBe(views[2]);

  const verdict = await verifyRender({ description, imageDataUrls: views, llm });
  console.log('  multi-angle verdict: matches=' + verdict.matches + ', feedback=' + verdict.feedback);
  expect(typeof verdict.matches).toBe('boolean');

  await app.close();
});
