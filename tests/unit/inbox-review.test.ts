// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
	counterLabel,
	currentId,
	fileAndNext,
	keptFields,
	proposeType,
	setField,
	skip,
	startSession
} from '$lib/inbox-review';

/**
 * Skip is safe to press because it does nothing.
 *
 * The cadence this screen is built for is email triage — decide, or pass — and
 * a Skip that quietly filed or deleted would make a fast lap dangerous. These
 * are the two behaviours that rot silently inside a component, which is why
 * they are here instead.
 */
describe('the review session', () => {
	it('wraps to the first skipped document and re-labels the counter', () => {
		let s = startSession(['a', 'b', 'c']);
		s = skip(s);
		s = skip(s);
		s = skip(s);
		expect(currentId(s)).toBe('a');
		expect(counterLabel(s)).toBe('3 skipped');
	});

	it('exits when only skipped documents remain and one is skipped again', () => {
		let s = startSession(['a']);
		s = skip(s);
		s = skip(s);
		expect(s.done).toBe(true);
	});

	it('is a no-op over a full lap of skipping', () => {
		// This is what makes Skip safe to press: it never files and never
		// deletes, so a lap changes nothing on disk.
		const before = startSession(['a', 'b']);
		const after = skip(skip(before));
		expect(after.filed).toEqual(before.filed);
		expect(after.filed).toEqual([]);
	});

	it('carries shelf and type forward, and says so', () => {
		const s = fileAndNext(startSession(['a', 'b']), { shelfKey: 'finance', type: 'invoice' });
		expect(currentId(s)).toBe('b');
		expect(keptFields(s)).toEqual(['shelf', 'type']);
		expect(s.filed).toEqual(['a']);
	});

	it('clears the kept mark the moment the field changes', () => {
		let s = fileAndNext(startSession(['a', 'b']), { shelfKey: 'finance', type: 'invoice' });
		s = setField(s, 'type', 'receipt');
		expect(keptFields(s)).toEqual(['shelf']);
		expect(s.sticky.type).toBe('receipt');
	});

	it('counts what is left rather than what was offered', () => {
		let s = startSession(['a', 'b', 'c']);
		expect(counterLabel(s)).toBe('3 remaining');
		s = fileAndNext(s, { shelfKey: 'finance' });
		expect(counterLabel(s)).toBe('2 remaining');
		s = skip(s);
		expect(counterLabel(s)).toBe('1 remaining');
	});

	it('starts done on an empty inbox', () => {
		const s = startSession([]);
		expect(s.done).toBe(true);
		expect(counterLabel(s)).toBe('Inbox is clear');
		expect(currentId(s)).toBeNull();
	});
});

describe('a shelf proposing a type', () => {
	it('fills a type nobody has decided yet', () => {
		const session = proposeType(startSession(['a', 'b']), 'id_document');

		expect(session.sticky.type).toBe('id_document');
		expect(session.suggested).toEqual(['type']);
		// A proposal is not something the person chose, so it never claims to be.
		expect(session.kept).not.toContain('type');
	});

	it('fills over the `other` a fresh session starts on', () => {
		const started = setField(startSession(['a']), 'type', 'other');
		expect(proposeType(started, 'id_document').sticky.type).toBe('id_document');
	});

	it('never overwrites an answer somebody gave', () => {
		// Picking Identity for the second of twenty certificates must not retype
		// the answer given for the first.
		const chosen = setField(startSession(['a']), 'type', 'certificate');
		const after = proposeType(chosen, 'id_document');

		expect(after.sticky.type).toBe('certificate');
		expect(after.suggested).toEqual([]);
	});

	it('re-proposes over a value it proposed itself', () => {
		// Picking Identity and then Statements must not leave a bank statement
		// typed as an identity document: nobody chose that, this function did.
		const first = proposeType(startSession(['a']), 'id_document');
		const second = proposeType(first, 'bank_statement');

		expect(second.sticky.type).toBe('bank_statement');
		expect(second.suggested).toEqual(['type']);
	});

	it('does nothing for a shelf that expects nothing', () => {
		const session = startSession(['a']);
		expect(proposeType(session, undefined)).toBe(session);
	});

	it('is cleared by touching the field', () => {
		const proposed = proposeType(startSession(['a']), 'id_document');
		expect(setField(proposed, 'type', 'passport').suggested).toEqual([]);
	});

	it('is cleared by filing, because what carries forward was chosen', () => {
		const proposed = proposeType(startSession(['a', 'b']), 'id_document');
		const filed = fileAndNext(proposed, { shelfKey: 'identity', type: 'id_document' });

		expect(filed.suggested).toEqual([]);
		expect(filed.kept).toContain('type');
	});
});
