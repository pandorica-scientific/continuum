import { rowId } from '../row-id';
import { setTimeout as delay } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { createDocument } from '$lib/server/documents/mutations';
import { missingRateCurrencies } from '$lib/server/fx';
import {
	registerHomeProvider,
	syncMeterBill,
	type HomeProvider,
	type HomeSnapshot
} from '$lib/server/home';
import { registerBrokerAdapter, type BrokerReport } from '$lib/server/invest/adapter';
import { ingestBrokerFile } from '$lib/server/invest/ingest';
import {
	createPropertyBill,
	createTenancy,
	setPropertyBillSource,
	setPropertyDrawing,
	setPropertyImage,
	updateMeterBillAmount
} from '$lib/server/property/mutations';
import { deleteSplits, saveSplits } from '$lib/server/splits';
import { setSetting } from '$lib/server/settings';
import { updateLoanTags, updatePropertyTags, updateTransactionTags } from '$lib/server/tags';
import { saveStatement } from '$lib/server/tax';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

let harness: Harness;
let testDb: TestDb;

const REPORT: BrokerReport = {
	accountCurrency: 'EUR',
	generatedAt: '2026-08-15T12:00:00.000Z',
	summaryValueMinor: 30000n,
	holdings: [
		{
			ticker: 'GOOD',
			name: 'Good holding',
			category: 'STOCK',
			units: 1,
			valueMinor: 10000n,
			netProfitPct: null
		},
		{
			ticker: 'BAD',
			name: 'Injected failure',
			category: 'STOCK',
			units: 1,
			valueMinor: 20000n,
			netProfitPct: null
		}
	],
	operations: [
		{
			id: rowId('new-operation'),
			type: 'Deposit',
			ticker: null,
			happenedAt: '2026-08-15T10:00:00.000Z',
			amountMinor: 30000n,
			comment: null,
			positionId: null
		}
	],
	positions: []
};

let activeReport = REPORT;
let delayedHomeSnapshotStarted: Promise<void>;
let markDelayedHomeSnapshotStarted: () => void;
let releaseDelayedHomeSnapshot: () => void;
let delayedHomeSnapshotRelease: Promise<void>;

const DELAYED_HOME_SNAPSHOT: HomeSnapshot = {
	metrics: [],
	rooms: [],
	attention: [],
	monthKwh: 10
};

function resetDelayedHomeProvider(): void {
	delayedHomeSnapshotStarted = new Promise<void>(
		(resolve) => (markDelayedHomeSnapshotStarted = resolve)
	);
	delayedHomeSnapshotRelease = new Promise<void>(
		(resolve) => (releaseDelayedHomeSnapshot = resolve)
	);
}

function delayedHomeProvider(): HomeProvider {
	return {
		id: rowId('domain-delayed'),
		label: 'Delayed home fixture',
		async probe() {
			return { ok: true, detail: 'connected' };
		},
		async snapshot() {
			markDelayedHomeSnapshotStarted();
			await delayedHomeSnapshotRelease;
			return DELAYED_HOME_SNAPSHOT;
		},
		async setDevice() {},
		async energyHistory() {
			return [];
		}
	};
}

beforeAll(async () => {
	harness = await startPostgres(rowId('domain-atomicity'));
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);

	registerBrokerAdapter({
		id: rowId('domain-atomicity'),
		label: 'Domain atomicity fixture',
		sniff: (fileName) => fileName.endsWith('.atomic'),
		parse: () => activeReport
	});
	registerHomeProvider(rowId('domain-delayed'), 'Delayed home fixture', delayedHomeProvider);
}, 30_000);

beforeEach(async () => {
	activeReport = REPORT;
	resetDelayedHomeProvider();
	await harness.sql.unsafe(`
		drop trigger if exists task_domain_fail_tax_line on tax_statement_line;
		drop function if exists task_domain_fail_tax_line();
		drop trigger if exists task_domain_fail_holding on holding;
		drop function if exists task_domain_fail_holding();
		drop trigger if exists task_domain_fail_document_tag on tag_link;
		drop function if exists task_domain_fail_document_tag();
		drop trigger if exists task_domain_fail_property_bill on property_bill;
		drop function if exists task_domain_fail_property_bill();
		drop trigger if exists task_domain_slow_tag_replace on tag_link;
		drop function if exists task_domain_slow_tag_replace();
		drop trigger if exists task_domain_slow_meter on property_bill;
		drop function if exists task_domain_slow_meter();
		-- entity is truncated with the rest, and must be: TRUNCATE does not fire
		-- row triggers, so the retire trigger never runs and every registration
		-- would otherwise survive into the next test. These suites reuse ids, so a
		-- stale entity of one kind would then refuse the same id as another.
		truncate table tag_link, document_link, contact_link, transaction_split,
			"transaction", property_bill, document, subject, property, tag, account,
			loan, tax_statement_line, tax_statement, broker_import_state, portfolio_snapshot, holding, broker_position,
			broker_operation, currency_rate, settings, person, entity restart identity cascade;
	`);
});

describe('home meter sync freshness', () => {
	async function seedMeterHomes(): Promise<void> {
		await testDb.insert(schema.property).values([
			{ id: rowId('old-home'), name: 'Old home', kind: 'lived', currency: 'CZK' },
			{ id: rowId('new-home'), name: 'New home', kind: 'lived', currency: 'CZK' }
		]);
		await testDb.insert(schema.propertyBill).values([
			{
				id: rowId('old-meter-bill'),
				propertyId: rowId('old-home'),
				label: 'Old meter',
				amountMinor: 111n,
				source: 'meter'
			},
			{
				id: rowId('new-meter-bill'),
				propertyId: rowId('new-home'),
				label: 'New meter',
				amountMinor: 222n,
				source: 'meter'
			}
		]);
		await setSetting(
			'home',
			{
				kind: rowId('domain-delayed'),
				meterPropertyId: rowId('old-home'),
				pricePerKwh: '100',
				pricePerKwhCurrency: 'CZK',
				endpoint: 'old-provider'
			},
			testDb
		);
	}

	it('does not write the old property after configuration changes during a delayed snapshot', async () => {
		await seedMeterHomes();
		const syncing = syncMeterBill(testDb);
		await delayedHomeSnapshotStarted;

		await setSetting(
			'home',
			{
				kind: 'demo',
				meterPropertyId: rowId('new-home'),
				pricePerKwh: '900',
				pricePerKwhCurrency: 'CZK'
			},
			testDb
		);
		releaseDelayedHomeSnapshot();

		await expect(syncing).resolves.toBeNull();
		expect(
			await testDb
				.select({ id: schema.propertyBill.id, amountMinor: schema.propertyBill.amountMinor })
				.from(schema.propertyBill)
				// Ordered by amount, not by id: ids are uuids since 0053 and sort by
				// nothing the fixture names would predict.
				.orderBy(schema.propertyBill.amountMinor)
		).toEqual([
			{ id: rowId('old-meter-bill'), amountMinor: 111n },
			{ id: rowId('new-meter-bill'), amountMinor: 222n }
		]);
	});

	it('does not write the old property after disconnect during a delayed snapshot', async () => {
		await seedMeterHomes();
		const syncing = syncMeterBill(testDb);
		await delayedHomeSnapshotStarted;

		await testDb.delete(schema.settings).where(eq(schema.settings.key, 'home'));
		releaseDelayedHomeSnapshot();

		await expect(syncing).resolves.toBeNull();
		expect(
			(await testDb.select().from(schema.propertyBill)).find(
				(bill) => bill.id === rowId('old-meter-bill')
			)
		).toMatchObject({ amountMinor: 111n });
	});
});

afterAll(async () => {
	await harness?.stop();
});

describe('domain replacement writes', () => {
	async function seedSplit(): Promise<void> {
		await testDb.insert(schema.account).values({
			id: rowId('account-split'),
			name: 'Split account',
			bank: 'other',
			currency: 'CZK'
		});
		await testDb.insert(schema.transaction).values({
			id: rowId('transaction-split'),
			accountId: rowId('account-split'),
			bookedOn: '2026-08-15',
			amountMinor: -100n,
			currency: 'CZK',
			dedupFingerprint: 'split-fixture',
			reviewState: 'confirmed'
		});
		await testDb.insert(schema.transactionSplit).values([
			{
				id: rowId('split-a'),
				transactionId: rowId('transaction-split'),
				amountMinor: -40n,
				categoryId: null,
				sort: 0
			},
			{
				id: rowId('split-b'),
				transactionId: rowId('transaction-split'),
				amountMinor: -60n,
				categoryId: null,
				sort: 1
			}
		]);
	}

	it('rejects duplicate persisted split identities without changing the stored split', async () => {
		await seedSplit();

		const result = await saveSplits(
			rowId('transaction-split'),
			[
				{ id: rowId('split-a'), amountMinor: 30n, categoryId: null },
				{ id: rowId('split-a'), amountMinor: 70n, categoryId: null }
			],
			undefined,
			testDb
		);

		expect(result).toMatchObject({ ok: false, status: 400 });
		expect(
			await testDb
				.select({
					id: schema.transactionSplit.id,
					amountMinor: schema.transactionSplit.amountMinor
				})
				.from(schema.transactionSplit)
				.orderBy(schema.transactionSplit.sort)
		).toEqual([
			{ id: rowId('split-a'), amountMinor: -40n },
			{ id: rowId('split-b'), amountMinor: -60n }
		]);
	});

	it('locks the parent before unsplitting so a concurrent save cannot deadlock on child rows', async () => {
		await seedSplit();
		const blocker = harness.connect({ max: 1 });
		const probe = harness.connect({ max: 1 });
		let releaseParent!: () => void;
		let parentLocked!: () => void;
		const release = new Promise<void>((resolveRelease) => (releaseParent = resolveRelease));
		const locked = new Promise<void>((resolveLocked) => (parentLocked = resolveLocked));
		const holding = blocker.begin(async (connection) => {
			await connection`select id from "transaction" where id = ${rowId('transaction-split')} for update`;
			parentLocked();
			await release;
		});

		await locked;
		const deleting = deleteSplits(rowId('transaction-split'), testDb).then(
			(result) => ({ result, error: null }),
			(error: unknown) => ({ result: null, error })
		);

		try {
			let waiting = false;
			for (let attempt = 0; attempt < 100; attempt++) {
				const rows = await harness.sql<{ query: string }[]>`
					select query from pg_stat_activity
					where datname = ${harness.database} and wait_event_type = 'Lock'
				`;
				if (rows.some((row) => row.query.includes('transaction'))) {
					waiting = true;
					break;
				}
				await delay(10);
			}
			expect(waiting).toBe(true);

			await expect(
				probe.begin(
					(connection) =>
						connection`select id from transaction_split where transaction_id = ${rowId('transaction-split')} for update nowait`
				)
			).resolves.toHaveLength(2);
		} finally {
			releaseParent();
			await holding;
		}

		const outcome = await deleting;
		expect(outcome.error).toBeNull();
		expect(outcome.result).toEqual({ ok: true });
		expect(await testDb.select().from(schema.transactionSplit)).toHaveLength(0);
		await blocker.end();
		await probe.end();
	});

	it('rolls a document, its new subject, links, and tags back when a tag link fails', async () => {
		await harness.sql.unsafe(`
			create function task_domain_fail_document_tag() returns trigger language plpgsql as $$
			begin
				if exists (select 1 from tag where id = new.tag_id and normalised_name = 'explode') then
					raise exception 'injected document tag failure';
				end if;
				return new;
			end $$;
			create trigger task_domain_fail_document_tag before insert on tag_link
			for each row execute function task_domain_fail_document_tag();
		`);

		let documentError: unknown;
		try {
			await createDocument(
				{
					id: rowId('document-fail'),
					name: 'Rollback document',
					shelfId: await shelfIdByKey('family', testDb),
					type: 'other',
					storedName: 'stored.pdf',
					ext: 'PDF',
					addedOn: '2026-08-15',
					expiresOn: null,
					expiryVerb: 'expires',
					personIds: [],
					propertyIds: [],
					accountIds: [],
					transactionIds: [],
					subjectIds: [],
					newSubjectName: 'Vehicle',
					tagNames: ['Safe', 'Explode']
				},
				testDb
			);
		} catch (error) {
			documentError = error;
		}
		expect(
			(documentError as { cause?: { message?: string } } | undefined)?.cause?.message
		).toContain('injected document tag failure');

		expect(await testDb.select().from(schema.document)).toHaveLength(0);
		expect(await testDb.select().from(schema.subject)).toHaveLength(0);
		expect(await testDb.select().from(schema.tag)).toHaveLength(0);
		expect(await testDb.select().from(schema.documentLink)).toHaveLength(0);
		expect(await testDb.select().from(schema.tagLink)).toHaveLength(0);
	});

	it('rolls an attached bill document and links back when the property bill insert fails', async () => {
		await testDb.insert(schema.property).values({
			id: rowId('property-a'),
			name: 'Flat A',
			kind: 'lived',
			currency: 'CZK'
		});
		await harness.sql.unsafe(`
			create function task_domain_fail_property_bill() returns trigger language plpgsql as $$
			begin
				if new.label = 'Explode' then raise exception 'injected property bill failure'; end if;
				return new;
			end $$;
			create trigger task_domain_fail_property_bill before insert on property_bill
			for each row execute function task_domain_fail_property_bill();
		`);

		let billError: unknown;
		try {
			await createPropertyBill(
				{
					id: rowId('bill-fail'),
					propertyId: rowId('property-a'),
					label: 'Explode',
					amountMinor: 1200n,
					document: {
						id: rowId('bill-document-fail'),
						name: 'Explode · Flat A',
						storedName: 'bill.pdf',
						ext: 'PDF',
						addedOn: '2026-08-15'
					}
				},
				testDb
			);
		} catch (error) {
			billError = error;
		}
		expect((billError as { cause?: { message?: string } } | undefined)?.cause?.message).toContain(
			'injected property bill failure'
		);

		expect(await testDb.select().from(schema.propertyBill)).toHaveLength(0);
		expect(await testDb.select().from(schema.document)).toHaveLength(0);
		expect(await testDb.select().from(schema.documentLink)).toHaveLength(0);
		expect(await testDb.select().from(schema.tagLink)).toHaveLength(0);
		expect(await testDb.select().from(schema.tag)).toHaveLength(0);
	});

	it('serializes overlapping tenancy inserts on their property', async () => {
		await testDb.insert(schema.property).values({
			id: rowId('property-tenancy'),
			name: 'Rental flat',
			kind: 'rented',
			currency: 'CZK'
		});
		const base = {
			propertyId: rowId('property-tenancy'),
			rentMinor: 20_000n,
			depositMinor: 40_000n,
			startsOn: '2026-01-01',
			endsOn: '2026-12-31',
			renewalNoticeOn: null
		};

		const outcomes = await Promise.all([
			createTenancy({ ...base, id: rowId('tenancy-a'), tenantName: 'Tenant A' }, testDb),
			createTenancy({ ...base, id: rowId('tenancy-b'), tenantName: 'Tenant B' }, testDb)
		]);

		expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
		expect(outcomes.filter((outcome) => !outcome.ok)).toMatchObject([{ ok: false, status: 409 }]);
		expect(await testDb.select().from(schema.tenancy)).toHaveLength(1);
	});

	it('rejects a tenancy whose end precedes its start', async () => {
		await testDb.insert(schema.property).values({
			id: rowId('property-invalid-tenancy'),
			name: 'Rental flat',
			kind: 'rented',
			currency: 'CZK'
		});

		expect(
			await createTenancy(
				{
					id: rowId('tenancy-invalid'),
					propertyId: rowId('property-invalid-tenancy'),
					tenantName: 'Tenant',
					rentMinor: 20_000n,
					depositMinor: 0n,
					startsOn: '2026-12-31',
					endsOn: '2026-01-01',
					renewalNoticeOn: null
				},
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });
		expect(await testDb.select().from(schema.tenancy)).toHaveLength(0);
	});

	it('merges concurrent property image and drawing updates after locking the row', async () => {
		await testDb.insert(schema.property).values({
			id: rowId('property-images'),
			name: 'Photo flat',
			kind: 'lived',
			currency: 'CZK',
			images: { plan: 'plan-old.png', photos: ['one.jpg'] }
		});
		const drawing = {
			cellCm: 50,
			rooms: [{ name: 'Kitchen', cells: [[0, 0] as [number, number]] }]
		};

		const outcomes = await Promise.all([
			setPropertyImage(
				{
					propertyId: rowId('property-images'),
					slot: 'photo1',
					storedName: 'two.jpg',
					expectedImage: null
				},
				testDb
			),
			setPropertyDrawing({ propertyId: rowId('property-images'), drawing }, testDb)
		]);

		expect(outcomes).toEqual([{ ok: true }, { ok: true }]);
		expect((await testDb.select().from(schema.property))[0].images).toEqual({
			plan: 'plan-old.png',
			photos: ['one.jpg', 'two.jpg'],
			drawing
		});
	});

	it('preserves both photos when concurrent requests append to the same stale slot', async () => {
		await testDb.insert(schema.property).values({
			id: rowId('property-photo-appends'),
			name: 'Photo flat',
			kind: 'lived',
			currency: 'CZK',
			images: { photos: ['one.jpg'] }
		});

		const outcomes = await Promise.all(
			['two.jpg', 'three.jpg'].map((storedName) =>
				setPropertyImage(
					{
						propertyId: rowId('property-photo-appends'),
						slot: 'photo1',
						storedName,
						expectedImage: null
					},
					testDb
				)
			)
		);

		expect(outcomes).toEqual([{ ok: true }, { ok: true }]);
		const photos = (await testDb.select().from(schema.property))[0].images.photos;
		expect(photos[0]).toBe('one.jpg');
		expect(photos.slice(1).sort()).toEqual(['three.jpg', 'two.jpg']);
	});

	it('rejects a property image slot beyond the next append position', async () => {
		await testDb.insert(schema.property).values({
			id: rowId('property-image-slot'),
			name: 'Photo flat',
			kind: 'lived',
			currency: 'CZK',
			images: { photos: ['one.jpg'] }
		});

		expect(
			await setPropertyImage(
				{
					propertyId: rowId('property-image-slot'),
					slot: 'photo3',
					storedName: 'gap.jpg',
					expectedImage: null
				},
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });
		expect((await testDb.select().from(schema.property))[0].images.photos).toEqual(['one.jpg']);
	});

	it('serializes meter-source switches and enforces one meter bill in the database', async () => {
		await testDb.insert(schema.property).values({
			id: rowId('property-meter'),
			name: 'Meter flat',
			kind: 'lived',
			currency: 'CZK'
		});
		await testDb.insert(schema.propertyBill).values([
			{ id: rowId('bill-a'), propertyId: rowId('property-meter'), label: 'Power A' },
			{ id: rowId('bill-b'), propertyId: rowId('property-meter'), label: 'Power B' }
		]);
		await harness.sql.unsafe(`
			create function task_domain_slow_meter() returns trigger language plpgsql as $$
			begin
				if new.source = 'meter' then perform pg_sleep(0.2); end if;
				return new;
			end $$;
			create trigger task_domain_slow_meter before update of source on property_bill
			for each row execute function task_domain_slow_meter();
		`);

		expect(
			await Promise.all([
				setPropertyBillSource(rowId('bill-a'), true, testDb),
				setPropertyBillSource(rowId('bill-b'), true, testDb)
			])
		).toEqual([{ ok: true }, { ok: true }]);
		expect(
			await testDb
				.select({ id: schema.propertyBill.id })
				.from(schema.propertyBill)
				.where(eq(schema.propertyBill.source, 'meter'))
		).toHaveLength(1);

		await expect(testDb.update(schema.propertyBill).set({ source: 'meter' })).rejects.toThrow();
	});

	it('reselects the meter bill after a concurrent source switch', async () => {
		await testDb.insert(schema.property).values({
			id: rowId('property-meter-sync'),
			name: 'Meter sync flat',
			kind: 'lived',
			currency: 'CZK'
		});
		await testDb.insert(schema.propertyBill).values([
			{
				id: rowId('bill-old-meter'),
				propertyId: rowId('property-meter-sync'),
				label: 'Old meter',
				amountMinor: 100n,
				source: 'meter'
			},
			{
				id: rowId('bill-new-meter'),
				propertyId: rowId('property-meter-sync'),
				label: 'New meter',
				amountMinor: 200n,
				source: 'manual'
			}
		]);
		await harness.sql.unsafe(`
			create function task_domain_slow_meter() returns trigger language plpgsql as $$
			begin
				if old.source = 'meter' and new.source = 'manual' then perform pg_sleep(0.2); end if;
				return new;
			end $$;
			create trigger task_domain_slow_meter before update of source on property_bill
			for each row execute function task_domain_slow_meter();
		`);

		const switching = setPropertyBillSource(rowId('bill-new-meter'), true, testDb);
		await delay(50);
		const syncing = updateMeterBillAmount(rowId('property-meter-sync'), 999n, testDb);
		await Promise.all([switching, syncing]);

		expect(
			await testDb
				.select({ id: schema.propertyBill.id, amountMinor: schema.propertyBill.amountMinor })
				.from(schema.propertyBill)
				// Ordered by amount, not by id: ids are uuids since 0053.
				.orderBy(schema.propertyBill.amountMinor)
		).toEqual([
			{ id: rowId('bill-old-meter'), amountMinor: 100n },
			{ id: rowId('bill-new-meter'), amountMinor: 999n }
		]);
	});

	/*
	 * RETIRED: two cases that replayed migrations 0030 and 0032 against data
	 * arranged to be ambiguous, proving each picked deterministically rather than
	 * by whatever order the planner returned.
	 *
	 * They went with the migrations themselves in the squash to a single
	 * baseline. The invariants they were protecting survive as schema: the
	 * partial unique index on property_bill(property_id) where source = 'meter'
	 * is asserted by tests/integration/baseline-migration.test.ts, and the
	 * settings key it bound is written only through setHome() now.
	 */

	it('reports every historically unconvertible salary and broker currency', async () => {
		await testDb.insert(schema.currencyRate).values([
			{ code: 'EUR', day: '2026-01-02', rate: '25' },
			{ code: 'USD', day: '2026-01-02', rate: '23' },
			{ code: 'PLN', day: '2026-01-02', rate: '5.8' }
		]);
		await testDb.insert(schema.person).values({
			id: rowId('historical-tax-person'),
			name: 'Historical Tax Person',
			initials: 'HT'
		});
		// The salary ENTRY, not the payslip document. A payslip's currency lives
		// on the entry, and the document is the file — so a month paid in a
		// currency this instance cannot convert has to be found here or nowhere.
		// The month it covers is the day the rate is wanted for, which is what
		// makes this a carry-back rather than a missing rate.
		await testDb.insert(schema.salaryEntry).values({
			id: rowId('historical-salary-entry'),
			personId: rowId('historical-tax-person'),
			periodMonth: '2020-01',
			netMinor: 100n,
			currency: 'EUR',
			source: 'payslip'
		});
		await testDb.insert(schema.brokerOperation).values({
			id: rowId('historical-operation'),
			type: 'Deposit',
			happenedAt: new Date('2020-01-02T00:00:00.000Z'),
			amountMinor: 100n,
			currency: 'USD'
		});
		await testDb.insert(schema.brokerPosition).values({
			id: rowId('historical-position'),
			ticker: 'OLD',
			purchaseValueMinor: 100n,
			saleValueMinor: null,
			currency: 'PLN',
			openedAt: new Date('2020-01-03T00:00:00.000Z'),
			closedAt: null
		});
		await testDb.insert(schema.taxStatement).values({
			id: rowId('historical-tax-statement'),
			personId: rowId('historical-tax-person'),
			year: 2020,
			country: 'CH',
			currency: 'CHF',
			grossIncomeMinor: 100n,
			taxPaidMinor: 10n
		});

		// Reported by REASON now. Everything here is dated before this instance's
		// first stored fixing, so it is a historical carry-back rather than a
		// missing rate — which is the distinction the banner needs in order to give
		// advice that is any use.
		const approximate = await missingRateCurrencies('CZK', testDb);
		expect([...approximate.carried, ...approximate.none].sort()).toEqual([
			'CHF',
			'EUR',
			'PLN',
			'USD'
		]);
	});

	it('serializes tag deltas so a concurrent add cannot restore a removed tag', async () => {
		await testDb.insert(schema.account).values({
			id: rowId('account-tags'),
			name: 'Tag account',
			bank: 'other',
			currency: 'CZK'
		});
		await testDb.insert(schema.transaction).values({
			id: rowId('transaction-tags'),
			accountId: rowId('account-tags'),
			bookedOn: '2026-08-15',
			amountMinor: -100n,
			currency: 'CZK',
			dedupFingerprint: 'tag-fixture'
		});
		await testDb.insert(schema.tag).values({
			id: rowId('tag-base'),
			name: 'Base',
			normalisedName: 'base'
		});
		await testDb
			.insert(schema.tagLink)
			.values({ targetId: rowId('transaction-tags'), tagId: rowId('tag-base') });
		// With no owner lock, both mutations load Base before either DELETE runs.
		// The adder then re-inserts that stale name after the remover commits.
		await harness.sql.unsafe(`
			create function task_domain_slow_tag_replace() returns trigger language plpgsql as $$
			begin
				perform pg_sleep(0.2);
				return null;
			end $$;
			create trigger task_domain_slow_tag_replace before delete on tag_link
			for each statement execute function task_domain_slow_tag_replace();
		`);

		await Promise.all([
			updateTransactionTags(rowId('transaction-tags'), { remove: 'Base' }, testDb),
			updateTransactionTags(rowId('transaction-tags'), { add: 'Beta' }, testDb)
		]);

		const names = await testDb
			.select({ name: schema.tag.name })
			.from(schema.tagLink)
			.innerJoin(schema.tag, eq(schema.tagLink.tagId, schema.tag.id))
			.orderBy(schema.tag.name);
		expect(names).toEqual([{ name: 'Beta' }]);
	});

	it('applies the shared delta mutation to property tags', async () => {
		await testDb.insert(schema.property).values({
			id: rowId('property-tags'),
			name: 'Tagged flat',
			kind: 'lived',
			currency: 'CZK'
		});

		await updatePropertyTags(rowId('property-tags'), { add: 'Home' }, testDb);

		expect(
			await testDb
				.select({ name: schema.tag.name })
				.from(schema.tagLink)
				.innerJoin(schema.tag, eq(schema.tagLink.tagId, schema.tag.id))
		).toEqual([{ name: 'Home' }]);
	});

	it('applies the shared delta mutation to loan tags', async () => {
		await testDb.insert(schema.loan).values({
			id: rowId('loan-tags'),
			name: 'Tagged loan',
			principalMinor: 10000n,
			owedMinor: 9000n
		});

		await updateLoanTags(rowId('loan-tags'), { add: 'Debt' }, testDb);

		expect(
			await testDb
				.select({ name: schema.tag.name })
				.from(schema.tagLink)
				.innerJoin(schema.tag, eq(schema.tagLink.tagId, schema.tag.id))
		).toEqual([{ name: 'Debt' }]);
	});

	it('keeps the prior tax statement and lines when replacement line insertion fails', async () => {
		await testDb
			.insert(schema.person)
			.values({ id: rowId('person-a'), name: 'Person A', initials: 'PA' });
		const base = {
			personId: rowId('person-a'),
			year: 2025,
			country: 'CZ',
			currency: 'CZK',
			taxPaidMinor: 2000n,
			note: null,
			attachments: [],
			linkDocumentIds: []
		};
		await saveStatement(
			{ ...base, grossIncomeMinor: 10000n, lines: [{ label: 'Original', amountMinor: 500n }] },
			testDb
		);
		await harness.sql.unsafe(`
			create function task_domain_fail_tax_line() returns trigger language plpgsql as $$
			begin
				if new.label = 'Injected failure' then raise exception 'injected tax line failure'; end if;
				return new;
			end $$;
			create trigger task_domain_fail_tax_line before insert on tax_statement_line
			for each row execute function task_domain_fail_tax_line();
		`);

		await expect(
			saveStatement(
				{
					...base,
					grossIncomeMinor: 99999n,
					lines: [{ label: 'Injected failure', amountMinor: 999n }]
				},
				testDb
			)
		).rejects.toThrow();

		const statements = await testDb.select().from(schema.taxStatement);
		const lines = await testDb.select().from(schema.taxStatementLine);
		expect(statements[0].grossIncomeMinor).toBe(10000n);
		expect(lines).toMatchObject([{ label: 'Original', amountMinor: 500n }]);
	});

	it('files no document at all when a batch save is refused', async () => {
		await testDb
			.insert(schema.person)
			.values({ id: rowId('person-a'), name: 'Person A', initials: 'PA' })
			.onConflictDoNothing();
		// The dangerous case: the uploads are already on the volume, and a refusal
		// after that point could leave documents filed against a statement that
		// was never written. Validation returns before the transaction opens.
		const result = await saveStatement(
			{
				personId: rowId('person-a'),
				year: 2025,
				country: '', // refused: "Name the country."
				currency: 'CZK',
				grossIncomeMinor: 100n,
				taxPaidMinor: 10n,
				note: null,
				lines: [],
				attachments: [
					{ storedName: 'aaaa.pdf', ext: 'PDF', addedOn: '2026-08-23', kind: 'statement' },
					{ storedName: 'bbbb.pdf', ext: 'PDF', addedOn: '2026-08-23', kind: 'broker' }
				],
				linkDocumentIds: []
			},
			testDb
		);

		expect(result.ok).toBe(false);
		expect(
			await testDb.select().from(schema.document).where(eq(schema.document.type, 'tax_document'))
		).toEqual([]);
	});

	it('files none of a batch when one document in it fails', async () => {
		await testDb
			.insert(schema.person)
			.values({ id: rowId('person-a'), name: 'Person A', initials: 'PA' })
			.onConflictDoNothing();
		// Half a batch is worse than none: the statement would show two of the
		// three papers it was given, with nothing saying the third went missing.
		await harness.sql.unsafe(`
			create function task_domain_fail_third_doc() returns trigger language plpgsql as $$
			begin
				if new.name like '%broker earnings report%' then
					raise exception 'injected document failure';
				end if;
				return new;
			end $$;
			create trigger task_domain_fail_third_doc before insert on document
			for each row execute function task_domain_fail_third_doc();
		`);

		await expect(
			saveStatement(
				{
					personId: rowId('person-a'),
					year: 2023,
					country: 'CZ',
					currency: 'CZK',
					grossIncomeMinor: 100n,
					taxPaidMinor: 10n,
					note: null,
					lines: [],
					attachments: [
						{ storedName: 'cccc.pdf', ext: 'PDF', addedOn: '2026-08-23', kind: 'statement' },
						{ storedName: 'dddd.pdf', ext: 'PDF', addedOn: '2026-08-23', kind: 'broker' }
					],
					linkDocumentIds: []
				},
				testDb
			)
		).rejects.toThrow();

		expect(
			await testDb.select().from(schema.taxStatement).where(eq(schema.taxStatement.year, 2023))
		).toEqual([]);

		await harness.sql.unsafe(`
			drop trigger task_domain_fail_third_doc on document;
			drop function task_domain_fail_third_doc();
		`);
	});

	it('rolls back the entire broker report when the new holdings snapshot fails', async () => {
		await testDb.insert(schema.holding).values({
			id: rowId('old-holding'),
			ticker: 'OLD',
			name: 'Prior snapshot',
			category: 'STOCK',
			units: '1',
			valueMinor: 7000n,
			currency: 'EUR',
			netProfitPct: null,
			valuedAt: new Date('2026-08-01T00:00:00.000Z')
		});
		await testDb.insert(schema.portfolioSnapshot).values({
			day: '2026-08-01',
			valueMinor: 7000n,
			currency: 'EUR'
		});
		await harness.sql.unsafe(`
			create function task_domain_fail_holding() returns trigger language plpgsql as $$
			begin
				if new.ticker = 'BAD' then raise exception 'injected holding failure'; end if;
				return new;
			end $$;
			create trigger task_domain_fail_holding before insert on holding
			for each row execute function task_domain_fail_holding();
		`);

		await expect(ingestBrokerFile('report.atomic', new Uint8Array(), testDb)).rejects.toThrow();

		expect(await testDb.select().from(schema.holding)).toMatchObject([
			{ id: rowId('old-holding'), ticker: 'OLD', valueMinor: 7000n }
		]);
		expect(await testDb.select().from(schema.brokerOperation)).toHaveLength(0);
		expect(await testDb.select().from(schema.portfolioSnapshot)).toMatchObject([
			{ day: '2026-08-01', valueMinor: 7000n }
		]);
	});

	it('does not let an older report resurrect holdings after a newer empty report', async () => {
		activeReport = {
			...REPORT,
			generatedAt: '2026-08-20T18:00:00.000Z',
			summaryValueMinor: 0n,
			holdings: [],
			operations: []
		};
		expect(await ingestBrokerFile('report.atomic', new Uint8Array(), testDb)).toMatchObject({
			replacedHoldings: true,
			holdings: 0
		});

		activeReport = {
			...REPORT,
			generatedAt: '2026-08-19T18:00:00.000Z',
			summaryValueMinor: 99_999n,
			holdings: [{ ...REPORT.holdings[0], ticker: 'STALE', name: 'Stale holding' }],
			operations: []
		};
		expect(await ingestBrokerFile('report.atomic', new Uint8Array(), testDb)).toMatchObject({
			replacedHoldings: false
		});

		expect(await testDb.select().from(schema.holding)).toHaveLength(0);
		// Holdings are a snapshot of now and must not come back. The older
		// report's own day is a different matter: it is a genuine record of what
		// the portfolio was worth on the 19th, and portfolio_snapshot is keyed by
		// day, so it records without touching the 20th.
		expect(
			await testDb.select().from(schema.portfolioSnapshot).orderBy(schema.portfolioSnapshot.day)
		).toMatchObject([
			{ day: '2026-08-19', valueMinor: 99_999n, currency: 'EUR' },
			{ day: '2026-08-20', valueMinor: 0n, currency: 'EUR' }
		]);
	});

	it('does not let an older same-day report overwrite the newer snapshot', async () => {
		activeReport = {
			...REPORT,
			generatedAt: '2026-08-20T18:00:00.000Z',
			summaryValueMinor: 30_000n,
			holdings: [{ ...REPORT.holdings[0], ticker: 'NEW' }],
			operations: []
		};
		await ingestBrokerFile('report.atomic', new Uint8Array(), testDb);

		activeReport = {
			...REPORT,
			generatedAt: '2026-08-20T08:00:00.000Z',
			summaryValueMinor: 10_000n,
			holdings: [{ ...REPORT.holdings[0], ticker: 'OLD' }],
			operations: []
		};
		expect(await ingestBrokerFile('report.atomic', new Uint8Array(), testDb)).toMatchObject({
			replacedHoldings: false
		});

		expect(await testDb.select().from(schema.holding)).toMatchObject([
			{ ticker: 'NEW', valueMinor: 10_000n }
		]);
		expect(await testDb.select().from(schema.portfolioSnapshot)).toMatchObject([
			{ day: '2026-08-20', valueMinor: 30_000n, currency: 'EUR' }
		]);
	});

	// portfolio_snapshot is keyed by day, so an archived report describes a row
	// the current one cannot occupy. Skipping it left the investments chart with
	// exactly the gap the backfill was uploaded to close, while the action still
	// reported the day as recorded.
	it('records a value point when an older report backfills a different day', async () => {
		activeReport = {
			...REPORT,
			generatedAt: '2026-08-20T18:00:00.000Z',
			summaryValueMinor: 30_000n,
			operations: []
		};
		await ingestBrokerFile('report.atomic', new Uint8Array(), testDb);

		activeReport = {
			...REPORT,
			generatedAt: '2026-03-31T18:00:00.000Z',
			summaryValueMinor: 12_000n,
			operations: []
		};
		expect(await ingestBrokerFile('report.atomic', new Uint8Array(), testDb)).toMatchObject({
			replacedHoldings: false
		});

		expect(
			await testDb.select().from(schema.portfolioSnapshot).orderBy(schema.portfolioSnapshot.day)
		).toMatchObject([
			{ day: '2026-03-31', valueMinor: 12_000n, currency: 'EUR' },
			{ day: '2026-08-20', valueMinor: 30_000n, currency: 'EUR' }
		]);
	});

	it('rejects a report in a different account currency without mixing the portfolio', async () => {
		activeReport = { ...REPORT, operations: [] };
		await ingestBrokerFile('report.atomic', new Uint8Array(), testDb);

		activeReport = {
			...REPORT,
			accountCurrency: 'USD',
			generatedAt: '2026-08-16T12:00:00.000Z',
			operations: []
		};
		await expect(ingestBrokerFile('report.atomic', new Uint8Array(), testDb)).rejects.toThrow(
			/currenc/i
		);

		expect(await testDb.select().from(schema.holding)).toHaveLength(2);
		expect(await testDb.select().from(schema.portfolioSnapshot)).toMatchObject([
			{ day: '2026-08-15', valueMinor: 30_000n, currency: 'EUR' }
		]);
	});

	it('does not let an older partial close overwrite a newer completed position', async () => {
		activeReport = {
			...REPORT,
			generatedAt: '2026-08-20T18:00:00.000Z',
			holdings: [],
			operations: [],
			positions: [
				{
					id: rowId('position-1'),
					ticker: 'ACME',
					purchaseValueMinor: 10_000n,
					saleValueMinor: 15_000n,
					openedAt: '2026-01-01T00:00:00.000Z',
					closedAt: '2026-08-20T12:00:00.000Z'
				}
			]
		};
		await ingestBrokerFile('report.atomic', new Uint8Array(), testDb);

		activeReport = {
			...REPORT,
			generatedAt: '2026-08-10T18:00:00.000Z',
			holdings: [],
			operations: [],
			positions: [
				{
					id: rowId('position-1'),
					ticker: 'ACME',
					purchaseValueMinor: 8_000n,
					saleValueMinor: 9_000n,
					openedAt: '2026-01-01T00:00:00.000Z',
					closedAt: '2026-08-10T12:00:00.000Z'
				}
			]
		};
		await ingestBrokerFile('report.atomic', new Uint8Array(), testDb);

		expect(await testDb.select().from(schema.brokerPosition)).toMatchObject([
			{
				id: rowId('position-1'),
				purchaseValueMinor: 10_000n,
				saleValueMinor: 15_000n,
				closedAt: new Date('2026-08-20T12:00:00.000Z')
			}
		]);
	});

	it('does not regress a closed position when a stale report has the same close time', async () => {
		const closedAt = '2026-08-20T12:00:00.000Z';
		activeReport = {
			...REPORT,
			generatedAt: '2026-08-30T18:00:00.000Z',
			holdings: [],
			operations: [],
			positions: [
				{
					id: rowId('position-same-close'),
					ticker: 'ACME',
					purchaseValueMinor: 10_000n,
					saleValueMinor: 15_000n,
					openedAt: '2026-01-01T00:00:00.000Z',
					closedAt
				}
			]
		};
		await ingestBrokerFile('report.atomic', new Uint8Array(), testDb);

		activeReport = {
			...REPORT,
			generatedAt: '2026-08-25T18:00:00.000Z',
			holdings: [],
			operations: [],
			positions: [
				{
					id: rowId('position-same-close'),
					ticker: 'ACME',
					purchaseValueMinor: 8_000n,
					saleValueMinor: 9_000n,
					openedAt: '2026-01-01T00:00:00.000Z',
					closedAt
				}
			]
		};
		await ingestBrokerFile('report.atomic', new Uint8Array(), testDb);

		expect(await testDb.select().from(schema.brokerPosition)).toMatchObject([
			{
				id: rowId('position-same-close'),
				purchaseValueMinor: 10_000n,
				saleValueMinor: 15_000n,
				closedAt: new Date(closedAt)
			}
		]);
	});

	// RETIRED: this replayed migration 0029 against a CURRENT schema to check
	// its one-time backfill. v0.3.10 collapses every migration into one baseline,
	// so 0029 will not exist to replay — and since the rename it names a column
	// (holding.as_of) that no longer exists. The freshness rule it covered is
	// exercised live by the broker ingest tests.
});
