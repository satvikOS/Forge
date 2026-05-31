// e2e/forge/_helpers.js — shared Electron launch + screenshot tooling
// for the Forge headless self-verification suite.
//
// Three rules these tests follow:
//   1. Headless. The kernel + bridge tests don't need a watcher.
//      (Studio's headed rule applies to Studio e2e — see memory.)
//   2. Every assertion gets a screenshot, even on pass, so I can scan
//      `test-results/forge-screenshots/` and visually confirm what the
//      app actually looked like.
//   3. The tests must not require the React-mounted Forge app shell
//      to exist (Forge-26 is in flight). They load `about:blank` or a
//      tiny inline page and exercise `window.forge` directly.

const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('@playwright/test');

const SHOTS_DIR = path.resolve(__dirname, '..', '..', 'test-results', 'forge-screenshots');

function ensureShotsDir() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
}

async function launchForge({ extraArgs = [] } = {}) {
  ensureShotsDir();
  const app = await electron.launch({
    args: [
      path.resolve(__dirname, '..', '..', 'electron', 'main.js'),
      '--no-sandbox',
      ...extraArgs,
    ],
    env: { ...process.env, FORGE_E2E: '1' },
  });
  return app;
}

/** Capture a screenshot of `page` under a stable filename. */
async function shot(page, name) {
  ensureShotsDir();
  const file = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/** Inject a viewer-friendly HTML page so a screenshot is interesting. */
async function loadInlinePage(page, body) {
  await page.goto('about:blank');
  await page.evaluate((html) => {
    document.documentElement.innerHTML = `
      <head>
        <meta charset="utf-8">
        <title>Forge headless test</title>
        <style>
          body { margin: 0; background: #0a0e14; color: #c4ccd6;
                 font: 14px/1.4 -apple-system, ui-sans-serif, system-ui;
                 padding: 16px; }
          h1 { color: #fff; font-weight: 600; }
          .panel { background: #131a23; border: 1px solid #1f2a37;
                   border-radius: 6px; padding: 12px; margin: 8px 0; }
          code { background: #0a0e14; padding: 1px 4px; border-radius: 3px; }
          .ok { color: #4ec18b; } .bad { color: #ff6363; }
          .num { color: #6cd0e8; }
        </style>
      </head>
      <body>${html}</body>
    `;
  }, body);
  await page.waitForLoadState('domcontentloaded');
}

module.exports = { launchForge, shot, loadInlinePage, SHOTS_DIR };
