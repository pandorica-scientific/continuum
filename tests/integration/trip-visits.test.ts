// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A trip that has ended has been where it said it was going.
 *
 * The pass runs on every load of the Trips and Map screens, so "safe to run
 * again" is not a nicety here — it is the only thing standing between a
 * household and Portugal appearing on its map forty times.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';
import {
	addManualVisit,
	markRevealed,
	mapFigures,
	pendingReveals,
	visitedByCountry,
	writeVisitsForEndedTrips
} from '$lib/server/life/visits';

let harness: Harness;
let jana: string;
let petr: string;

const DAY = 86_400_000;
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

beforeAll(async () => {
	harness = await startPostgres('trip-visits', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	jana = uuidv7();
	petr = uuidv7();
	await harness.sql`insert into person (id, name, initials, role)
		values (${jana}, 'Jana', 'J', 'admin'), (${petr}, 'Petr', 'P', 'member')`;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from visit`;
	await harness.sql`delete from trip`;
});

/** A trip, its destinations and its members, in one call. */
async function makeTrip(options: {
	name?: string;
	startsIn: number;
	nights: number;
	destinations: { country: string; region?: string; city?: string }[];
	members?: string[];
}): Promise<string> {
	const id = uuidv7();
	await harness.sql`insert into trip (id, name, starts_on, ends_on)
		values (${id}, ${options.name ?? 'A trip'},
			${isoDay(options.startsIn)}, ${isoDay(options.startsIn + options.nights)})`;
	for (const [ordinal, destination] of options.destinations.entries()) {
		await harness.sql`insert into trip_destination (id, trip_id, ordinal, country, region, city)
			values (${uuidv7()}, ${id}, ${ordinal}, ${destination.country},
				${destination.region ?? null}, ${destination.city ?? null})`;
	}
	for (const personId of options.members ?? [jana, petr]) {
		await harness.sql`insert into trip_member (trip_id, person_id) values (${id}, ${personId})`;
	}
	return id;
}

const visitCount = async (): Promise<number> => {
	const [row] = await harness.sql<{ n: string }[]>`select count(*)::text as n from visit`;
	return Number(row.n);
};

describe('writing visits for trips that have ended', () => {
	it('writes nothing for a trip still to come', async () => {
		await makeTrip({ startsIn: 30, nights: 7, destinations: [{ country: 'PT' }] });
		await writeVisitsForEndedTrips(harness.db);
		expect(await visitCount()).toBe(0);
	});

	it('writes nothing for a trip somebody is still on', async () => {
		// Ends today. A person looking at the app from the hotel has not come
		// home yet, and the map should not have scratched itself behind them.
		await makeTrip({ startsIn: -3, nights: 3, destinations: [{ country: 'PT' }] });
		await writeVisitsForEndedTrips(harness.db);
		expect(await visitCount()).toBe(0);
	});

	it('writes one visit per destination of a trip that has ended', async () => {
		await makeTrip({
			startsIn: -30,
			nights: 7,
			destinations: [
				{ country: 'PT', region: 'Porto', city: 'Porto' },
				{ country: 'PT', region: 'Vila Real' }
			]
		});
		await writeVisitsForEndedTrips(harness.db);
		expect(await visitCount()).toBe(2);
	});

	// The whole reason the pass may run on a page load.
	it('writes nothing the second time it runs', async () => {
		await makeTrip({
			startsIn: -30,
			nights: 7,
			destinations: [{ country: 'PT', region: 'Porto' }]
		});
		await writeVisitsForEndedTrips(harness.db);
		await writeVisitsForEndedTrips(harness.db);
		await writeVisitsForEndedTrips(harness.db);
		expect(await visitCount()).toBe(1);
	});

	// NULL is not equal to NULL, so without the COALESCE in the index this one
	// inserts again on every single load. It is the bug the index exists for.
	it('writes nothing the second time for a destination with no region', async () => {
		await makeTrip({ startsIn: -30, nights: 7, destinations: [{ country: 'HR' }] });
		await writeVisitsForEndedTrips(harness.db);
		await writeVisitsForEndedTrips(harness.db);
		expect(await visitCount()).toBe(1);
	});

	it('records who went', async () => {
		await makeTrip({
			startsIn: -30,
			nights: 4,
			destinations: [{ country: 'ES' }],
			members: [jana]
		});
		await writeVisitsForEndedTrips(harness.db);
		const rows = await harness.sql<{ person_id: string }[]>`select person_id from visit_member`;
		expect(rows.map((row) => row.person_id)).toEqual([jana]);
	});

	it('takes back a visit when the destination is corrected away', async () => {
		const tripId = await makeTrip({
			startsIn: -30,
			nights: 4,
			destinations: [
				{ country: 'PT', region: 'Porto' },
				{ country: 'PT', region: 'Lisbon' }
			]
		});
		await writeVisitsForEndedTrips(harness.db);
		expect(await visitCount()).toBe(2);

		// "Not right? Edit the trip." — the offer the map makes has to be kept.
		await harness.sql`delete from trip_destination
			where trip_id = ${tripId} and region = 'Lisbon'`;
		await writeVisitsForEndedTrips(harness.db);

		const rows = await harness.sql<{ region: string }[]>`select region from visit`;
		expect(rows.map((row) => row.region)).toEqual(['Porto']);
	});

	it('leaves a hand-typed visit alone when a trip names the same place', async () => {
		await addManualVisit(
			{ country: 'PT', region: 'Porto', city: null, year: 2015, members: [jana] },
			harness.db
		);
		const tripId = await makeTrip({
			startsIn: -30,
			nights: 4,
			destinations: [{ country: 'PT', region: 'Porto' }]
		});
		await writeVisitsForEndedTrips(harness.db);
		expect(await visitCount()).toBe(2);

		// Correcting the trip must not take the hand-typed one with it.
		await harness.sql`delete from trip_destination where trip_id = ${tripId}`;
		await writeVisitsForEndedTrips(harness.db);

		const rows = await harness.sql<{ source: string; year: number }[]>`
			select source, year from visit`;
		expect(rows).toEqual([{ source: 'manual', year: 2015 }]);
	});

	// A trip edited after it ended is a correction, and the pass is a SYNC. The
	// three things a household can change are the dates, the people and the
	// places; the places already have a test above, and these are the other two.
	it('moves the visit to the new year when the dates are corrected', async () => {
		const id = uuidv7();
		await harness.sql`insert into trip (id, name, starts_on, ends_on)
			values (${id}, 'Mistyped', '2023-06-01', '2023-06-08')`;
		await harness.sql`insert into trip_destination (id, trip_id, ordinal, country)
			values (${uuidv7()}, ${id}, 0, 'GR')`;
		await writeVisitsForEndedTrips(harness.db);

		// The unique index is keyed by the PLACE, so the re-insert is skipped and
		// the year has to be corrected in its own right.
		await harness.sql`update trip set starts_on = '2024-06-01', ends_on = '2024-06-08'
			where id = ${id}`;
		await writeVisitsForEndedTrips(harness.db);

		const rows = await harness.sql<{ year: number }[]>`select year from visit`;
		expect(rows).toEqual([{ year: 2024 }]);
	});

	it('credits somebody added to the trip after it ended', async () => {
		const tripId = await makeTrip({
			startsIn: -30,
			nights: 4,
			destinations: [{ country: 'NO' }],
			members: [jana]
		});
		await writeVisitsForEndedTrips(harness.db);

		await harness.sql`insert into trip_member (trip_id, person_id) values (${tripId}, ${petr})`;
		await writeVisitsForEndedTrips(harness.db);

		const rows = await harness.sql<{ person_id: string }[]>`
			select person_id from visit_member order by person_id`;
		expect(rows.map((row) => row.person_id).sort()).toEqual([jana, petr].sort());
	});

	it('stops crediting somebody taken off the trip', async () => {
		const tripId = await makeTrip({
			startsIn: -30,
			nights: 4,
			destinations: [{ country: 'SE' }],
			members: [jana, petr]
		});
		await writeVisitsForEndedTrips(harness.db);

		await harness.sql`delete from trip_member where trip_id = ${tripId} and person_id = ${petr}`;
		await writeVisitsForEndedTrips(harness.db);

		const rows = await harness.sql<{ person_id: string }[]>`select person_id from visit_member`;
		expect(rows.map((row) => row.person_id)).toEqual([jana]);
	});

	// A trip speaks for its own visits and nobody else's.
	it('leaves a hand-typed visit its own members', async () => {
		await addManualVisit(
			{ country: 'DK', region: null, city: null, year: 2019, members: [petr] },
			harness.db
		);
		await makeTrip({
			startsIn: -30,
			nights: 4,
			destinations: [{ country: 'DK' }],
			members: [jana]
		});
		await writeVisitsForEndedTrips(harness.db);

		const rows = await harness.sql<{ source: string; person_id: string }[]>`
			select v.source, m.person_id from visit v join visit_member m on m.visit_id = v.id`;
		expect(rows.find((row) => row.source === 'manual')?.person_id).toBe(petr);
		expect(rows.find((row) => row.source === 'trip')?.person_id).toBe(jana);
	});

	it('files a trip under the year it started, not the year it ended', async () => {
		const id = uuidv7();
		await harness.sql`insert into trip (id, name, starts_on, ends_on)
			values (${id}, 'New Year', '2024-12-28', '2025-01-03')`;
		await harness.sql`insert into trip_destination (id, trip_id, ordinal, country)
			values (${uuidv7()}, ${id}, 0, 'AT')`;
		await writeVisitsForEndedTrips(harness.db);

		const [row] = await harness.sql<{ year: number }[]>`select year from visit`;
		expect(row.year).toBe(2024);
	});
});

describe('what the map reads', () => {
	it('folds visits into one entry per country', async () => {
		await makeTrip({
			startsIn: -30,
			nights: 7,
			destinations: [
				{ country: 'PT', region: 'Porto', city: 'Porto' },
				{ country: 'PT', region: 'Vila Real' },
				{ country: 'ES', region: 'Galicia' }
			]
		});
		await writeVisitsForEndedTrips(harness.db);

		const visited = await visitedByCountry(harness.db);
		expect([...visited.keys()].sort()).toEqual(['ES', 'PT']);
		expect(visited.get('PT')?.regions).toEqual(new Set(['Porto', 'Vila Real']));
		expect(visited.get('PT')?.cities).toEqual(new Set(['Porto']));
		expect(visited.get('PT')?.members).toEqual(new Set([jana, petr]));
	});

	it('counts a country once however many times it was visited', async () => {
		await makeTrip({ startsIn: -400, nights: 4, destinations: [{ country: 'IT' }] });
		await makeTrip({
			startsIn: -30,
			nights: 4,
			destinations: [{ country: 'IT', region: 'Lazio' }]
		});
		await writeVisitsForEndedTrips(harness.db);

		const visited = await visitedByCountry(harness.db);
		expect(mapFigures(visited, 241).countries).toBe(1);
		expect(visited.get('IT')?.years.length).toBe(2);
	});

	it('reports a share of the countries the atlas can actually draw', async () => {
		await makeTrip({ startsIn: -30, nights: 2, destinations: [{ country: 'PT' }] });
		await writeVisitsForEndedTrips(harness.db);
		const visited = await visitedByCountry(harness.db);
		expect(mapFigures(visited, 200).percentOfWorld).toBe(1);
		// Nothing to divide by is nothing to report, not a crash.
		expect(mapFigures(visited, 0).percentOfWorld).toBe(0);
	});
});

describe('the reveal', () => {
	it('offers a new visit once, and not again', async () => {
		await makeTrip({
			startsIn: -30,
			nights: 4,
			destinations: [{ country: 'HR', region: 'Split-Dalmatia' }],
			members: [jana]
		});
		await writeVisitsForEndedTrips(harness.db);

		const pending = await pendingReveals(harness.db);
		expect(pending).toHaveLength(1);
		expect(pending[0].country).toBe('HR');
		expect(pending[0].tripName).toBe('A trip');

		await markRevealed(
			pending.map((row) => row.visitId),
			harness.db
		);
		expect(await pendingReveals(harness.db)).toHaveLength(0);
	});

	it('never offers a hand-typed visit — the household already knows', async () => {
		await addManualVisit(
			{ country: 'FR', region: 'Île-de-France', city: 'Paris', year: 2018, members: [petr] },
			harness.db
		);
		expect(await pendingReveals(harness.db)).toHaveLength(0);
	});

	it('shows the oldest first, so two holidays play in the order they happened', async () => {
		await makeTrip({
			name: 'Older',
			startsIn: -400,
			nights: 3,
			destinations: [{ country: 'SK' }]
		});
		await makeTrip({
			name: 'Newer',
			startsIn: -20,
			nights: 3,
			destinations: [{ country: 'PL' }]
		});
		await writeVisitsForEndedTrips(harness.db);

		const pending = await pendingReveals(harness.db);
		expect(pending.map((row) => row.tripName)).toEqual(['Older', 'Newer']);
	});
});
