// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Seeing a place, and the one rule that must never break.
 *
 * `visit` answers "have we been to this country or region"; `sight_visit`
 * answers "have we seen this place". Rubbing a coin must touch only the second
 * — the moment it writes a visit, two tables answer one question and can
 * disagree, which is exactly what the rest of the Life area was built to avoid.
 *
 * A rubbed Eiffel Tower over an uncoloured France is therefore correct, not a
 * bug: somebody can see a sight on a layover without counting the country.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sightVisit, visit } from '$lib/server/db/schema';
import { applyPlaces, markSeen, seenIn, unmarkSeen, type PlaceSeed } from '$lib/server/life/places';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

let harness: Harness;

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

beforeAll(async () => {
	harness = await startPostgres('sight-visits', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	await applyPlaces([EIFFEL, COLOSSEUM], harness.db);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

describe('marking a sight seen', () => {
	it('records it and writes NO visit', async () => {
		await markSeen('fr-q243', 2026, harness.db);

		expect(await harness.db.select().from(sightVisit)).toHaveLength(1);
		// The rule the whole design rests on. If this ever fails, the separation
		// has collapsed and two tables answer "have we been to France".
		expect(await harness.db.select().from(visit), 'a sight must not write a visit').toHaveLength(0);
	});

	it('is the same fact twice', async () => {
		await markSeen('fr-q243', 2026, harness.db);
		expect(await harness.db.select().from(sightVisit)).toHaveLength(1);
	});

	it('refuses a place that does not exist rather than raising', async () => {
		// The id comes off a form. Letting an unknown one reach the insert turns a
		// request that should be refused with a reason into a foreign-key
		// violation and a 500.
		expect(await markSeen('fr-q000000', 2026, harness.db)).toBe(false);
		expect(await harness.db.select().from(sightVisit)).toHaveLength(1);
	});

	it('reports which places in a country have been seen', async () => {
		expect(await seenIn('FR', harness.db)).toEqual(['fr-q243']);
		expect(await seenIn('IT', harness.db)).toEqual([]);
	});

	it('can be taken back', async () => {
		await unmarkSeen('fr-q243', harness.db);
		expect(await harness.db.select().from(sightVisit)).toHaveLength(0);
		expect(await seenIn('FR', harness.db)).toEqual([]);
	});

	it('taking back one that was never seen is not an error', async () => {
		await expect(unmarkSeen('it-q10285', harness.db)).resolves.toBeUndefined();
	});
});
