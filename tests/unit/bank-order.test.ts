// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { orderBanksForChoosing } from '$lib/banks';

// "Other" is a fallback, not a bank, so alphabetical order puts it in the
// middle of a list of real institutions. It belongs at the bottom, just above
// the "add a bank" control the markup renders after this list.
describe('orderBanksForChoosing', () => {
	it('sorts by label and puts Other last', () => {
		const ordered = orderBanksForChoosing([
			{ key: 'revolut', label: 'Revolut' },
			{ key: 'other', label: 'Other' },
			{ key: 'fio', label: 'Fio banka' },
			{ key: 'csas', label: 'Česká spořitelna' }
		]);
		expect(ordered.map((b) => b.key)).toEqual(['csas', 'fio', 'revolut', 'other']);
	});

	it('is unchanged when there is no Other row', () => {
		const ordered = orderBanksForChoosing([
			{ key: 'revolut', label: 'Revolut' },
			{ key: 'fio', label: 'Fio banka' }
		]);
		expect(ordered.map((b) => b.key)).toEqual(['fio', 'revolut']);
	});

	it('does not mutate its argument', () => {
		const input = [
			{ key: 'other', label: 'Other' },
			{ key: 'fio', label: 'Fio banka' }
		];
		orderBanksForChoosing(input);
		expect(input.map((b) => b.key)).toEqual(['other', 'fio']);
	});

	it('sorts a household-added bank among the real ones', () => {
		const ordered = orderBanksForChoosing([
			{ key: 'other', label: 'Other' },
			{ key: 'monzo', label: 'Monzo' },
			{ key: 'fio', label: 'Fio banka' }
		]);
		expect(ordered.map((b) => b.key)).toEqual(['fio', 'monzo', 'other']);
	});
});
