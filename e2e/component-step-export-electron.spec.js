import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Component STEP export, end to end, in the real ArchDisc desktop app: the AI
 * sculpts a component, it is saved into the component library with an id, and
 * its STEP file is written to disk — the unit operation of the Seamaster build.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output', 'seamaster', 'components');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('a sculpted component is saved with an id and exported to a STEP file', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscSculptor && !!window.__archdiscComponents, null, { timeout: 60000 });

  const description = 'A flat ring (annulus) 40 mm outer diameter, 30 mm inner diameter, '
    + '3 mm thick.';

  const result = await win.evaluate(async ({ description, llm }) => {
    const { part } = await window.__archdiscSculptor.sculptPart({
      description, llm, atomicApi: window.__archdiscAtomic,
    });
    window.__archdiscAtomic.render(part);
    const entry = await window.__archdiscComponents.save({ id: 'SM-001', name: 'case-back-ring', part });
    return {
      count: window.__archdiscComponents.count(),
      id: entry.id, name: entry.name, volume: entry.volume,
      stepHead: entry.stepText.slice(0, 40),
      stepLength: entry.stepText.length,
    };
  }, { description, llm });

  console.log('  saved component: ' + JSON.stringify(result));

  expect(result.count).toBe(1);
  expect(result.id).toBe('SM-001');
  expect(result.volume).toBeGreaterThan(0);
  expect(result.stepHead).toContain('ISO-10303-21');
  expect(result.stepLength).toBeGreaterThan(200);

  const stepText = await win.evaluate(() => window.__archdiscComponents.get('SM-001').stepText);
  fs.writeFileSync(path.join(OUT, 'SM-001-case-back-ring.step'), stepText);

  await win.waitForTimeout(2000);
  await win.screenshot({ path: path.resolve(__dirname, '..', 'autonomous-output', 'component-step-export.png') });
  await app.close();
});
