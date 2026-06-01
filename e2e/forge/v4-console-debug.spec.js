// Debug spec — capture every console message + exception on boot.
const { test, _electron } = require('@playwright/test');
const path = require('path');

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

test('debug — capture console errors on boot', async () => {
  const app = await _electron.launch({
    args: [ELECTRON_MAIN, '--no-sandbox'],
    env: { ...process.env, FORGE_E2E: '1' },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      errors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    errors.push(`[pageerror] ${err.message}\n${err.stack}`);
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4500);
  console.log('=== console messages ===');
  for (const e of errors.slice(0, 30)) console.log(e);
  await app.close();
});
