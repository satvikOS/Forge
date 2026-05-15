import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: false,
    // Headed playback for a human watcher: pin a generous viewport
    // and explicitly size the OS-level window to match so nothing
    // gets cropped. Avoid --start-maximized — it leaves the inner
    // viewport at the default 1280×720 even when the chrome fills
    // the screen, which is what was cropping panels before.
    viewport: { width: 1920, height: 1000 },
    launchOptions: {
      args: ['--window-position=0,0', '--window-size=1920,1080'],
    },
    screenshot: 'on',
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'cd frontend && npx vite --port 3000',
    port: 3000,
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
