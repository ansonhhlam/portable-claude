import { defineConfig, devices } from '@playwright/test';

export const E2E_PORT = 18_417;

// Chromium renders both the iPhone and Android viewports: WebKit refuses
// `Secure` cookies on plain-http loopback, which is what tests run on.
const iphone = {
  ...devices['iPhone 14'],
  browserName: 'chromium' as const,
  defaultBrowserType: 'chromium' as const,
};
const android = { ...devices['Pixel 7'] };

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'iphone-light', use: { ...iphone, colorScheme: 'light' } },
    { name: 'iphone-dark', use: { ...iphone, colorScheme: 'dark' } },
    { name: 'android-light', use: { ...android, colorScheme: 'light' } },
    { name: 'android-dark', use: { ...android, colorScheme: 'dark' } },
  ],
  webServer: {
    command: `node test/e2e/serve.mjs ${E2E_PORT}`,
    url: `http://127.0.0.1:${E2E_PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
