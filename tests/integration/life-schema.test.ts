// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the Life tables refuse.
 *
 * Every assertion here is a rule the screens depend on being true. The
 * ownership rules in particular are enforced in two places on purpose: the
 * three controls on the bottle page keep `opened <= owned`, and this constraint
 * is what proves they do rather than trusting three event handlers to agree
 * forever.
 *
 * Written against `harness.sql` rather than Drizzle, following the baseline
 * suite: Drizzle wraps a driver error so its message reads "Failed query …"
 * and the constraint name is buried in `cause`. Asserting on the raw message
 * is asserting on what Postgres actually said.
 */
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

let harness: Harness;
let cellarId: string;
let categoryId: string;

beforeAll(async () => {
	harness = await startPostgres('life-schema', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);

	// The Cellar is a seeded row every install has — see `lifeSeedSql`. Inserting
	// a second one here would collide on the key rather than test anything.
	const [cellar] = await harness.sql`select id from collection where key = 'cellar'`;
	cellarId = cellar.id;

	categoryId = uuidv7();
	await harness.sql`insert into recipe_category (id, name) values (${categoryId}, 'Weeknight')`;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

interface BottleFields {
	id?: string;
	type?: string;
	country?: string | null;
	drink_from?: number | null;
	drink_to?: number | null;
	owned?: number;
	opened?: number;
	bought_minor?: number | null;
	bought_currency?: string | null;
}

/**
 * A bottle that satisfies every constraint, for a test to spoil one field of.
 *
 * Every column is named rather than built from `Object.keys`: postgres.js types
 * its dynamic-insert helper against the keys of the row it is handed, so a
 * spread of `string[]` does not type-check even though it runs.
 */
function insertBottle(fields: BottleFields = {}) {
	const {
		id = uuidv7(),
		type = 'wine',
		country = null,
		drink_from = null,
		drink_to = null,
		owned = 1,
		opened = 0,
		bought_minor = null,
		bought_currency = null
	} = fields;
	return harness.sql`
		insert into bottle
			(id, collection_id, type, name, country, drink_from, drink_to,
			 owned, opened, bought_minor, bought_currency)
		values (${id}, ${cellarId}, ${type}, 'Something red', ${country},
			${drink_from}, ${drink_to}, ${owned}, ${opened},
			${bought_minor}, ${bought_currency})`;
}

describe('a bottle', () => {
	it('may be owned without being open', async () => {
		await expect(insertBottle()).resolves.toBeDefined();
	});

	it('refuses more open than owned', async () => {
		await expect(insertBottle({ owned: 1, opened: 2 })).rejects.toThrow(/bottle_counts_check/);
	});

	it('refuses a negative count', async () => {
		await expect(insertBottle({ owned: -1 })).rejects.toThrow(/bottle_counts_check/);
	});

	it('refuses a drink-by window that closes before it opens', async () => {
		await expect(insertBottle({ drink_from: 2030, drink_to: 2025 })).rejects.toThrow(
			/bottle_drink_window_check/
		);
	});

	it('accepts either end of the window alone', async () => {
		await expect(insertBottle({ drink_from: 2026 })).resolves.toBeDefined();
		await expect(insertBottle({ drink_to: 2032 })).resolves.toBeDefined();
	});

	it('refuses an amount with no currency', async () => {
		await expect(insertBottle({ bought_minor: 45000 })).rejects.toThrow(
			/bottle_bought_money_check/
		);
	});

	it('refuses a currency with no amount', async () => {
		await expect(insertBottle({ bought_currency: 'CZK' })).rejects.toThrow(
			/bottle_bought_money_check/
		);
	});

	it('refuses a country that is not two upper-case letters', async () => {
		await expect(insertBottle({ country: 'cz' })).rejects.toThrow(/bottle_country_check/);
	});

	it('refuses a type outside the list', async () => {
		await expect(insertBottle({ type: 'mead' })).rejects.toThrow(/bottle_type_check/);
	});

	it('will not let its shelf be deleted out from under it', async () => {
		await insertBottle();
		await expect(harness.sql`delete from collection where id = ${cellarId}`).rejects.toThrow(
			/RESTRICT/
		);
	});
});

describe('a trip', () => {
	it('refuses to end before it starts', async () => {
		await expect(
			harness.sql`insert into trip (id, name, starts_on, ends_on)
				values (${uuidv7()}, 'Backwards', '2026-06-10', '2026-06-01')`
		).rejects.toThrow(/trip_dates_check/);
	});

	it('may start and end on the same day', async () => {
		await expect(
			harness.sql`insert into trip (id, name, starts_on, ends_on)
				values (${uuidv7()}, 'A day out', '2026-06-01', '2026-06-01')`
		).resolves.toBeDefined();
	});

	it('keeps its bookings when the confirmation is deleted', async () => {
		const tripId = uuidv7();
		await harness.sql`insert into trip (id, name, starts_on, ends_on)
			values (${tripId}, 'Porto', '2026-06-01', '2026-06-08')`;
		const [{ id: documentId }] = await harness.sql<{ id: string }[]>`
			insert into document (id, name, shelf_id, added_on)
			values (gen_random_uuid(), 'Boarding pass',
				(select id from shelf order by sort_order limit 1), current_date)
			returning id`;
		const bookingId = uuidv7();
		await harness.sql`insert into trip_booking (id, trip_id, kind, title, starts_at, document_id)
			values (${bookingId}, ${tripId}, 'flight', 'LIS → OPO', now(), ${documentId})`;

		await harness.sql`delete from document where id = ${documentId}`;

		const [row] = await harness.sql<{ document_id: string | null }[]>`
			select document_id from trip_booking where id = ${bookingId}`;
		expect(row).toBeDefined();
		expect(row.document_id).toBeNull();
	});
});

/**
 * A trip, a bottle and a recipe are entities.
 *
 * That is what lets a household file the hotel confirmation against the trip
 * and the receipt against the bottle through the ONE link table, rather than
 * each connector needing a table per pair. Without it the Documents screen
 * could not say what a PDF was filed against, because a direct `document_id`
 * on `trip_booking` answers "this flight's confirmation" and nothing else.
 */
describe('the Life records that can be linked to', () => {
	const kinds: [string, () => Promise<string>][] = [
		[
			'trip',
			async () => {
				const id = uuidv7();
				await harness.sql`insert into trip (id, name, starts_on, ends_on)
					values (${id}, 'Linkable', '2026-06-01', '2026-06-05')`;
				return id;
			}
		],
		[
			'bottle',
			async () => {
				const id = uuidv7();
				await insertBottle({ id });
				return id;
			}
		],
		[
			'recipe',
			async () => {
				const id = uuidv7();
				await harness.sql`insert into recipe (id, category_id, name)
					values (${id}, ${categoryId}, 'Linkable')`;
				return id;
			}
		]
	];

	for (const [kind, create] of kinds) {
		it(`registers a ${kind} in the entity table on insert`, async () => {
			const id = await create();
			const [row] = await harness.sql<{ kind: string }[]>`
				select kind from entity where id = ${id}`;
			expect(row?.kind).toBe(kind);
		});

		it(`files a document against a ${kind}`, async () => {
			const id = await create();
			const [{ id: documentId }] = await harness.sql<{ id: string }[]>`
				insert into document (id, name, shelf_id, added_on)
				values (gen_random_uuid(), 'Receipt',
					(select id from shelf order by sort_order limit 1), current_date)
				returning id`;
			await harness.sql`insert into document_link (document_id, target_id)
				values (${documentId}, ${id})`;
			const [link] = await harness.sql<{ target_id: string }[]>`
				select target_id from document_link where document_id = ${documentId}`;
			expect(link?.target_id).toBe(id);
		});

		it(`drops the ${kind}'s links when it is deleted`, async () => {
			const id = await create();
			const [{ id: documentId }] = await harness.sql<{ id: string }[]>`
				insert into document (id, name, shelf_id, added_on)
				values (gen_random_uuid(), 'Receipt',
					(select id from shelf order by sort_order limit 1), current_date)
				returning id`;
			await harness.sql`insert into document_link (document_id, target_id)
				values (${documentId}, ${id})`;

			await harness.sql`delete from ${harness.sql(kind)} where id = ${id}`;

			const links = await harness.sql`select 1 from document_link where target_id = ${id}`;
			expect(links.length).toBe(0);
			// The paper survives the thing it was filed against.
			const documents = await harness.sql`select 1 from document where id = ${documentId}`;
			expect(documents.length).toBe(1);
		});
	}
});

describe('a visit', () => {
	function insertVisit(
		fields: {
			id?: string;
			country?: string;
			region?: string | null;
			year?: number;
			source?: string;
			trip_id?: string | null;
		} = {}
	) {
		const {
			id = uuidv7(),
			country = 'PT',
			region = null,
			year = 2026,
			source = 'manual',
			trip_id = null
		} = fields;
		return harness.sql`
			insert into visit (id, country, region, year, source, trip_id)
			values (${id}, ${country}, ${region}, ${year}, ${source}, ${trip_id})`;
	}

	it('refuses a year outside the range a map can label', async () => {
		await expect(insertVisit({ year: 1755 })).rejects.toThrow(/visit_year_check/);
	});

	it('refuses a lower-case country', async () => {
		await expect(insertVisit({ country: 'pt' })).rejects.toThrow(/visit_country_check/);
	});

	it('lets a household record two manual visits to the same place', async () => {
		await insertVisit({ country: 'ES', region: 'Galicia', year: 2019 });
		await expect(
			insertVisit({ country: 'ES', region: 'Galicia', year: 2024 })
		).resolves.toBeDefined();
	});

	describe('derived from a trip', () => {
		let tripId: string;

		beforeAll(async () => {
			tripId = uuidv7();
			await harness.sql`insert into trip (id, name, starts_on, ends_on)
				values (${tripId}, 'Douro', '2026-06-01', '2026-06-08')`;
		});

		it('is written once per destination', async () => {
			await insertVisit({ country: 'PT', region: 'Norte', source: 'trip', trip_id: tripId });
			await expect(
				insertVisit({ country: 'PT', region: 'Norte', source: 'trip', trip_id: tripId })
			).rejects.toThrow(/visit_from_trip_unique/);
		});

		// The COALESCE in the index is what makes this hold: NULL is not equal to
		// NULL, so a country-only destination would otherwise insert again on
		// every single load of the map.
		it('is written once for a destination with no region', async () => {
			await insertVisit({ country: 'HR', source: 'trip', trip_id: tripId });
			await expect(insertVisit({ country: 'HR', source: 'trip', trip_id: tripId })).rejects.toThrow(
				/visit_from_trip_unique/
			);
		});

		it('survives its trip being deleted', async () => {
			const doomed = uuidv7();
			await harness.sql`insert into trip (id, name, starts_on, ends_on)
				values (${doomed}, 'Deleted', '2020-01-01', '2020-01-05')`;
			const visitId = uuidv7();
			await insertVisit({ id: visitId, country: 'IT', source: 'trip', trip_id: doomed });

			await harness.sql`delete from trip where id = ${doomed}`;

			const [row] = await harness.sql<{ trip_id: string | null }[]>`
				select trip_id from visit where id = ${visitId}`;
			expect(row).toBeDefined();
			expect(row.trip_id).toBeNull();
		});
	});
});

describe('a recipe', () => {
	it('refuses to be for nobody', async () => {
		await expect(
			harness.sql`insert into recipe (id, category_id, name, servings)
				values (${uuidv7()}, ${categoryId}, 'For no one', 0)`
		).rejects.toThrow(/recipe_servings_check/);
	});

	it('will not let its category be deleted out from under it', async () => {
		await harness.sql`insert into recipe (id, category_id, name)
			values (${uuidv7()}, ${categoryId}, 'Soup')`;
		await expect(harness.sql`delete from recipe_category where id = ${categoryId}`).rejects.toThrow(
			/RESTRICT/
		);
	});
});

describe('a tasting', () => {
	it('refuses a score outside 1 to 100', async () => {
		const bottleId = uuidv7();
		await insertBottle({ id: bottleId });
		await expect(
			harness.sql`insert into tasting (id, bottle_id, tasted_on, score)
				values (${uuidv7()}, ${bottleId}, '2026-05-01', 0)`
		).rejects.toThrow(/tasting_score_check/);
		await expect(
			harness.sql`insert into tasting (id, bottle_id, tasted_on, score)
				values (${uuidv7()}, ${bottleId}, '2026-05-01', 101)`
		).rejects.toThrow(/tasting_score_check/);
	});

	it('outlives the person who wrote it', async () => {
		const personId = uuidv7();
		await harness.sql`insert into person (id, name, initials, role)
			values (${personId}, 'Guest', 'G', 'member')`;
		const bottleId = uuidv7();
		await insertBottle({ id: bottleId });
		const tastingId = uuidv7();
		await harness.sql`insert into tasting (id, bottle_id, tasted_on, person_id, score)
			values (${tastingId}, ${bottleId}, '2026-05-01', ${personId}, 92)`;

		await harness.sql`delete from person where id = ${personId}`;

		const [row] = await harness.sql<{ score: number }[]>`
			select score from tasting where id = ${tastingId}`;
		expect(row?.score).toBe(92);
	});

	it('records one flavour note once', async () => {
		const bottleId = uuidv7();
		await insertBottle({ id: bottleId });
		const tastingId = uuidv7();
		await harness.sql`insert into tasting (id, bottle_id, tasted_on)
			values (${tastingId}, ${bottleId}, '2026-05-01')`;
		await harness.sql`insert into tasting_note (id, tasting_id, note, series)
			values (${uuidv7()}, ${tastingId}, 'peat', 'series-r1')`;
		await expect(
			harness.sql`insert into tasting_note (id, tasting_id, note, series)
				values (${uuidv7()}, ${tastingId}, 'peat', 'series-r2')`
		).rejects.toThrow(/tasting_note_unique/);
	});
});
