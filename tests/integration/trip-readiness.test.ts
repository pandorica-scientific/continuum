// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which passport a trip reads.
 *
 * A household renewing a passport has two on file for a while, and the trip has
 * to read the one that expires LATEST — that is what makes the renewal
 * invisible. Every test here is about choosing between two rows for one person,
 * because choosing wrong is not a crash: it is a trip that says "expires before
 * you come home" over a passport that does not.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';
import { makeDocument, makePerson } from './fixtures';
import { document, documentIdentity, documentLink } from '$lib/server/db/schema';
import { tripReadiness } from '$lib/server/life/readiness';

let harness: Harness;
let person: { id: string; name: string };

beforeAll(async () => {
	harness = await startPostgres('trip-readiness', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	person = await makePerson(harness.db, { name: 'Jana' });
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.db.delete(document);
});

/** A passport on file for Jana, expiring when it says — or not saying. */
async function filePassport(country: string, expiresOn: string | null): Promise<void> {
	const row = await makeDocument(harness.db, {
		name: `${country} passport`,
		shelfKey: 'identity',
		expiresOn
	});
	await harness.db
		.insert(documentIdentity)
		.values({ documentId: row.id, kind: 'passport', country });
	await harness.db.insert(documentLink).values({ documentId: row.id, targetId: person.id });
}

const readFor = async () =>
	(
		await tripReadiness(
			{
				members: [person],
				destinations: [{ country: 'US' }],
				returnsOn: '2026-08-01'
			},
			harness.db
		)
	)[0];

describe('choosing a passport', () => {
	// The two are told apart by their issuing country, because that is the one
	// thing the readiness line carries out of the row it picked.
	it('takes the one that expires latest', async () => {
		await filePassport('CZ', '2026-09-01');
		await filePassport('PL', '2031-09-30');
		const read = await readFor();
		expect(read.passportCountry).toBe('PL');
		expect(read.passport).toBe('valid');
	});

	// A descending sort in Postgres puts nulls FIRST, so the undated one won and
	// a household that had just renewed read "no expiry date" over a passport
	// good until 2031.
	it('prefers a dated passport over one with no expiry', async () => {
		await filePassport('CZ', null);
		await filePassport('PL', '2031-09-30');
		const read = await readFor();
		expect(read.passportCountry).toBe('PL');
		expect(read.passport).toBe('valid');
	});

	it('falls back to the undated one when it is all there is', async () => {
		await filePassport('PL', null);
		const read = await readFor();
		expect(read.passportCountry).toBe('PL');
		expect(read.passport).toBe('unknown');
	});

	// Grey, not red: the archive not knowing is not the answer being bad.
	it('reports nothing on file as missing', async () => {
		const read = await readFor();
		expect(read.passport).toBe('missing');
		expect(read.visas.every((one) => one.position === 'unknown')).toBe(true);
	});
});
