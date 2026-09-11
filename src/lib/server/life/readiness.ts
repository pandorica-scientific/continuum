// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reading the household's passports out of the archive.
 *
 * Nothing here asks a household to type a passport into a trip. Since v0.8.7 an
 * identity document already carries its kind, its issuing country and its
 * expiry, and it is already linked to the person it belongs to — so a trip can
 * simply look, and the one place a passport is recorded stays the one place.
 */
import { desc, eq } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { document, documentIdentity, documentLink } from '$lib/server/db/schema';
import { passportStatus, type PassportState, type Readiness } from '$lib/life/readiness';
import { visaPosition } from '$lib/life/visa';

export interface PersonReadiness extends Readiness {
	personId: string;
	name: string;
	/** Where their passport was issued, for the visa lookup. Null if none. */
	passportCountry: string | null;
	passport: PassportState;
}

interface PassportRow {
	personId: string;
	country: string | null;
	expiresOn: string | null;
}

/**
 * One passport per person: the one that expires LATEST.
 *
 * A household renewing a passport has two on file for a while, and the old one
 * is not the answer to "can they travel in June". Ordering by expiry and taking
 * the first is what makes the renewal invisible, which is what it should be.
 *
 * A document with no expiry sorts last (`NULLS LAST` by default on DESC in
 * Postgres is NULLS FIRST, so it is stated), because a dated passport is a
 * better answer than an undated one.
 */
async function passportsByPerson(
	personIds: string[],
	handle: Db
): Promise<Map<string, PassportRow>> {
	if (personIds.length === 0) return new Map();

	const rows = await handle
		.select({
			personId: documentLink.targetId,
			country: documentIdentity.country,
			expiresOn: document.expiresOn
		})
		.from(documentIdentity)
		.innerJoin(document, eq(document.id, documentIdentity.documentId))
		.innerJoin(documentLink, eq(documentLink.documentId, document.id))
		.where(eq(documentIdentity.kind, 'passport'))
		.orderBy(desc(document.expiresOn));

	const byPerson = new Map<string, PassportRow>();
	for (const row of rows) {
		if (!personIds.includes(row.personId)) continue;
		// First wins, and the query ordered them, so this is the latest expiry.
		if (!byPerson.has(row.personId)) byPerson.set(row.personId, row);
	}
	return byPerson;
}

/**
 * The readiness line for everyone on a trip.
 *
 * A person with no passport on file gets `missing`, which is grey rather than
 * red: the archive not knowing is not the same as the answer being bad. Their
 * visa positions are `unknown` for the same reason — without a passport there
 * is no country to look the pair up from.
 */
export async function tripReadiness(
	input: {
		members: { id: string; name: string }[];
		destinations: { country: string }[];
		returnsOn: string;
	},
	handle: Db = db
): Promise<PersonReadiness[]> {
	const passports = await passportsByPerson(
		input.members.map((member) => member.id),
		handle
	);

	// The same country twice on one trip is one line, not two.
	const countries = [...new Set(input.destinations.map((destination) => destination.country))];

	return input.members.map((member) => {
		const passport = passports.get(member.id);
		const country = passport?.country ?? null;
		return {
			personId: member.id,
			name: member.name,
			passportCountry: country,
			passport: passportStatus(
				passport ? { expiresOn: passport.expiresOn } : null,
				input.returnsOn
			),
			visas: countries.map((destination) => ({
				country: destination,
				position: country ? visaPosition(country, destination) : ('unknown' as const)
			}))
		};
	});
}
