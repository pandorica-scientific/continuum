// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { expect, test } from '@playwright/test';

const AUTH_STATE = 'test-results/e2e-auth.json';
test.use({ storageState: AUTH_STATE });
test.describe.configure({ mode: 'serial' });

// "Allow me to move these boxes in settings so I could change order."
//
// Dragging is what was asked for; the arrow keys are what makes it reachable
// without a mouse. Both write the whole group's order in one transaction, so a
// half-applied sequence is never visible.

const names = (page: import('@playwright/test').Page, group: string) =>
	page.locator(`.tx-group[data-group="${group}"] .tx-leaf`).allInnerTexts();

test('the arrow keys move a category and the order sticks', async ({ page }) => {
	await page.goto('/settings');

	const group = page.locator('.tx-group[data-group="income"]');
	await expect(group).toBeVisible();

	const before = await names(page, 'income');
	expect(before.length).toBeGreaterThan(2);

	// Focus the second chip and move it left.
	const second = group.locator('.tx-leaf[draggable="true"]').nth(1);
	const movedName = (await second.innerText()).replace(/[⠿✕\s]+/g, ' ').trim();
	await second.focus();
	await page.keyboard.press('ArrowLeft');

	await expect
		.poll(async () => {
			const now = await names(page, 'income');
			return now[0]?.replace(/[⠿✕\s]+/g, ' ').trim();
		})
		.toBe(movedName);

	// And it survives a reload, which is the whole point of persisting it.
	await page.reload();
	const after = await names(page, 'income');
	expect(after[0]?.replace(/[⠿✕\s]+/g, ' ').trim()).toBe(movedName);
});

test('the catch-all cannot be picked up, and stays last', async ({ page }) => {
	await page.goto('/settings');

	const group = page.locator('.tx-group[data-group="income"]');
	const pinned = group.locator('.tx-leaf.pinned');
	await expect(pinned).toHaveCount(1);
	await expect(pinned).toHaveAttribute('title', /Always last/);

	// It offers no grip and takes no focus: nothing promises a move that the
	// ordering would refuse to honour.
	await expect(pinned.locator('.grip')).toHaveCount(0);
	await expect(pinned).not.toHaveAttribute('draggable', 'true');

	// Last in the group, whatever sort values the others carry.
	const all = await names(page, 'income');
	const pinnedText = await pinned.innerText();
	expect(all[all.length - 1]).toBe(pinnedText);
});
