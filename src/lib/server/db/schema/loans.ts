// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Loans, what they are secured on, and how their rate changes over time.
 */

import {
	bigint,
	boolean,
	date,
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
// Relative, not aliased: drizzle-kit loads these files outside Vite and
// does not resolve SvelteKit's $lib.
import type { EnumValue } from '../../../enums';
import { transaction } from './accounts';
import { person } from './auth';
import { currency } from './money';
import { property } from './property';

export const loan = pgTable(
	'loan',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		lender: text('lender').notNull().default(''),
		kind: text('kind').$type<EnumValue<'loan.kind'>>().notNull().default('mortgage'),
		currency: text('currency')
			.notNull()
			.default('CZK')
			.references(() => currency.code),
		principalMinor: bigint('principal_minor', { mode: 'bigint' }).notNull(),
		owedMinor: bigint('owed_minor', { mode: 'bigint' }).notNull(),
		owedOn: date('owed_on'),
		ownerPersonId: uuid('owner_person_id').references(() => person.id, { onDelete: 'set null' }),
		startsOn: date('starts_on'),
		endsOn: date('ends_on'),
		// fixed_period: rate fixed until a date, then re-fixed (mortgages)
		// fixed_term:   rate fixed for the whole life of the loan
		// floating:     rate tracks a reference
		regime: text('regime').$type<EnumValue<'loan.regime'>>().notNull().default('fixed_period'),
		// how the bank accrues interest — per loan, because banks differ:
		// 30/360 (rate ÷ 12), act/365, act/360
		dayCount: text('day_count').$type<EnumValue<'loan.day_count'>>().notNull().default('30/360'),
		// payment: accrues payment-date to payment-date on one balance
		// calendar: accrues daily over the calendar month, charged on its last
		//           day and collected with the next instalment (Česká spořitelna)
		accrualStyle: text('accrual_style')
			.$type<EnumValue<'loan.accrual_style'>>()
			.notNull()
			.default('payment'),
		// day of month the payment falls on; actual-day conventions accrue from
		// payment date to payment date
		paymentDay: integer('payment_day'),
		// czech mortgage interest on owner-occupied housing is tax deductible
		interestDeductible: boolean('interest_deductible').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('loan_currency_idx').on(table.currency),
		index('loan_owner_person_idx').on(table.ownerPersonId)
	]
);

// One mortgage agreement can secure several properties (the flats entered at
// different values with different shares owed) — the share is explicit, never
// derived. sharePct null = split proportionally to current property values.
export const loanProperty = pgTable(
	'loan_property',
	{
		id: uuid('id').primaryKey(),
		loanId: uuid('loan_id')
			.notNull()
			.references(() => loan.id, { onDelete: 'cascade' }),
		propertyId: uuid('property_id')
			.notNull()
			.references(() => property.id, { onDelete: 'cascade' }),
		sharePct: numeric('share_pct', { precision: 6, scale: 3 })
	},
	(table) => [
		uniqueIndex('loan_property_idx').on(table.loanId, table.propertyId),
		index('loan_property_property_idx').on(table.propertyId)
	]
);

// Interest is booked per fixation period so a later re-fix never rewrites
// history. ends_on null = open-ended (fixed_term / floating current period).
// The monthly payment lives here too: when a fixation ends the bank re-quotes
// the payment together with the rate.
export const loanFixationPeriod = pgTable(
	'loan_fixation_period',
	{
		id: uuid('id').primaryKey(),
		loanId: uuid('loan_id')
			.notNull()
			.references(() => loan.id, { onDelete: 'cascade' }),
		startsOn: date('starts_on').notNull(),
		endsOn: date('ends_on'),
		annualRatePct: numeric('annual_rate_pct', { precision: 6, scale: 3 }).notNull(),
		paymentMinor: bigint('payment_minor', { mode: 'bigint' }).notNull()
	},
	(table) => [
		index('loan_fixation_loan_idx').on(table.loanId),
		uniqueIndex('loan_fixation_start_idx').on(table.loanId, table.startsOn)
	]
);

// What actually happened on a loan: payments, extra repayments, re-fixes,
// fees, and balance statements. This is the booked history the projections
// anchor to, and the natural link between a loan and the transaction that
// carried the money out of an account.
export const loanEvent = pgTable(
	'loan_event',
	{
		id: uuid('id').primaryKey(),
		loanId: uuid('loan_id')
			.notNull()
			.references(() => loan.id, { onDelete: 'cascade' }),
		happenedOn: date('happened_on').notNull(),
		// payment | extra_payment | refix | fee | balance
		kind: text('kind').notNull(),
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		// interest portion of a payment, when the statement splits it
		interestMinor: bigint('interest_minor', { mode: 'bigint' }),
		note: text('note'),
		transactionId: uuid('transaction_id').references(() => transaction.id, {
			onDelete: 'set null'
		})
	},
	(table) => [
		index('loan_event_loan_idx').on(table.loanId),
		index('loan_event_transaction_idx').on(table.transactionId)
	]
);
