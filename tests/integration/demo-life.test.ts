// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The demo household's Life half actually seeds.
 *
 * `seedDemo` runs once on a pristine instance and is the first thing anybody
 * sees, so a constraint it violates is a first impression of a 500. Every rule
 * in `life.ts` is exercised here by real data rather than by a fixture built to
 * pass — the counts below are what the screens will show.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('demo-life', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);

	// Handed this suite's own database, rather than the app's module-level
	// connection, which in a test has no DATABASE_URL to open.
	const { seedDemoLife } = await import('$lib/server/system/demo-life');
	const jana = uuidv7();
	const petr = uuidv7();
	await harness.sql`insert into person (id, name, initials, role)
		values (${jana}, 'Jana Nováková', 'JN', 'admin'), (${petr}, 'Petr Novák', 'PN', 'member')`;
	await seedDemoLife({ jana, petr }, harness.db);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

const count = async (table: string): Promise<number> => {
	const [row] = await harness.sql<
		{ n: string }[]
	>`select count(*)::text as n from ${harness.sql(table)}`;
	return Number(row.n);
};

describe('the trips', () => {
	it('seeds trips ahead and behind', async () => {
		const [row] = await harness.sql<{ upcoming: string; past: string }[]>`
			select
				count(*) filter (where starts_on > current_date)::text as upcoming,
				count(*) filter (where ends_on < current_date)::text as past
			from trip`;
		expect(Number(row.upcoming)).toBeGreaterThan(0);
		expect(Number(row.past)).toBeGreaterThan(0);
	});

	it('gives every trip at least one destination and one member', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from trip t
			where not exists (select 1 from trip_destination d where d.trip_id = t.id)
			   or not exists (select 1 from trip_member m where m.trip_id = t.id)`;
		expect(Number(row.n)).toBe(0);
	});

	it('registers every trip as an entity, so paper can be filed against it', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from trip t
			where not exists (select 1 from entity e where e.id = t.id and e.kind = 'trip')`;
		expect(Number(row.n)).toBe(0);
	});

	it('orders a trip’s bookings in travel order', async () => {
		const rows = await harness.sql<{ title: string }[]>`
			select b.title from trip_booking b
			join trip t on t.id = b.trip_id
			where t.name like 'Porto%'
			order by b.starts_at`;
		expect(rows[0].title).toContain('Prague → Porto');
		expect(rows[rows.length - 1].title).toContain('Porto → Prague');
	});
});

describe('the map', () => {
	it('has visits from trips and visits typed in by hand', async () => {
		const [row] = await harness.sql<{ trip: string; manual: string }[]>`
			select
				count(*) filter (where source = 'trip')::text as trip,
				count(*) filter (where source = 'manual')::text as manual
			from visit`;
		expect(Number(row.trip)).toBeGreaterThan(0);
		expect(Number(row.manual)).toBeGreaterThan(0);
	});

	it('writes a visit only for a trip that has already ended', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from visit v
			join trip t on t.id = v.trip_id
			where t.ends_on >= current_date`;
		expect(Number(row.n)).toBe(0);
	});

	it('leaves one visit unrevealed, so the map has something to play', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from visit where revealed_at is null`;
		expect(Number(row.n)).toBeGreaterThan(0);
	});

	it('covers enough countries for the tiles to read', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(distinct country)::text as n from visit`;
		expect(Number(row.n)).toBeGreaterThanOrEqual(8);
	});
});

describe('the idea board', () => {
	it('seeds ideas, two of them hearted by both', async () => {
		expect(await count('trip_idea')).toBeGreaterThan(0);
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from (
				select idea_id from trip_idea_heart group by idea_id having count(*) = 2
			) both_of_them`;
		expect(Number(row.n)).toBe(2);
	});
});

describe('the cookbook', () => {
	it('fills every category it creates', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from recipe_category c
			where not exists (select 1 from recipe r where r.category_id = c.id)`;
		expect(Number(row.n)).toBe(0);
	});

	it('gives every recipe ingredients and steps', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from recipe r
			where not exists (select 1 from recipe_ingredient i where i.recipe_id = r.id)
			   or not exists (select 1 from recipe_step s where s.recipe_id = r.id)`;
		expect(Number(row.n)).toBe(0);
	});

	it('keeps an unmeasurable quantity unmeasured', async () => {
		// "A splash of milk" is a quantity a recipe is allowed to have, and the
		// scaler has to leave it alone rather than invent a number for it.
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from recipe_ingredient where quantity is null`;
		expect(Number(row.n)).toBeGreaterThan(0);
	});

	it('stores resolved artwork rather than re-deriving it from the name', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from recipe where art is null`;
		expect(Number(row.n)).toBe(0);
	});
});

describe('the cellar', () => {
	it('puts every bottle on the one shelf', async () => {
		expect(await count('collection')).toBe(1);
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from bottle b
			where not exists (select 1 from collection c where c.id = b.collection_id)`;
		expect(Number(row.n)).toBe(0);
	});

	it('holds more than four types, so the filter row has to collapse some', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(distinct type)::text as n from bottle`;
		expect(Number(row.n)).toBeGreaterThan(4);
	});

	it('never opens more than it owns', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from bottle where opened > owned or owned < 0 or opened < 0`;
		expect(Number(row.n)).toBe(0);
	});

	it('prices every bottle in a currency', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from bottle
			where (bought_minor is null) <> (bought_currency is null)`;
		expect(Number(row.n)).toBe(0);
	});

	it('gives one bottle enough tastings for the radar to draw a shape', async () => {
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from (
				select t.bottle_id
				from tasting t
				join tasting_note n on n.tasting_id = t.id
				group by t.bottle_id
				having count(distinct n.note) >= 3
			) with_a_shape`;
		expect(Number(row.n)).toBeGreaterThan(0);
	});

	it('has something past its drink-by window, so the tile can go amber', async () => {
		const year = new Date().getUTCFullYear();
		const [row] = await harness.sql<{ n: string }[]>`
			select count(*)::text as n from bottle where drink_to is not null and drink_to < ${year}`;
		expect(Number(row.n)).toBeGreaterThan(0);
	});
});
