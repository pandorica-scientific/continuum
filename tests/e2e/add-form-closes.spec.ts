// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { expect, test } from '@playwright/test';

const AUTH_STATE = 'test-results/e2e-auth.json';
test.use({ storageState: AUTH_STATE });
test.describe.configure({ mode: 'serial' });

test('adding a property closes the form', async ({ page }) => {
	await page.goto('/property');
	await page
		.locator('.switcher')
		.getByRole('button', { name: /Add property/ })
		.click();

	const form = page.locator('form[action="?/addProperty"]');
	await expect(form).toBeVisible();

	await form.locator('input[name="name"]').fill('Plan test flat');
	await form.getByRole('button', { name: 'Add property' }).click();

	// The form is gone, and the property is there.
	await expect(form).toHaveCount(0);
	await expect(page.getByText('Plan test flat').first()).toBeVisible();
});

test('a refused property submission leaves the form open', async ({ page }) => {
	await page.goto('/property');
	await page
		.locator('.switcher')
		.getByRole('button', { name: /Add property/ })
		.click();

	const form = page.locator('form[action="?/addProperty"]');
	await expect(form).toBeVisible();
	// A nameless property is refused, so the form must survive to be corrected.
	await form.locator('input[name="name"]').fill('');
	await form.getByRole('button', { name: 'Add property' }).click();

	await expect(form).toBeVisible();
});
