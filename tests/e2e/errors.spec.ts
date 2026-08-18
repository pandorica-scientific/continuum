import { expect, test } from '@playwright/test';

// The error screens. A wrong address is the one error anybody can produce on
// demand, so 404 is what these drive — the screen itself is shared, so what it
// proves about layout and behaviour holds for every status.

const AUTH_STATE = 'test-results/e2e-auth.json';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH_STATE });

test('a wrong address gets a screen, not a stack trace', async ({ page }) => {
	const response = await page.goto('/property/karlin/floorplan-that-is-not-there');

	// The status has to be a real 404. A pretty page served as 200 tells a
	// crawler, a monitor and the browser's own history that the page exists.
	expect(response?.status()).toBe(404);

	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'This page is not in this timeline.'
	);
	// Both the code and its name, as the design has them.
	await expect(page.getByText('404', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('Not found')).toBeVisible();

	// SvelteKit's default page is gone: it prints the bare status and message.
	await expect(page.locator('body')).not.toContainText('Internal Error');

	// No reference on a 404. SvelteKit routes these through handleError like any
	// other failure, and minting one here both invites somebody to report a typed
	// address as a fault and writes a log line per bad URL.
	await expect(page.locator('body')).not.toContainText('ref ');
});

test('the way back out is a real link', async ({ page }) => {
	await page.goto('/nothing-here-at-all');
	await page.getByRole('link', { name: 'Back to Overview' }).click();
	await expect(page).toHaveURL(/\/overview$/);
});

test('the address that failed is shown, so it can be quoted', async ({ page }) => {
	await page.goto('/property/karlin/missing?ref=1');
	await expect(page.getByText('/property/karlin/missing?ref=1')).toBeVisible();
});

test('the rings hide a drawing and a line, and it stays found', async ({ page }) => {
	await page.goto('/nothing-here-at-all');

	const rings = page.getByRole('button', { name: 'Reveal 404 illustration' });
	await expect(rings).toBeVisible();
	await expect(rings.locator('[data-error-logo]')).toBeVisible();
	await expect(page.getByText('Try the same address on a different Tuesday.')).toBeHidden();

	await rings.click();

	const revealed = page.getByRole('button', { name: 'Hide 404 illustration' });
	await expect(revealed.locator('[data-error-artwork]')).toBeVisible();
	await expect(page.getByText('Try the same address on a different Tuesday.')).toBeVisible();

	// The drawing is a file rather than inline paths, so it has to actually be
	// served — a mask over a 404 is an empty square, which still "renders".
	const artwork = revealed.locator('[data-error-artwork] image');
	await expect(artwork).toHaveAttribute('href', '/error-pages/404.webp');
	expect(
		await page.evaluate(async (url) => (await fetch(url)).status, '/error-pages/404.webp')
	).toBe(200);

	// The drawing takes the colour of the state rather than staying white.
	const hue = await revealed.evaluate((node) => getComputedStyle(node).color);
	expect(await artwork.evaluate((node) => getComputedStyle(node).color)).toBe(hue);

	// Clicking again puts the rings back rather than leaving the drawing stuck.
	await revealed.click();
	await expect(page.getByRole('button', { name: 'Reveal 404 illustration' })).toBeVisible();
	await expect(page.getByText('Try the same address on a different Tuesday.')).toBeHidden();
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	// The mark goes ABOVE the sentence on a narrow screen. Beside it there is no
	// room for either; below it, it is the first thing scrolled off.
	test('the mark sits above the text, not beside or below it', async ({ page }) => {
		await page.goto('/nothing-here-at-all');

		const mark = await page.getByRole('button', { name: /illustration/ }).boundingBox();
		const heading = await page.getByRole('heading', { level: 1 }).boundingBox();

		expect(mark!.y + mark!.height).toBeLessThanOrEqual(heading!.y);
	});

	test('nothing overflows the width of the screen', async ({ page }) => {
		await page.goto('/nothing-here-at-all');
		const { scrollWidth, clientWidth } = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth
		}));
		expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
	});
});
