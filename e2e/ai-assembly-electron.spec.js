import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * L4 assembly, end to end, in the real ArchDisc desktop app: the AI is given
 * an ASSEMBLY description. It decomposes it into parts, sculpts each, and
 * positions them — multiple bodies coexisting in the viewport.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI decomposes and builds a 2-part assembly in the ArchDisc desktop app', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscAtomic && !!window.__archdiscSculptor
      && !!window.__archdiscSculptor.sculptAssembly, null, { timeout: 60000 });

  const description = 'A simple display stand: a round base disc 70 mm in diameter and '
    + '10 mm thick, and a vertical pillar — a cylinder 16 mm in diameter and 50 mm tall — '
    + 'standing on the centre of the base.';

  const result = await win.evaluate(async ({ description, llm }) => {
    return window.__archdiscSculptor.sculptAssembly({
      description, llm,
      atomicApi: window.__archdiscAtomic,
      placeAndRender: async (part) => { window.__archdiscAtomic.renderBody(part); },
    });
  }, { description, llm });

  console.log('  assembly parts: ' + JSON.stringify(result.parts));

  expect(result.parts.length).toBeGreaterThanOrEqual(2);
  for (const p of result.parts) {
    expect(p.volume).toBeGreaterThan(0);
    expect(Array.isArray(p.position)).toBe(true);
    expect(p.position.length).toBe(3);
  }

  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-ai-assembly.png') });
  await app.close();
});
