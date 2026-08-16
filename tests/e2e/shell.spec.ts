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

test('quick add reaches import from anywhere', async ({ page }) => {
	await page.goto('/loans');
	await page.getByRole('link', { name: 'Quick add' }).click();
	await expect(page).toHaveURL(/\/import/);
});

// Both the quick-add button and the header button lead to /import, which 404s
// when the module is off. Neither may be left pointing at it.
test('quick add and the header button go with the import module', async ({ page }) => {
	await page.goto('/settings');
	await page.locator('.module-row', { hasText: 'Import' }).getByRole('switch').click();

	await page.goto('/loans');
	// Both of them: the quick-add button and the header button.
	await expect(page.getByRole('link', { name: 'Quick add' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Import statement' })).toHaveCount(0);

	await page.goto('/settings');
	await page.locator('.module-row', { hasText: 'Import' }).getByRole('switch').click();
	await page.goto('/loans');
	await expect(page.getByRole('link', { name: 'Quick add' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Import statement' })).toBeVisible();
});
