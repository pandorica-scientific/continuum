// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import {
	counterLabel,
	currentId,
	fileAndNext,
	keptFields,
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
