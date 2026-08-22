// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { expect, test } from '@playwright/test';

const AUTH_STATE = 'test-results/e2e-auth.json';
test.use({ storageState: AUTH_STATE });

// The reported fault, end to end: the threshold field was disabled from the
// last SAVED value, so switching the exemption on left it disabled, a disabled
// field is not posted, and the action rejected the absence — losing the rate
// typed beside it as well.
//
// It restores the screen to an unconfigured rate before it finishes, because
// the pixel baseline photographs this page after this project has run.
test('the rate and the holding-period exemption save in one visit', async ({ page }) => {
	await page.goto('/investments');

	const rate = page.locator('input[name="ratePct"]');
	const exempt = page.locator('input[name="exemptLongHeld"]');
	const years = page.locator('input[name="exemptAfterYears"]');

	await expect(years).toBeDisabled();
	await exempt.check();
	await expect(years, 'the threshold stays disabled until a reload').toBeEnabled();

	await rate.fill('15');
	await years.fill('3');
	await page.getByRole('button', { name: 'Save' }).click();

	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(rate).toHaveValue('15');
	await expect(exempt).toBeChecked();
	await expect(years).toHaveValue('3');
	await expect(page.getByText('estimate · 15% of')).toBeVisible();

	// Back to how the rest of the suite expects to find it.
	await exempt.uncheck();
	await rate.fill('');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('set a rate below')).toBeVisible();
});
