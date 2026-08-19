// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The broker feed, the positions it reports, and net worth over time.
 */

import {
	bigint,
	date,
	index,
	numeric,
	pgTable,
	pgView,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';
import { currency } from './money';

// ---- Investments (XTB report snapshots) ----

// A cash operation from the broker report; XTB assigns each a unique id, so
// re-uploading the same (or an overlapping) report is idempotent.
export const brokerOperation = pgTable(
	'broker_operation',
	{
		id: text('id').primaryKey(), // XTB operation ID
		type: text('type').notNull(), // Deposit | Withdrawal | Dividend | …
		ticker: text('ticker'),
		happenedAt: timestamp('happened_at', { withTimezone: true }).notNull(),
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		comment: text('comment'),
		// the broker position this cash movement belongs to — links purchases and
		// sells to holding periods for the reconstructed value curve
		positionId: text('position_id').references(() => brokerPosition.id, {
			onDelete: 'set null'
		})
	},
	(table) => [
		index('broker_operation_currency_idx').on(table.currency),
		index('broker_operation_position_idx').on(table.positionId)
	]
);

// A broker position's holding interval, from the report's Closed Positions
// sheet (authoritative purchase/sale values and times) and the open lots.
// This is what turns a single report into a value history.
export const brokerPosition = pgTable(
	'broker_position',
	{
		id: text('id').primaryKey(), // XTB position ID
		ticker: text('ticker').notNull(),
		purchaseValueMinor: bigint('purchase_value_minor', { mode: 'bigint' }),
		saleValueMinor: bigint('sale_value_minor', { mode: 'bigint' }),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
		closedAt: timestamp('closed_at', { withTimezone: true })
	},
	(table) => [index('broker_position_currency_idx').on(table.currency)]
);

// Current holdings — a snapshot replaced wholesale by each newer report.
export const holding = pgTable(
	'holding',
	{
		id: uuid('id').primaryKey(),
		ticker: text('ticker').notNull(),
		name: text('name').notNull(),
		category: text('category').notNull().default('STOCK'),
		units: numeric('units', { precision: 18, scale: 6 }).notNull(),
		valueMinor: bigint('value_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		netProfitPct: numeric('net_profit_pct', { precision: 9, scale: 2 }),
		valuedAt: timestamp('valued_at', { withTimezone: true }).notNull()
	},
	(table) => [index('holding_currency_idx').on(table.currency)]
);

// Portfolio value over time: one row per report upload day, appended forever —
// this series is the "actual" line on the value chart.
export const portfolioSnapshot = pgTable(
	'portfolio_snapshot',
	{
		day: date('day').primaryKey(),
		valueMinor: bigint('value_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency')
			.notNull()
			.references(() => currency.code)
	},
	(table) => [index('portfolio_snapshot_currency_idx').on(table.currency)]
);

// A holdings report can legitimately contain zero rows, so freshness cannot
// be inferred from the current holding table. This singleton remembers the
// exact report timestamp and account currency independently of its contents.
export const brokerImportState = pgTable(
	'broker_import_state',
	{
		id: text('id').primaryKey(),
		latestGeneratedAt: timestamp('latest_generated_at', { withTimezone: true }).notNull(),
		currency: text('currency')
			.notNull()
			.references(() => currency.code)
	},
	(table) => [index('broker_import_state_currency_idx').on(table.currency)]
);

// ---- Net worth ----

/**
 * Every valued thing the household owns or owes, one row each, with the sign
 * already applied: a loan arrives negative.
 *
 * Read-only, created by migration 0055 and declared here only so queries are
 * typed — `.existing()` keeps drizzle-kit from trying to generate it.
 *
 * `computeNetWorth` reads this and nothing else for its components, so a new
 * asset type reaches net worth by adding a UNION branch to the migration. It
 * does not reach the right GROUP without a line in `networth.ts` naming it, but
 * an unnamed kind still counts toward the total rather than vanishing.
 *
 * Amounts are in each row's own `currency`: the view knows nothing about rates.
 */
export const netWorthComponent = pgView('net_worth_component', {
	id: uuid('id'),
	/** which table the row came from: property | account | loan | holding */
	kind: text('kind'),
	/** the row's own kind, e.g. an account's `brokerage` or a property's `rented` */
	subkind: text('subkind'),
	ownerPersonId: uuid('owner_person_id'),
	currency: text('currency'),
	valueMinor: bigint('value_minor', { mode: 'bigint' }),
	valuedOn: date('valued_on')
}).existing();

// Net-worth history: upserted daily so the sidebar delta and (later) trend
// charts have real data.
export const netWorthSnapshot = pgTable(
	'net_worth_snapshot',
	{
		day: date('day').primaryKey(),
		valueMinor: bigint('value_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency')
			.notNull()
			.references(() => currency.code)
	},
	(table) => [index('net_worth_snapshot_currency_idx').on(table.currency)]
);
