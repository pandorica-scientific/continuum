// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { expect, test } from '@playwright/test';

const AUTH_STATE = 'test-results/e2e-auth.json';
test.use({ storageState: AUTH_STATE });

// The y-axis labels are positioned as a percentage of their container. While
// the year row lived inside that container, 100% was 20px below the plot —
// which is exactly where the year labels are.
test('the bottom axis label does not sit on the year row', async ({ page }) => {
	await page.goto('/retirement');

	const axisLabels = page.locator('.chart .axis');
	await expect(axisLabels).toHaveCount(3);

	const bottomAxis = axisLabels.last();
	const firstYear = page.locator('.years .year').first();
	await expect(firstYear).toBeVisible();

	const [axisBox, yearBox] = await Promise.all([bottomAxis.boundingBox(), firstYear.boundingBox()]);
	expect(axisBox).not.toBeNull();
	expect(yearBox).not.toBeNull();

	// No vertical overlap between the two boxes.
	const overlaps =
		axisBox!.y < yearBox!.y + yearBox!.height && yearBox!.y < axisBox!.y + axisBox!.height;
	expect(overlaps, 'the 0.0 axis label overlaps the first year label').toBe(false);
});

// Moving the year row out of .chart must not shift the years sideways: the
// gutter that .chart's padding used to provide has to be replaced.
test('the year labels stay inside the plot area', async ({ page }) => {
	await page.goto('/retirement');

	const svg = page.locator('.chart svg').first();
	const firstYear = page.locator('.years .year').first();
	const [svgBox, yearBox] = await Promise.all([svg.boundingBox(), firstYear.boundingBox()]);
	expect(svgBox).not.toBeNull();
	expect(yearBox).not.toBeNull();

	// The first year sits at left:0% of the plot and is centred on it, so its
	// midpoint should be within a few pixels of the plot's left edge.
	const yearMid = yearBox!.x + yearBox!.width / 2;
	expect(Math.abs(yearMid - svgBox!.x)).toBeLessThan(6);
});

// The salary-history row is `align-items: end`, so a control taller than its
// neighbours does not sit lower — it rides UP. The payslip file input did:
// 42px against 36 for the selects, 34 for the amount and 32 for the button,
// which is four different baselines in one row. Heights, not widths: every
// column was already 208px wide when this was reported, which is why an
// overflow test saw nothing wrong.
test('every control in the payslip row shares one height and one baseline', async ({ page }) => {
	await page.goto('/retirement');

	const controls = page.locator('.payslip-form input, .payslip-form select, .payslip-form .btn');
	const count = await controls.count();
	expect(count).toBeGreaterThan(3);

	const boxes = [];
	for (let i = 0; i < count; i++) {
		const box = await controls.nth(i).boundingBox();
		expect(box).not.toBeNull();
		boxes.push(box!);
	}

	const first = boxes[0];
	for (const box of boxes) {
		expect(Math.abs(box.height - first.height), 'control heights differ').toBeLessThan(2);
		expect(Math.abs(box.y - first.y), 'control top edges differ').toBeLessThan(2);
	}
});
