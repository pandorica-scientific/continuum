// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reading and writing trips, the idea board, and what a trip is made of.
 *
 * The screens call these; no `+page.server.ts` writes SQL of its own. Anything
 * derived — nights, whether a trip is upcoming, which year it belongs to — is
 * computed here rather than in the component, so the list and the detail page
 * cannot disagree about the same trip.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db, type Queryable } from '$lib/server/db';
import {
	place,
	person,
	trip,
	tripBooking,
	tripDestination,
	tripIdea,
	tripIdeaHeart,
	tripMember,
	tripPlace
} from '$lib/server/db/schema';
import { contactLink, document, documentLink, tagLink } from '$lib/server/db/schema';
import type { EnumValue } from '$lib/enums';
import type { PlaceRow } from '$lib/server/life/places';
import {
	parseStoredStamp,
	resolveStamp,
	stampHue,
	stampSvg,
	type ArtDefinition
} from '$lib/life/art';
import { orderBookings, type OrderableBooking } from '$lib/life/trips/booking-order';
import { attachmentFiling, insertDocumentAggregate } from '$lib/server/documents/mutations';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';
import { claimedDocuments, removeDocumentRow } from '$lib/server/documents/lifecycle';
import { isFileableTarget } from '$lib/server/documents/targets';
import { archiveScopePredicate } from '$lib/server/documents/visibility';
import { documentTypesOutOfReach } from '$lib/server/api/areas';
import { removeUpload } from '$lib/server/system/files';

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
	/** Its extension, which the in-page viewer needs to know how to show it. */
	documentExt: string | null;
	/** Whether it has a file behind it to open; a named record alone does not. */
	documentHasFile: boolean;
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
	/**
	 * Whether `art` is a stamp stored on the idea, which becoming a trip keeps,
	 * rather than one drawn from its name for this view alone.
	 */
	stampStored: boolean;
	/** Plans and other paper attached to the idea, newest first. */
	papers: AttachedPaper[];
}

/** A document attached to a trip or an idea, for a link that opens it. */
export interface AttachedPaper {
	id: string;
	name: string;
	ext: string;
	/**
	 * Whether there is a file to open. A document can be a record with no bytes
	 * behind it, and a link to its file would open a 404.
	 */
	hasFile: boolean;
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
	place: { country: string | null; city?: string | null },
	name = ''
): { svg: string; hue: string | null } | null => {
	try {
		// A row written with no stamp — an idea or a trip a script added over the
		// API, which draws nothing — is drawn from its name, country and city each
		// time it is shown, from the same inputs `createTrip` would have stored,
		// rather than left blank. Not stored, so it follows a rename, unlike a
		// stamp the app chose once and kept.
		const definition =
			art && typeof art === 'object'
				? (art as ArtDefinition)
				: resolveStamp({ name, country: place.country, city: place.city ?? null });
		return { svg: stampSvg(definition), hue: stampHue(place.country, name) };
	} catch {
		// A definition written by an older version of the generator that this one
		// cannot draw, or a row the generator cannot draw from at all — a blank
		// name, one over its 120 characters, a country that is not two letters,
		// all of which the API accepts. The card falls back to its "no stamp yet"
		// state, which is a great deal better than a screen that will not render.
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
		stamp: artOf(
			row.art,
			{ country: destinations[0]?.country ?? null, city: destinations[0]?.city },
			row.name
		)
	};
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Every trip, newest first, with what each one needs to draw a row. */
export async function listTrips(handle: Db = db): Promise<TripView[]> {
	const rows = await handle
		.select()
		.from(trip)
		.where(isNull(trip.removedAt))
		.orderBy(desc(trip.startsOn));
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
	/**
	 * Paper attached to the trip that is not a booking's confirmation — the
	 * plan it was promoted with, above all. A confirmation shows on its booking.
	 */
	papers: AttachedPaper[];
}

export async function loadTrip(id: string, handle: Db = db): Promise<TripDetail | null> {
	const [row] = await handle
		.select()
		.from(trip)
		.where(and(eq(trip.id, id), isNull(trip.removedAt)));
	if (!row) return null;

	const [destinations, members, bookings, places, papers] = await Promise.all([
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
				documentName: document.name,
				documentExt: document.ext,
				documentHasFile: sql<boolean>`${document.storedName} is not null`
			})
			.from(tripBooking)
			.leftJoin(document, eq(document.id, tripBooking.documentId))
			.where(eq(tripBooking.tripId, id)),
		handle.select().from(tripPlace).where(eq(tripPlace.tripId, id)).orderBy(asc(tripPlace.ordinal)),
		papersFor([id], handle)
	]);

	const view = toView(row, destinations.get(id) ?? [], members.get(id) ?? [], todayIso());
	return {
		...view,
		// Travel order, which is not the order they were typed in — see
		// `booking-order.ts` for why a flight sorts before the hotel it delivers
		// you to when the two share a moment.
		bookings: orderBookings(bookings as OrderableBooking[]) as BookingView[],
		places: places.map((place) => ({ id: place.id, label: place.label, done: place.done })),
		papers: (papers.get(id) ?? []).filter(
			(paper) => !bookings.some((booking) => booking.documentId === paper.id)
		)
	};
}

/**
 * The documents attached to each of these trips or ideas, newest first.
 *
 * Under the archive's own rule, as every documents card is: paper whose only
 * subjects are archived is demoted here too, so a trip does not show what the
 * Documents screen has put away.
 */
async function papersFor(ids: string[], handle: Queryable): Promise<Map<string, AttachedPaper[]>> {
	const byTarget = new Map<string, AttachedPaper[]>();
	if (ids.length === 0) return byTarget;
	const rows = await handle
		.select({
			targetId: documentLink.targetId,
			id: document.id,
			name: document.name,
			ext: document.ext,
			hasFile: sql<boolean>`${document.storedName} is not null`
		})
		.from(documentLink)
		.innerJoin(document, eq(document.id, documentLink.documentId))
		.where(and(inArray(documentLink.targetId, ids), archiveScopePredicate(false)))
		.orderBy(desc(document.addedOn), desc(document.id));
	for (const { targetId, ...paper } of rows) {
		byTarget.set(targetId, [...(byTarget.get(targetId) ?? []), paper]);
	}
	return byTarget;
}

/** The idea board, in the household's own order. */
export async function listIdeas(handle: Db = db): Promise<IdeaView[]> {
	const rows = await handle
		.select()
		.from(tripIdea)
		.where(isNull(tripIdea.removedAt))
		.orderBy(asc(tripIdea.sortOrder), asc(tripIdea.createdAt));
	if (rows.length === 0) return [];

	const papers = await papersFor(
		rows.map((row) => row.id),
		handle
	);
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
		art: artOf(row.art, { country: row.country }, row.name),
		stampStored: row.art !== null && typeof row.art === 'object',
		papers: papers.get(row.id) ?? []
	}));
}

export interface TripFigures {
	/** Trips that have not ended yet, including any the household is on now. */
	upcoming: number;
	/**
	 * Days until the next trip STARTS, or null when none is still to start —
	 * nothing booked, or every upcoming trip already under way.
	 */
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
			.where(and(gte(trip.endsOn, today), isNull(trip.removedAt)))
			.orderBy(asc(trip.startsOn)),
		handle
			.select({ n: sql<number>`count(*)::int` })
			.from(tripIdea)
			.where(isNull(tripIdea.removedAt)),
		handle.select({ n: sql<number>`count(*)::int` }).from(
			handle
				.select({ ideaId: tripIdeaHeart.ideaId })
				.from(tripIdeaHeart)
				.innerJoin(tripIdea, eq(tripIdea.id, tripIdeaHeart.ideaId))
				.where(isNull(tripIdea.removedAt))
				.groupBy(tripIdeaHeart.ideaId)
				.having(sql`count(*) = (select count(*) from ${person})`)
				.as('agreed')
		),
		handle.select({ n: sql<number>`count(*)::int` }).from(person)
	]);

	// Only a trip still to start is "next". Falling back to one already under way
	// counted the days to a start that had passed, which came out as zero and
	// read as "one starts today" for the whole of the holiday.
	const next = upcoming.find((row) => row.startsOn >= today);
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

/**
 * How long a removed trip or idea waits, hidden, before the sweep deletes it.
 *
 * Longer than the undo bar is on screen with script (six seconds), so an undo
 * pressed at the last moment always finds the row still there; short enough
 * that the archive is not holding paper for something the household has let
 * go of. A page without script keeps its bar until it is left, so an undo can
 * arrive after the sweep — `restoreIdea` and `restoreTrip` say so, and the
 * screen tells the household it came too late rather than pretending.
 */
export const REMOVAL_GRACE_MS = 60_000;

/**
 * Take an idea off the board. Hidden, not deleted: undo is `restoreIdea`, and
 * the idea is gone for good — with the plans attached to it alone — once
 * `purgeRemovedTrips` finds it removed for longer than `REMOVAL_GRACE_MS`.
 *
 * Returns the idea's name, which the undo bar shows, or null when there was
 * nothing on the board to take off.
 */
export async function removeIdea(id: string, handle: Db = db): Promise<string | null> {
	const [removed] = await handle
		.update(tripIdea)
		.set({ removedAt: new Date() })
		.where(and(eq(tripIdea.id, id), isNull(tripIdea.removedAt)))
		.returning({ name: tripIdea.name });
	return removed?.name ?? null;
}

/**
 * Undo `removeIdea`: the same idea, hearts and plans, back where it was.
 *
 * False when there is no idea to bring back — the sweep got there first — so
 * the screen can say the undo came too late instead of reporting a success
 * that changed nothing. An undo racing the sweep waits on the row lock the
 * sweep holds, and then finds either the idea or nothing.
 */
export async function restoreIdea(id: string, handle: Db = db): Promise<boolean> {
	const restored = await handle
		.update(tripIdea)
		.set({ removedAt: null })
		.where(eq(tripIdea.id, id))
		.returning({ id: tripIdea.id });
	return restored.length > 0;
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
	/** The definition the dialog previewed. See `NewIdea.art`. */
	art?: unknown;
	/**
	 * A stamp already stored on another row — the idea a trip is promoted from
	 * — kept when the form previewed none. A definition, not the string a form
	 * posts, so it is taken as it is: it was checked when it was stored, and
	 * `artOf` still refuses to draw one it cannot.
	 */
	storedArt?: ArtDefinition | null;
}

/**
 * A new trip.
 *
 * `trip.from_idea_id` is left empty: a promoted trip's idea is deleted in the
 * same transaction (see `promoteIdea`), which would null it straight away, and
 * what the idea held is carried onto the trip itself instead.
 */
export async function createTrip(input: NewTrip, handle: Queryable = db): Promise<string> {
	const id = uuidv7();
	const first = input.destinations[0];
	await handle.insert(trip).values({
		id,
		name: input.name,
		emoji: input.emoji,
		startsOn: input.startsOn,
		endsOn: input.endsOn,
		notes: input.notes,
		art:
			parseStoredStamp(input.art) ??
			input.storedArt ??
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

/**
 * Delete a trip, with an undo. Hidden at once and deleted by
 * `purgeRemovedTrips` after `REMOVAL_GRACE_MS` — bookings, places and every
 * document attached to it alone go with it then.
 */
export async function removeTrip(id: string, handle: Db = db): Promise<void> {
	await handle
		.update(trip)
		.set({ removedAt: new Date() })
		.where(and(eq(trip.id, id), isNull(trip.removedAt)));
}

/**
 * Undo `removeTrip`; false when the sweep got there first and there is no trip
 * to bring back. The same lock as `restoreIdea` settles a race with the sweep.
 */
export async function restoreTrip(id: string, handle: Db = db): Promise<boolean> {
	const restored = await handle
		.update(trip)
		.set({ removedAt: null })
		.where(eq(trip.id, id))
		.returning({ id: trip.id });
	return restored.length > 0;
}

/** The name the undo bar shows, for a trip removed and not yet swept. */
export async function removedTripName(id: string, handle: Db = db): Promise<string | null> {
	const [row] = await handle
		.select({ name: trip.name, removedAt: trip.removedAt })
		.from(trip)
		.where(eq(trip.id, id));
	return row?.removedAt ? row.name : null;
}

/**
 * Turn an idea into a trip, losing nothing it held.
 *
 * The idea is deleted — it is the same plan now, not a duplicate on the board
 * — so everything on it moves first: its note becomes the trip's notes unless
 * the form gave some, its stamp is kept unless the form previewed another, and
 * every document, tag and contact attached to it is attached to the trip. One
 * transaction, so a failure leaves the idea exactly as it was.
 *
 * An idea that is gone (removed, promoted twice by a double click, or a stale
 * or forged id off the form) makes an ordinary trip rather than failing the
 * form, so the screens hand any posted id straight here.
 */
export async function promoteIdea(
	ideaId: string,
	input: NewTrip,
	handle: Db = db
): Promise<string> {
	return handle.transaction(async (tx) => {
		const [idea] = await tx
			.select()
			.from(tripIdea)
			.where(and(eq(tripIdea.id, ideaId), isNull(tripIdea.removedAt)))
			.for('update');
		if (!idea) return createTrip(input, tx);

		const id = await createTrip(
			{
				...input,
				notes: input.notes.trim() ? input.notes : idea.note,
				// The idea's stamp as stored, which `createTrip` keeps unless the form
				// previewed one of its own. It cannot go in `art`: that is the string
				// a form posts, and a stored definition is an object, which
				// `parseStoredStamp` refuses — every promoted trip was redrawn.
				storedArt: idea.art && typeof idea.art === 'object' ? (idea.art as ArtDefinition) : null
			},
			tx
		);
		await tx.execute(sql`
			insert into ${documentLink} (document_id, target_id)
			select document_id, ${id}::uuid from ${documentLink} where target_id = ${ideaId}
			on conflict do nothing`);
		await tx.execute(sql`
			insert into ${tagLink} (tag_id, target_id)
			select tag_id, ${id}::uuid from ${tagLink} where target_id = ${ideaId}
			on conflict do nothing`);
		await tx.execute(sql`
			insert into ${contactLink} (contact_id, target_id)
			select contact_id, ${id}::uuid from ${contactLink} where target_id = ${ideaId}
			on conflict do nothing`);
		// Its links cascade with it; the copies above are what is kept.
		await tx.delete(tripIdea).where(eq(tripIdea.id, ideaId));
		return id;
	});
}

/**
 * Kinds of paper the sweep never deletes, whatever they are filed against: the
 * ones that belong to an area of their own as well as to the archive — a
 * payslip is Salary's. The same list that keeps them from a token limited to
 * Trips, asked the same way, so the sweep deletes no kind of paper a Trips
 * token could not delete itself, and a new entry there reaches here unedited.
 */
const OTHER_AREAS_PAPER = new Set<string>(
	documentTypesOutOfReach({ access: 'read-write', areas: ['trips'] }).map((entry) => entry.type)
);

/**
 * Delete what was removed more than `REMOVAL_GRACE_MS` ago, for good.
 *
 * A removed trip or idea takes with it the documents that were ITS alone — the
 * plan, the booking confirmations — files included. Anything something else
 * still claims stays, and only loses its link to what is gone:
 *
 * - paper filed against another record as well (the receipt that is also on a
 *   transaction);
 * - paper another record cites as its evidence: a salary month's payslip, an
 *   import's statement, a bill, a grant letter, a role's contract, another
 *   trip's booking (`claimedDocuments`);
 * - a kind of paper that belongs to another area, a payslip above all
 *   (`OTHER_AREAS_PAPER`), even filed against nothing else.
 *
 * So removing a trip — which a token limited to Trips may do — can never
 * delete somebody's payslip and the salary hanging off it. Run every minute
 * from boot.
 *
 * One record at a time, each in a transaction of its own, so one that fails is
 * tried again next minute without holding back the rest.
 */
export async function purgeRemovedTrips(
	handle: Db = db,
	now = new Date()
): Promise<{ trips: number; ideas: number; documents: number }> {
	const cutoff = new Date(now.getTime() - REMOVAL_GRACE_MS);
	const [trips, ideas] = await Promise.all([
		handle.select({ id: trip.id }).from(trip).where(lt(trip.removedAt, cutoff)),
		handle.select({ id: tripIdea.id }).from(tripIdea).where(lt(tripIdea.removedAt, cutoff))
	]);
	const purged = { trips: 0, ideas: 0, documents: 0 };
	const work = [
		...trips.map((row) => ({ kind: 'trips' as const, id: row.id })),
		...ideas.map((row) => ({ kind: 'ideas' as const, id: row.id }))
	];
	for (const { kind, id } of work) {
		try {
			const documents = await purgeOne(kind === 'trips' ? trip : tripIdea, id, cutoff, handle);
			if (documents === null) continue;
			purged[kind]++;
			purged.documents += documents;
		} catch (error) {
			console.error(
				`Removed ${kind === 'trips' ? 'trip' : 'idea'} ${id} could not be deleted:`,
				error
			);
		}
	}
	return purged;
}

/**
 * Delete one removed trip or idea with the paper that was its alone; null
 * when it is no longer removed.
 *
 * The row is locked and "still removed" asked again inside the transaction,
 * because the list above is already stale: an undo that lands first keeps
 * everything, and one that lands after waits for the lock and finds nothing to
 * restore. Files are unlinked only once the transaction has committed.
 */
async function purgeOne(
	table: typeof trip | typeof tripIdea,
	id: string,
	cutoff: Date,
	handle: Db
): Promise<number | null> {
	const removed = await handle.transaction(async (tx) => {
		const [row] = await tx
			.select({ id: table.id })
			.from(table)
			.where(and(eq(table.id, id), lt(table.removedAt, cutoff)))
			.for('update');
		if (!row) return null;

		const attached = await tx
			.select({ id: documentLink.documentId })
			.from(documentLink)
			.where(eq(documentLink.targetId, id));
		// Locked before anything is decided about them. Filing a document against
		// another record, or citing it from one, takes a key-share lock on it,
		// which waits for this one: a link that landed first is seen below and
		// keeps the document, and one that comes after finds it gone and fails
		// out loud — rather than being deleted with it unseen. In id order, so
		// two sweeps cannot take the same documents in opposite orders.
		const papers =
			attached.length === 0
				? []
				: await tx
						.select({ id: document.id, type: document.type })
						.from(document)
						.where(
							inArray(
								document.id,
								attached.map((link) => link.id)
							)
						)
						.orderBy(asc(document.id))
						.for('update');

		// The record first, and with it its links and every row that cascades
		// from it — a trip's own bookings above all — so whatever still claims a
		// document after this is something else.
		await tx.delete(table).where(eq(table.id, id));

		const claimed = await claimedDocuments(
			papers.map((paper) => paper.id),
			tx
		);
		const files: string[] = [];
		let documents = 0;
		for (const paper of papers) {
			if (claimed.has(paper.id) || OTHER_AREAS_PAPER.has(paper.type)) continue;
			// A refusal still undoes only this one document (a savepoint), and
			// leaves it in place rather than failing the sweep.
			const outcome = await removeDocumentRow(paper.id, tx);
			if (!outcome.ok) continue;
			documents++;
			if (outcome.storedName) files.push(outcome.storedName);
		}
		return { documents, files };
	});
	if (!removed) return null;

	// Committed. Only now are the bytes nobody's; a file that will not go is
	// bytes nothing names, not a reason to report the record as still there.
	for (const name of removed.files) {
		await removeUpload(name).catch((error) =>
			console.error(`The file ${name} of a removed trip could not be deleted:`, error)
		);
	}
	return removed.documents;
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
 *
 * Null, filing nothing, when the trip is no longer one paper may be filed
 * against — deleted in another tab and waiting for the sweep, which would
 * delete the confirmation with it a minute later without a word. The caller
 * still holds the uploaded file and removes it.
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
): Promise<string | null> {
	if (!(await isFileableTarget(input.tripId, handle))) return null;
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
			attachmentFiling({
				id: documentId,
				name: input.name,
				shelfId,
				storedName: input.storedName,
				ext: input.ext,
				contentHash: input.contentHash,
				targetId: input.tripId,
				addedOn: todayIso()
			}),
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

/**
 * Something to see, added to the end of the list.
 *
 * `placeId` is set when this came from a suggestion and null when somebody
 * typed it. Either way the LABEL is stored on the row rather than joined from
 * the dataset: a trip's list is a record of what somebody planned, and it must
 * still read correctly if the place is later retired.
 */
export async function addPlace(
	tripId: string,
	label: string,
	placeId: string | null = null,
	handle: Db = db
): Promise<string> {
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
		done: false,
		placeId
	});
	return id;
}

/**
 * Places worth seeing where this trip is going.
 *
 * By COUNTRY, not by the trip's named regions or cities. A trip that says only
 * "France" is the common case when one is first created, which is exactly when
 * suggestions are worth having — narrowing to named destinations would offer
 * nothing at the only moment it matters.
 *
 * Anything already on the list is dropped, matched on `placeId`, so an accepted
 * suggestion does not come back. A hand-typed place matches nothing and
 * therefore suppresses nothing, even when its label happens to read the same:
 * guessing that two strings are one place is how a suggestion silently vanishes.
 */
export async function suggestedPlaces(tripId: string, handle: Db = db): Promise<PlaceRow[]> {
	const countries = await handle
		.selectDistinct({ country: tripDestination.country })
		.from(tripDestination)
		.where(eq(tripDestination.tripId, tripId));
	if (!countries.length) return [];

	const taken = await handle
		.select({ placeId: tripPlace.placeId })
		.from(tripPlace)
		.where(eq(tripPlace.tripId, tripId));
	const already = new Set(taken.map((one) => one.placeId).filter((one) => one !== null));

	const rows = await handle
		.select({
			id: place.id,
			name: place.name,
			region: place.region,
			kind: place.kind,
			importance: place.importance
		})
		.from(place)
		.where(
			and(
				inArray(
					place.country,
					countries.map((one) => one.country.toUpperCase())
				),
				eq(place.retired, false)
			)
		)
		.orderBy(desc(place.importance), asc(place.sortOrder));

	return rows.filter((one) => !already.has(one.id));
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
