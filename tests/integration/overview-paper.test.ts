// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { document } from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { computeNetWorth } from '$lib/server/networth';
import { loadRateTable } from '$lib/server/fx/table';
import { expenseSpendingByMonth } from '$lib/server/cashflow/spending';
import { panelData } from '$lib/server/overview';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

/**
 * The Paper panel counts, and a count is exactly where the read rule leaks.
 *
 * A member told "9 on Household" where an admin is told "10" has been told a
 * restricted document exists, which is the one fact `visibleDocumentPredicate`
 * protects. The builder reads the module-level `db` singleton rather than a
 * handle, so it has to be pointed at this harness the way the other
 * document-visibility suites do it.
 */
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const asAdmin = { id: 'a', role: 'admin' } as const;
const asMember = { id: 'm', role: 'member' } as const;

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
/** Inside the 60-day amber window every non-`due` verb watches. */
const soon = day(30);
const later = day(50);

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('overview-paper', { max: 1 });
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
	await harness.sql`truncate document cascade`;
});

async function seed(options: {
	name: string;
	shelf: string;
	sensitivity?: 'normal' | 'restricted';
	expiresOn?: string;
	addedOn?: string;
}): Promise<void> {
	await testDb.insert(document).values({
		id: uuidv7(),
		name: options.name,
		shelfId: await shelfIdByKey(options.shelf, testDb),
		type: 'other',
		sensitivity: options.sensitivity ?? 'normal',
		addedOn: options.addedOn ?? '2026-01-01',
		expiresOn: options.expiresOn ?? null,
		expiryVerb: 'expires'
	});
}

interface PaperPanel {
	inbox: number;
	expiring: { soon: number; expired: number; next: string | null };
	shelves: { key: string; label: string; emoji: string; count: number; href: string }[];
	lastFiled: string | null;
}

/** The panel as one person sees it, through the loader the screen itself uses. */
async function paperFor(actor: { id: string; role: 'admin' | 'member' }): Promise<PaperPanel> {
	const built = await panelData(['paper'], {
		baseCurrency: 'CZK',
		period: 'ytd',
		anchorMonth: null,
		netWorth: () => computeNetWorth(),
		rates: () => loadRateTable(),
		spending: () => expenseSpendingByMonth('CZK'),
		actor
	});
	return built.paper as PaperPanel;
}

describe('the Paper panel', () => {
	it('counts a restricted document for an admin and not for a member', async () => {
		await seed({ name: 'Passport', shelf: 'identity', expiresOn: soon });
		await seed({
			name: 'Divorce papers',
			shelf: 'identity',
			sensitivity: 'restricted',
			expiresOn: soon
		});

		const admin = await paperFor(asAdmin);
		const member = await paperFor(asMember);

		expect(admin.expiring.soon).toBe(2);
		expect(member.expiring.soon).toBe(1);
		expect(admin.shelves.find((s) => s.key === 'identity')?.count).toBe(2);
		expect(member.shelves.find((s) => s.key === 'identity')?.count).toBe(1);
	});

	// The inbox is the panel's own first figure, with its own link to the review
	// flow. Listing it again among the shelves would offer the same pile twice,
	// and the second offer goes to the screen that cannot file it.
	it('leaves the inbox out of the shelf list and counts it on its own', async () => {
		await seed({ name: 'Scan 004', shelf: 'inbox' });
		await seed({ name: 'Scan 005', shelf: 'inbox' });
		await seed({ name: 'Boiler service', shelf: 'household' });

		const panel = await paperFor(asAdmin);

		expect(panel.inbox).toBe(2);
		expect(panel.shelves.map((s) => s.key)).toEqual(['household']);
	});

	it('names the nearest expiry still ahead', async () => {
		await seed({ name: 'Car insurance', shelf: 'vehicles', expiresOn: later });
		await seed({ name: 'Passport', shelf: 'identity', expiresOn: soon });
		// Behind us, so it is not what happens next however recent it is.
		await seed({ name: 'Old lease', shelf: 'tenancy', expiresOn: day(-5) });

		const panel = await paperFor(asAdmin);

		expect(panel.expiring.next).toBe(soon);
	});
});
