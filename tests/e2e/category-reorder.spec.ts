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
	const second = group.locator('.tx-leaf[data-leaf]').nth(1);
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
	await expect(pinned).not.toHaveAttribute('data-leaf', /./);

	// Last in the group, whatever sort values the others carry.
	const all = await names(page, 'income');
	const pinnedText = await pinned.innerText();
	expect(all[all.length - 1]).toBe(pinnedText);
});

// Dragging is pointer-driven, not HTML5 drag-and-drop — `draggable` never fires
// on touch, so the first version worked on a desktop and did nothing at all on a
// phone or tablet. Playwright's mouse emits pointer events, so this exercises
// the same code path a finger takes.
test('a category can be dragged, and the order rearranges under the pointer', async ({ page }) => {
	await page.goto('/settings');
	const group = page.locator('.tx-group[data-group="income"]');
	const chips = () => group.locator('.tx-leaf[data-leaf]');

	const before = await chips().evaluateAll((els) =>
		els.map((el) => (el as HTMLElement).dataset.leaf)
	);
	expect(before.length).toBeGreaterThan(2);

	const source = group.locator(`.tx-leaf[data-leaf="${before[2]}"] .grip`);
	const target = group.locator(`.tx-leaf[data-leaf="${before[0]}"]`);
	// Scrolled into view first: Settings is a long page, and a bounding box off
	// the bottom of the viewport gives coordinates the mouse cannot reach — the
	// press lands on nothing and the test blames the code.
	await source.scrollIntoViewIfNeeded();
	const from = await source.boundingBox();
	const to = await target.boundingBox();

	await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
	await page.mouse.down();
	// Two steps: the first tells the page a drag has begun, the second lands it.
	await page.mouse.move(to!.x + 4, to!.y + to!.height / 2, { steps: 8 });

	// Rearranged BEFORE the button is released — the reported fault was seeing
	// nothing happen until you let go.
	await expect
		.poll(async () => chips().evaluateAll((els) => (els[0] as HTMLElement).dataset.leaf))
		.toBe(before[2]);

	await page.mouse.up();

	// And it stuck.
	await page.reload();
	const after = await chips().evaluateAll((els) =>
		els.map((el) => (el as HTMLElement).dataset.leaf)
	);
	expect(after[0]).toBe(before[2]);
});
