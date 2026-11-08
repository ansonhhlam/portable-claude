import { expect, test } from '@playwright/test';
import { newSession, signIn } from './fixtures.js';

test.describe('longcord web app', () => {
  test('shows the login screen when signed out', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await expect(page.getByTestId('login-passcode')).toBeVisible();
    await page.getByTestId('login-passcode').fill('not the passcode');
    await page.getByTestId('login-submit').click();
    await expect(page.getByText(/not right|locked|Too many/i)).toBeVisible();
  });

  test('pairs, runs a session and streams the reply', async ({ page }) => {
    await signIn(page);
    await newSession(page, 'Say hello to the team');
    await expect(page.getByTestId('run-finished').first()).toBeVisible();
    await expect(page.getByTestId('timeline')).toContainText('Mock reply');
    await expect(page.getByTestId('state-badge')).toContainText(/idle/i);
  });

  test('approves a command and denies an edit with a note', async ({ page }) => {
    await signIn(page);
    await newSession(page, 'Run the bash tests');
    const card = page.getByTestId('approval-card').last();
    await expect(card).toContainText('npm test');
    await expect(page.getByTestId('state-badge')).toContainText(/waiting/i);
    await card.getByTestId('approval-allow').click();
    await expect(page.getByTestId('run-finished').last()).toBeVisible();
    await page.getByTestId('composer-input').fill('Now edit the file');
    await page.getByTestId('send-button').click();
    const edit = page.getByTestId('approval-card').last();
    await expect(edit).toContainText('src/app.ts');
    await edit.getByRole('button', { name: /deny/i }).click();
    const note = edit.getByTestId('approval-deny-note');
    if (await note.isVisible()) {
      await note.fill('Keep the old signature');
      await edit
        .getByRole('button', { name: /send|deny/i })
        .last()
        .click();
    }
    await expect(page.getByTestId('run-finished').nth(1)).toBeVisible();
  });

  test('queues a follow-up and stops a long run', async ({ page }) => {
    await signIn(page);
    await newSession(page, 'Please wait on this task');
    await expect(page.getByTestId('stop-button')).toBeVisible();
    await page.getByTestId('composer-input').fill('And then summarise');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('timeline')).toContainText(/queued/i);
    await page.getByTestId('stop-button').click();
    await expect(page.getByTestId('run-finished').first()).toBeVisible();
  });

  test('bypass mode needs confirmation and shows a banner', async ({ page }) => {
    await signIn(page);
    await newSession(page, 'hello');
    await expect(page.getByTestId('run-finished').first()).toBeVisible();
    await page.getByTestId('mode-chip-bypassPermissions').click();
    await page.getByRole('button', { name: 'Switch to bypass' }).click();
    await expect(page.getByTestId('bypass-banner')).toBeVisible();
    await page.getByTestId('mode-chip-default').click();
    await expect(page.getByTestId('bypass-banner')).toBeHidden();
  });

  test('reconnects after the page was in the background and shows missed events', async ({
    page,
  }) => {
    await signIn(page);
    await newSession(page, 'Run the bash tests');
    await expect(page.getByTestId('approval-card').last()).toBeVisible();
    const url = page.url();
    // Simulate iOS killing the connection while the app is in the background.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.context().setOffline(true);
    await page.waitForTimeout(300);
    await page.context().setOffline(false);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByTestId('connection-status')).not.toContainText(/offline/i);
    await page.getByTestId('approval-card').last().getByTestId('approval-allow').click();
    await expect(page.getByTestId('run-finished').last()).toBeVisible();
    // A full reload replays the log without duplicates.
    await page.goto(url);
    await expect(page.getByTestId('run-finished')).toHaveCount(1);
    await expect(page.getByTestId('approval-card')).toHaveCount(1);
  });

  test('imports a session started on the computer', async ({ page }) => {
    await signIn(page);
    await page.getByTestId('new-session-button').click();
    await page.getByTestId('project-select').selectOption('docs-site');
    await page.getByTestId('import-link').click();
    await page.getByTestId('import-candidate').first().getByTestId('import-button').click();
    await expect(page.getByTestId('timeline')).toContainText('signup form');
    // Clean up so the next browser project can import it again.
    const id = new URL(page.url()).hash.split('/')[2];
    const origin = new URL(page.url()).origin;
    const res = await page.request.delete(`/api/sessions/${id}`, { headers: { origin }, data: {} });
    expect(res.ok()).toBe(true);
  });

  test('settings lists devices and projects', async ({ page }) => {
    await signIn(page);
    await page.getByTestId('settings-button').click();
    await expect(page.getByTestId('devices-list')).toBeVisible();
    await expect(page.getByTestId('projects-list')).toContainText('my-app');
    await expect(page.getByTestId('spend-info')).toBeVisible();
    await expect(page.getByTestId('mock-indicator')).toBeVisible();
  });

  test('has no accessibility basics missing on the home screen', async ({ page }) => {
    await signIn(page);
    // Every form control has an accessible name and the page has a main landmark and title.
    const unlabeled = await page.evaluate(
      () =>
        [...document.querySelectorAll('input, select, textarea, button')].filter((el) => {
          const e = el as HTMLElement;
          const name =
            e.getAttribute('aria-label') ||
            e.textContent?.trim() ||
            (e.id && document.querySelector(`label[for="${e.id}"]`)) ||
            e.closest('label') ||
            e.getAttribute('title');
          return !name;
        }).length,
    );
    expect(unlabeled).toBe(0);
    await expect(page.locator('main')).toHaveCount(1);
    expect(await page.title()).toContain('longcord');
  });
});
