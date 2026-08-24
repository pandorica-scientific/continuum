// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Read a payslip without filing it.
 *
 * The upload dialog calls this the moment a file is chosen, so the figures are
 * on screen to be checked before anything is written. Filing blind and then
 * correcting what landed is the workflow this replaces — and a correction
 * teaches the reader a label, so a wrong one taught it the wrong thing.
 *
 * Reads only: no document is stored and no entry is written.
 */
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { readPayslip } from '$lib/server/salary';
import { getBaseCurrency } from '$lib/server/settings';
import { formatMinor } from '$lib/money';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.person) error(401, 'Sign in first.');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File) || file.size === 0) error(400, 'Choose a payslip file.');

	// Whose slip it is decides which learned labels the reader uses, so the
	// preview has to be asked the same question the filing will be.
	const personId = String(form.get('personId') ?? '').trim();
	const [owner] = personId
		? await db.select({ name: person.name }).from(person).where(eq(person.id, personId))
		: [];
	if (!owner) error(400, 'Pick whose payslip this is.');

	const currency = await getBaseCurrency();
	const reading = await readPayslip(new Uint8Array(await file.arrayBuffer()), owner.name);

	return json({
		periodMonth: reading.periodMonth,
		gross: reading.grossMinor === null ? '' : formatMinor(reading.grossMinor, currency),
		net: reading.netMinor === null ? '' : formatMinor(reading.netMinor, currency),
		bonus: reading.bonusMinor === null ? '' : formatMinor(reading.bonusMinor, currency)
	});
};
