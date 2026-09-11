// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reading and writing trips, the idea board, and what a trip is made of.
 *
 * The screens call these; no `+page.server.ts` writes SQL of its own. Anything
 * derived — nights, whether a trip is upcoming, which year it belongs to — is
 * computed here rather than in the component, so the list and the detail page
 * cannot disagree about the same trip.
 */
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db } from '$lib/server/db';
import {
	person,
	trip,
	tripBooking,
	tripDestination,
	tripIdea,
	tripIdeaHeart,
	tripMember,
	tripPlace
} from '$lib/server/db/schema';
import { document } from '$lib/server/db/schema';
import type { EnumValue } from '$lib/enums';
import {
	parseStoredStamp,
	resolveStamp,
	stampHue,
	stampSvg,
	type ArtDefinition
} from '$lib/life/art';
import { orderBookings, type OrderableBooking } from '$lib/life/trips/booking-order';
import { insertDocumentAggregate } from '$lib/server/documents/mutations';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';

export interface TripPerson {
	id: string;
	name: string;
	initials: string;
}

export interface TripDestinationView {
	country: string;
	region: string | null;
	city: string | null;
	/** Where a reader would say it: "Porto, Portugal". */
	label: string;
}

export interface TripView {
	id: string;
	name: string;
	emoji: string;
	startsOn: string;
	endsOn: string;
	notes: string;
	/** Whole nights away, which is what the tile counts. */
	nights: number;
	/** The year the stamp wall files it under: the year it STARTED. */
	year: number;
	upcoming: boolean;
	destinations: TripDestinationView[];
	members: TripPerson[];
	/** The stamp, already inked in its destination country's colour. */
	stamp: { svg: string; hue: string | null } | null;
}

export interface BookingView {
	id: string;
	kind: EnumValue<'booking.kind'>;
	title: string;
	startsAt: Date;
	endsAt: Date | null;
	reference: string;
	documentId: string | null;
	/** What the attached confirmation is called, for the row to name it. */
	documentName: string | null;
}

export interface PlaceView {
	id: string;
	label: string;
	done: boolean;
}

export interface IdeaView {
	id: string;
	name: string;
	emoji: string;
	note: string;
	country: string | null;
	hearts: TripPerson[];
	art: { svg: string; hue: string | null } | null;
}

/**
 * Nights, not days.
 *
 * A trip that leaves on the 1st and comes back on the 8th is seven nights,
 * which is both what a hotel counts and what a person says. Dates are ISO days
 * with no time, so this is exact arithmetic rather than a duration that has to
 * worry about when the clocks change.
 */
export function nightsBetween(startsOn: string, endsOn: string): number {
	const start = Date.parse(`${startsOn}T00:00:00Z`);
	const end = Date.parse(`${endsOn}T00:00:00Z`);
	return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** "Porto, Portugal" — the city when there is one, then the country. */
export function destinationLabel(
	destination: { country: string; region: string | null; city: string | null },
	countryName: (code: string) => string
): string {
	const place = destination.city ?? destination.region;
	const country = countryName(destination.country);
	return place ? `${place}, ${country}` : country;
}

const artOf = (
	art: unknown,
	country: string | null,
	name = ''
): { svg: string; hue: string | null } | null => {
	if (!art || typeof art !== 'object') return null;
	try {
		return { svg: stampSvg(art as ArtDefinition), hue: stampHue(country, name) };
	} catch {
		// A definition written by an older version of the generator that this one
		// cannot draw. The card falls back to its "no stamp yet" state, which is
		// a great deal better than a screen that will not render.
		return null;
	}
};

/** Everyone on a set of trips, in one query rather than one per trip. */
async function membersByTrip(tripIds: string[], handle: Db): Promise<Map<string, TripPerson[]>> {
	if (tripIds.length === 0) return new Map();
	const rows = await handle
		.select({
			tripId: tripMember.tripId,
			id: person.id,
			name: person.name,
			initials: person.initials
		})
		.from(tripMember)
		.innerJoin(person, eq(person.id, tripMember.personId))
		.where(inArray(tripMember.tripId, tripIds))
		.orderBy(asc(person.name));

	const byTrip = new Map<string, TripPerson[]>();
	for (const row of rows) {
		const list = byTrip.get(row.tripId) ?? [];
		list.push({ id: row.id, name: row.name, initials: row.initials });
		byTrip.set(row.tripId, list);
	}
	return byTrip;
}

async function destinationsByTrip(
	tripIds: string[],
	handle: Db
): Promise<Map<string, TripDestinationView[]>> {
	if (tripIds.length === 0) return new Map();
	const rows = await handle
		.select()
		.from(tripDestination)
		.where(inArray(tripDestination.tripId, tripIds))
		.orderBy(asc(tripDestination.tripId), asc(tripDestination.ordinal));

	const byTrip = new Map<string, TripDestinationView[]>();
	for (const row of rows) {
		const list = byTrip.get(row.tripId) ?? [];
		list.push({
			country: row.country,
			region: row.region,
			city: row.city,
			label: ''
		});
		byTrip.set(row.tripId, list);
	}
	return byTrip;
}

function toView(
	row: typeof trip.$inferSelect,
	destinations: TripDestinationView[],
	members: TripPerson[],
	today: string
): TripView {
	return {
		id: row.id,
		name: row.name,
		emoji: row.emoji,
		startsOn: row.startsOn,
		endsOn: row.endsOn,
		notes: row.notes,
		nights: nightsBetween(row.startsOn, row.endsOn),
		year: Number(row.startsOn.slice(0, 4)),
		// A trip is upcoming until the day it ends, not until the day it starts:
		// somebody looking at the app from a hotel is still on their holiday.
		upcoming: row.endsOn >= today,
		destinations,
		members,
		stamp: artOf(row.art, destinations[0]?.country ?? null, row.name)
	};
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Every trip, newest first, with what each one needs to draw a row. */
export async function listTrips(handle: Db = db): Promise<TripView[]> {
	const rows = await handle.select().from(trip).orderBy(desc(trip.startsOn));
	const ids = rows.map((row) => row.id);
	const [destinations, members] = await Promise.all([
		destinationsByTrip(ids, handle),
		membersByTrip(ids, handle)
	]);
	const today = todayIso();
	return rows.map((row) =>
		toView(row, destinations.get(row.id) ?? [], members.get(row.id) ?? [], today)
	);
}

export interface TripDetail extends TripView {
	bookings: BookingView[];
	places: PlaceView[];
}

export async function loadTrip(id: string, handle: Db = db): Promise<TripDetail | null> {
	const [row] = await handle.select().from(trip).where(eq(trip.id, id));
	if (!row) return null;

	const [destinations, members, bookings, places] = await Promise.all([
		destinationsByTrip([id], handle),
		membersByTrip([id], handle),
		handle
			.select({
				id: tripBooking.id,
				kind: tripBooking.kind,
				title: tripBooking.title,
				startsAt: tripBooking.startsAt,
				endsAt: tripBooking.endsAt,
				reference: tripBooking.reference,
				documentId: tripBooking.documentId,
				documentName: document.name
			})
			.from(tripBooking)
			.leftJoin(document, eq(document.id, tripBooking.documentId))
			.where(eq(tripBooking.tripId, id)),
		handle.select().from(tripPlace).where(eq(tripPlace.tripId, id)).orderBy(asc(tripPlace.ordinal))
	]);

	const view = toView(row, destinations.get(id) ?? [], members.get(id) ?? [], todayIso());
	return {
		...view,
		// Travel order, which is not the order they were typed in — see
		// `booking-order.ts` for why a flight sorts before the hotel it delivers
		// you to when the two share a moment.
		bookings: orderBookings(bookings as OrderableBooking[]) as BookingView[],
		places: places.map((place) => ({ id: place.id, label: place.label, done: place.done }))
	};
}

/** The idea board, in the household's own order. */
export async function listIdeas(handle: Db = db): Promise<IdeaView[]> {
	const rows = await handle
		.select()
		.from(tripIdea)
		.orderBy(asc(tripIdea.sortOrder), asc(tripIdea.createdAt));
	if (rows.length === 0) return [];

	const hearts = await handle
		.select({
			ideaId: tripIdeaHeart.ideaId,
			id: person.id,
			name: person.name,
			initials: person.initials
		})
		.from(tripIdeaHeart)
		.innerJoin(person, eq(person.id, tripIdeaHeart.personId))
		.where(
			inArray(
				tripIdeaHeart.ideaId,
				rows.map((row) => row.id)
			)
		)
		.orderBy(asc(person.name));

	const byIdea = new Map<string, TripPerson[]>();
	for (const heart of hearts) {
		const list = byIdea.get(heart.ideaId) ?? [];
		list.push({ id: heart.id, name: heart.name, initials: heart.initials });
		byIdea.set(heart.ideaId, list);
	}

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		emoji: row.emoji,
		note: row.note,
		country: row.country,
		hearts: byIdea.get(row.id) ?? [],
		art: artOf(row.art, row.country, row.name)
	}));
}

export interface TripFigures {
	upcoming: number;
	/** Days until the next trip starts, or null when none is booked. */
	nextInDays: number | null;
	nightsBooked: number;
	ideas: number;
	/** Ideas both members have hearted — the ones actually agreed on. */
	ideasHeartedByAll: number;
}

/**
 * The four figures at the top of the screen.
 *
 * One query each rather than one clever one: they are read together and never
 * written, and a single query joining four unrelated things is what makes a
 * summary band hard to change later.
 */
export async function tripFigures(handle: Db = db): Promise<TripFigures> {
	const today = todayIso();
	const [upcoming, ideaCount, agreed, people] = await Promise.all([
		handle
			.select({ startsOn: trip.startsOn, endsOn: trip.endsOn })
			.from(trip)
			.where(gte(trip.endsOn, today))
			.orderBy(asc(trip.startsOn)),
		handle.select({ n: sql<number>`count(*)::int` }).from(tripIdea),
		handle.select({ n: sql<number>`count(*)::int` }).from(
			handle
				.select({ ideaId: tripIdeaHeart.ideaId })
				.from(tripIdeaHeart)
				.groupBy(tripIdeaHeart.ideaId)
				.having(sql`count(*) = (select count(*) from ${person})`)
				.as('agreed')
		),
		handle.select({ n: sql<number>`count(*)::int` }).from(person)
	]);

	const next = upcoming.find((row) => row.startsOn >= today) ?? upcoming[0];
	return {
		upcoming: upcoming.length,
		nextInDays: next ? nightsBetween(today, next.startsOn) : null,
		nightsBooked: upcoming.reduce((sum, row) => sum + nightsBetween(row.startsOn, row.endsOn), 0),
		ideas: ideaCount[0]?.n ?? 0,
		// With nobody in the household, "hearted by everyone" is every idea, which
		// is not a fact worth reporting.
		ideasHeartedByAll: (people[0]?.n ?? 0) > 0 ? (agreed[0]?.n ?? 0) : 0
	};
}

// ---- Writes ----

export async function removeIdea(id: string, handle: Db = db): Promise<void> {
	await handle.delete(tripIdea).where(eq(tripIdea.id, id));
}

/**
 * Does this idea still exist?
 *
 * Asked before a trip records where it came from. `trip.from_idea_id` is a real
 * foreign key, so a stale or forged id does not fail quietly — it rejects the
 * whole insert, and a household loses the trip it was trying to make over a
 * field it never filled in.
 */
export async function ideaExists(id: string | undefined, handle: Db = db): Promise<boolean> {
	if (!id) return false;
	const [row] = await handle
		.select({ id: tripIdea.id })
		.from(tripIdea)
		.where(eq(tripIdea.id, id))
		.limit(1);
	return Boolean(row);
}

export interface NewIdea {
	name: string;
	emoji: string;
	note: string;
	country: string | null;
	hearts: string[];
	/**
	 * The definition the dialog previewed, as it came off the form.
	 *
	 * Kept only if it renders — `parseStoredStamp` re-renders it, which also
	 * runs the inertness check — so what the household saw is what is stored.
	 * Anything missing or strange falls back to resolving one here, and the
	 * household sees the stamp the app would have chosen anyway.
	 */
	art?: unknown;
}

export async function addIdea(input: NewIdea, handle: Db = db): Promise<string> {
	const id = uuidv7();
	const [last] = await handle
		.select({ sortOrder: tripIdea.sortOrder })
		.from(tripIdea)
		.orderBy(desc(tripIdea.sortOrder))
		.limit(1);

	await handle.insert(tripIdea).values({
		id,
		name: input.name,
		emoji: input.emoji,
		note: input.note,
		country: input.country,
		sortOrder: (last?.sortOrder ?? -1) + 1,
		// Stored once, here — so renaming the idea later does not silently
		// repaint it.
		art: parseStoredStamp(input.art) ?? resolveStamp({ name: input.name, country: input.country })
	});
	if (input.hearts.length) {
		await handle
			.insert(tripIdeaHeart)
			.values(input.hearts.map((personId) => ({ ideaId: id, personId })));
	}
	return id;
}

/** Add or remove one person's heart, which is the only edit a heart has. */
export async function toggleHeart(
	ideaId: string,
	personId: string,
	handle: Db = db
): Promise<void> {
	const existing = await handle
		.select({ ideaId: tripIdeaHeart.ideaId })
		.from(tripIdeaHeart)
		.where(and(eq(tripIdeaHeart.ideaId, ideaId), eq(tripIdeaHeart.personId, personId)));

	if (existing.length) {
		await handle
			.delete(tripIdeaHeart)
			.where(and(eq(tripIdeaHeart.ideaId, ideaId), eq(tripIdeaHeart.personId, personId)));
		return;
	}
	await handle.insert(tripIdeaHeart).values({ ideaId, personId });
}

export interface NewTrip {
	name: string;
	emoji: string;
	startsOn: string;
	endsOn: string;
	notes: string;
	destinations: { country: string; region: string | null; city: string | null }[];
	members: string[];
	/** Set when the trip was promoted from an idea, which is then taken off the board. */
	fromIdeaId?: string | null;
	/** The definition the dialog previewed. See `NewIdea.art`. */
	art?: unknown;
}

export async function createTrip(input: NewTrip, handle: Db = db): Promise<string> {
	const id = uuidv7();
	const first = input.destinations[0];
	await handle.insert(trip).values({
		id,
		name: input.name,
		emoji: input.emoji,
		startsOn: input.startsOn,
		endsOn: input.endsOn,
		notes: input.notes,
		fromIdeaId: input.fromIdeaId ?? null,
		art:
			parseStoredStamp(input.art) ??
			resolveStamp({
				name: input.name,
				country: first?.country ?? null,
				city: first?.city ?? null
			})
	});
	if (input.destinations.length) {
		await handle.insert(tripDestination).values(
			input.destinations.map((destination, ordinal) => ({
				id: uuidv7(),
				tripId: id,
				ordinal,
				country: destination.country,
				region: destination.region,
				city: destination.city
			}))
		);
	}
	if (input.members.length) {
		await handle
			.insert(tripMember)
			.values(input.members.map((personId) => ({ tripId: id, personId })));
	}
	return id;
}

export async function deleteTrip(id: string, handle: Db = db): Promise<void> {
	await handle.delete(trip).where(eq(trip.id, id));
}

export interface TripEdit {
	name: string;
	emoji: string;
	startsOn: string;
	endsOn: string;
	destinations: { country: string; region: string | null; city: string | null }[];
	members: string[];
}

/**
 * Change a trip's head: its name, its dates, where it goes, who is going.
 *
 * Destinations and members are REPLACED rather than merged. Both are short
 * lists the household edits as a whole — "actually we are not going to Lisbon
 * after all" — and a merge would need a per-row identity the form does not
 * have. The artwork is deliberately left alone: it was resolved once and
 * stored, and renaming a trip must not silently repaint its stamp.
 */
export async function updateTrip(id: string, input: TripEdit, handle: Db = db): Promise<void> {
	await handle.transaction(async (tx) => {
		await tx
			.update(trip)
			.set({
				name: input.name,
				emoji: input.emoji,
				startsOn: input.startsOn,
				endsOn: input.endsOn
			})
			.where(eq(trip.id, id));

		await tx.delete(tripDestination).where(eq(tripDestination.tripId, id));
		if (input.destinations.length) {
			await tx.insert(tripDestination).values(
				input.destinations.map((destination, ordinal) => ({
					id: uuidv7(),
					tripId: id,
					ordinal,
					country: destination.country,
					region: destination.region,
					city: destination.city
				}))
			);
		}

		await tx.delete(tripMember).where(eq(tripMember.tripId, id));
		if (input.members.length) {
			await tx
				.insert(tripMember)
				.values(input.members.map((personId) => ({ tripId: id, personId })));
		}
	});
}

/** Free text on the trip, saved on its own so the head can be edited separately. */
export async function saveNotes(id: string, notes: string, handle: Db = db): Promise<void> {
	await handle.update(trip).set({ notes }).where(eq(trip.id, id));
}

export interface NewBooking {
	tripId: string;
	kind: EnumValue<'booking.kind'>;
	title: string;
	/** An ISO day and a time, as the form gives them. */
	startsOn: string;
	startsAt: string;
	/** A stay's last day. Only meaningful for something you sleep in. */
	endsOn?: string | null;
	reference: string;
}

/**
 * Add a flight, a room, a train.
 *
 * The date and the time arrive as two fields because that is how a
 * confirmation reads them out, and they are combined here rather than in the
 * component so the timeline and the form cannot disagree about what "the 5th
 * at nine" means. Stored as an instant, in UTC: a trip crosses time zones and
 * a wall clock with no zone is a time nobody can check against a boarding pass.
 */
export async function addBooking(input: NewBooking, handle: Db = db): Promise<string> {
	const id = uuidv7();
	await handle.insert(tripBooking).values({
		id,
		tripId: input.tripId,
		kind: input.kind,
		title: input.title,
		startsAt: new Date(`${input.startsOn}T${input.startsAt || '00:00'}:00Z`),
		endsAt: input.endsOn ? new Date(`${input.endsOn}T11:00:00Z`) : null,
		reference: input.reference
	});
	return id;
}

export async function deleteBooking(id: string, handle: Db = db): Promise<void> {
	await handle.delete(tripBooking).where(eq(tripBooking.id, id));
}

/**
 * Attach a confirmation to a booking.
 *
 * The file goes into the ARCHIVE, not into a private corner of the Life area.
 * It is a real document filed on a shelf, linked to the trip, and searchable
 * with every other piece of paper the household keeps — which is what the
 * archive is for, and is why `trip` is an entity: `document_link` takes entity
 * ids, so the link costs nothing extra.
 *
 * The booking then points at it directly as well. The two answer different
 * questions: the link says "this PDF is about that trip", the column says
 * "this is THIS flight's confirmation", and a trip with five documents needs
 * both to know which is which.
 */
export async function attachBookingFile(
	input: {
		bookingId: string;
		tripId: string;
		name: string;
		storedName: string;
		contentHash: string;
		ext: string;
	},
	handle: Db = db
): Promise<string> {
	const documentId = uuidv7();
	// Read before the transaction opens: a lookup inside the callback would be a
	// second round trip holding the transaction open for no reason.
	//
	// The registry, not the literal: `SYSTEM_SHELF_KEYS` is the one place a
	// written-to shelf is named, so renaming one stays a one-line change, and
	// `shelf-keys.test.ts` catches a writer that spells it out.
	const shelfId = await shelfIdByKey(SYSTEM_SHELF_KEYS.inbox, handle);

	// `insertDocumentAggregate` rather than `createDocument`, because the latter
	// also queues the document for text extraction. A travel confirmation is
	// read by the person holding it and never searched for its contents, so
	// putting every boarding pass through OCR would be work nobody asked for,
	// competing with the statements that do need it. The file is still filed,
	// still linked, and still opens.
	await handle.transaction((tx) =>
		insertDocumentAggregate(
			{
				id: documentId,
				name: input.name,
				shelfId,
				// `other` rather than a guess: a booking confirmation is not one of the
				// seventeen shapes the archive knows, and mislabelling it as a receipt
				// would put it in front of the wrong readers.
				type: 'other',
				note: null,
				storedName: input.storedName,
				ext: input.ext,
				addedOn: todayIso(),
				expiresOn: null,
				expiryVerb: 'expires',
				targetIds: [input.tripId],
				tagNames: [],
				contentHash: input.contentHash
			},
			tx
		)
	);

	await handle.update(tripBooking).set({ documentId }).where(eq(tripBooking.id, input.bookingId));
	return documentId;
}

/**
 * Unhook a confirmation from its booking.
 *
 * The document itself is left in the archive. Deleting somebody's paper because
 * they corrected which flight it belonged to would be a surprise, and the
 * Documents screen is where deleting a document belongs.
 */
export async function detachBookingFile(id: string, handle: Db = db): Promise<void> {
	await handle.update(tripBooking).set({ documentId: null }).where(eq(tripBooking.id, id));
}

/** Something to see, added to the end of the list. */
export async function addPlace(tripId: string, label: string, handle: Db = db): Promise<string> {
	const id = uuidv7();
	const [last] = await handle
		.select({ ordinal: tripPlace.ordinal })
		.from(tripPlace)
		.where(eq(tripPlace.tripId, tripId))
		.orderBy(desc(tripPlace.ordinal))
		.limit(1);

	await handle.insert(tripPlace).values({
		id,
		tripId,
		ordinal: (last?.ordinal ?? -1) + 1,
		label,
		done: false
	});
	return id;
}

export async function deletePlace(id: string, handle: Db = db): Promise<void> {
	await handle.delete(tripPlace).where(eq(tripPlace.id, id));
}

/** Tick or untick one of the things to see. */
export async function togglePlace(id: string, handle: Db = db): Promise<void> {
	await handle
		.update(tripPlace)
		.set({ done: sql`not ${tripPlace.done}` })
		.where(eq(tripPlace.id, id));
}

/** Trips that have ended, for the pass that writes their visits. */
export async function endedTrips(handle: Db = db) {
	return handle.select().from(trip).where(lt(trip.endsOn, todayIso()));
}
