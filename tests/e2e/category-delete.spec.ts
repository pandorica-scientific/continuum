// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { expect, test } from '@playwright/test';

const AUTH_STATE = 'test-results/e2e-auth.json';
test.use({ storageState: AUTH_STATE });

// The dialog half of the delete flow. The silent half — a category nothing uses
// going without a question — is covered in flow.spec.ts, which is where the
// unused category already exists.
//
// The ✕ used to open a "move what is filed under this to…" form unconditionally,
// inline, pushing the rest of the list down past the thing being asked about.
test('a category with history asks in a dialog, and names what is filed under it', async ({
	page
}) => {
	await page.goto('/settings');

	// Groceries carries the transactions the import journey filed.
	const chip = page.locator('.tx-leaf').filter({ hasText: 'Groceries' }).first();
	await expect(chip).toBeVisible();
	await chip.getByRole('button', { name: /Delete Groceries/ }).click();

	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	// \s+ rather than a literal space: the sentence wraps in the template, so the
	// rendered text carries a newline and tabs between the words.
	await expect(dialog).toContainText(/filed\s+under it/);
	// Money and rules are counted apart, because they fail differently: a rule
	// pointing at a deleted category still matches and files nothing.
	await expect(dialog).toContainText(/transaction/);
	await expect(dialog).toContainText(/rule/);

	// Somewhere to put the history, rather than orphaning it.
	await expect(dialog.locator('select[name=reassignTo]')).toBeVisible();

	// Cancelling leaves the category exactly where it was.
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(chip).toBeVisible();
});
