import { test, expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

test.describe.configure({ mode: 'serial' });
const firstProgram = '11111111-1111-4111-8111-111111111111';
async function login(
  page: Page,
  email = process.env.E2E_EMAIL!,
  password = process.env.E2E_PASSWORD!,
) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}
async function treasury(page: Page) {
  await page.getByRole('link', { name: 'Treasury', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Local demo controls' })).toBeVisible();
}
async function applyFresh(page: Page) {
  await page.getByRole('button', { name: 'Apply fresh snapshot', exact: true }).click();
  await expect(page.locator('.event-outcome > strong')).toHaveText('Applied');
  await expect(page.getByText('Your program is in sync', { exact: true })).toBeVisible();
}
async function expectSameRow(...controls: Locator[]) {
  const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
  const first = boxes[0]!;
  expect(first).not.toBeNull();
  for (const box of boxes.slice(1)) {
    expect(box).not.toBeNull();
    expect(Math.abs(first.y + first.height / 2 - box!.y - box!.height / 2)).toBeLessThanOrEqual(1);
  }
}
async function reserve(page: Page, invoice: string, amount = '1250.50', currency = 'EUR') {
  await page.getByRole('link', { name: 'Reservations', exact: true }).click();
  await page.getByRole('button', { name: 'New reservation', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'New reservation',
    exact: true,
  });
  await dialog.getByLabel('Invoice ID', { exact: true }).fill(invoice);
  await dialog.getByLabel('Amount', { exact: true }).fill(amount);
  await dialog.getByLabel('Currency', { exact: true }).selectOption(currency);
  await dialog.getByRole('button', { name: 'Create reservation', exact: true }).click();
  return page.getByRole('dialog', { name: 'Reservation details', exact: true });
}
test('login, real Kafka reconciliation, cross-currency reserve/release and stale snapshot recovery', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill('WrongPassword123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/Invalid|credentials/i);
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByText('10,000,000.00', { exact: true }).first()).toBeVisible();
  await treasury(page);
  await applyFresh(page);
  const invoice = `EUR-${randomUUID()}`;
  const detail = await reserve(page, invoice);
  await expect(detail.getByRole('heading', { name: 'USD 1,375.55' })).toBeVisible();
  await expect(detail.getByText(/1.1 USD \/ EUR/)).toBeVisible();
  await detail.getByRole('button', { name: 'Close dialog' }).click();
  await treasury(page);
  await page.getByRole('button', { name: 'Capture snapshot', exact: true }).click();
  await expect(page.getByText(/Captured at version/)).toBeVisible();
  const second = await reserve(page, `STALE-${randomUUID()}`, '25.00', 'USD');
  await expect(second).toBeVisible();
  await second.getByRole('button', { name: 'Close dialog' }).click();
  await treasury(page);
  await page.getByRole('button', { name: 'Publish captured', exact: true }).click();
  await expect(page.getByText('State version conflict', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Fresh reconciliation required', { exact: true })).toBeVisible();
  await applyFresh(page);
  await page.getByLabel('Program limit', { exact: true }).fill('2000000.00');
  await page.getByRole('button', { name: 'Publish limit update', exact: true }).click();
  await expect(page.locator('.event-outcome > strong')).toHaveText('Applied');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(firstProgram);
  await page.getByRole('link', { name: 'Reservations', exact: true }).click();
  await page.getByLabel('Search invoices').fill(invoice);
  await expect(page.getByRole('row').filter({ hasText: invoice })).toHaveCount(1);
  await page.getByRole('button', { name: `View invoice ${invoice}` }).click();
  const release = page.getByRole('dialog', {
    name: 'Reservation details',
    exact: true,
  });
  await release.getByRole('button', { name: 'Release reservation', exact: true }).click();
  await release.getByRole('button', { name: 'Confirm release', exact: true }).click();
  await expect(release.getByText('Released', { exact: true })).toBeVisible();
  await release.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('RELEASED');
  await expect(page.getByRole('row').filter({ hasText: invoice })).toHaveCount(1);
  await page
    .getByLabel('Program', { exact: true })
    .selectOption('22222222-2222-4222-8222-222222222222');
  await expect(page.getByText('Your first reservation starts here')).not.toBeVisible();
  await page.getByLabel('Search invoices').fill('');
  await page.getByLabel('Status', { exact: true }).selectOption('');
  await expect(page.getByText('Your first reservation starts here')).toBeVisible();
});
test('lost HTTP response retries one operation with the same idempotency key; errors retain a usable form', async ({
  page,
}) => {
  await login(page);
  await page.getByLabel('Program', { exact: true }).selectOption(firstProgram);
  let first = true;
  const keys: string[] = [];
  await page.route(`**/api/v1/programs/${firstProgram}/reservations`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (first) {
      first = false;
      await route.fetch();
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await reserve(page, `NETWORK-${randomUUID()}`, '10.00', 'USD');
  const form = page.getByRole('dialog', {
    name: 'New reservation',
    exact: true,
  });
  await expect(form.getByRole('alert')).toContainText('outcome is unknown');
  await form.getByRole('button', { name: 'Retry exact request', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Reservation details', exact: true }),
  ).toBeVisible();
  expect(keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.unroute(`**/api/v1/programs/${firstProgram}/reservations`);
  const known = `DUPLICATE-${randomUUID()}`;
  const detail = await reserve(page, known, '1.00', 'USD');
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Close dialog' }).click();
  await reserve(page, known, '1.00', 'USD');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/Invoice|invoice/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.route(`**/api/v1/programs/${firstProgram}/reservations`, async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: {
            code: 422000,
            message: 'Validation failed',
            details: { invoiceId: ['Invalid invoice reference'] },
          },
        }),
      });
    else await route.continue();
  });
  await reserve(page, `VALIDATION-${randomUUID()}`, '1.00', 'USD');
  await expect(page.getByRole('alert')).toContainText('Invalid invoice reference');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.unroute(`**/api/v1/programs/${firstProgram}/reservations`);
  let outage = true;
  await page.route('**/api/v1/programs?*', async (route) => {
    if (outage)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 503000, message: 'Service temporarily unavailable' },
        }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(page.getByRole('alert')).toContainText('Service temporarily unavailable');
  outage = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('refresh survives reload, concurrent expired-token requests rotate once, logout and roles are enforced', async ({
  page,
}) => {
  await login(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  let rotations = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/auth/token/refresh')) rotations++;
  });
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect.poll(() => rotations).toBe(1);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await login(page, 'reader@capacity.local', process.env.E2E_READER_PASSWORD!);
  await expect(page.getByRole('button', { name: 'New reservation', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Treasury', exact: true })).toHaveCount(0);
  await page.goto('/treasury');
  await expect(page.getByText('Your account does not have treasury permission.')).toBeVisible();
  await page.route('**/api/v1/programs?*', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: { code: 403000, message: 'Forbidden' },
      }),
    }),
  );
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(page.getByRole('alert')).toContainText('does not have permission');
  await page.unroute('**/api/v1/programs?*');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login(page, 'foreign@capacity.local', process.env.E2E_FOREIGN_PASSWORD!);
  await expect(page.getByText('No programs are assigned to this tenant yet.')).toBeVisible();
});
test('responsive layouts, keyboard dialog focus, no console errors or missing local assets', async ({
  page,
}) => {
  const errors: string[] = [];
  const missing: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() === 404 && /\.(png|svg|woff2|css|js)$/.test(response.url()))
      missing.push(response.url());
  });
  await login(page);
  await page.getByLabel('Program', { exact: true }).selectOption(firstProgram);
  const directory = process.env.WEB_SCREENSHOT_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByText('Capacity at a glance')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    if (directory)
      await page.screenshot({
        path: join(directory, `program-capacity-${width}.png`),
        fullPage: true,
      });
  }
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Reservations', exact: true }).click();
  await page.getByRole('button', { name: 'New reservation', exact: true }).click();
  await expect(page.getByLabel('Invoice ID', { exact: true })).toBeFocused();
  const dialog = page.getByRole('dialog', {
    name: 'New reservation',
    exact: true,
  });
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New reservation', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
  expect(missing).toEqual([]);
});

test('form controls and action rows stay aligned across responsive layouts', async ({ page }) => {
  await login(page);
  for (const width of [2560, 1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/treasury');
    await expect(
      page.getByRole('button', { name: 'Publish limit update', exact: true }),
    ).toBeEnabled();
    await expectSameRow(
      page.locator('.program-selector'),
      page.getByRole('button', { name: 'Refresh workspace' }),
    );
    const field = page.getByLabel('Program limit', { exact: true });
    const publish = page.getByRole('button', {
      name: 'Publish limit update',
      exact: true,
    });
    const inputBox = (await field.boundingBox())!;
    const buttonBox = (await publish.boundingBox())!;
    expect(Math.abs(inputBox.height - buttonBox.height)).toBeLessThanOrEqual(1);
    if (buttonBox.y < inputBox.y + inputBox.height) {
      await expectSameRow(field, publish);
    } else {
      expect(
        Math.abs(buttonBox.x + buttonBox.width / 2 - inputBox.x - inputBox.width / 2),
      ).toBeLessThanOrEqual(1);
      expect(Math.abs(buttonBox.width - inputBox.width)).toBeLessThanOrEqual(1);
      expect(buttonBox.y - inputBox.y - inputBox.height).toBeCloseTo(10, 0);
    }
    const snapshotButtons = page.locator('.demo-buttons .button');
    const a = (await snapshotButtons.nth(0).boundingBox())!;
    const b = (await snapshotButtons.nth(1).boundingBox())!;
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
    if (b.y < a.y + a.height) await expectSameRow(snapshotButtons.nth(0), snapshotButtons.nth(1));
    else expect(Math.abs(a.x + a.width / 2 - b.x - b.width / 2)).toBeLessThanOrEqual(1);

    await page.goto('/reservations');
    await expect(page.getByRole('button', { name: 'New reservation', exact: true })).toBeEnabled();
    await expectSameRow(
      page.getByLabel('Status', { exact: true }),
      page.getByLabel('Currency filter', { exact: true }),
    );
    if (width > 900)
      await expectSameRow(
        page.locator('.search-field'),
        page.getByLabel('Status', { exact: true }),
      );
    await page.getByRole('button', { name: 'New reservation', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: 'New reservation',
      exact: true,
    });
    await expectSameRow(
      dialog.getByLabel('Amount', { exact: true }),
      dialog.getByLabel('Currency', { exact: true }),
    );
    await expectSameRow(
      dialog.getByRole('button', { name: 'Cancel', exact: true }),
      dialog.getByRole('button', { name: 'Create reservation', exact: true }),
    );
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});
