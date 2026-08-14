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

	test('the register finds a transaction by text, direction and amount', async ({ page }) => {
		await page.goto('/transactions');
		// The fio fixture's five rows; nothing is a paired own-account transfer
		// yet, so all of them are in scope.
		await expect(page.locator('.txn-row')).toHaveCount(5);

		// Searching narrows to the one payment from ACME BIOTECH, and the filter
		// lands in the URL so the view is linkable.
		await page.locator('input[name=q]').fill('ACME');
		await page.getByRole('button', { name: 'Apply' }).click();
		await expect(page).toHaveURL(/q=ACME/);
		await expect(page.locator('.txn-row')).toHaveCount(1);
		await expect(page.locator('.txn-row').first()).toContainText('ACME BIOTECH');

		// Money out alone is three of the five rows.
		await page.goto('/transactions?dir=out');
		await expect(page.locator('.txn-row')).toHaveCount(3);

		// Two of those three are the 20 000 CZK payments; the 50 CZK one drops
		// out, which proves the bound is read as a magnitude.
		await page.goto('/transactions?dir=out&min=1000');
		await expect(page.locator('.txn-row')).toHaveCount(2);

		// An unfiled row must not look filed: its picker sits on the prompt
		// rather than on whichever category happens to sort first.
		await page.goto('/transactions?review=needs_review');
		const unfiled = page.locator('.txn-row').first();
		await expect(unfiled).toBeVisible();
		await expect(unfiled.locator('select[name=categoryId]')).toHaveValue('');
	});

	test('the register totals the filtered set and recategorises a row', async ({ page }) => {
		await page.goto('/transactions?dir=out&min=1000');
		await expect(page.locator('.filter-total')).toContainText('2');

		// Filing the ACME payment from the register moves it into the category,
		// exactly as filing it from the review queue would.
		await page.goto('/transactions?q=ACME');
		const row = page.locator('.txn-row').first();
		await row.locator('select[name=categoryId]').selectOption('groceries');
		await row.getByRole('button', { name: 'File' }).click();

		await page.goto('/transactions?q=ACME&category=groceries');
		await expect(page.locator('.txn-row')).toHaveCount(1);
	});

	test('splitting a transaction divides it between two categories', async ({ page }) => {
		await page.goto('/transactions?q=ACME');
		await page.getByRole('button', { name: 'Split' }).first().click();

		// Lines that do not add up: the dialog must refuse to save.
		await page.locator('.split-line input[name=amount]').first().fill('10000');
		await page.locator('.split-line input[name=amount]').nth(1).fill('10000');
		await expect(page.getByRole('button', { name: 'Save split' })).toBeDisabled();

		// Balanced: 32 892 split as 20 000 + 12 892. Amounts are magnitudes; the
		// direction comes from the transaction itself.
		await page.locator('.split-line input[name=amount]').first().fill('20000');
		await page.locator('.split-line input[name=amount]').nth(1).fill('12892');
		await page.locator('.split-line select[name=categoryId]').first().selectOption('groceries');
		await page.locator('.split-line select[name=categoryId]').nth(1).selectOption('salary');
		await expect(page.getByRole('button', { name: 'Save split' })).toBeEnabled();
		await page.getByRole('button', { name: 'Save split' }).click();

		await expect(page.locator('.txn-row .split-line')).toHaveCount(2, { timeout: 10000 });
	});

	test('filtering by one category shows only that share of a split', async ({ page }) => {
		await page.goto('/transactions?q=ACME&category=groceries');
		await expect(page.locator('.txn-row')).toHaveCount(1);
		// The groceries share, not the whole 32 892 — the line-summed total.
		await expect(page.locator('.filter-total')).toContainText('20 000');
	});

	test('a tag rolls its transactions up into a running total', async ({ page }) => {
		await page.goto('/transactions?q=ACME');
		await page.locator('.txn-row .tag-input').first().fill('Renovation 2026');
		await page.locator('.txn-row .tag-input').first().press('Enter');
		await expect(page.locator('.txn-row .tag-chip')).toContainText('Renovation 2026', {
			timeout: 10000
		});

		await page.goto('/tags');
		const row = page.locator('.tag-row', { hasText: 'Renovation 2026' });
		await expect(row).toBeVisible();
		// Tagged at transaction level, so the whole transaction counts.
		await expect(row).toContainText('32 892');
	});

	test('the rules screen lists the seeded rules with their confidence', async ({ page }) => {
		await page.goto('/rules');
		await expect(page.locator('.rule-row').first()).toBeVisible();
		// Seeded rules start at the prior, which clears the filing threshold.
		await expect(
			page.locator('.rule-row', { hasText: 'cssz' }).locator('.r-confidence')
		).toHaveText('61%');
	});

	test('a hand-written rule previews its matches before it is saved', async ({ page }) => {
		await page.goto('/rules');
		await page.getByRole('button', { name: 'New rule' }).click();
		await page.locator('.rule-name').fill('Outgoing to Jan');
		await page.locator('.condition-value').first().fill('novák');
		await page.locator('.rule-category').selectOption('everything-else');

		await page.getByRole('button', { name: 'Preview matches' }).click();
		await expect(page.locator('.preview-count')).toContainText('matches', { timeout: 10000 });

		await page.getByRole('button', { name: 'Save rule' }).click();
		await expect(page.locator('.rule-row', { hasText: 'Outgoing to Jan' })).toBeVisible({
			timeout: 10000
		});
		// A hand-written rule starts from no evidence, so it does not file yet.
		await expect(
			page.locator('.rule-row', { hasText: 'Outgoing to Jan' }).locator('.r-confidence')
		).toHaveText('0%');
	});

	test('overriding a rule-filed transaction is recorded against that rule', async ({ page }) => {
		// The seeded cssz rule filed this row automatically; overriding it is the
		// signal that should cost the rule some confidence.
		await page.goto('/transactions?q=SSZ');
		const row = page.locator('.txn-row').first();
		await expect(row).toContainText('SSZ');
		await row.locator('select[name=categoryId]').selectOption('groceries');
		await row.getByRole('button', { name: 'File' }).click();
		await page.waitForTimeout(800);

		await page.goto('/rules');
		const cssz = page.locator('.rule-row', { hasText: 'cssz' });
		await expect(cssz.locator('.r-counts')).toContainText('1 overridden');
		// One correction takes a rule at the prior below the threshold.
		await expect(cssz.locator('.r-confidence')).toHaveText('49%');
	});

	test('an api token is shown once and then reads the ledger', async ({ page, request }) => {
		await page.goto('/settings');
		await page.locator('.api-token-label').fill('E2E dashboard');
		await page.getByRole('button', { name: 'Create token' }).click();

		const token = (await page.locator('.api-token-raw').innerText()).trim();
		expect(token.length).toBeGreaterThan(20);

		// Unauthenticated and wrongly authenticated are both refused — with a 401,
		// not a redirect to the login screen.
		expect((await request.get('/api/v1/accounts')).status()).toBe(401);
		const wrong = await request.get('/api/v1/accounts', {
			headers: { Authorization: 'Bearer not-a-real-token' }
		});
		expect(wrong.status()).toBe(401);

		const ok = await request.get('/api/v1/accounts', {
			headers: { Authorization: `Bearer ${token}` }
		});
		expect(ok.status()).toBe(200);
		const body = await ok.json();
		expect(body.accounts.length).toBeGreaterThan(0);
		// Money is minor units and a code, never a float or a formatted string.
		expect(typeof body.accounts[0].balance.amountMinor).toBe('number');
		expect(body.accounts[0].balance.currency).toBe('CZK');
	});

	test('the api applies the register filters the same way the screen does', async ({
		page,
		request
	}) => {
		await page.goto('/settings');
		await page.locator('.api-token-label').fill('E2E filters');
		await page.getByRole('button', { name: 'Create token' }).click();
		const token = (await page.locator('.api-token-raw').innerText()).trim();
		const headers = { Authorization: `Bearer ${token}` };

		const all = await (await request.get('/api/v1/transactions', { headers })).json();
		const out = await (
			await request.get('/api/v1/transactions?dir=out&min=1000', { headers })
		).json();
		expect(out.total).toBeLessThan(all.total);
		// The same two rows the register screen shows for this filter.
		expect(out.total).toBe(2);
	});

	test('revoking a token refuses the request it used to allow', async ({ page, request }) => {
		await page.goto('/settings');
		await page.locator('.api-token-label').fill('E2E doomed');
		await page.getByRole('button', { name: 'Create token' }).click();
		const token = (await page.locator('.api-token-raw').innerText()).trim();

		expect(
			(
				await request.get('/api/v1/accounts', { headers: { Authorization: `Bearer ${token}` } })
			).status()
		).toBe(200);

		await page.locator('.token-row', { hasText: 'E2E doomed' }).getByRole('button').click();
		await page.waitForTimeout(600);

		const after = await request.get('/api/v1/accounts', {
			headers: { Authorization: `Bearer ${token}` }
		});
		expect(after.status()).toBe(401);
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
