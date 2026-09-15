// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Equity an employer grants, and the market prices that value it.
 *
 * A grant is restricted stock units: a number of shares that become the
 * person's on dated tranches, no purchase involved. The shares themselves sit
 * at whatever broker the employer uses, which this schema never names — the
 * household owns units and a schedule, and a daily close turns them into money.
 *
 * Prices are their own table rather than a column on a holding: the XTB
 * holdings table is replaced wholesale on every report, and the RSU grant
 * outlives any one report. Both look prices up by ticker.
 */
import {
	bigint,
	boolean,
	date,
	index,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';
import { person } from './auth';
import { currency } from './money';
import { document } from './documents';
import { engagement } from './organisations';
import type { EnumValue } from '../../../enums';

/** One close per ticker per day, in the market's own currency. */
export const securityPrice = pgTable(
	'security_price',
	{
		/** Broker form: `MSFT.US`, `VWCE.DE`. Upper case. */
		ticker: text('ticker').notNull(),
		day: date('day').notNull(),
		closeMinor: bigint('close_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		source: text('source').$type<EnumValue<'security_price.source'>>().notNull(),
		fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		primaryKey({ columns: [table.ticker, table.day] }),
		index('security_price_currency_idx').on(table.currency)
	]
);

export const equityGrant = pgTable(
	'equity_grant',
	{
		id: uuid('id').primaryKey(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		/** The employer role period the grant belongs to; the job may outlive the paper. */
		engagementId: uuid('engagement_id').references(() => engagement.id, { onDelete: 'set null' }),
		ticker: text('ticker').notNull(),
		/** The market's currency, never the household base. */
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		grantedOn: date('granted_on').notNull(),
		totalUnits: numeric('total_units', { precision: 18, scale: 6 }).notNull(),
		label: text('label'),
		/** The grant letter, where there is one. SET NULL: losing the paper does not lose the grant. */
		documentId: uuid('document_id').references(() => document.id, { onDelete: 'set null' }),
		note: text('note')
	},
	(table) => [
		index('equity_grant_person_idx').on(table.personId),
		index('equity_grant_engagement_idx').on(table.engagementId),
		index('equity_grant_document_idx').on(table.documentId),
		index('equity_grant_currency_idx').on(table.currency),
		index('equity_grant_ticker_idx').on(table.ticker)
	]
);

export const equityTranche = pgTable(
	'equity_tranche',
	{
		id: uuid('id').primaryKey(),
		grantId: uuid('grant_id')
			.notNull()
			.references(() => equityGrant.id, { onDelete: 'cascade' }),
		vestsOn: date('vests_on').notNull(),
		/** Scheduled units. */
		units: numeric('units', { precision: 18, scale: 6 }).notNull(),
		/** When the tranche actually delivered; null until recorded. */
		settledOn: date('settled_on'),
		/** Units received after any sell-to-cover. Null means "as scheduled". */
		deliveredUnits: numeric('delivered_units', { precision: 18, scale: 6 }),
		/** Units sold or withheld for tax at settlement. */
		withheldUnits: numeric('withheld_units', { precision: 18, scale: 6 }),
		/** Later disposals, so net worth stops counting them. */
		soldUnits: numeric('sold_units', { precision: 18, scale: 6 }).notNull().default('0'),
		/** Left the employer before vesting: excluded everywhere. */
		forfeitedOn: date('forfeited_on'),
		/** The employer itemised this vest on a payslip, so salary must not add it again. */
		onPayslip: boolean('on_payslip').notNull().default(false)
	},
	(table) => [
		index('equity_tranche_grant_idx').on(table.grantId),
		index('equity_tranche_vests_idx').on(table.grantId, table.vestsOn)
	]
);
