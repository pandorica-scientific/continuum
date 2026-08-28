import { describe, expect, it } from 'vitest';
import { ENTITY_KINDS, ENUMS, ENUM_COLUMNS, asEnumValue, isEnumValue } from '$lib/enums';
import { EXPIRY_VERBS } from '$lib/documents';
import { DAY_COUNTS } from '$lib/loans';
import { REVIEW_STATES } from '$lib/transactions/filter';

/**
 * The lists the screens use are the lists the database enforces.
 *
 * Several of these were written out by hand beside the schema and had already
 * drifted from it — `REVIEW_STATES` was missing `filed`, which `ingest.ts`
 * treats as terminal, so the register could not filter for it. Deriving them
 * removes the drift; this suite is what stops it coming back through a list
 * that cannot be derived because it carries labels too.
 */
describe('the screens and the schema agree', () => {
	it('the derived lists are the schema lists', () => {
		expect(EXPIRY_VERBS).toEqual(ENUMS['document.expiry_verb']);
		expect(DAY_COUNTS).toEqual(ENUMS['loan.day_count']);
		expect(REVIEW_STATES).toEqual(ENUMS['transaction.review_state']);
	});

	it('includes the filed state, which the register could not previously reach', () => {
		expect(REVIEW_STATES).toContain('filed');
	});

	it('ENTITY_KINDS is the set the entity.kind constraint enforces', () => {
		expect(ENTITY_KINDS).toEqual(ENUMS['entity.kind']);
	});
});

describe('every constrained column names a list that exists', () => {
	it('has no dangling enum key', () => {
		for (const { table, column, enum: key } of ENUM_COLUMNS) {
			expect(ENUMS[key], `${table}.${column}`).toBeDefined();
			expect(ENUMS[key].length, `${table}.${column}`).toBeGreaterThan(1);
		}
	});

	it('constrains each column once', () => {
		const seen = ENUM_COLUMNS.map(({ table, column }) => `${table}.${column}`);
		expect(new Set(seen).size).toBe(seen.length);
	});
});

describe('narrowing at a boundary', () => {
	it('accepts a value in the set', () => {
		expect(isEnumValue('loan.day_count', 'act/365')).toBe(true);
		expect(asEnumValue('loan.day_count', 'act/365', '30/360')).toBe('act/365');
	});

	it('falls back rather than letting the constraint discover it', () => {
		expect(isEnumValue('loan.day_count', 'act/366')).toBe(false);
		expect(asEnumValue('loan.day_count', 'act/366', '30/360')).toBe('30/360');
	});

	it('rejects what is not a string at all', () => {
		expect(isEnumValue('account.kind', undefined)).toBe(false);
		expect(isEnumValue('account.kind', 3)).toBe(false);
		// A FormData field arrives as File | string; neither may slip through.
		expect(asEnumValue('account.kind', null, 'current')).toBe('current');
	});
});

describe('the documents-v2 registry', () => {
	it('no longer knows about a shelf', () => {
		// Shelves became rows. A closed set here would be a migration every time
		// a household added one, which is the cost this file exists to avoid.
		expect(ENUMS).not.toHaveProperty('document.shelf');
		expect(ENUM_COLUMNS.some((c) => c.table === 'document' && c.column === 'shelf')).toBe(false);
	});

	it('constrains type, sensitivity and chunk source', () => {
		expect(ENUMS['document.type']).toContain('payslip');
		expect(ENUMS['document.type']).toContain('bank_statement');
		expect(ENUMS['document.type']).toContain('other');
		expect(ENUMS['document.sensitivity']).toEqual(['normal', 'restricted']);
		expect(ENUMS['document_text_chunk.source']).toEqual(['text_layer', 'ocr', 'plain']);
		for (const [table, column, key] of [
			['document', 'type', 'document.type'],
			['document', 'sensitivity', 'document.sensitivity'],
			['document_text_chunk', 'source', 'document_text_chunk.source']
		] as const) {
			expect(ENUM_COLUMNS).toContainEqual({ table, column, enum: key });
		}
	});

	it('lets the queue carry an extraction', () => {
		expect(ENUMS['job.kind']).toEqual(['import', 'calendar_sync', 'extract_text']);
		expect(isEnumValue('job.kind', 'extract_text')).toBe(true);
	});
});
