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

/**
 * What a shelf IS, as data.
 *
 * Before v0.8.0 this lived in `src/lib/shelf-profiles.ts` as a hand-written
 * record keyed by shelf, so a shelf a household made could not have a layout at
 * all. Naming the template and the unit as enums is what lets the shelf row
 * carry them, and what puts them behind a CHECK constraint like every other
 * closed set in the schema.
 */
describe('the shelf enums', () => {
	it('name seven templates and six units', () => {
		expect(ENUMS['shelf.template']).toEqual([
			'queue',
			'wallet',
			'completeness',
			'dossier',
			'timeline',
			'kit',
			'obligations'
		]);
		expect(ENUMS['shelf.unit']).toEqual([
			'document',
			'person',
			'account',
			'organisation',
			'property',
			'subject'
		]);
	});

	it('a lane can expect paper once', () => {
		// A slot — receipt, warranty, manual — is a lane with cadence `once`, not
		// a table of its own.
		expect(ENUMS['lane.cadence']).toEqual(['monthly', 'yearly', 'once', 'none']);
	});

	it('both shelf columns get a CHECK', () => {
		const shelfChecks = ENUM_COLUMNS.filter((c) => c.table === 'shelf').map((c) => c.column);
		expect(shelfChecks.sort()).toEqual(['template', 'unit']);
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
	it('still names the types the app ships, and no longer constrains the column', () => {
		// `document_type` is a table now — a household adds its own — so this list
		// is what SHIPS rather than what is allowed. It stays because code reads
		// these keys by name; the column is a foreign key, not a CHECK.
		expect(ENUMS['document.type']).toContain('payslip');
		expect(ENUMS['document.type']).toContain('bank_statement');
		expect(ENUMS['document.type']).toContain('other');
		expect(ENUM_COLUMNS.some((c) => c.table === 'document' && c.column === 'type')).toBe(false);
		expect(ENUM_COLUMNS.some((c) => c.table === 'shelf_type')).toBe(false);
	});

	it('no longer knows about a shelf', () => {
		// Shelves became rows. A closed set here would be a migration every time
		// a household added one, which is the cost this file exists to avoid.
		expect(ENUMS).not.toHaveProperty('document.shelf');
		expect(ENUM_COLUMNS.some((c) => c.table === 'document' && c.column === 'shelf')).toBe(false);
	});

	it('constrains sensitivity and chunk source', () => {
		expect(ENUMS['document.sensitivity']).toEqual(['normal', 'restricted']);
		expect(ENUMS['document_text_chunk.source']).toEqual(['text_layer', 'ocr', 'plain']);
		for (const [table, column, key] of [
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
