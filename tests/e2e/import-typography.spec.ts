// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { expect, test } from '@playwright/test';

const AUTH_STATE = 'test-results/e2e-auth.json';
test.use({ storageState: AUTH_STATE });

// Two lists of filenames on one screen, at two different sizes: the queue set
// its own --text-md, the recent list set nothing and inherited body's
// --text-xl. Same thing, same size.
test('queue and recent-import filenames are the same size', async ({ page }) => {
	await page.goto('/import');

	// No skip guard on purpose. This project depends on `desktop`, whose
	// flow.spec.ts imports the Fio fixture, so a recent import always exists —
	// and a guard here would quietly pass on a suite that had stopped covering
	// this screen at all.
	const recent = page.locator('.import-row .i-name').first();
	await expect(recent).toBeVisible();

	const recentSize = await recent.evaluate((el) => getComputedStyle(el).fontSize);
	// 13px is --text-md, which the queue row already uses.
	expect(recentSize).toBe('13px');
});
