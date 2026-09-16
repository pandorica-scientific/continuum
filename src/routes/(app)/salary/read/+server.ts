// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Read a payslip without filing it, so the figures can be checked on screen
 * before anything is written. Reads only: no document stored, no entry written.
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

	// Whose slip it is decides which learned labels the reader uses.
	const personId = String(form.get('personId') ?? '').trim();
	const [owner] = personId
		? await db.select({ name: person.name }).from(person).where(eq(person.id, personId))
		: [];
	if (!owner) error(400, 'Pick whose payslip this is.');

	const reading = await readPayslip(new Uint8Array(await file.arrayBuffer()), owner.name);
	// Only the formatting falls back to the base currency; `currency` still
	// crosses as null so the dialog asks rather than silently filling one in.
	const currency = reading.currency ?? (await getBaseCurrency());

	return json({
		periodMonth: reading.periodMonth,
		currency: reading.currency,
		currencyFrom: reading.currencyFrom,
		gross: reading.grossMinor === null ? '' : formatMinor(reading.grossMinor, currency),
		net: reading.netMinor === null ? '' : formatMinor(reading.netMinor, currency),
		bonus: reading.bonusMinor === null ? '' : formatMinor(reading.bonusMinor, currency)
	});
};
