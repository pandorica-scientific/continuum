// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectAndParseAll } from '$lib/server/import/detect';

// "Pohyby na účtu" is a movement list with no balance figures, so it is
// unconfirmable by construction and must be refused with a pointer to the
// "Výpis z účtu" export that has balances instead.
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
