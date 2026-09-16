import { rowId } from '../row-id';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normaliseSearch } from '$lib/contacts/search';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

/**
 * The contact search fold, run against a real PostgreSQL.
 *
 * TypeScript normalises what someone typed; SQL normalises what is stored,
 * and the index is built on the SQL half. If they disagree the query returns
 * no results, never an error, so a contact that exists cannot be found and
 * nothing says why.
 *
 * Only this suite can answer questions that are database behaviour: whether
 * `unaccent` strips what we assume, whether the index resolves the function
 * under its restricted search_path, and whether an uppercase stroked letter
 * folds the same on both sides.
 */

let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('contact-fold', { max: 1 });

	// Statement by statement, the way drizzle sends them — so this also proves
	// the baseline applies, which only ever fails on a fresh database.
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

describe('contact_fold agrees with normaliseSearch', () => {
	// Written CAPITALISED: normaliseSearch lowercases then substitutes strokes,
	// while SQL translate() runs before lower() with a lowercase-only
	// from-list, so 'Ł' never reaches it. The two still agree only because
	// PostgreSQL's unaccent covers stroked letters itself.
	const names = [
		'Łódź',
		'Łukasz Nowak',
		'Đorđe Petrović',
		'Řehoř Novák',
		'Škoda',
		'Żabka',
		'Świętochowski',
		'ČESKÁ SPOŘITELNA',
		'Ørsted',
		'Ħamrun',
		'Ŧorne',
		'Kaufland'
	];

	it.each(names)('folds %s the same in SQL as in TypeScript', async (name) => {
		const [row] = await harness.sql`select public.contact_fold(${name}) as folded`;
		expect(row.folded).toBe(normaliseSearch(name));
	});

	// The end-to-end shape: what listContacts() actually runs. A fold that agrees
	// on a string but not through to_tsvector/plainto_tsquery would still find
	// nobody.
	it('finds a capitalised stroked name from an ASCII term', async () => {
		await harness.sql`insert into contact (id, name, organisation)
			values (${rowId('lukasz')}, 'Łukasz Nowak', 'Łódź s.r.o.')`;
		const rows = await harness.sql`
			select name from contact
			where to_tsvector('simple', public.contact_fold(coalesce(name, '') || ' ' || coalesce(organisation, '')))
			      @@ plainto_tsquery('simple', ${normaliseSearch('lukasz')})
		`;
		expect(rows.map((r) => r.name)).toEqual(['Łukasz Nowak']);
	});
});
