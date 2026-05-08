import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: false,
    viewport: { width: 1920, height: 1080 },
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
