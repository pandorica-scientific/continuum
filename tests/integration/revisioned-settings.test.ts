import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { EXCEPT_FINGERPRINT_REPAIR, startPostgres, type Harness, type TestDb } from './harness';
import { exportConfig, importConfig } from '$lib/server/config-file';
import { lockTransferPairing } from '$lib/server/import/ingest';
import { mutateRuleAndReplay, saveRuleDefinition } from '$lib/server/rule-mutations';
import { loadRules } from '$lib/server/rules';
import { getRevisionedSetting, setRevisionedSetting } from '$lib/server/settings';

const migrationJournal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
	entries: Array<{ idx: number; tag: string }>;
};
const moneyCurrencyTag = migrationJournal.entries.find((entry) => entry.idx === 31)?.tag;
if (!moneyCurrencyTag) throw new Error('Migration journal is missing index 31');

let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('revisioned-settings');
	testDb = harness.db;
	// The real schema, not a hand-written subset of it. The subset that used
	// to live here had to be kept in step with schema.ts by hand, and a test
	// passing against a stale copy of a table says nothing about the real one.
	await harness.applyMigrations(EXCEPT_FINGERPRINT_REPAIR);
}, 30_000);

beforeEach(async () => {
	await harness.sql.unsafe('truncate table rule_tag, tag, rule, settings cascade;');
});

afterAll(async () => {
	await harness?.stop();
});

describe('revisioned settings', () => {
	it('does not let an older in-flight autosave overwrite a newer exit snapshot', async () => {
		const writer = '11111111-1111-4111-8111-111111111111';
		expect(await setRevisionedSetting('retirement', writer, 0, 42, { spend: 42 }, testDb)).toBe(
			true
		);
		expect(await setRevisionedSetting('retirement', writer, 0, 41, { spend: 41 }, testDb)).toBe(
			false
		);

		expect((await testDb.select().from(schema.settings))[0].value).toMatchObject({
			value: { spend: 42 },
			version: 1,
			writerId: writer,
			revision: 42
		});
		expect(await setRevisionedSetting('retirement', writer, 0, 42, { spend: 999 }, testDb)).toBe(
			true
		);
		expect(
			(await getRevisionedSetting<{ spend: number }>('retirement', { spend: 0 }, testDb)).value
		).toEqual({ spend: 42 });
	});

	it('upgrades a legacy unversioned value on the first revised save', async () => {
		await testDb.insert(schema.settings).values({ key: 'retirement', value: { spend: 1 } });

		const writer = '22222222-2222-4222-8222-222222222222';
		expect(await setRevisionedSetting('retirement', writer, 0, 1, { spend: 2 }, testDb)).toBe(true);
		expect((await testDb.select().from(schema.settings))[0].value).toMatchObject({
			value: { spend: 2 },
			version: 1,
			writerId: writer,
			revision: 1
		});
	});

	it('exports only the retirement payload, not autosave concurrency metadata', async () => {
		const writer = '88888888-8888-4888-8888-888888888888';
		await setRevisionedSetting('retirement', writer, 0, 1, { spend: 42 }, testDb);

		const exported = await exportConfig(testDb);

		expect(exported.settings.retirement).toEqual({ spend: 42 });
		expect(exported.settings.retirement).not.toHaveProperty('writerId');
	});

	// Export unwraps the payload, so import has to re-wrap it. Writing the bare
	// value reset the version to 0: a tab still holding baseVersion 0 then
	// passed the concurrency check and silently replaced the file that had just
	// been imported.
	it('re-versions an imported retirement payload above any open tab', async () => {
		const writer = '99999999-9999-4999-8999-999999999999';
		await setRevisionedSetting('retirement', writer, 0, 1, { spend: 42 }, testDb);
		const staleBaseVersion = (await getRevisionedSetting('retirement', { spend: 0 }, testDb))
			.version;

		await importConfig(
			{
				continuum: 1,
				exportedAt: '2026-08-15T00:00:00.000Z',
				settings: { retirement: { spend: 7 } }
			},
			testDb
		);

		const imported = await getRevisionedSetting('retirement', { spend: 0 }, testDb);
		expect(imported.value).toEqual({ spend: 7 });
		expect(imported.version).toBeGreaterThan(staleBaseVersion);

		// The tab that was open before the import is refused, not silently obeyed.
		expect(
			await setRevisionedSetting('retirement', writer, staleBaseVersion, 2, { spend: 42 }, testDb)
		).toBe(false);
		expect((await getRevisionedSetting('retirement', { spend: 0 }, testDb)).value).toEqual({
			spend: 7
		});
	});

	it('preserves values written by the short-lived per-writer wrapper format', async () => {
		await testDb.insert(schema.settings).values({
			key: 'retirement',
			value: {
				value: { spend: 12 },
				writers: {
					'77777777-7777-4777-8777-777777777777': { revision: 3, touchedAt: 1 }
				}
			}
		});

		expect(await getRevisionedSetting('retirement', { spend: 0 }, testDb)).toMatchObject({
			value: { spend: 12 },
			version: 0
		});
	});

	it('requires a second tab to reload before replacing a value saved after it loaded', async () => {
		const firstWriter = '33333333-3333-4333-8333-333333333333';
		const secondWriter = '44444444-4444-4444-8444-444444444444';
		expect(
			await setRevisionedSetting('retirement', firstWriter, 0, 10, { spend: 10 }, testDb)
		).toBe(true);
		expect(
			await setRevisionedSetting('retirement', secondWriter, 0, 1, { spend: 20 }, testDb)
		).toBe(false);
		const refreshed = await getRevisionedSetting<{ spend: number }>(
			'retirement',
			{ spend: 0 },
			testDb
		);
		expect(refreshed).toMatchObject({ value: { spend: 10 }, version: 1 });
		expect(
			await setRevisionedSetting(
				'retirement',
				secondWriter,
				refreshed.version,
				1,
				{ spend: 20 },
				testDb
			)
		).toBe(true);
		expect(
			await setRevisionedSetting('retirement', firstWriter, 0, 11, { spend: 11 }, testDb)
		).toBe(false);
		expect(
			(await getRevisionedSetting<{ spend: number }>('retirement', { spend: 0 }, testDb)).value
		).toEqual({ spend: 20 });
	});

	it('lets only one of two tabs loaded at the same version win', async () => {
		const results = await Promise.all([
			setRevisionedSetting(
				'retirement',
				'55555555-5555-4555-8555-555555555555',
				0,
				1,
				{ spend: 10 },
				testDb
			),
			setRevisionedSetting(
				'retirement',
				'66666666-6666-4666-8666-666666666666',
				0,
				1,
				{ spend: 20 },
				testDb
			)
		]);

		expect(results.filter(Boolean)).toHaveLength(1);
	});
});

describe('rule definition mutation', () => {
	it('takes the pairing lock before a rule row, matching filing lock order', async () => {
		await testDb.insert(schema.rule).values({
			id: 'rule-order',
			name: 'Original',
			conditions: [{ field: 'description', op: 'contains', value: 'rent' }]
		});

		let announceFirstLock!: () => void;
		const firstHasLock = new Promise<void>((resolve) => (announceFirstLock = resolve));
		let releaseFirst!: () => void;
		const firstMayFinish = new Promise<void>((resolve) => (releaseFirst = resolve));
		const filingPath = testDb.transaction(async (tx) => {
			await lockTransferPairing(tx);
			announceFirstLock();
			await firstMayFinish;
			await tx.update(schema.rule).set({ name: 'Filed' }).where(eq(schema.rule.id, 'rule-order'));
		});
		await firstHasLock;

		let mutationEntered = false;
		const rulePath = mutateRuleAndReplay(
			async (tx) => {
				mutationEntered = true;
				await tx
					.update(schema.rule)
					.set({ name: 'Rule edit' })
					.where(eq(schema.rule.id, 'rule-order'));
				return true;
			},
			async () => undefined,
			testDb
		);

		try {
			await new Promise((resolve) => setTimeout(resolve, 75));
			expect(mutationEntered).toBe(false);
		} finally {
			releaseFirst();
		}
		await Promise.all([filingPath, rulePath]);
		expect((await testDb.select().from(schema.rule))[0].name).toBe('Rule edit');
	});

	it('rolls the rule and tag replacement back when replay fails', async () => {
		await testDb.insert(schema.rule).values({
			id: 'rule-a',
			name: 'Original',
			provenance: 'manual',
			conditions: [{ field: 'counterparty', op: 'contains', value: 'old' }]
		});
		await testDb.insert(schema.tag).values({
			id: 'tag-old',
			name: 'Old',
			normalisedName: 'old'
		});
		await testDb.insert(schema.ruleTag).values({ ruleId: 'rule-a', tagId: 'tag-old' });

		await expect(
			saveRuleDefinition(
				{
					id: 'rule-a',
					name: 'Replacement',
					conditions: [{ field: 'counterparty', op: 'contains', value: 'new' }],
					categoryId: null,
					tagNames: ['New']
				},
				async (tx) => {
					await tx.insert(schema.settings).values({ key: 'replay-write', value: true });
					throw new Error('injected replay failure');
				},
				testDb
			)
		).rejects.toThrow('injected replay failure');

		expect(await testDb.select().from(schema.rule)).toMatchObject([
			{ id: 'rule-a', name: 'Original' }
		]);
		expect(await testDb.select().from(schema.tag)).toMatchObject([{ id: 'tag-old', name: 'Old' }]);
		expect(await testDb.select().from(schema.ruleTag)).toEqual([
			{ ruleId: 'rule-a', tagId: 'tag-old' }
		]);
		expect(await testDb.select().from(schema.settings)).toEqual([]);
	});

	it('rolls a non-save rule mutation back with replay writes', async () => {
		await testDb.insert(schema.rule).values({
			id: 'rule-toggle',
			name: 'Toggle me',
			conditions: [{ field: 'description', op: 'contains', value: 'rent' }]
		});

		await expect(
			mutateRuleAndReplay(
				async (tx) => {
					await tx
						.update(schema.rule)
						.set({ enabled: false })
						.where(eq(schema.rule.id, 'rule-toggle'));
					return true;
				},
				async (tx) => {
					await tx.insert(schema.settings).values({ key: 'replay-write', value: true });
					throw new Error('injected replay failure');
				},
				testDb
			)
		).rejects.toThrow('injected replay failure');

		expect((await testDb.select().from(schema.rule))[0].enabled).toBe(true);
		expect(await testDb.select().from(schema.settings)).toEqual([]);
	});
});

describe('legacy monetary currency migration', () => {
	it('is present in the Drizzle journal and split into executable statements', () => {
		const parsed = readMigrationFiles({ migrationsFolder: 'drizzle' });
		const migration = parsed[migrationJournal.entries.findIndex((entry) => entry.idx === 31)];

		expect(moneyCurrencyTag).toBe('0031_bind_legacy_money_currencies');
		expect(migration.sql).toHaveLength(2);
	});

	it('keeps rule bounds and the meter price in their upgrade-time base currency', async () => {
		await testDb.insert(schema.settings).values([
			{ key: 'baseCurrency', value: 'CZK' },
			{ key: 'home', value: { kind: 'homeassistant', pricePerKwh: '650' } }
		]);
		await testDb.insert(schema.rule).values({
			id: 'legacy-amount',
			name: 'Legacy amount',
			conditions: [{ field: 'amount', op: 'between', min: '10000', max: null }]
		});

		for (const statement of readMigrationFiles({ migrationsFolder: 'drizzle' })[
			migrationJournal.entries.findIndex((entry) => entry.idx === 31)
		].sql) {
			await harness.sql.unsafe(statement);
		}
		await testDb
			.update(schema.settings)
			.set({ value: 'EUR' })
			.where(eq(schema.settings.key, 'baseCurrency'));

		expect((await loadRules(testDb))[0].conditions).toEqual([
			{ field: 'amount', op: 'between', min: '10000', max: null, currency: 'CZK' }
		]);
		const home = (await testDb.select().from(schema.settings)).find((row) => row.key === 'home');
		expect(home?.value).toEqual({
			kind: 'homeassistant',
			pricePerKwh: '650',
			pricePerKwhCurrency: 'CZK'
		});
	});
});
