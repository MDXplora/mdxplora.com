import { defineConfig, devices } from '@playwright/test';

// Tests run against the built site (npm run build first), served by astro preview.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Playwright's own reporter, list here and github in CI, with the operator's name masked in all it prints, as the
  // log of each run in CI is public. See tests/lib/masked-reporter.ts.
  reporter: [['./tests/lib/masked-reporter.ts', { reporter: process.env.CI ? 'github' : 'list' }]],
  use: {
    baseURL: 'http://localhost:4321',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npx astro preview --port 4321',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
  },
});
