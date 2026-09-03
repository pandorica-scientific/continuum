// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Making a card on a shelf.
 *
 * A card is the unit a shelf is organised by. Only two units are made from the
 * Documents screen — a subject and an organisation; people, accounts and
 * properties have screens of their own, and a card for each exists the moment
 * the record does. That is also why only those two carry a home shelf.
 *
 * Both take the shelf's lane seeds, so a new boiler starts with Receipt,
 * Warranty and Manual before anybody has filed anything against it — which is
 * the point: the missing manual is the finding, and a card with no lanes has
 * nothing to be missing.
 */
import { eq } from 'drizzle-orm';
import { unitMakesCards } from '$lib/documents/templates';
import type { EnumValue } from '$lib/enums';
import { db, type Queryable } from '$lib/server/db';
import { shelf } from '$lib/server/db/schema';
import { addLane, addOrganisation, LANE_PRESETS } from '$lib/server/organisations/mutations';
import { addSubject } from './subjects';

export interface NewCard {
	id: string;
	unit: 'subject' | 'organisation';
}

export async function createCard(
	input: {
		shelfId: string;
		name: string;
		emoji?: string;
		/** Organisations only; ignored on a subject shelf. */
		kind?: EnumValue<'organisation.kind'>;
	},
	handle: Queryable = db
): Promise<NewCard> {
	const [home] = await handle.select().from(shelf).where(eq(shelf.id, input.shelfId)).limit(1);
	if (!home) throw new Error('No such shelf.');
	if (!unitMakesCards(home.unit))
		throw new Error(`A ${home.unit} is not made from the Documents screen.`);

	if (home.unit === 'organisation') {
		// Organisations seed by KIND, not by the shelf: an employer sends payslips
		// monthly and a tax office does not, and the shelf cannot know which this
		// is. `addOrganisation` does the seeding, and is idempotent on the name.
		const org = await addOrganisation(
			{ name: input.name, shelfId: home.id, kind: input.kind, emoji: input.emoji },
			handle
		);
		return { id: org.id, unit: 'organisation' };
	}

	const id = await addSubject(input.name, input.emoji ?? '', home.id, handle);
	let sortOrder = 0;
	for (const seed of home.laneSeeds) {
		await addLane({ entityId: id, ...seed, sortOrder }, handle);
		sortOrder += 10;
	}
	return { id, unit: 'subject' };
}

/** The lane presets an organisation of this kind starts with. Re-exported so
 *  callers that seed a card do not have to know where they live. */
export { LANE_PRESETS };
