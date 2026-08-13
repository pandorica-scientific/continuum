import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
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

	test('documents: adding one builds its shelf and subject column', async ({ page }) => {
		await page.goto('/documents');
		await page.getByRole('button', { name: '➕ Add document' }).click();
		await page.getByPlaceholder('Passport · Robert').fill('Passport · Jana');
		await page.locator('select[name=shelf]').selectOption('identity');
		await page.locator('input[name=subject]').fill('Jana Nováková');
		await page.locator('select[name=expiryVerb]').selectOption('expires');
		await page.locator('input[name=expiresOn]').fill('2027-03-15');
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(page.getByText('Passport · Jana')).toBeVisible();
		await expect(page.getByText('expires 2027-03-15')).toBeVisible();
		// the subject column derived itself
		await expect(page.locator('.col-label', { hasText: 'Jana Nováková' })).toBeVisible();
	});

	test('property: documents filed about a flat appear on its card', async ({ page }) => {
		await page.goto('/property');
		await page.getByRole('button', { name: '➕ Add property' }).click();
		await page.getByPlaceholder('Karlín, Praha 8').fill('Flat Žižkov');
		await page.getByRole('button', { name: 'Add property', exact: true }).click();
		await expect(page.locator('.tab', { hasText: 'Flat Žižkov' })).toBeVisible();

		// the card's add link opens the documents form pre-addressed to this flat
		await page.getByRole('link', { name: '➕ Add a document about this flat' }).click();
		await expect(page.locator('input[name=subject]')).toHaveValue('Flat Žižkov');
		await expect(page.locator('select[name=shelf]')).toHaveValue('property');
		await page.getByPlaceholder('Passport · Robert').fill('Renting contract · Žižkov');
		await page.locator('select[name=shelf]').selectOption('tenancy');
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(page.getByText('Renting contract · Žižkov')).toBeVisible();

		// …and the document shows on the property's own card
		await page.goto('/property');
		await page.locator('.tab', { hasText: 'Flat Žižkov' }).click();
		await expect(page.getByText('Renting contract · Žižkov')).toBeVisible();
		await expect(page.getByText(/Tenancy · added/)).toBeVisible();
	});

	test('calendar renders the month grid and the published feed path', async ({ page }) => {
		await page.goto('/calendar');
		await expect(page.locator('.day').first()).toBeVisible();
		const icsPath = await page.locator('.f-detail').innerText();
		expect(icsPath).toMatch(/^\/ics\/[0-9a-f]+$/);
		// the feed itself answers without a session cookie
		const response = await page.request.get(icsPath);
		expect(response.status()).toBe(200);
		expect(await response.text()).toContain('BEGIN:VCALENDAR');
	});

	test('retirement recomputes live when assumptions change', async ({ page }) => {
		await page.goto('/retirement');
		await expect(page.getByText('If you stopped working today')).toBeVisible();
		const before = await page.locator('.chip').first().innerText();
		await page.locator('.seg button', { hasText: '4.0%' }).click();
		await expect(page.locator('.chip').first()).not.toHaveText(before);
	});

	test('backups: back up now writes a restorable dump to the chosen folder', async ({ page }) => {
		const dest = 'scratch-workspace/e2e-backups';
		await rm(dest, { recursive: true, force: true });
		await page.goto('/settings');
		await page.locator('input[name=dir]').fill(dest);
		await page.locator('select[name=cadence]').selectOption('weekly');
		await page.locator('.backup-form').getByRole('button', { name: 'Save' }).click();
		await page.getByRole('button', { name: 'Back up now' }).click();
		// the dump itself can take a while
		await expect(page.getByText(/Database dumped/)).toBeVisible({ timeout: 20000 });
		await expect(page.getByText(/Last backup/)).toBeVisible();

		const files = await readdir(join(dest, 'Continuum backups'));
		expect(files).toContain('continuum-backup.sql');
		const sql = await readFile(join(dest, 'Continuum backups', 'continuum-backup.sql'), 'utf8');
		expect(sql).toContain('copy "person"');
		expect(sql).toContain('truncate');
		expect(sql.trim().endsWith('commit;')).toBe(true);
	});

	test('settings export produces a config file with only whitelisted keys', async ({ page }) => {
		await page.goto('/settings');
		const resp = await page.request.get('/settings/export');
		expect(resp.status()).toBe(200);
		expect(resp.headers()['content-disposition']).toContain('ledger.config.json');
		const json = await resp.json();
		expect(json.continuum).toBe(1);
		expect(json.settings.baseCurrency).toBe('CZK');
		// secrets and state never leave: no calendar token, no backup status
		expect(json.settings.icsToken).toBeUndefined();
		expect(json.settings.backupLastRun).toBeUndefined();
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
