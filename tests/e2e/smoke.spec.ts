import { expect, test } from '@playwright/test';

// Viewport smoke: the login page must render without horizontal page scroll
// at tablet and mobile widths (the app pages are covered by the desktop run;
// this guards the responsive shell CSS).

test('login renders without horizontal page overflow', async ({ page }) => {
	await page.goto('/login');
	// Must be a real Continuum page, not an error page passing vacuously.
	await expect(page.getByText('Continuum').first()).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
