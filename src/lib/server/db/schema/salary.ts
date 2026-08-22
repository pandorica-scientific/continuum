// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Salary, from a payslip or from the bank.
 *
 * Until now salary history was assembled entirely from documents on the
 * Payslips shelf, so a salary already sitting in the ledger — categorised as
 * such by whoever imported the statement — was invisible to it, and there was
 * nowhere to persist a correction to a figure the bank supplied.
 */

import {
	bigint,
	boolean,
	date,
	index,
	pgTable,
	text,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { account } from './accounts';
import { person } from './auth';
import { currency } from './money';
import { document } from './documents';
import { transaction } from './accounts';

export const salaryEntry = pgTable(
	'salary_entry',
	{
		id: uuid('id').primaryKey(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		/** YYYY-MM. One entry per person per month. */
		periodMonth: text('period_month').notNull(),
		/**
		 * Gross and net are two FIELDS, not two rows.
		 *
		 * A payslip states gross; a bank credit is net. They are not competing
		 * readings of one number, so a month carries both and neither has to win.
		 */
		grossMinor: bigint('gross_minor', { mode: 'bigint' }),
		netMinor: bigint('net_minor', { mode: 'bigint' }),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		/** payslip | statement | manual — where the entry came from first. */
		source: text('source').notNull().default('manual'),
		documentId: uuid('document_id').references(() => document.id, { onDelete: 'set null' }),
		transactionId: uuid('transaction_id').references(() => transaction.id, {
			onDelete: 'set null'
		}),
		/** The figure was corrected by hand, so re-reading must not overwrite it. */
		amountOverridden: boolean('amount_overridden').notNull().default(false)
	},
	(table) => [
		// One entry per person per month: a payslip and a bank credit for the same
		// month fill their own column of the SAME row rather than racing.
		uniqueIndex('salary_entry_person_month_key').on(table.personId, table.periodMonth),
		index('salary_entry_person_month_idx').on(table.personId, table.periodMonth),
		index('salary_entry_currency_idx').on(table.currency),
		index('salary_entry_document_idx').on(table.documentId),
		index('salary_entry_transaction_idx').on(table.transactionId)
	]
);

/**
 * Whose salary a payment into a JOINT account is.
 *
 * Deliberately not the `rule` table. That engine's payload is `category_id`: it
 * maps a transaction to a category, and adding a person to it would let the
 * categoriser start assigning people. The two fail differently — a
 * miscategorised coffee is a nuisance, a salary attributed to the wrong person
 * corrupts two retirement projections.
 */
export const salaryAttribution = pgTable(
	'salary_attribution',
	{
		id: uuid('id').primaryKey(),
		/** The normalised counterparty — in practice the employer's name. */
		matchKey: text('match_key').notNull(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		/** Narrow it to one account, or leave null to mean any. */
		accountId: uuid('account_id').references(() => account.id, { onDelete: 'cascade' }),
		createdOn: date('created_on').notNull().defaultNow()
	},
	(table) => [
		index('salary_attribution_key_idx').on(table.matchKey),
		index('salary_attribution_person_idx').on(table.personId),
		index('salary_attribution_account_idx').on(table.accountId)
	]
);
