// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { document } from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { buildBriefing } from '$lib/server/briefing';
import { buildIcs, generateEvents } from '$lib/server/calendar';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * Restricted paper reaches no briefing, no calendar and no feed.
 *
 * The calendar rule is absolute rather than role-dependent, and that is not an
 * oversight: a generated event syncs to iCloud, where there is no session and
 * no role to filter by. Filtering at generation time by who happens to be
 * looking would be false safety. The briefing DOES filter per viewer, because
 * the briefing is rendered inside the session boundary.
 */
let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const asAdmin = { id: 'a', role: 'admin' } as const;
const asMember = { id: 'm', role: 'member' } as const;

/** Far enough out to be a briefing item, close enough to be in range. */
const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('restricted-read-paths', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`delete from document`;
});

async function seedDocument(options: {
	name: string;
	sensitivity: 'normal' | 'restricted';
	expiresOn: string;
}) {
	const id = uuidv7();
	await testDb.insert(document).values({
		id,
		name: options.name,
		shelfId: await shelfIdByKey('household', testDb),
		type: 'other',
		sensitivity: options.sensitivity,
		expiresOn: options.expiresOn,
		expiryVerb: 'expires',
		addedOn: '2026-01-01'
	});
	return id;
}

describe('the briefing', () => {
	it("leaves a restricted document out of a member's briefing", async () => {
		await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted', expiresOn: soon });
		const { items } = await buildBriefing(asMember);
		expect(items.map((i) => i.title).join(' ')).not.toMatch(/Divorce/);
	});

	it('shows it to an admin', async () => {
		await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted', expiresOn: soon });
		const { items } = await buildBriefing(asAdmin);
		expect(items.map((i) => i.title).join(' ')).toMatch(/Divorce/);
	});

	it('shows a normal document to both', async () => {
		await seedDocument({ name: 'Passport', sensitivity: 'normal', expiresOn: soon });
		for (const actor of [asMember, asAdmin]) {
			const { items } = await buildBriefing(actor);
			expect(items.map((i) => i.title).join(' ')).toMatch(/Passport/);
		}
	});
});

describe('calendar generation', () => {
	it('generates no event for a restricted document, for anyone', async () => {
		// Not a role filter: a synced event lands on a device outside the session
		// boundary entirely, where there is no role to filter by.
		await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted', expiresOn: soon });
		const events = await generateEvents('2020-01-01', '2099-01-01', testDb);
		expect(events.some((e) => e.binding?.table === 'document')).toBe(false);
	});

	it('still generates one for a normal document', async () => {
		await seedDocument({ name: 'Passport', sensitivity: 'normal', expiresOn: soon });
		const events = await generateEvents('2020-01-01', '2099-01-01', testDb);
		expect(events.some((e) => e.binding?.table === 'document')).toBe(true);
	});

	it('keeps restricted paper out of the published feed', async () => {
		// The feed reads generated events, so it inherits the rule — which is
		// worth proving rather than assuming, because the feed is the one door
		// with no session behind it at all.
		await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted', expiresOn: soon });
		await seedDocument({ name: 'Passport', sensitivity: 'normal', expiresOn: soon });
		const ics = await buildIcs();
		expect(ics).not.toMatch(/Divorce/);
		expect(ics).toMatch(/Passport/);
	});
});
