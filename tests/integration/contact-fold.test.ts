import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normaliseSearch } from '$lib/contacts/search';
import { startPostgres, type Harness } from './harness';

/**
 * The contact search fold, run against a real PostgreSQL.
 *
 * The TypeScript half normalises what someone typed; the SQL half normalises
 * what is stored, and the index is built on the SQL half. If they disagree the
 * query returns NO RESULTS — never an error — so a contact that plainly exists
 * simply cannot be found, and nothing anywhere says why.
 *
 * The unit test can pin the letters and the shape of the expression. Only this
 * can answer the questions that are database behaviour: whether `unaccent`
 * actually strips what we assume it strips, whether the index resolves the
 * function under its restricted search_path, and — the bug this file was added
 * for — whether an UPPERCASE stroked letter folds the same on both sides.
 */

let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('contact-fold', { max: 1 });

	// Only what the fold and its index touch.
	await harness.sql.unsafe(`
		create table contact (
			id text primary key,
			name text not null,
			organisation text
		);
	`);

	// Statement by statement, the way drizzle sends them — so this also proves
	// the migration APPLIES, which is the half that only ever fails on a fresh
	// database (see its own notes on the ::regdictionary cast and the schema
	// qualification, both of which were found exactly that way).
	await harness.applyMigrationFile('0036_contact_search.sql');
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

describe('contact_fold agrees with normaliseSearch', () => {
	// Written the way a person writes them: CAPITALISED, which is the case the
	// two halves fold in different orders. normaliseSearch lowercases first and
	// then substitutes strokes; the SQL translate() runs before its lower(), and
	// its from-list is lowercase only, so 'Ł' never reaches it. That the two
	// still agree rests on PostgreSQL's unaccent covering the stroked letters
	// itself — which is not what the migration's comment assumes, and is worth
	// holding still: every letter of STROKED appears below, in upper case.
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
		await harness.sql`insert into contact (id, name, organisation) values ('1', 'Łukasz Nowak', 'Łódź s.r.o.')`;
		const rows = await harness.sql`
			select name from contact
			where to_tsvector('simple', public.contact_fold(coalesce(name, '') || ' ' || coalesce(organisation, '')))
			      @@ plainto_tsquery('simple', ${normaliseSearch('lukasz')})
		`;
		expect(rows.map((r) => r.name)).toEqual(['Łukasz Nowak']);
	});
});
