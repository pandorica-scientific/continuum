import { expect, test } from '@playwright/test';
import { AREAS } from '../../src/lib/modules/registry';

// The navigation shell: areas in the sidebar, screens as sub-tabs beneath the
// page title, and one permanent way to import a statement.

const AUTH_STATE = 'test-results/e2e-auth.json';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH_STATE });

test('the sidebar lists areas, not screens', async ({ page }) => {
	await page.goto('/overview');
	const nav = page.locator('aside nav');

	// One row per area, and the count comes from the registry so the two cannot
	// drift apart silently.
	await expect(nav.getByRole('link')).toHaveCount(AREAS.length);
	for (const area of AREAS) {
		await expect(nav.getByRole('link', { name: new RegExp(area.label) })).toHaveCount(1);
	}

	// Screens that used to be their own row are no longer in the sidebar.
	await expect(nav.getByRole('link', { name: /Cash flow/ })).toHaveCount(0);
	await expect(nav.getByRole('link', { name: /Loans/ })).toHaveCount(0);
});

test('an area row opens its first screen and stays lit while you are inside it', async ({
	page
}) => {
	await page.goto('/overview');
	await page
		.locator('aside nav')
		.getByRole('link', { name: /Assets/ })
		.click();

	await expect(page).toHaveURL(/\/property/);
	// Lit by the screen you are on belonging to it, not by its own href.
	await expect(page.locator('aside nav').getByRole('link', { name: /Assets/ })).toHaveAttribute(
		'aria-current',
		'page'
	);

	await page.goto('/loans');
	await expect(page.locator('aside nav').getByRole('link', { name: /Assets/ })).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('a multi-screen area shows sub-tabs and a single-screen area shows none', async ({ page }) => {
	await page.goto('/cashflow');
	const tabs = page.locator('.subtabs').getByRole('link');
	await expect(tabs).toHaveCount(7);
	await expect(page.locator('.subtabs').getByRole('link', { name: 'Cash flow' })).toHaveAttribute(
		'aria-current',
		'page'
	);

	// Overview holds one screen, so a row of pills would be a label pretending
	// to be a choice.
	await page.goto('/overview');
	await expect(page.locator('.subtabs')).toHaveCount(0);
});

test('the sub-tabs scroll rather than wrap when they do not fit', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/cashflow');

	const row = page.locator('.subtabs');
	await expect(row).toBeVisible();
	// Seven pills on a phone: one line that scrolls, never a second line that
	// would shove every screen's content down by a variable amount.
	const { scrollWidth, clientWidth, lines } = await row.evaluate((el) => ({
		scrollWidth: el.scrollWidth,
		clientWidth: el.clientWidth,
		lines: new Set(Array.from(el.children, (c) => c.getBoundingClientRect().top)).size
	}));
	expect(scrollWidth).toBeGreaterThan(clientWidth);
	expect(lines).toBe(1);
});

// Importing belongs to Overview and Money. On Property or Retirement a
// floating button over the screen is just something in the way.
// Quick add is now on EVERY screen, because it opens a named menu rather than
// being a bare plus whose meaning depended on where you were standing.
test('quick add is offered on every screen', async ({ page }) => {
	for (const path of ['/overview', '/cashflow', '/loans', '/retirement']) {
		await page.goto(path);
		await expect(page.getByRole('button', { name: 'Quick add' }), path).toBeVisible();
	}

	await page.goto('/loans');
	await page.getByRole('button', { name: 'Quick add' }).click();
	await expect(page.getByRole('menuitem', { name: 'Bank statements' })).toBeVisible();
	await page.getByRole('menuitem', { name: 'Bank statements' }).click();
	await expect(page).toHaveURL(/\/import/);
});

test('the menu offers only what is switched on', async ({ page }) => {
	await page.goto('/settings');
	await page.locator('.module-row', { hasText: 'Import' }).getByRole('switch').click();

	// An entry leading to a switched-off module would 404.
	await page.goto('/cashflow');
	await page.getByRole('button', { name: 'Quick add' }).click();
	await expect(page.getByRole('menuitem', { name: 'Bank statements' })).toHaveCount(0);

	await page.goto('/settings');
	await page.locator('.module-row', { hasText: 'Import' }).getByRole('switch').click();
	await page.goto('/cashflow');
	await page.getByRole('button', { name: 'Quick add' }).click();
	await expect(page.getByRole('menuitem', { name: 'Bank statements' })).toBeVisible();
});
