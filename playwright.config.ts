/**
 * E2E config. Manual-run only (no webServer block) — we expect the local
 * Docker stack (`just up`) to already be running on port 3000. CI brings
 * the same stack up before invoking Playwright.
 *
 * Port 3000 (webpack-dev-server) is used, never 8000: the Django shell
 * serves hashed bundle URLs with text/html MIME under the SPA catch-all,
 * which breaks pages in a real browser. :3000 proxies /api/ to Django and
 * serves bundles with correct MIME types.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
