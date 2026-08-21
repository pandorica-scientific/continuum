// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { expect, test } from '@playwright/test';

// Part 0 rewrites geometry across the whole product and is forbidden from
// changing how any of it looks. No one can check that by eye over fourteen
// screens, so it is checked by pixels: these are captured before the sweep
// begins and asserted after every step of it.
//
// A failure here is not "the screenshot is stale". It is the migration having
// changed the design, which is the one thing this part must not do.
//
// This lives in its own project, depending on `polish`, so it always runs after
// every spec that mutates the database — a property added, a failed job left in
// the import queue. Running it on its own therefore sees the same screens as
// running the whole suite, which is what stops it diffing against state that
// happens to differ.

const AUTH_STATE = 'test-results/e2e-auth.json';
test.use({ storageState: AUTH_STATE });

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

for (const path of SCREENS) {
	test(`${path} is pixel-identical to the baseline`, async ({ page }) => {
		await page.goto(path);
		await expect(page.locator('h1').first()).toBeVisible();

		// Three kinds of content move on their own, and masking them is the
		// alternative to a tolerance so loose it stops noticing anything. Each was
		// found by reading the diff image, not by guessing:
		//
		//   Settings — `status.uptime`, which changes every second.
		//   Settings — the last-backup line: its timestamp and file count.
		//   Calendar — the ICS feed path. The token in it is a secret regenerated
		//              on every database reset, so it is never the same twice.
		//   Both     — "last synced <time>" for a calendar account; the sync ticks
		//              every minute.
		//
		// Everything else on those screens is still compared to the pixel.
		const volatile = [
			page.locator('.status').filter({ hasText: 'Uptime' }),
			page.getByText(/Last backup|Last attempt failed/),
			page.locator('.f-detail'),
			page.getByText(/last synced/)
		];

		await expect(page).toHaveScreenshot(`${path.slice(1)}.png`, {
			fullPage: true,
			// threshold is the PER-PIXEL colour sensitivity, and its default of 0.2
			// is what made the first version of this guard useless: card and page
			// backgrounds sit close together in the dark theme, so re-rounding every
			// card corner from 10px to 22px moved pixels by less than the default
			// tolerated, and the suite reported success. Measured, not assumed.
			threshold: 0.02,
			maxDiffPixels: 120,
			mask: volatile,
			animations: 'disabled'
		});
	});
}
