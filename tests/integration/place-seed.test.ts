// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Seeding is idempotent, and a place that leaves the dataset keeps the record
 * of somebody having seen it — the one way this feature could destroy
 * something a person made.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { place, sightVisit } from '$lib/server/db/schema';
import { applyPlaces, placesFor, type PlaceSeed } from '$lib/server/life/places';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('place-seed', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

const EIFFEL: PlaceSeed = {
	id: 'fr-q243',
	name: 'Eiffel Tower',
	country: 'FR',
	region: 'Île-de-France',
	kind: 'landmark',
	importance: 5,
	latitude: 48.8584,
	longitude: 2.2945,
	sortOrder: 0
};

const COLOSSEUM: PlaceSeed = {
	id: 'it-q10285',
	name: 'Colosseum',
	country: 'IT',
	region: 'Lazio',
	kind: 'historic_site',
	importance: 5,
	latitude: 41.8902,
	longitude: 12.4922,
	sortOrder: 1
};

describe('applyPlaces', () => {
	it('inserts the dataset', async () => {
		expect(await applyPlaces([EIFFEL, COLOSSEUM], harness.db)).toBe(2);
		const [row] = await harness.db.select().from(place).where(eq(place.id, 'fr-q243'));
		expect(row.name).toBe('Eiffel Tower');
		expect(row.region).toBe('Île-de-France');
		expect(row.retired).toBe(false);
	});

	it('is idempotent, and corrections arrive', async () => {
		await applyPlaces([{ ...EIFFEL, name: 'Tour Eiffel' }, COLOSSEUM], harness.db);
		const rows = await harness.db.select().from(place).where(eq(place.id, 'fr-q243'));
		expect(rows).toHaveLength(1);
		// Unlike the bank and category seeds, this one DOES overwrite: nobody
		// edits a place, so a corrected name in a later release should arrive.
		expect(rows[0].name).toBe('Tour Eiffel');
	});

	// The one way this feature could destroy something a person made.
	it('retires a departed place and keeps the record of having seen it', async () => {
		await harness.db
			.insert(sightVisit)
			.values({ id: randomUUID(), placeId: 'fr-q243', year: 2026, seenAt: new Date() });

		await applyPlaces([COLOSSEUM], harness.db);

		const [row] = await harness.db.select().from(place).where(eq(place.id, 'fr-q243'));
		expect(row, 'the place must not be deleted').toBeDefined();
		expect(row.retired).toBe(true);
		const seen = await harness.db.select().from(sightVisit);
		expect(seen, 'the sight visit must survive').toHaveLength(1);
	});

	it('un-retires one that comes back', async () => {
		await applyPlaces([EIFFEL, COLOSSEUM], harness.db);
		const [row] = await harness.db.select().from(place).where(eq(place.id, 'fr-q243'));
		expect(row.retired).toBe(false);
	});

	// An empty file is a build with no dataset, not an instruction to wipe.
	it('retires everything when handed nothing', async () => {
		await applyPlaces([], harness.db);
		const rows = await harness.db.select().from(place);
		expect(rows).toHaveLength(2);
		expect(rows.every((one) => one.retired)).toBe(true);
		await applyPlaces([EIFFEL, COLOSSEUM], harness.db);
	});
});

describe('placesFor', () => {
	it('answers with one country, best first', async () => {
		const rows = await placesFor('FR', harness.db);
		expect(rows.map((one) => one.id)).toEqual(['fr-q243']);
		expect(rows[0].region).toBe('Île-de-France');
	});

	it('is case-insensitive about the country', async () => {
		expect(await placesFor('fr', harness.db)).toHaveLength(1);
	});

	it('leaves retired places out', async () => {
		await applyPlaces([COLOSSEUM], harness.db);
		expect(await placesFor('FR', harness.db)).toEqual([]);
		await applyPlaces([EIFFEL, COLOSSEUM], harness.db);
	});
});
