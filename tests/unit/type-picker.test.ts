// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { ALL_TYPES, mayProposeType, typeOptionsFor } from '$lib/documents';
import { TYPE_LABELS } from '$lib/documents/view';

describe('mayProposeType', () => {
	it('fills a field nobody has answered', () => {
		expect(mayProposeType(undefined, false)).toBe(true);
		expect(mayProposeType('other', false)).toBe(true);
	});

	it('replaces what it proposed itself', () => {
		// Picking Identity and then Statements must not leave a bank statement
		// typed as an identity document.
		expect(mayProposeType('id_document', true)).toBe(true);
	});

	it('never touches an answer somebody gave', () => {
		expect(mayProposeType('certificate', false)).toBe(false);
	});
});

describe('typeOptionsFor', () => {
	it('offers the shelf\u2019s own list, in that order', () => {
		expect(
			typeOptionsFor(['id_document', 'certificate'], undefined, TYPE_LABELS).map(([c]) => c)
		).toEqual(['id_document', 'certificate']);
	});

	it('keeps the chosen type visible even when the shelf does not name it', () => {
		// Or changing shelf would silently retype the document.
		expect(typeOptionsFor(['id_document'], 'payslip', TYPE_LABELS).map(([c]) => c)).toEqual([
			'id_document',
			'payslip'
		]);
	});

	it('offers everything when the shelf names nothing', () => {
		// A shelf with no list is a full picker, never a refusal.
		expect(typeOptionsFor([], undefined, TYPE_LABELS)).toHaveLength(
			Object.keys(TYPE_LABELS).length
		);
	});

	it('offers everything once widened', () => {
		expect(typeOptionsFor(['id_document'], undefined, TYPE_LABELS, true)).toHaveLength(
			Object.keys(TYPE_LABELS).length
		);
	});

	it('ignores a type the archive no longer has', () => {
		// A shelf's list is rows in a table and the enum is code; a value dropped
		// from one should not put an unlabelled option in a picker.
		expect(typeOptionsFor(['id_document', 'blueprint'], undefined, TYPE_LABELS)).toEqual([
			['id_document', TYPE_LABELS.id_document]
		]);
	});

	it('never offers the widening sentinel as a type', () => {
		expect(typeOptionsFor([ALL_TYPES], undefined, TYPE_LABELS)).toHaveLength(
			Object.keys(TYPE_LABELS).length
		);
	});
});
