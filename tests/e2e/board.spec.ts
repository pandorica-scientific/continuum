import { expect, test } from '@playwright/test';
import postgres from 'postgres';

// The Overview board: a person arranges their own panels and the arrangement
// survives, per person, across reloads and module toggles.
//
// Runs as its own project depending on `accounts`, so the household exists and
// a second person has been created — which is what makes the isolation check
// meaningful rather than vacuous.

const AUTH_STATE = 'test-results/e2e-auth.json';
const DATABASE_URL =
	process.env.E2E_DATABASE_URL ?? 'postgres://continuum:continuum@localhost:5432/continuum_e2e';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH_STATE });

const panel = (page: import('@playwright/test').Page, title: string) =>
	page.locator('section.panel').filter({ hasText: title });

test('the default board is the four panels of the old fixed screen', async ({ page }) => {
	await page.goto('/overview');

	await expect(panel(page, 'Needs you')).toBeVisible();
	await expect(panel(page, 'Where the money goes')).toBeVisible();
	await expect(panel(page, 'What it is made of')).toBeVisible();
	// No board chrome until someone asks for it.
	await expect(page.getByRole('button', { name: 'Customise' })).toBeVisible();
	await expect(page.getByText('Add a panel')).toHaveCount(0);
});

test('adding a panel from the tray survives a reload', async ({ page }) => {
	await page.goto('/overview');
	await page.getByRole('button', { name: 'Customise' }).click();

	await expect(page.getByText('Add a panel')).toBeVisible();
	await page.getByRole('button', { name: 'Where the cash sits' }).click();
	await expect(panel(page, 'Where the cash sits')).toBeVisible();

	await page.reload();
	await expect(panel(page, 'Where the cash sits')).toBeVisible();
});

test('resizing a panel survives a reload', async ({ page }) => {
	await page.goto('/overview');
	await page.getByRole('button', { name: 'Customise' }).click();

	const cash = panel(page, 'Where the cash sits');
	const slot = page.locator('.slot').filter({ has: cash });
	const before = await slot.evaluate((el) => getComputedStyle(el).gridColumnEnd);

	const handle = cash.getByRole('button', { name: /^Resize/ });
	// page.mouse works in viewport coordinates and boundingBox does not scroll,
	// so without this the drag is aimed a thousand pixels below the fold and
	// lands on nothing at all.
	await handle.scrollIntoViewIfNeeded();
	const box = await handle.boundingBox();
	if (!box) throw new Error('the resize handle has no box');
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	// Two columns wider, well past the five-pixel drag threshold.
	await page.mouse.move(box.x + 240, box.y + 10, { steps: 8 });
	await page.mouse.up();

	await expect
		.poll(() => slot.evaluate((el) => getComputedStyle(el).gridColumnEnd))
		.not.toBe(before);
	const after = await slot.evaluate((el) => getComputedStyle(el).gridColumnEnd);

	await page.reload();
	await expect(slot).toHaveCount(1);
	expect(await slot.evaluate((el) => getComputedStyle(el).gridColumnEnd)).toBe(after);
});

test('removing a panel survives a reload', async ({ page }) => {
	await page.goto('/overview');
	await page.getByRole('button', { name: 'Customise' }).click();

	await page.getByRole('button', { name: 'Remove Where the cash sits' }).click();
	await expect(panel(page, 'Where the cash sits')).toHaveCount(0);

	await page.reload();
	await expect(panel(page, 'Where the cash sits')).toHaveCount(0);
});

// One layout, two editing models. The narrow view stacks and offers reordering
// instead of resizing, because width in columns means nothing in one column.
test('a narrow viewport stacks the board and drops resizing', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/overview');

	const slots = page.locator('.slot');
	const columns = await slots
		.first()
		.evaluate((el) => getComputedStyle(el.parentElement!).gridTemplateColumns);
	expect(columns.split(' ').length).toBe(1);

	await page.getByRole('button', { name: 'Customise' }).click();
	await expect(page.getByRole('button', { name: /^Resize/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /^Move .* up$/ }).first()).toBeVisible();
	await expect(page.getByText('There is one board.')).toBeVisible();
});

// The buttons were visible and did nothing: reordering exchanged the two
// panels' cells, which leaves a short panel overlapping a tall one, and the
// board then pushed it straight back below — the same sequence, every time.
test('reordering on a narrow viewport moves the panel and sticks', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/overview');
	await page.getByRole('button', { name: 'Customise' }).click();

	const titles = () => page.locator('section.panel header .eyebrow').allInnerTexts();
	const before = await titles();
	expect(before.length).toBeGreaterThan(1);

	await page
		.getByRole('button', { name: `Move ${before[0].trim().split(/\s+/).slice(1).join(' ')} down` })
		.click();

	await expect.poll(async () => (await titles())[0]).not.toBe(before[0]);
	const after = await titles();
	expect(after[0]).toBe(before[1]);
	expect(after[1]).toBe(before[0]);

	await page.reload();
	expect(await titles()).toEqual(after);
});

// The board has gravity: dragging a panel down and letting go must not leave a
// hole above it. This is the rule the design originally had the other way up.
test('the board closes the space when a panel is dragged away from it', async ({ page }) => {
	await page.goto('/overview');
	await page.getByRole('button', { name: 'Customise' }).click();

	const first = page.locator('.slot').first();
	const topRow = () => first.evaluate((el) => getComputedStyle(el).gridRowStart);
	expect(await topRow()).toBe('1');

	const body = page.locator('section.panel').first().locator('.body');
	const box = await body.boundingBox();
	if (!box) throw new Error('the panel has no box');
	await page.mouse.move(box.x + box.width / 2, box.y + 20);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + 400, { steps: 10 });
	await page.mouse.up();

	// Whatever ends up on top, something does: no board may start below row 1.
	await expect
		.poll(async () =>
			Math.min(
				...(await page
					.locator('.slot')
					.evaluateAll((els) => els.map((el) => Number(getComputedStyle(el).gridRowStart))))
			)
		)
		.toBe(1);
});

// Switching a module off closes the space; switching it back on returns the
// panel to where its owner had put it, because the entry was never deleted.
test('a switched-off module hides its panel and gives it back afterwards', async ({ page }) => {
	await page.goto('/overview');
	await expect(panel(page, 'Next 30 days')).toBeVisible();

	// Settings toggles a module with a submit button acting as a switch, not the
	// checkbox the setup wizard uses.
	await page.goto('/settings');
	const calendar = page.getByRole('switch', { name: 'Toggle Calendar' });
	await expect(calendar).toHaveAttribute('aria-checked', 'true');
	await calendar.click();
	await expect(calendar).toHaveAttribute('aria-checked', 'false');

	await page.goto('/overview');
	await expect(panel(page, 'Next 30 days')).toHaveCount(0);

	await page.goto('/settings');
	await page.getByRole('switch', { name: 'Toggle Calendar' }).click();
	await expect(page.getByRole('switch', { name: 'Toggle Calendar' })).toHaveAttribute(
		'aria-checked',
		'true'
	);

	await page.goto('/overview');
	await expect(panel(page, 'Next 30 days')).toBeVisible();
});

test('one person customising leaves everybody else on the default', async () => {
	const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
	try {
		const rows = await sql<{ name: string; overview_layout: unknown }[]>`
			select name, overview_layout from person order by created_at
		`;

		expect(rows.length).toBeGreaterThan(1);
		// Exactly the administrator who has been dragging things about.
		const customised = rows.filter((r) => r.overview_layout !== null);
		expect(customised).toHaveLength(1);
		// Null, not an empty array: everyone else has never customised, so they
		// render the default rather than an empty board.
		for (const row of rows.filter((r) => r.overview_layout === null)) {
			expect(row.overview_layout).toBeNull();
		}
	} finally {
		await sql.end();
	}
});
