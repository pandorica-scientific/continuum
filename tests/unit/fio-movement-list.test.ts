// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectAndParseAll } from '$lib/server/import/detect';

// Fio offers two exports and only one of them is a statement.
//
// "Pohyby na účtu" is a movement LIST: dates, amounts, counterparties, and no
// balance anywhere — no running balance, no opening or closing figure, no
// totals. Nothing in it can show whether every row is present, so it is P0 by
// construction, and decideImport refuses P0 even for a mapping somebody
// confirmed by hand. That refusal is right and stays.
//
// What was wrong was the answer: the file fell through to "map this layout",
// a screen where no answer the person gives can ever succeed, because the
// missing thing is not a column meaning — it is the balances.
//
// The missing counterparty numbers on the interest rows are a red herring: the
// same rows appear in the reporter's "Výpis z účtu" export for the same
// account and import without trouble.
const bytes = readFileSync('tests/fixtures/fio-movements.csv');

describe('Fio’s movement-list export', () => {
	it('is refused by name, and points at the export that works', async () => {
		await expect(detectAndParseAll(new Uint8Array(bytes))).rejects.toThrow(/Pohyby na účtu/);

		await expect(detectAndParseAll(new Uint8Array(bytes))).rejects.toThrow(/Výpis z účtu/);
	});

	it('says why, so the refusal is not a dead end', async () => {
		await expect(detectAndParseAll(new Uint8Array(bytes))).rejects.toThrow(/balance/i);
	});
});
