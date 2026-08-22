// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { expect, test } from '@playwright/test';

const AUTH_STATE = 'test-results/e2e-auth.json';
test.use({ storageState: AUTH_STATE });

// The reported fault: "when opening 'choose a category…' it always opens from
// the bottom even if there is no space". A native select's popup is positioned
// by the browser and cannot be steered, so on the register — a long page whose
// rows run to the very bottom — the list expanded downwards past the fold and
// the categories were off-screen until you scrolled to find them.
//
// These assert the two things a select gave away and this control had to earn
// back: it opens where there is room, and it never runs past the viewport.

test('the list opens downwards when there is room below', async ({ page }) => {
	await page.goto('/transactions');
	const picker = page.locator('.picker').first();
	await expect(picker).toBeVisible();
	await picker.scrollIntoViewIfNeeded();
	// Put it near the top of the screen, so below is clearly the roomier side.
	await page.evaluate(() => window.scrollBy(0, -200));

	await picker.locator('.trigger').click();
	const list = picker.locator('.list');
	await expect(list).toBeVisible();

	const [trigger, box] = await Promise.all([
		picker.locator('.trigger').boundingBox(),
		list.boundingBox()
	]);
	expect(box!.y).toBeGreaterThanOrEqual(trigger!.y);
});

test('the list opens upwards rather than off the bottom of the page', async ({ page }) => {
	await page.goto('/transactions');
	const pickers = page.locator('.picker');
	const count = await pickers.count();
	expect(count).toBeGreaterThan(0);

	// The last row on the page: the case that was broken.
	const picker = pickers.nth(count - 1);
	await picker.scrollIntoViewIfNeeded();
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

	await picker.locator('.trigger').click();
	const list = picker.locator('.list');
	await expect(list).toBeVisible();

	const [trigger, box, viewport] = await Promise.all([
		picker.locator('.trigger').boundingBox(),
		list.boundingBox(),
		page.evaluate(() => window.innerHeight)
	]);

	// Whichever way it chose, the whole list is on screen — which is the promise
	// the native select could not keep.
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.y + box!.height).toBeLessThanOrEqual(viewport + 1);
	// And with the trigger at the foot of the page, the room is above it.
	expect(box!.y).toBeLessThan(trigger!.y);
});

test('a category can be chosen by keyboard alone', async ({ page }) => {
	await page.goto('/transactions');
	const picker = page.locator('.picker').first();
	await picker.locator('.trigger').focus();

	await page.keyboard.press('ArrowDown');
	await expect(picker.locator('.list')).toBeVisible();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');

	await expect(picker.locator('.list')).toHaveCount(0);
	// Something was chosen, and it reached the field the form posts.
	await expect(picker.locator('input[name=categoryId]')).not.toHaveValue('');
});
