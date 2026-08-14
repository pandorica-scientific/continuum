import { describe, expect, it } from 'vitest';
import { deriveColumns, isUnlinked } from '$lib/documents-links';

const doc = (id: string, over: Partial<Parameters<typeof deriveColumns>[0][number]> = {}) => ({
	id,
	people: [],
	properties: [],
	accounts: [],
	subjects: [],
	...over
});

describe('deriveColumns', () => {
	it('puts a document linked to two people in both columns', () => {
		const columns = deriveColumns([doc('d1', { people: ['Jana', 'Jan'] })]);
		expect(columns.map((c) => c.label)).toEqual(['Jan', 'Jana']);
		expect(columns[0].docIds).toEqual(['d1']);
		expect(columns[1].docIds).toEqual(['d1']);
	});

	it('orders columns people, properties, accounts, subjects — alphabetical within each', () => {
		const columns = deriveColumns([
			doc('d1', { subjects: ['Car'] }),
			doc('d2', { properties: ['Flat Karlín'] }),
			doc('d3', { people: ['Jana'] }),
			doc('d4', { accounts: ['XTB portfolio'] }),
			doc('d5', { subjects: ['Household'] })
		]);
		expect(columns.map((c) => c.label)).toEqual([
			'Jana',
			'Flat Karlín',
			'XTB portfolio',
			'Car',
			'Household'
		]);
	});

	it('follows a rename, because the label is whatever current name is passed in', () => {
		const before = deriveColumns([doc('d1', { people: ['Jana'] })]);
		const after = deriveColumns([doc('d1', { people: ['Jana Nováková'] })]);
		expect(before[0].label).toBe('Jana');
		expect(after[0].label).toBe('Jana Nováková');
		expect(after[0].docIds).toEqual(['d1']); // the document came along
	});

	it('never lists a document twice within one column', () => {
		const columns = deriveColumns([doc('d1', { people: ['Jana'], subjects: [] })]);
		expect(columns[0].docIds).toEqual(['d1']);
	});
});

describe('isUnlinked', () => {
	it('is true only when the document belongs to nothing at all', () => {
		expect(isUnlinked({ people: [], properties: [], accounts: [], subjects: [] })).toBe(true);
		expect(isUnlinked({ people: ['p1'], properties: [], accounts: [], subjects: [] })).toBe(false);
		expect(isUnlinked({ people: [], properties: [], accounts: [], subjects: ['s1'] })).toBe(false);
	});
});
