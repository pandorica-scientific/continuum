// SPDX-License-Identifier: AGPL-3.0-or-later
import { fail } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { asRowId } from '$lib/ids';
import { localToday } from '$lib/dates';
import { addManualVisit, mapFigures, visitedByCountry } from '$lib/server/life/visits';
import {
	FETCH_COMMAND,
	geoManifest,
	hasGeodata,
	projectedWorld,
	zoneCard
} from '$lib/server/life/geodata';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [visited, people, outline, zones] = await Promise.all([
		visitedByCountry(),
		db.select({ id: person.id, name: person.name }).from(person).orderBy(asc(person.name)),
		// Already projected: the browser gets 240 path strings rather than 756 kB
		// of topology to parse and project on the main thread.
		projectedWorld(),
		zoneCard()
	]);

	const manifest = geoManifest();

	/**
	 * The name the OUTLINE uses, against the code everything else uses.
	 *
	 * A feature in the world atlas has no identity but its name, and the atlas
	 * says Czechia where the rest of the world says CZ. The fetch script already
	 * reconciled the two and wrote the answer into the manifest, so this is a
	 * lookup rather than a second alias table — and a country that silently
	 * never colours in is the failure that looks like a design choice.
	 */
	const codeByName = Object.fromEntries(
		Object.entries(manifest?.countries ?? {}).map(([name, entry]) => [name, entry.code])
	);

	// Sets do not survive the trip to the browser, so they become arrays here
	// rather than being quietly lost.
	const countries = [...visited.values()].map((entry) => ({
		code: entry.country,
		regions: [...entry.regions],
		cities: [...entry.cities],
		members: [...entry.members],
		years: entry.years
	}));

	return {
		countries,
		codeByName,
		people,
		today: localToday(),
		world: outline,
		// Not a crash: a developer who has not run the fetch gets a map that says
		// so and the command that fixes it.
		geodata: hasGeodata() ? null : { missing: true as const, command: FETCH_COMMAND },
		// The only honest denominator is how many countries this map can draw.
		figures: mapFigures(visited, Object.keys(manifest?.countries ?? {}).length),
		/** The zone bands, already drawn, and which zone each country sits in. */
		zones,
		zoneCount: manifest?.zones ?? 0,
		continentTotals: manifest?.continents ?? {},
		/**
		 * A point inside each visited country, for lighting a time zone.
		 *
		 * The projected centroid of the country the outline draws — which is the
		 * only position a visit actually carries, since a visit records a name
		 * rather than a coordinate.
		 */
		places: placesFor(visited, manifest),
		credits: creditsFor(visited, manifest)
	};
};

/**
 * Somewhere inside each visited country, in longitude and latitude.
 *
 * A visit records a country and maybe a region name, never a coordinate — so
 * the honest answer to "which time zone were you in" is the middle of the
 * country, and a household that crossed Russia lights one zone rather than
 * eleven. Better a figure that is understated than one that is invented.
 */
function placesFor(
	visited: Map<string, { country: string }>,
	manifest: ReturnType<typeof geoManifest>
): Record<string, [number, number]> {
	if (!manifest) return {};
	const byCode = new Map<string, [number, number]>();
	for (const entry of Object.values(manifest.countries)) {
		if (entry.centre) byCode.set(entry.code, entry.centre);
	}
	const out: Record<string, [number, number]> = {};
	for (const code of visited.keys()) {
		const at = byCode.get(code);
		if (at) out[code] = at;
	}
	return out;
}

/**
 * The nine countries too big to count whole.
 *
 * The handoff's rule, and it is the honest one: having been to Prague is having
 * been to Czechia, but having been to New York is not having been to the United
 * States. A big country counts by the share of its regions somebody has
 * actually been to.
 */
const BIG = new Set(['US', 'RU', 'CA', 'CN', 'BR', 'AU', 'IN', 'AR', 'KZ']);

/**
 * How much of each visited country counts, from 0 to 1.
 *
 * Summed per continent by the card, because the continent each country belongs
 * to lives in a file the browser fetches rather than in the manifest.
 */
function creditsFor(
	visited: Map<string, { regions: Set<string> }>,
	manifest: ReturnType<typeof geoManifest>
): Record<string, number> {
	const slugs = new Map<string, string>();
	for (const entry of Object.values(manifest?.countries ?? {})) slugs.set(entry.code, entry.slug);

	const out: Record<string, number> = {};
	for (const [code, entry] of visited) {
		if (!BIG.has(code)) {
			out[code] = 1;
			continue;
		}
		const slug = slugs.get(code);
		// Twelve where the outline count is unknown, as the prototype assumes:
		// better a rough denominator than crediting a continent for all of Russia
		// because somebody changed planes in Moscow.
		const total = (slug ? manifest?.files[slug]?.regions : 0) || 12;
		out[code] = Math.min(1, entry.regions.size / total);
	}
	return out;
}

export const actions: Actions = {
	/**
	 * A place the household went before Continuum existed.
	 *
	 * Written with `source = 'manual'`, which the trip sweep then leaves alone
	 * forever: a country somebody scratched by hand must not be un-scratched
	 * because no trip in the ledger explains it.
	 */
	markVisited: async ({ request }) => {
		const form = await request.formData();
		const country = String(form.get('country') ?? '')
			.trim()
			.toUpperCase();
		const year = Number(form.get('year'));

		if (country.length !== 2) {
			return fail(400, { on: 'visit', message: 'Pick a country.' });
		}
		if (!Number.isFinite(year) || year < 1900 || year > 2200) {
			return fail(400, { on: 'visit', message: 'Which year was that?' });
		}

		await addManualVisit({
			country,
			region: String(form.get('region') ?? '').trim() || null,
			city: String(form.get('city') ?? '').trim() || null,
			year: Math.round(year),
			members: form
				.getAll('member')
				.map(String)
				.map(asRowId)
				.filter((id): id is string => Boolean(id))
		});
		return { marked: true };
	}
};
