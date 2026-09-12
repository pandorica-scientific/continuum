// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the map reads, and the one rule that fills it in.
 *
 * **A trip that has ended has been where it said it was going.** That sentence
 * is the whole feature: the household never tells the map anything, it plans a
 * holiday and the map fills in afterwards.
 *
 * The pass runs on READ — when the Trips or Map screen loads — rather than on a
 * timer. There is no scheduler in this product to hang it on, and a household
 * opening the app after a holiday is exactly the moment it should happen. That
 * makes idempotency the load-bearing property: opening the map twice must not
 * visit Portugal twice, which is what the partial unique index in `life.ts`
 * guarantees and what `ON CONFLICT DO NOTHING` here leans on.
 */
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db } from '$lib/server/db';
import { trip, tripDestination, tripMember, visit, visitMember } from '$lib/server/db/schema';

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Write a visit for every destination of every trip that has ended.
 *
 * Safe to call on every page load. Three things make that true:
 *
 * 1. The insert is `ON CONFLICT DO NOTHING` against the partial unique index,
 *    so a destination already recorded is skipped rather than duplicated.
 * 2. It only looks at trips whose end date has passed.
 * 3. It never touches a `manual` visit, so the decade somebody typed in by hand
 *    for the years before Continuum is not rewritten by a trip that happens to
 *    name the same region.
 *
 * It is a SYNC, not an append. A trip edited after it ended — a date corrected,
 * a person added, a destination dropped — moves its visits with it, because
 * "Not right? Edit the trip." is the only correction the Map offers and it has
 * to be one that works.
 */
export async function writeVisitsForEndedTrips(handle: Db = db): Promise<number> {
	const today = todayIso();

	const destinations = await handle
		.select({
			tripId: tripDestination.tripId,
			country: tripDestination.country,
			region: tripDestination.region,
			city: tripDestination.city,
			startsOn: trip.startsOn
		})
		.from(tripDestination)
		.innerJoin(trip, eq(trip.id, tripDestination.tripId))
		.where(lt(trip.endsOn, today));

	const rows = destinations.map((destination) => ({
		id: uuidv7(),
		country: destination.country,
		region: destination.region,
		city: destination.city,
		// The year it STARTED. A trip over New Year belongs to the year it was
		// planned as, which is the year somebody left home.
		year: Number(destination.startsOn.slice(0, 4)),
		tripId: destination.tripId,
		source: 'trip' as const
	}));

	const written = rows.length
		? await handle.insert(visit).values(rows).onConflictDoNothing().returning({ id: visit.id })
		: [];

	// A trip moved to another year after it ended — a date typed wrong, then
	// fixed — has to carry its visits with it. The unique index is keyed by the
	// PLACE, not the year, so `DO NOTHING` above silently kept the old one and
	// the map counted a holiday in a year nobody travelled.
	await handle.execute(sql`
		update ${visit}
		set year = extract(year from t.starts_on)::int
		from ${trip} t
		where t.id = ${visit}.trip_id
		  and ${visit}.source = 'trip'
		  and ${visit}.year <> extract(year from t.starts_on)::int`);

	// Who went is who is on the trip NOW. Reconciled rather than written once:
	// a person added to a trip after it ended was never credited, and a person
	// taken off it stayed credited forever. Both are corrections somebody made
	// on the Trips screen, and both have to reach the map.
	//
	// Only trip-derived visits. A manual visit's members are whoever the
	// household said, and no trip speaks for them.
	await handle.execute(sql`
		delete from ${visitMember} m
		using ${visit} v
		where v.id = m.visit_id
		  and v.source = 'trip'
		  and v.trip_id is not null
		  and not exists (
			select 1 from ${tripMember} tm
			where tm.trip_id = v.trip_id and tm.person_id = m.person_id
		  )`);

	await handle.execute(sql`
		insert into ${visitMember} (visit_id, person_id)
		select v.id, tm.person_id
		from ${visit} v
		join ${tripMember} tm on tm.trip_id = v.trip_id
		where v.source = 'trip' and v.trip_id is not null
		on conflict do nothing`);

	// A destination removed from a trip after it ended is a correction, and the
	// visit it wrote has to go with it — otherwise "Not right? Edit the trip."
	// is an offer the app does not keep. Manual visits are never touched.
	//
	// This runs even when there is nothing to insert, which is the case that
	// matters: a trip whose ONLY destination was removed has no rows left to
	// look at, and an early return here left its visit standing forever.
	await handle.execute(sql`
		delete from ${visit}
		where source = 'trip'
		  and trip_id is not null
		  and not exists (
			select 1 from ${tripDestination} d
			where d.trip_id = ${visit}.trip_id
			  and d.country = ${visit}.country
			  and coalesce(d.region, '') = coalesce(${visit}.region, '')
			  and coalesce(d.city, '') = coalesce(${visit}.city, '')
		  )`);

	return written.length;
}

export interface VisitedRegion {
	country: string;
	regions: Set<string>;
	cities: Set<string>;
	members: Set<string>;
	years: number[];
}

/**
 * Everything the map draws, in one shape.
 *
 * The member filter on the Map screen is a filter over THIS, not a second
 * query: the household view and one person's view have to agree about what
 * counts as visited, and two queries is two chances for them not to.
 */
export async function visitedByCountry(handle: Db = db): Promise<Map<string, VisitedRegion>> {
	const rows = await handle
		.select({
			id: visit.id,
			country: visit.country,
			region: visit.region,
			city: visit.city,
			year: visit.year,
			personId: visitMember.personId
		})
		.from(visit)
		.leftJoin(visitMember, eq(visitMember.visitId, visit.id));

	const byCountry = new Map<string, VisitedRegion>();
	for (const row of rows) {
		let entry = byCountry.get(row.country);
		if (!entry) {
			entry = {
				country: row.country,
				regions: new Set(),
				cities: new Set(),
				members: new Set(),
				years: []
			};
			byCountry.set(row.country, entry);
		}
		if (row.region) entry.regions.add(row.region);
		if (row.city) entry.cities.add(row.city);
		if (row.personId) entry.members.add(row.personId);
		if (!entry.years.includes(row.year)) entry.years.push(row.year);
	}
	for (const entry of byCountry.values()) entry.years.sort((a, b) => a - b);
	return byCountry;
}

export interface CountryRow {
	region: string | null;
	city: string | null;
	year: number;
	personId: string | null;
}

/**
 * Every visit to one country, with who it belonged to.
 *
 * The map's member tabs need this: the household view is the union, and a
 * person's view is their own rows. Asked as one query so the two views cannot
 * disagree about what counts — and it carries the CITY and the YEAR as well as
 * the region, because a member tab that filtered the regions and then printed
 * the household's cities and years underneath was three figures about three
 * different people on one screen.
 */
export async function countryVisits(country: string, handle: Db = db): Promise<CountryRow[]> {
	return handle
		.select({
			region: visit.region,
			city: visit.city,
			year: visit.year,
			personId: visitMember.personId
		})
		.from(visit)
		.leftJoin(visitMember, eq(visitMember.visitId, visit.id))
		.where(eq(visit.country, country.toUpperCase()));
}

export interface PendingReveal {
	visitId: string;
	country: string;
	region: string | null;
	city: string | null;
	year: number;
	tripName: string | null;
	tripId: string | null;
}

/**
 * What the map has not shown yet.
 *
 * Ordered oldest first so a household coming back from two holidays sees them
 * in the order they happened.
 */
export async function pendingReveals(handle: Db = db): Promise<PendingReveal[]> {
	const rows = await handle
		.select({
			visitId: visit.id,
			country: visit.country,
			region: visit.region,
			city: visit.city,
			year: visit.year,
			tripId: visit.tripId,
			tripName: trip.name
		})
		.from(visit)
		.leftJoin(trip, eq(trip.id, visit.tripId))
		.where(isNull(visit.revealedAt))
		.orderBy(visit.year);

	return rows.map((row) => ({ ...row, tripName: row.tripName ?? null }));
}

/** Mark reveals as played, so the scratch happens once and not on every load. */
export async function markRevealed(visitIds: string[], handle: Db = db): Promise<void> {
	if (visitIds.length === 0) return;
	await handle
		.update(visit)
		.set({ revealedAt: new Date() })
		.where(and(inArray(visit.id, visitIds), isNull(visit.revealedAt)));
}

export interface NewVisit {
	country: string;
	region: string | null;
	city: string | null;
	year: number;
	members: string[];
}

/**
 * A place somebody went before Continuum existed, typed in by hand.
 *
 * `source` is `manual`, which is what makes the trip pass above leave it alone
 * forever. It is also already revealed: the household just told the map about
 * it, so playing a scratch animation would be the app performing a discovery
 * it did not make.
 */
export async function addManualVisit(input: NewVisit, handle: Db = db): Promise<string> {
	const id = uuidv7();
	await handle.insert(visit).values({
		id,
		country: input.country.toUpperCase(),
		region: input.region,
		city: input.city,
		year: input.year,
		source: 'manual',
		revealedAt: new Date()
	});
	if (input.members.length) {
		await handle
			.insert(visitMember)
			.values(input.members.map((personId) => ({ visitId: id, personId })));
	}
	return id;
}

export interface MapFigures {
	countries: number;
	regions: number;
	/** Share of the world's countries, as a whole percentage. */
	percentOfWorld: number;
}

/**
 * The three tiles above the map.
 *
 * `total` is how many countries the atlas actually draws, passed in rather than
 * hard-coded: "how many countries there are" is a question with no settled
 * answer, and the only honest denominator is the number this map can show.
 */
export function mapFigures(visited: Map<string, VisitedRegion>, total: number): MapFigures {
	const countries = visited.size;
	let regions = 0;
	for (const entry of visited.values()) regions += entry.regions.size;
	return {
		countries,
		regions,
		percentOfWorld: total > 0 ? Math.round((countries / total) * 100) : 0
	};
}
