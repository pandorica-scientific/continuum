// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { ATTACHMENT_KINDS, attachmentKind, statementDocumentName } from '$lib/tax';

describe('statementDocumentName', () => {
	it('keeps the two-argument name it had before kinds existed', () => {
		// tax-statement-document.test.ts asserts this exact string.
		expect(statementDocumentName(2025, 'cz')).toBe('2025 CZ tax statement');
	});

	it('names each kind after what the paper actually is', () => {
		expect(statementDocumentName(2025, 'CZ', 'employer')).toBe('2025 CZ employer earnings report');
		expect(statementDocumentName(2025, 'CZ', 'broker')).toBe('2025 CZ broker earnings report');
		expect(statementDocumentName(2025, 'CZ', 'other')).toBe('2025 CZ tax document');
	});

	it('uppercases and trims the country the way the statement stores it', () => {
		expect(statementDocumentName(2024, '  de  ', 'statement')).toBe('2024 DE tax statement');
	});

	it('appends the filename when told to, so two of a kind stay distinguishable', () => {
		expect(statementDocumentName(2025, 'CZ', 'broker', 'degiro-2025.pdf')).toBe(
			'2025 CZ broker earnings report · degiro-2025.pdf'
		);
	});

	it('ignores an empty filename rather than leaving a trailing separator', () => {
		expect(statementDocumentName(2025, 'CZ', 'broker', '   ')).toBe(
			'2025 CZ broker earnings report'
		);
	});
});

describe('attachmentKind', () => {
	it('resolves every declared key', () => {
		for (const kind of ATTACHMENT_KINDS) {
			expect(attachmentKind(kind.key).key).toBe(kind.key);
		}
	});

	it('falls back to other rather than throwing on a key from a stale form', () => {
		expect(attachmentKind('nonsense').key).toBe('other');
		expect(attachmentKind('').key).toBe('other');
	});

	it('gives every kind a tag, so the documents screen can filter across years', () => {
		for (const kind of ATTACHMENT_KINDS) {
			expect(kind.tag.trim()).not.toBe('');
		}
	});

	it('gives every kind a distinct noun, so two kinds cannot file under one name', () => {
		const nouns = ATTACHMENT_KINDS.map((k) => k.noun);
		expect(new Set(nouns).size).toBe(nouns.length);
	});
});

describe('pairing a batch of uploads with what each one is', () => {
	/**
	 * The pairing `takeUploads` does, as a pure function of the three lists a
	 * multi-file form sends. Written out here because the failure is silent: a
	 * mismatched index files a Czech employer report as an Austrian statement
	 * and nothing complains.
	 */
	const pair = (
		files: { name: string; size: number }[],
		kinds: string[],
		countries: string[],
		fallbackCountry: string
	) =>
		files
			.map((file, index) => ({
				file,
				kind: attachmentKind(kinds[index] ?? kinds[0] ?? 'statement').key,
				country: (countries[index] ?? countries[0] ?? '').trim().toUpperCase() || fallbackCountry
			}))
			.filter((row) => row.file.size > 0);

	it('gives each file its own kind and country', () => {
		const out = pair(
			[
				{ name: 'return.pdf', size: 10 },
				{ name: 'employer.pdf', size: 10 }
			],
			['statement', 'employer'],
			['CZ', 'at'],
			'CZ'
		);
		expect(out.map((r) => [r.file.name, r.kind, r.country])).toEqual([
			['return.pdf', 'statement', 'CZ'],
			['employer.pdf', 'employer', 'AT']
		]);
	});

	it('falls back to the statement’s own country where none was typed', () => {
		const out = pair([{ name: 'a.pdf', size: 1 }], ['statement'], [''], 'PL');
		expect(out[0].country).toBe('PL');
	});

	it('keeps a form that sends a single kind working for every file', () => {
		// The shape the dialog sent before it asked per file.
		const out = pair(
			[
				{ name: 'a.pdf', size: 1 },
				{ name: 'b.pdf', size: 1 }
			],
			['broker'],
			[],
			'CZ'
		);
		expect(out.map((r) => r.kind)).toEqual(['broker', 'broker']);
	});

	it('does not let an empty file shift the ones after it onto the wrong kind', () => {
		// The reason the pairing runs before the size filter, not after: dropping
		// the empty first would slide every later kind up by one.
		const out = pair(
			[
				{ name: 'empty.pdf', size: 0 },
				{ name: 'employer.pdf', size: 10 }
			],
			['statement', 'employer'],
			['CZ', 'AT'],
			'CZ'
		);
		expect(out).toHaveLength(1);
		expect([out[0].file.name, out[0].kind, out[0].country]).toEqual([
			'employer.pdf',
			'employer',
			'AT'
		]);
	});

	it('names each document after its own country, not the statement’s', () => {
		expect(statementDocumentName(2025, 'AT', 'employer')).toBe('2025 AT employer earnings report');
		expect(statementDocumentName(2025, 'CZ', 'statement')).toBe('2025 CZ tax statement');
	});
});
