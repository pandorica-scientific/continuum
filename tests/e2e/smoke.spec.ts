import { expect, test } from '@playwright/test';

// Viewport smoke: nothing may overflow the page horizontally, and no visible
// text may be clipped by its own box. Runs at tablet and mobile widths.
//
// It used to cover the login page alone. An account field whose helper text was
// cut off before it finished saying what it was for reached a user on a small
// screen, because every signed-in screen was only ever rendered at 1440px.

const AUTH_STATE = 'test-results/e2e-auth.json';

/** Every screen the navigation offers, plus the two with the densest forms. */
const SCREENS = [
	'/overview',
	'/cashflow',
	'/accounts',
	'/transactions',
	'/import',
	'/rules',
	'/tags',
	'/property',
	'/investments',
	'/loans',
	'/documents',
	'/calendar',
	'/retirement',
	'/settings'
];

async function horizontalOverflow(page: import('@playwright/test').Page): Promise<number> {
	return page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
}

/**
 * Elements whose text is wider than the box drawn for it, and which have not
 * been told to scroll or wrap. This is what "the label was cut off" looks like
 * from the outside.
 *
 * Deliberately narrow: only leaf elements holding text, only where overflow is
 * hidden or clipped, and with a pixel of tolerance for sub-pixel rounding.
 */
async function clippedText(page: import('@playwright/test').Page): Promise<string[]> {
	return page.evaluate(() => {
		const clipped: string[] = [];
		for (const element of document.querySelectorAll<HTMLElement>('body *')) {
			if (element.children.length > 0) continue;
			const text = element.textContent?.trim();
			if (!text) continue;
			const style = getComputedStyle(element);
			if (style.display === 'none' || style.visibility === 'hidden') continue;
			// Anything allowed to scroll is not clipped, it is scrollable.
			if (style.overflowX !== 'hidden' && style.overflowX !== 'clip') continue;
			if (element.scrollWidth - element.clientWidth > 1) {
				clipped.push(`${element.tagName.toLowerCase()}.${element.className}: ${text.slice(0, 60)}`);
			}
		}
		return clipped;
	});
}

test('login renders without horizontal page overflow', async ({ page }) => {
	await page.goto('/login');
	// Must be a real Continuum page, not an error page passing vacuously.
	await expect(page.getByText('Continuum').first()).toBeVisible();
	expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test.describe('signed in, at this width', () => {
	test.use({ storageState: AUTH_STATE });

	for (const path of SCREENS) {
		test(`${path} does not overflow horizontally`, async ({ page }) => {
			const response = await page.goto(path);
			// A 404 from a switched-off module cannot overflow, and asserting
			// against one would pass vacuously for the rest of this release.
			test.skip(response?.status() === 404, 'module switched off');
			await expect(page.locator('h1').first()).toBeVisible();
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
		});

		test(`${path} clips no visible text`, async ({ page }) => {
			const response = await page.goto(path);
			test.skip(response?.status() === 404, 'module switched off');
			await expect(page.locator('h1').first()).toBeVisible();
			const clipped = await clippedText(page);
			expect(clipped, `clipped on ${path}:\n${clipped.join('\n')}`).toEqual([]);
		});
	}
});
