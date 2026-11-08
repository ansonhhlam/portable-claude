// Regenerates the README screenshots from the mock agent with fixed fake data.
// Run with: SCREENSHOTS=1 npx playwright test screenshots --project=iphone-light
import { expect, test } from '@playwright/test';
import { newSession, signIn } from './fixtures.js';

test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to regenerate docs/assets');

const shot = (name: string) => ({
  path: `docs/assets/${name}.png`,
  animations: 'disabled' as const,
});

test('README screenshots', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await signIn(page);

  // A finished session with Markdown and tool calls.
  await newSession(page, 'Fix the greeting and edit the file');
  const edit = page.getByTestId('approval-card').last();
  await expect(edit).toContainText('src/app.ts');
  await edit.getByTestId('approval-allow').click();
  await expect(page.getByTestId('run-finished').last()).toBeVisible();
  await page.screenshot(shot('session-light'));

  // A session waiting for approval, in dark mode.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#/');
  await newSession(page, 'Run the bash tests before the release');
  await expect(page.getByTestId('approval-card').last()).toContainText('npm test');
  await page.goto('/#/');
  await page.goto('/#/');
  await newSession(page, 'Update the docs site: edit the intro page', 'docs-site');
  await expect(page.getByTestId('approval-card').last()).toContainText('src/app.ts');
  await page.screenshot(shot('approval-dark'));

  await page.goto('/#/');
  await expect(page.getByTestId('home-needs-you')).toBeVisible();
  await page.screenshot(shot('home-dark'));

  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('devices-list')).toBeVisible();
  // The fixture folders live in this checkout; show them as the fake paths they
  // stand for so the published image contains no details of the build machine.
  await page.getByTestId('projects-list').evaluate((ul) => {
    for (const li of ul.querySelectorAll('li')) {
      const name = li.firstElementChild?.textContent?.trim() ?? '';
      for (const el of li.querySelectorAll('*')) {
        if (el.children.length === 0 && /[\\/]/.test(el.textContent ?? ''))
          el.textContent = `~/code/${name}`;
      }
    }
  });
  await expect(page.getByTestId('projects-list')).not.toContainText('test-results');
  await page.screenshot(shot('settings-light'));
});
