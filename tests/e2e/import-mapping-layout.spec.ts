// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { expect, test } from '@playwright/test';

const AUTH_STATE = 'test-results/e2e-auth.json';
test.use({ storageState: AUTH_STATE });

// A layout nothing recognises: headings in a language the dictionary does not
// carry, so no column can be named by inference and the reader has to ask. One
// heading is deliberately long enough to wrap at the column width, because a
// header of a different height is the whole condition being tested.
const UNMAPPABLE = [
	'Tanggal,Keterangan lengkap mengenai transaksi ini,Jumlah,Sisa',
	'2026-03-14,Gaji bulanan,1500000,2500000',
	'2026-03-15,Belanja harian,-320500,2179500',
	'2026-03-16,Tagihan listrik,-179500,2000000'
].join('\n');

test('the mapping columns line up across differing header heights', async ({ page }) => {
	await page.goto('/import');

	await page
		.locator('input[type=file]')
		.first()
		.setInputFiles({
			// Short on purpose. The queue's .r-name ellipsizes, and smoke.spec.ts
			// flags any clipped text — so a long fixture name would fail the narrow
			// viewport guards for a reason that has nothing to do with this test.
			name: 'unknown.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from(UNMAPPABLE, 'utf8')
		});

	// The queue reads it in the background and refuses it, which is what offers
	// the mapping route. The button appears once that has happened.
	const mapButton = page.getByRole('button', { name: 'Map its columns' }).first();
	await expect(mapButton).toBeVisible({ timeout: 30_000 });
	await mapButton.click();

	const wizard = page.locator('.w-columns');
	await expect(wizard).toBeVisible();

	const selects = wizard.locator('.w-col select');
	await expect(selects).toHaveCount(4);

	const tops: number[] = [];
	for (let i = 0; i < 4; i++) {
		const box = await selects.nth(i).boundingBox();
		expect(box).not.toBeNull();
		tops.push(box!.y);
	}

	// Compare only within the first grid row: at a narrow width the four columns
	// may wrap, and a column on row two legitimately sits lower.
	const firstRowTop = Math.min(...tops);
	const firstRow = tops.filter((t) => t < firstRowTop + 40);
	expect(firstRow.length).toBeGreaterThan(1);
	for (const top of firstRow) {
		expect(Math.abs(top - firstRowTop)).toBeLessThan(2);
	}
});
