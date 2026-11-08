import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { PairingStore, DeviceStore } from '../../src/server/auth.js';

export const HOME = path.resolve('test-results', 'e2e-data');

/** Sign the page in by opening a fresh one-time pairing link. */
export async function signIn(page: Page): Promise<void> {
  const { token } = new PairingStore(path.join(HOME, 'pairing.json')).create();
  await page.goto(`/#/pair/${token}`);
  await expect(page.getByTestId('new-session-button')).toBeVisible();
}

export function deviceNames(): string[] {
  return new DeviceStore(path.join(HOME, 'devices.json')).list().map((d) => d.name);
}

export async function newSession(page: Page, prompt: string, project = 'my-app'): Promise<void> {
  await page.getByTestId('new-session-button').click();
  await page.getByTestId('project-select').selectOption(project);
  await page.getByTestId('prompt-input').fill(prompt);
  await page.getByTestId('create-session').click();
  await expect(page.getByTestId('timeline')).toBeVisible();
}
