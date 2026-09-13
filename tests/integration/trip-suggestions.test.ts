// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a trip suggests seeing.
 *
 * By COUNTRY, not by the regions or cities a trip names. A trip that says only
 * "France" is the common case when one is first created, which is exactly when
 * suggestions are worth having — narrowing to named destinations would offer
 * nothing at the only moment it matters.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tripPlace } from '$lib/server/db/schema';
import { applyPlaces, type PlaceSeed } from '$lib/server/life/places';
import { addPlace, createTrip, suggestedPlaces } from '$lib/server/life/trips';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

let harness: Harness;
let tripId: string;

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

const MONT: PlaceSeed = {
	id: 'fr-q83497',
	name: 'Mont Saint-Michel',
	country: 'FR',
	region: 'Normandie',
	kind: 'historic_site',
	importance: 4,
	latitude: 48.636,
	longitude: -1.5115,
	sortOrder: 1
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
	sortOrder: 2
};

beforeAll(async () => {
	harness = await startPostgres('trip-suggestions', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	await applyPlaces([EIFFEL, MONT, COLOSSEUM], harness.db);

	tripId = await createTrip(
		{
			name: 'France in June',
			emoji: '',
			startsOn: '2026-06-01',
			endsOn: '2026-06-14',
			notes: '',
			destinations: [{ country: 'FR', region: null, city: null }],
			members: [],
			art: null
		},
		harness.db
	);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

describe('suggestedPlaces', () => {
	it('suggests places in the destination country and no others', async () => {
		const suggested = await suggestedPlaces(tripId, harness.db);
		expect(suggested.map((one) => one.id).sort()).toEqual(['fr-q243', 'fr-q83497']);
	});

	it('stops suggesting one that has been added', async () => {
		await addPlace(tripId, 'Eiffel Tower', 'fr-q243', harness.db);
		const suggested = await suggestedPlaces(tripId, harness.db);
		expect(suggested.map((one) => one.id)).toEqual(['fr-q83497']);
	});

	// The list is a record of what somebody planned, not a view onto reference
	// data: it must still read correctly if the place is later retired.
	it('copies the label onto the row rather than joining it', async () => {
		const rows = await harness.db.select().from(tripPlace).where(eq(tripPlace.placeId, 'fr-q243'));
		expect(rows).toHaveLength(1);
		expect(rows[0].label).toBe('Eiffel Tower');
	});

	it('leaves a hand-typed place with no dataset id', async () => {
		const id = await addPlace(tripId, "Aunt Marie's", null, harness.db);
		const [row] = await harness.db.select().from(tripPlace).where(eq(tripPlace.id, id));
		expect(row.placeId).toBeNull();
		// And it does not suppress anything, because it matches no place.
		expect((await suggestedPlaces(tripId, harness.db)).map((one) => one.id)).toEqual(['fr-q83497']);
	});

	it('suggests nothing for a trip with no destinations', async () => {
		const empty = await createTrip(
			{
				name: 'Somewhere',
				emoji: '',
				startsOn: '2026-07-01',
				endsOn: '2026-07-02',
				notes: '',
				destinations: [],
				members: [],
				art: null
			},
			harness.db
		);
		expect(await suggestedPlaces(empty, harness.db)).toEqual([]);
	});
});
