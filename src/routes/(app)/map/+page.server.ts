// SPDX-License-Identifier: AGPL-3.0-or-later
import { asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { localToday } from '$lib/dates';
import { mapFigures, visitedByCountry, writeVisitsForEndedTrips } from '$lib/server/life/visits';
import {
	FETCH_COMMAND,
	geoManifest,
	hasGeodata,
	projectedWorld,
	zoneCard
} from '$lib/server/life/geodata';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Also run here (not just on Trips) so a holiday reaches the map even if
	// its owner never opens the trips list. Idempotent — safe to run from both.
	await writeVisitsForEndedTrips();

	const [visited, people, outline, zones] = await Promise.all([
		visitedByCountry(),
		db.select({ id: person.id, name: person.name }).from(person).orderBy(asc(person.name)),
		// Already projected: 240 path strings, not 756 kB of topology to parse
		// and project on the main thread.
		projectedWorld(),
		zoneCard()
	]);

	const manifest = geoManifest();

	/** The name the OUTLINE uses, against the code everything else uses (e.g. Czechia vs CZ). */
	const codeByName = Object.fromEntries(
		Object.entries(manifest?.countries ?? {}).map(([name, entry]) => [name, entry.code])
	);

	// Sets do not survive the trip to the browser, so they become arrays here.
	const countries = [...visited.values()].map((entry) => ({
		code: entry.country,
		regions: [...entry.regions],
		members: [...entry.members],
		years: entry.years
	}));

	return {
		countries,
		codeByName,
		people,
		today: localToday(),
		world: outline,
		// Not a crash: a developer who hasn't run the fetch gets a map that says
		// so and the command that fixes it.
		geodata: hasGeodata() ? null : { missing: true as const, command: FETCH_COMMAND },
		figures: mapFigures(visited, Object.keys(manifest?.countries ?? {}).length),
		/** The zone bands, already drawn, and which zone each country sits in. */
		zones,
		zoneCount: manifest?.zones ?? 0,
		continentTotals: manifest?.continents ?? {},
		/** The build stamp the coin's fetch carries; see Continents.svelte. */
		geoVersion: manifest?.generated ?? 'dev',
		/** Summed per code, not assigned — several outline names share a country (e.g. AU), and assigning would overwrite the real area. */
		areas: Object.values(manifest?.countries ?? {}).reduce<Record<string, number>>((all, entry) => {
			if (entry.code) all[entry.code] = (all[entry.code] ?? 0) + (entry.area ?? 0);
			return all;
		}, {}),
		/** The projected centroid, since a visit records a name, not a coordinate. */
		places: placesFor(visited, manifest),
		credits: creditsFor(visited, manifest)
	};
};

/** A visit never carries a coordinate, so a country lights one zone (its centre), not every zone it spans. */
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

/** Countries too big to count whole — these count by share of regions visited. */
const BIG = new Set(['US', 'RU', 'CA', 'CN', 'BR', 'AU', 'IN', 'AR', 'KZ']);

/** How much of each visited country counts, from 0 to 1. */
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
		// Twelve when the outline count is unknown — a rough denominator beats
		// crediting a continent for all of Russia over a Moscow layover.
		const total = (slug ? manifest?.files[slug]?.regions : 0) || 12;
		out[code] = Math.min(1, entry.regions.size / total);
	}
	return out;
}
