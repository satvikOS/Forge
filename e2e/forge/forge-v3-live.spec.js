// forge-v3-live.spec.js — actually mount the v3 app and screenshot it
// so we can see what the user sees when they install Forge.
//
// Loads frontend/dist/index.html in Electron and waits for the v3 grid
// to settle, then captures a full-page PNG.

const { test } = require('@playwright/test');
const path = require('path');
const { _electron: electron } = require('@playwright/test');
const { shot } = require('./_helpers');

test('v3 live — actually rendering', async () => {
  const app = await electron.launch({
    args: [
      path.resolve(__dirname, '..', '..', 'electron', 'main.js'),
      '--no-sandbox',
    ],
    env: { ...process.env, FORGE_E2E: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Wait long enough for r3f canvas to mount (lazy import).
  await page.waitForTimeout(3000);
  await shot(page, '99-v3-live');
  // Dump the body innerHTML so we can see if a runtime error blanked the page.
  const bodyText = await page.evaluate(() => document.body.innerHTML.slice(0, 2000));
  console.log('---BODY---');
  console.log(bodyText);
  console.log('---CONSOLE---');
  const errors = await page.evaluate(() => window.__capturedErrors || []);
  console.log(JSON.stringify(errors, null, 2));
  await app.close();
});
