// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The curated places, and how they get into the database.
 *
 * Read from `geodata/places.json.gz`, which the geodata build writes with each
 * place's region already resolved against the outlines the map actually draws.
 * Nothing here consults the dataset's own region field — see
 * `src/lib/life/geo/place-region.ts` for why that field cannot be used.
 */
import { gunzipSync } from 'node:zlib';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db } from '$lib/server/db';
import { place, sightVisit } from '$lib/server/db/schema';
import type { EnumValue } from '$lib/enums';

/** Where the geodata build writes. Relative to the working directory, as tessdata is. */
const GEODATA_DIR = process.env.GEODATA_DIR ?? 'geodata';

/** Where the committed engravings live, on the same terms. */
const ICONS_DIR = process.env.PLACE_ICONS_DIR ?? 'place-icons';

/**
 * How many places go into one insert.
 *
 * Bounded rather than the whole set in one statement: nine bind parameters
 * times three and a half thousand rows is close enough to a server's limit that
 * a chunk is cheaper than finding out where that limit is.
 */
const SEED_CHUNK = 500;

export interface PlaceSeed {
	id: string;
	name: string;
	country: string;
	region: string | null;
	kind: EnumValue<'place.kind'>;
	importance: number;
	latitude: number;
	longitude: number;
	sortOrder: number;
}

/**
 * Write the dataset into the table.
 *
 * Upserts rather than `onConflictDoNothing`, which is the opposite of the bank
 * and category seeds and for the opposite reason: a household may rename a
 * category, so that seed must not revert them; nobody edits a place, so a
 * corrected name or a moved region in a later release SHOULD arrive.
 *
 * Nothing is ever deleted. A place the dataset has stopped carrying is retired,
 * because deleting it would cascade to `sight_visit` and take somebody's record
 * of having stood in front of it — the only thing in this feature a person made
 * rather than received.
 *
 * Written in batches. A row at a time was 3,422 statements on every boot, for a
 * file that changes only when the image does.
 */
export async function applyPlaces(places: PlaceSeed[], handle: Db = db): Promise<number> {
	const ids = places.map((one) => one.id);

	await handle.transaction(async (tx) => {
		for (let at = 0; at < places.length; at += SEED_CHUNK) {
			await tx
				.insert(place)
				.values(
					places
						.slice(at, at + SEED_CHUNK)
						.map((one) => ({ ...one, country: one.country.toUpperCase(), retired: false }))
				)
				.onConflictDoUpdate({
					target: place.id,
					// From the row that was being inserted, which is what makes one
					// statement able to carry many different rows' corrections.
					set: {
						name: sql`excluded.name`,
						country: sql`excluded.country`,
						region: sql`excluded.region`,
						kind: sql`excluded.kind`,
						importance: sql`excluded.importance`,
						latitude: sql`excluded.latitude`,
						longitude: sql`excluded.longitude`,
						sortOrder: sql`excluded.sort_order`,
						retired: false
					}
				});
		}

		// Everything the file no longer carries, in one statement. An empty file
		// retires the lot rather than wiping it, which is a build with no dataset
		// rather than an instruction to forget.
		await tx
			.update(place)
			.set({ retired: true })
			.where(ids.length ? notInArray(place.id, ids) : sql`true`);
	});

	return places.length;
}

/**
 * Seed from the built file.
 *
 * A no-op when the geodata has not been fetched, exactly as the map screens
 * are: an install without the geometry has no sights either, and saying so at
 * the screen beats refusing to boot.
 */
export async function seedPlaces(): Promise<number> {
	let packed: Buffer;
	try {
		packed = await readFile(join(GEODATA_DIR, 'places.json.gz'));
	} catch {
		return 0;
	}
	const places = JSON.parse(gunzipSync(packed).toString('utf8')) as PlaceSeed[];
	return applyPlaces(places);
}

export interface PlaceRow {
	id: string;
	name: string;
	region: string | null;
	kind: EnumValue<'place.kind'>;
	importance: number;
}

/** A country's places, best first, retired ones left out. */
export async function placesFor(country: string, handle: Db = db): Promise<PlaceRow[]> {
	return handle
		.select({
			id: place.id,
			name: place.name,
			region: place.region,
			kind: place.kind,
			importance: place.importance
		})
		.from(place)
		.where(and(eq(place.country, country.toUpperCase()), eq(place.retired, false)))
		.orderBy(asc(place.sortOrder));
}

/**
 * Record that a place has been seen.
 *
 * Writes `sight_visit` and NOTHING ELSE. It must never touch `visit`: that
 * table is the only answer to whether a country or region has been visited, and
 * a second writer is a second answer to one question. Seeing the Eiffel Tower
 * on a layover is not the same as having been to France, and the product says
 * so rather than deciding on somebody's behalf.
 *
 * Doing nothing on conflict because a place is seen or it is not — a second
 * scratch is the same fact, not a second visit.
 *
 * False when there is no such place. The id arrives from a form, and letting an
 * unknown one reach the insert turns a request that should be refused with a
 * reason into a foreign-key violation and a 500.
 */
export async function markSeen(placeId: string, year: number, handle: Db = db): Promise<boolean> {
	const [known] = await handle
		.select({ id: place.id })
		.from(place)
		.where(eq(place.id, placeId))
		.limit(1);
	if (!known) return false;

	await handle
		.insert(sightVisit)
		.values({ id: uuidv7(), placeId, year, seenAt: new Date() })
		.onConflictDoNothing();
	return true;
}

/** Take it back, for the few seconds the pill offers to. */
export async function unmarkSeen(placeId: string, handle: Db = db): Promise<void> {
	await handle.delete(sightVisit).where(eq(sightVisit.placeId, placeId));
}

/** Which of a country's places have been seen. */
export async function seenIn(country: string, handle: Db = db): Promise<string[]> {
	const rows = await handle
		.select({ placeId: sightVisit.placeId })
		.from(sightVisit)
		.innerJoin(place, eq(place.id, sightVisit.placeId))
		.where(eq(place.country, country.toUpperCase()));
	return rows.map((row) => row.placeId);
}

/**
 * The ids that have an engraving, read once.
 *
 * A directory listing rather than a stat per place: the coin row asks about
 * fifteen places on every country page load, and the answer cannot change while
 * the process runs — the engravings are committed and shipped inside the image,
 * so the set is fixed the moment the container starts.
 */
let drawn: Set<string> | null = null;

function available(): Set<string> {
	if (!drawn) {
		try {
			drawn = new Set(
				readdirSync(ICONS_DIR)
					.filter((name) => name.endsWith('.webp'))
					.map((name) => name.slice(0, -'.webp'.length))
			);
		} catch {
			// No engravings in this build: every country shows no coins, which is
			// the same graceful state as a partial delivery rather than an error.
			drawn = new Set();
		}
	}
	return drawn;
}

/**
 * Whether this place has an engraving, and so whether it gets a coin at all.
 *
 * There is no fallback artwork. A gold disc hiding nothing promises a reveal it
 * cannot deliver, so a place without an engraving is simply not offered.
 */
export function hasArt(id: string): boolean {
	return available().has(id);
}

/**
 * A place's engraving.
 *
 * The id is checked against the shape the dataset mints rather than being
 * joined onto a path as it arrives. Same lesson as `/files/[name]`.
 */
export async function sightArt(id: string): Promise<Uint8Array | null> {
	if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id) || !hasArt(id)) return null;
	try {
		return new Uint8Array(await readFile(join(ICONS_DIR, `${id}.webp`)));
	} catch {
		return null;
	}
}

/**
 * Which build of the engravings this is, for the URL a coin asks for.
 *
 * The served bytes are `immutable` for a year, which is right for artwork that
 * does not change and a trap the moment it does — v0.9.1 learned exactly this
 * about the map outlines, where a corrected file was invisible for a year to
 * everyone who had already opened that country. A stamp in the URL makes a
 * corrected engraving a new address instead.
 *
 * The app's own version is the honest stamp: the engravings are committed and
 * ship with the image, so they change when it does and at no other time.
 */
let stamp: string | null = null;

export async function artVersion(): Promise<string> {
	if (!stamp) {
		try {
			const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version?: string };
			stamp = pkg.version ?? 'dev';
		} catch {
			stamp = 'dev';
		}
	}
	return stamp;
}
