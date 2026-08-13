import { expect, test } from '@playwright/test';

// One ordered journey through Phase 1: wizard → import → review → cash flow →
// settings module toggle → theme persistence. Auth is carried between tests
// via a saved storage state, since each test gets a fresh browser context.

const AUTH_STATE = 'test-results/e2e-auth.json';

test.describe.configure({ mode: 'serial' });

test('first visit redirects to the setup wizard', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/setup/);
	await expect(page.getByRole('heading', { name: 'Set up your household ledger' })).toBeVisible();
});

test('the wizard creates the household and signs in', async ({ page }) => {
	await page.goto('/setup');
	await page.getByPlaceholder('e.g. Robert & Tereza').fill('Jana & Jan');
	await page.getByPlaceholder('Name').first().fill('Jana Nováková');
	await page.getByPlaceholder('Password (8+ characters)').first().fill('correct-horse-battery');
	await page.getByRole('button', { name: 'Create household' }).click();
	await expect(page).toHaveURL(/\/overview/);
	await expect(page.getByText('Jana & Jan')).toBeVisible();
	await page.context().storageState({ path: AUTH_STATE });
});

test.describe('signed in', () => {
	test.use({ storageState: AUTH_STATE });

	test('importing the fio fixture creates an account and a review queue', async ({ page }) => {
		await page.goto('/import');
		await page.locator('input[type=file]').setInputFiles('tests/fixtures/fio.csv');
		await expect(page.getByText('Transactions read').locator('..').locator('.value')).toHaveText(
			'5',
			{ timeout: 15000 }
		);
		await page.goto('/accounts');
		await expect(page.getByText('Fio CZK').first()).toBeVisible();
		// Statement closing balance became the account balance.
		await expect(page.locator('.balance').first()).toContainText('22 984.38');
	});

	test('categorising a review row files it and teaches a rule', async ({ page }) => {
		await page.goto('/import');
		const firstRow = page.locator('.review-row').first();
		await expect(firstRow).toBeVisible();
		const merchant = await firstRow.locator('.r-merchant').innerText();
		await firstRow.locator('select[name=categoryId]').selectOption('groceries');
		await firstRow.getByRole('button', { name: 'File it' }).click();
		// The filed row leaves the queue (learned rules may clear more).
		await expect(page.locator('.review-row', { hasText: merchant })).toHaveCount(0, {
			timeout: 10000
		});
	});

	test('cash flow renders the waterfall from imported data', async ({ page }) => {
		await page.goto('/cashflow');
		await expect(page.getByText('Money in', { exact: true })).toBeVisible();
		await expect(page.locator('svg path').first()).toBeVisible();
		await expect(page.getByText('Saved & invested').first()).toBeVisible();
	});

	test('switching a module off removes it from the sidebar and 404s its routes', async ({
		page
	}) => {
		await page.goto('/settings');
		await page.locator('.module-row', { hasText: 'Property' }).getByRole('switch').click();
		await expect(page.locator('aside').getByText('Property')).toHaveCount(0, { timeout: 10000 });
		const response = await page.goto('/property');
		expect(response?.status()).toBe(404);
		// Switch it back on for later runs.
		await page.goto('/settings');
		await page.locator('.module-row', { hasText: 'Property' }).getByRole('switch').click();
		await expect(page.locator('aside').getByText('Property')).toHaveCount(1, { timeout: 10000 });
	});

	test('theme choice persists across reloads', async ({ page }) => {
		await page.goto('/overview');
		await page.getByRole('button', { name: '☀️ Light' }).click();
		await expect(page.locator('html')).toHaveAttribute('data-ledger-theme', 'light');
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-ledger-theme', 'light');
		await page.getByRole('button', { name: '🌙 Dark' }).click();
		await expect(page.locator('html')).not.toHaveAttribute('data-ledger-theme', 'light');
	});
});
