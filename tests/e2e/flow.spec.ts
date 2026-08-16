import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_PASSWORD_MIN_LENGTH, passwordHint } from '../../src/lib/password-policy';
import { MODULE_KEYS, MODULES } from '../../src/lib/modules/registry';

// The suite runs with no PASSWORD_MIN_LENGTH in the environment, so the pages
// advertise the default — and this selector fails loudly if the two ever part.
const HINT = passwordHint(DEFAULT_PASSWORD_MIN_LENGTH);

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

test('a rejected wizard submission names every module and keeps what was typed', async ({
	page
}) => {
	await page.goto('/setup');

	// Every module in the registry is named on screen. The wizard used to hold its
	// own label map beside the registry, so a module present in one and not the
	// other — Tax — rendered a checkbox with nothing next to it.
	const toggles = page.locator('label.toggle');
	await expect(toggles).toHaveCount(MODULE_KEYS.length);
	for (const key of MODULE_KEYS) {
		await expect(toggles.filter({ hasText: MODULES[key].label })).toHaveCount(1);
	}

	await page.getByPlaceholder('e.g. Robert & Tereza').fill('Jana & Jan');
	await page.getByPlaceholder('Name').first().fill('Jana Nováková');
	await page.getByPlaceholder('Birth year').first().fill('1988');
	await toggles.first().locator('input').uncheck();
	await page.getByPlaceholder(`Password (${HINT})`).first().fill('short');
	await page.getByRole('button', { name: 'Create household' }).click();

	// Rejected for the password — and everything else the person typed survives.
	await expect(page.locator('.error')).toBeVisible();
	await expect(page.getByPlaceholder('e.g. Robert & Tereza')).toHaveValue('Jana & Jan');
	await expect(page.getByPlaceholder('Name').first()).toHaveValue('Jana Nováková');
	await expect(page.getByPlaceholder('Birth year').first()).toHaveValue('1988');
	await expect(toggles.first().locator('input')).not.toBeChecked();
	// Except the password, which is never echoed back into the page.
	await expect(page.getByPlaceholder(`Password (${HINT})`).first()).toHaveValue('');
});

test('the wizard creates the household and signs in', async ({ page }) => {
	await page.goto('/setup');
	await page.getByPlaceholder('e.g. Robert & Tereza').fill('Jana & Jan');
	await page.getByPlaceholder('Name').first().fill('Jana Nováková');
	await page.getByPlaceholder(`Password (${HINT})`).first().fill('correct-horse-battery');
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
		// `use:enhance` submits asynchronously. Wait for the server result to be
		// applied before navigating, otherwise the filtered GET can race the commit.
		await expect(row.locator('.r-state')).toHaveText('confirmed');

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

	test('the rules screen lists what filing taught it, and nothing else', async ({ page }) => {
		await page.goto('/rules');
		await expect(page.locator('.rule-row').first()).toBeVisible();
		// Nothing arrives seeded any more, so every rule on this screen was earned
		// by a correction — here, the review row filed two tests ago.
		await expect(page.locator('.rule-row', { hasText: 'seeded' })).toHaveCount(0);
		// A learned rule starts at the prior, which clears the filing threshold.
		await expect(page.locator('.rule-row').first().locator('.r-confidence')).toHaveText('61%');
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
		// Nothing arrives seeded, so the rule that filed this row is one the
		// household taught: both Raiffeisenbank rows share a counter-account, so
		// filing one from the review queue filed the other automatically. That
		// second row is the only kind that can carry an override — overriding it is
		// the signal that should cost the rule some confidence.
		await page.goto('/transactions');
		const filed = page.locator('.txn-row', { hasText: 'filed by rule' }).first();
		await expect(filed).toBeVisible();
		await filed.locator('select[name=categoryId]').selectOption('eating-out');
		await filed.getByRole('button', { name: 'File' }).click();
		await page.waitForTimeout(800);

		// The rule that filed it is the one now carrying the correction. Its
		// identity does not matter here; that exactly one rule took the hit does.
		await page.goto('/rules');
		const overridden = page.locator('.rule-row', { hasText: '1 overridden' });
		await expect(overridden).toHaveCount(1);
		// One correction takes a rule at the prior below the threshold.
		await expect(overridden.locator('.r-confidence')).toHaveText('49%');
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

	test('a document ticking both people appears under both columns', async ({ page }) => {
		await page.goto('/documents');
		await page.getByRole('button', { name: '➕ Add document' }).click();
		await page.getByPlaceholder('Passport · Robert').fill('Mortgage statement 2026');
		await page.locator('select[name=shelf]').selectOption('loans');
		// Several links: one document, both people, two visible ticks.
		await page.locator('.tick', { hasText: 'Jana Nováková' }).locator('input').check();
		await page.locator('.tick', { hasText: 'Household' }).locator('input').check();
		await page.getByRole('button', { name: 'Add', exact: true }).click();

		const janaCol = page.locator('.col', {
			has: page.locator('.col-label', { hasText: 'Jana Nováková' })
		});
		const householdCol = page.locator('.col', {
			has: page.locator('.col-label', { hasText: 'Household' })
		});
		await expect(janaCol.getByText('Mortgage statement 2026')).toBeVisible();
		await expect(householdCol.getByText('Mortgage statement 2026')).toBeVisible();
	});

	test('a new subject is created in the add form and gets its own column', async ({ page }) => {
		await page.goto('/documents');
		await page.getByRole('button', { name: '➕ Add document' }).click();
		await page.getByPlaceholder('Passport · Robert').fill('Service book · Car');
		await page.locator('select[name=shelf]').selectOption('property');
		await page.getByRole('button', { name: 'New subject' }).click();
		await page.locator('input[name=newSubject]').fill('Car');
		await page.getByRole('button', { name: 'Add', exact: true }).click();

		// The record now exists and derived its own column.
		await expect(page.locator('.col-label', { hasText: 'Car' })).toBeVisible();
		// A successful save closes the form. Reopen it to prove the subject is a
		// reusable record, not just the string rendered in that document's column.
		await page.getByRole('button', { name: '➕ Add document' }).click();
		await expect(page.locator('.tick', { hasText: 'Car' })).toBeVisible();
	});

	test('a document belonging to nothing is refused', async ({ page }) => {
		await page.goto('/documents');
		await page.getByRole('button', { name: '➕ Add document' }).click();
		await page.getByPlaceholder('Passport · Robert').fill('Orphan attempt');
		await page.locator('select[name=shelf]').selectOption('identity');
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(page.getByText(/has to belong to something/)).toBeVisible();
	});

	test('a tax statement prefills its gross from the payslips and can be corrected', async ({
		page
	}) => {
		// The prefill needs a payslip to read, so add one first.
		await page.goto('/retirement');
		await page.locator('.payslip-form select[name=personId]').selectOption({ index: 0 });
		await page.locator('.payslip-form input[name=periodMonth]').fill('2026-05');
		await page.locator('.payslip-form input[name=amount]').fill('120000');
		await page.getByRole('button', { name: 'Add payslip' }).click();
		await page.waitForTimeout(600);

		await page.goto('/tax');
		await page.getByRole('button', { name: 'Add statement' }).click();
		await page.locator('.tax-person').selectOption({ index: 0 });
		await page.locator('.tax-year').fill('2026');
		await page.locator('.tax-country').fill('CZ');

		// Prefilled from the payslip history rather than left empty.
		await expect(page.locator('.tax-gross')).toHaveValue(/120/);

		// And correctable: the saved figure is the typed one, not the derived one.
		await page.locator('.tax-gross').fill('1305000');
		await page.locator('.tax-paid').fill('195750');
		await page.getByRole('button', { name: 'Save statement' }).click();

		const row = page.locator('.tax-row', { hasText: '2026' });
		await expect(row).toBeVisible({ timeout: 10000 });
		// 195 750 / 1 305 000 = exactly 15% effective.
		await expect(row).toContainText('15.00');
		// The divergence note: payslips say one thing, the statement another.
		await expect(row.locator('.t-diverges')).toContainText('120 000');
	});

	test('the saved tax figure survives a reload rather than being re-derived', async ({ page }) => {
		await page.goto('/tax');
		await expect(page.locator('.tax-row', { hasText: '2026' })).toContainText('1 305 000');
	});

	test('switching a module off removes its sub-tab and 404s its routes', async ({ page }) => {
		// The sidebar names areas, not screens. Property is a screen inside
		// Assets, so switching it off takes away its sub-tab; the Assets row
		// itself survives on Investments and Loans.
		const propertyTab = page.locator('.subtabs').getByRole('link', { name: 'Property' });

		await page.goto('/loans');
		await expect(propertyTab).toBeVisible();

		await page.goto('/settings');
		await page.locator('.module-row', { hasText: 'Property' }).getByRole('switch').click();

		const response = await page.goto('/property');
		expect(response?.status()).toBe(404);

		await page.goto('/loans');
		await expect(propertyTab).toHaveCount(0, { timeout: 10000 });
		await expect(page.locator('aside').getByRole('link', { name: /Assets/ })).toBeVisible();

		// Switch it back on for later runs.
		await page.goto('/settings');
		await page.locator('.module-row', { hasText: 'Property' }).getByRole('switch').click();
		await page.goto('/loans');
		await expect(propertyTab).toBeVisible({ timeout: 10000 });
	});

	test('documents: adding one builds its shelf and person column', async ({ page }) => {
		await page.goto('/documents');
		await page.getByRole('button', { name: '➕ Add document' }).click();
		await page.getByPlaceholder('Passport · Robert').fill('Passport · Jana');
		await page.locator('select[name=shelf]').selectOption('identity');
		// A real link, not a typed name: tick the person the document belongs to.
		await page.locator('.tick', { hasText: 'Jana Nováková' }).locator('input').check();
		await page.locator('select[name=expiryVerb]').selectOption('expires');
		await page.locator('input[name=expiresOn]').fill('2027-03-15');
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(page.getByText('Passport · Jana')).toBeVisible();
		await expect(page.getByText('expires 2027-03-15')).toBeVisible();
		// the column derived itself from the link
		await expect(page.locator('.col-label', { hasText: 'Jana Nováková' })).toBeVisible();
	});

	test('property: documents filed about a flat appear on its card', async ({ page }) => {
		await page.goto('/property');
		await page.getByRole('button', { name: '➕ Add property' }).click();
		await page.getByPlaceholder('Karlín, Praha 8').fill('Flat Žižkov');
		await page.getByRole('button', { name: 'Add property', exact: true }).click();
		await expect(page.locator('.tab', { hasText: 'Flat Žižkov' })).toBeVisible();

		// the card's add link opens the documents form pre-addressed to this flat:
		// its checkbox arrives already ticked, by id rather than by name
		await page.getByRole('link', { name: '➕ Add a document about this flat' }).click();
		await expect(page.locator('.tick', { hasText: 'Flat Žižkov' }).locator('input')).toBeChecked();
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

	// The first of next month, so a weekly series always has a full month to
	// expand into whenever this suite happens to run.
	const nextMonthFirst = () => {
		const date = new Date();
		date.setUTCMonth(date.getUTCMonth() + 1, 1);
		return date.toISOString().slice(0, 10);
	};

	test('a weekly event is authored and every occurrence appears', async ({ page }) => {
		const date = nextMonthFirst();
		await page.goto(`/calendar?m=${date.slice(0, 7)}`);
		await page.getByRole('button', { name: 'Add event' }).click();

		// Scoped to the dialog: the rule toggles beside it carry aria-labels like
		// "Property inspections and lease dates", which match a bare 'Date'.
		const dialog = page.locator('form.editor');
		await dialog.getByLabel('Title').fill('Bin day');
		await dialog.getByLabel('Date').fill(date);
		await dialog.getByLabel('Repeats').selectOption('weekly');
		await dialog.getByRole('button', { name: 'Save' }).click();

		await page.goto(`/calendar?m=${date.slice(0, 7)}`);
		// The agenda shows one day, so the MONTH is read from the grid: a weekly
		// series marks at least four days in any month.
		expect(await page.locator('.day.has-events').count()).toBeGreaterThanOrEqual(4);

		// And the event itself is on the day it starts.
		await page.locator('.day', { hasText: '1' }).first().click();
		await expect(page.getByText('Bin day').first()).toBeVisible();
	});

	test('editing one occurrence leaves the rest of the series alone', async ({ page }) => {
		const month = nextMonthFirst().slice(0, 7);
		await page.goto(`/calendar?m=${month}`);

		const markedDays = await page.locator('.day.has-events').count();
		expect(markedDays).toBeGreaterThanOrEqual(4);

		// Open a day that is NOT the first occurrence, so a scope bug that rewrites
		// the whole series shows up as the untouched days changing too.
		const marked = page.locator('.day.has-events');
		await marked.nth(1).click();
		await page.getByText('Bin day').first().click();

		const dialog = page.locator('form.editor');
		await dialog.getByLabel('Title').fill('Bin day moved');
		await dialog.getByRole('radio', { name: 'This event only' }).check();
		await dialog.getByRole('button', { name: 'Save' }).click();

		// That day now shows the renamed occurrence…
		await page.goto(`/calendar?m=${month}`);
		await page.locator('.day.has-events').nth(1).click();
		await expect(page.getByText('Bin day moved')).toBeVisible();

		// …and the first occurrence is untouched, which is what 'this event only'
		// has to mean.
		await page.locator('.day.has-events').first().click();
		await expect(page.getByText('Bin day', { exact: true })).toBeVisible();
		await expect(page.getByText('Bin day moved')).toHaveCount(0);
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

	test('the calendar panel renders itself from the provider registry', async ({ page }) => {
		await page.goto('/settings');
		await page.mouse.move(0, 0);
		// Scoped: there is one connect form per registered provider.
		const connect = page.locator('form.cal-connect', { hasText: 'iCloud' });
		await expect(connect).toBeVisible();

		// Fields come from the provider's own declaration, so this asserts the
		// registry contract rather than a hand-written form.
		await expect(connect.getByLabel('Apple ID')).toBeVisible();
		const password = connect.getByLabel('App-specific password');
		await expect(password).toBeVisible();
		// A secret field must never render as plain text.
		await expect(password).toHaveAttribute('type', 'password');
		// The instructions live behind the info icon rather than always on screen —
		// they are several lines and would bury the form. What matters is that they
		// say where to GET the app-specific password: it is the step people get
		// wrong, and the 401 that follows explains nothing.
		await connect.getByRole('button', { name: /how to connect/i }).click();
		await expect(connect.getByText(/appleid\.apple\.com/i)).toBeVisible();
	});

	test('connecting with credentials that do not work is refused, not stored', async ({ page }) => {
		await page.goto('/settings');
		const connect = page.locator('form.cal-connect', { hasText: 'iCloud' });
		await connect.getByLabel('Apple ID').fill('nobody@example.invalid');
		await connect.getByLabel('App-specific password').fill('wrong-wrong-wrong');
		await connect.getByLabel('Server').fill('https://caldav.example.invalid');
		await connect.getByRole('button', { name: 'Connect', exact: true }).click();

		// An account that does not work must not appear connected — that is worse
		// than no account at all, because it sits in the list looking fine.
		await expect(page.locator('.form-error')).toBeVisible();
		await expect(page.locator('.cal-account')).toHaveCount(0);
	});

	test('each provider gets the connect flow it declared', async ({ page }) => {
		await page.goto('/settings');
		await page.mouse.move(0, 0);

		// CalDAV takes pasted credentials and is done.
		const caldav = page.locator('form.cal-connect', { hasText: 'iCloud' });
		await expect(caldav.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();

		// Google has to send the browser away, so it asks for the client id and
		// secret only — never a refresh token, which nobody should have to fetch by
		// hand — and offers to authorise rather than to connect. It also makes its
		// own calendar rather than offering the account's, because the narrow scope
		// it asks for cannot even read that list.
		const google = page.locator('form.cal-connect', { hasText: 'Google' });
		await expect(google.getByLabel('OAuth client ID')).toBeVisible();
		await expect(google.getByLabel('OAuth client secret')).toHaveAttribute('type', 'password');
		await expect(google.getByLabel(/refresh token/i)).toHaveCount(0);
		await expect(google.getByRole('button', { name: 'Authorise with Google' })).toBeVisible();
		// The instructions must carry the publishing-status trap: left in Testing,
		// sync dies after seven days and keeps dying weekly.
		await google.getByRole('button', { name: /how to connect/i }).click();
		await expect(google.getByText(/production/i).first()).toBeVisible();
	});

	test('each provider explains how to connect it, behind an info icon', async ({ page }) => {
		await page.goto('/settings');

		// Park the pointer somewhere harmless first. The hint also opens on hover,
		// and the pointer is left wherever the previous test clicked — so without
		// this the bubble can already be open before the test does anything.
		await page.mouse.move(0, 0);

		const icloud = page.locator('form.cal-connect', { hasText: 'iCloud' });
		const hint = icloud.getByRole('button', { name: /how to connect/i });
		await expect(hint).toBeVisible();

		// Asserted on the bubble itself rather than on its words: the same phrases
		// appear in field labels, so matching text alone would pass whether or not
		// the disclosure worked.
		const bubble = icloud.locator('[role="note"]');
		await expect(bubble).toHaveCount(0);
		await expect(hint).toHaveAttribute('aria-expanded', 'false');

		// A real button, not hover-only — there is no hover on a phone and a
		// keyboard user never triggers one.
		await hint.click();
		await expect(hint).toHaveAttribute('aria-expanded', 'true');
		await expect(bubble).toBeVisible();
		await expect(bubble).toContainText(/appleid\.apple\.com/i);
		// The mistake people actually make.
		await expect(bubble).toContainText(/normal Apple ID password will not work/i);

		// Un-pinning is not enough on its own: the pointer is still on the icon
		// after the click, and hovering legitimately keeps it open. Move away first,
		// which is what a person does.
		await hint.click();
		await expect(hint).toHaveAttribute('aria-expanded', 'false');
		await page.mouse.move(0, 0);
		await expect(bubble).toHaveCount(0);

		// Google's warns about the trap that kills sync a week after setup.
		const google = page.locator('form.cal-connect', { hasText: 'Google' });
		await google.getByRole('button', { name: /how to connect/i }).click();
		await expect(google.locator('[role="note"]')).toContainText(/7 days/i);
	});

	test('the calendar screen says whether sync is actually live', async ({ page }) => {
		await page.goto('/calendar');
		// No account connected in this journey, so it must say so rather than
		// claiming sync is coming in a future phase.
		await expect(page.getByText('no calendar connected yet')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Connect Google or iCloud' })).toBeVisible();
		await expect(page.getByText(/Phase 4/i)).toHaveCount(0);

		// And the link lands on the panel that does it.
		await page.getByRole('link', { name: 'Connect Google or iCloud' }).click();
		await expect(page).toHaveURL(/\/settings#calendars/);
	});

	test('the OAuth callback refuses a state it never issued', async ({ page }) => {
		// The defence against a third party completing an authorisation on this
		// household's behalf. No pending flow exists, so any state must be refused.
		const response = await page.goto('/settings/google/callback?code=abc&state=forged');
		expect(response?.status()).toBeLessThan(400);
		await expect(page).toHaveURL(/\/settings\?calendar=/);
		await expect(page.locator('.calendar-notice')).toContainText(/did not match/i);
		// And nothing was connected.
		await expect(page.locator('.cal-account')).toHaveCount(0);
	});

	test('the ledger-marker toggle flips and sticks', async ({ page }) => {
		await page.goto('/settings');
		const toggle = page.getByRole('switch', { name: "Mark Continuum's own events" });
		await expect(toggle).toHaveAttribute('aria-checked', 'true');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-checked', 'false');
		await page.reload();
		await expect(page.getByRole('switch', { name: "Mark Continuum's own events" })).toHaveAttribute(
			'aria-checked',
			'false'
		);
		// Put it back: later tests read the published feed.
		await page.getByRole('switch', { name: "Mark Continuum's own events" }).click();
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
