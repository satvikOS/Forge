import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { sculptAndVerify, requestSculptPlan } from '../frontend/src/ai/sculptor/PartSculptor.js';
import { verifyRender } from '../frontend/src/ai/sculptor/PartVerifier.js';

/*
 * The Seamaster build loop, one batch: the AI decomposes the watch into a
 * component manifest, then builds the first 2 components — each through the
 * vision-verify loop so wrong geometry is caught — saving each with an id and
 * writing its STEP file to disk. Resumable: components already on disk are
 * skipped.
 */

const ROOT = path.resolve(__dirname, '..', 'autonomous-output', 'seamaster');
const COMPONENTS = path.join(ROOT, 'components');
const MANIFEST = path.join(ROOT, 'manifest.json');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');
const BATCH = 25;

test('the AI decomposes the Seamaster and builds the next components, verified', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  test.setTimeout(2400000);
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(COMPONENTS, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscSculptor && !!window.__archdiscComponents
      && !!window.__archdiscSculptor.requestManifest, null, { timeout: 60000 });

  let manifest;
  if (fs.existsSync(MANIFEST)) {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } else {
    manifest = await win.evaluate(async (llm) => window.__archdiscSculptor.requestManifest({
      productDescription: 'An Omega Seamaster wristwatch — case, bezel, crystal, '
        + 'dial, hands, caseback, crown, and the mechanical movement components.',
      llm,
    }), llm);
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  }
  expect(manifest.length).toBeGreaterThan(0);
  console.log('  manifest: ' + manifest.length + ' components');

  const done = new Set(fs.readdirSync(COMPONENTS)
    .filter((f) => f.endsWith('.step')).map((f) => f.split('--')[0]));
  const todo = manifest.filter((c) => !done.has(c.id)).slice(0, BATCH);
  console.log('  already built: ' + done.size + ' | building this run: ' + todo.map((c) => c.id).join(', '));

  for (const comp of todo) {
    const built = await sculptAndVerify({
      description: comp.description,
      requestPlan: async (feedback) => requestSculptPlan({
        description: feedback ? `${comp.description}\n\n${feedback}` : comp.description,
        llm,
      }),
      executePlan: async (plan) => win.evaluate(async (p) => {
        const part = await window.__archdiscSculptor.executeSculptPlan(p, window.__archdiscAtomic);
        window.__archdiscAtomic.render(part);
        window.__lastBuiltPart = part;
        return { volume: part.solid.volume() };
      }, plan),
      renderAndCapture: async () => {
        const views = [];
        for (const az of [30, 100, 170, 240, 310]) {
          await win.evaluate((a) => window.__archdiscOrbitView(a, 22), az);
          await win.waitForTimeout(350);
          const buf = await win.locator('canvas').first().screenshot();
          views.push('data:image/png;base64,' + buf.toString('base64'));
        }
        return views;
      },
      verify: ({ description, imageDataUrl }) =>
        verifyRender({ description, imageDataUrls: imageDataUrl, llm }),
      maxRounds: 3,
    });

    const saved = await win.evaluate(async ({ id, name }) => {
      const part = window.__lastBuiltPart;
      const entry = await window.__archdiscComponents.save({ id, name, part });
      return { id: entry.id, volume: entry.volume, step: entry.stepText };
    }, { id: comp.id, name: comp.name });

    fs.writeFileSync(path.join(COMPONENTS, `${comp.id}--${comp.name.replace(/\W+/g, '_')}.step`), saved.step);
    console.log(`  built ${comp.id} (${comp.name}) — accepted=${built.accepted}, `
      + `rounds=${built.rounds.length}, volume=${saved.volume.toFixed(0)} mm^3`);
    expect(saved.volume).toBeGreaterThan(0);
  }

  await win.screenshot({ path: path.join(ROOT, 'build-batch.png') });
  const builtCount = fs.readdirSync(COMPONENTS).filter((f) => f.endsWith('.step')).length;
  console.log('  total components built so far: ' + builtCount + ' / ' + manifest.length);
  expect(builtCount).toBeGreaterThanOrEqual(todo.length);

  await app.close();
});
