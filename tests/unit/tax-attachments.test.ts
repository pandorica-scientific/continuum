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
