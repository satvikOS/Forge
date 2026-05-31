// e2e/forge/playwright.headless.config.js — headless Playwright config
// specific to the Forge self-verification suite. The repo-root
// playwright.config.js is headed (Studio rule); this one is headless
// because the goal is screenshot artifacts for me to scan, not a live
// watcher.

const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: __dirname,
  fullyParallel: false,            // share one Electron app across tests
  timeout: 90_000,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.resolve(__dirname, '..', '..', 'test-results', 'forge-html-report'), open: 'never' }],
  ],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure', // we explicitly call shot() ourselves
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: path.resolve(__dirname, '..', '..', 'test-results', 'forge-output'),
});
